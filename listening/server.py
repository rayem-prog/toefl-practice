"""Loopback-only practice app and credential-free frontend API."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
import threading
from urllib.parse import urlsplit, parse_qs
from speech import ConfigStore, SpeechCache, synthesize, VOICES

ROOT = Path(__file__).resolve().parent
STATIC = {'/': ('index.html', 'text/html; charset=utf-8'),
          '/index.html': ('index.html', 'text/html; charset=utf-8'),
          '/styles.css': ('styles.css', 'text/css; charset=utf-8'),
          '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
          '/core.js': ('core.js', 'text/javascript; charset=utf-8')}


class PracticeServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, config_store=None, cache=None):
        super().__init__(address, Handler)
        self.bank = json.loads((ROOT / 'data/questions.json').read_text())
        self.questions = {q['id']: q for q in self.bank['questions']}
        self.config = config_store or ConfigStore()
        self.cache = cache or SpeechCache(ROOT / 'audio', lambda text, voice: synthesize(text, voice, self.config))
        self.token = secrets.token_urlsafe(32)
        self.job = None
        self.job_lock = threading.Lock()

    def status(self):
        return {'application': 'toefl-response', **self.config.public(), 'token': self.token,
                'questions': len(self.questions), 'sets': len(self.bank['sets']),
                'cachedFiles': len(list(self.cache.path.glob('*.wav'))), 'job': self.job}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # URLs and request bodies are deliberately not written to logs.
        pass

    def send(self, status, data, mime='application/json; charset=utf-8'):
        if not isinstance(data, bytes): data = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        try: self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError): pass

    def allowed(self, mutating=False):
        host = f'127.0.0.1:{self.server.server_port}'
        if self.headers.get('Host') != host:
            self.send(403, {'error': '只允许从本机练习页面访问。'}); return False
        origin = self.headers.get('Origin')
        if origin and origin != f'http://{host}':
            self.send(403, {'error': '不允许跨站访问。'}); return False
        if mutating and not secrets.compare_digest(self.headers.get('X-Session-Token', ''), self.server.token):
            self.send(403, {'error': '页面连接已过期，请刷新。'}); return False
        return True

    def do_GET(self):
        if not self.allowed(): return
        parsed = urlsplit(self.path)
        path = parsed.path
        if path == '/api/status':
            self.send(200, self.server.status())
        elif path == '/api/bank':
            self.send(200, self.server.bank)
        elif path.startswith('/api/audio/'):
            if not self.allowed(mutating=True): return
            question = self.server.questions.get(path.removeprefix('/api/audio/'))
            voice = parse_qs(parsed.query).get('voice', ['Serena'])[0]
            if not question:
                self.send(404, {'error': '题目不存在。'}); return
            if voice not in VOICES:
                self.send(400, {'error': '请选择支持的音色。'}); return
            try:
                audio = self.server.cache.get(question['prompt'], voice)
                self.send(200, audio.read_bytes(), 'audio/wav')
            except ValueError as exc:
                self.send(422, {'error': str(exc)})
            except Exception:
                self.send(502, {'error': '语音生成失败，请稍后重试。'})
        elif path in STATIC:
            filename, mime = STATIC[path]
            self.send(200, (ROOT / filename).read_bytes(), mime)
        elif path == '/favicon.ico':
            self.send(204, b'', 'image/x-icon')
        else:
            self.send(404, {'error': '页面不存在。'})

    def do_POST(self):
        if not self.allowed(mutating=True): return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 8192: raise ValueError('请求长度无效。')
            if not self.headers.get('Content-Type', '').startswith('application/json'):
                raise ValueError('请求格式无效。')
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict): raise ValueError('请求格式无效。')
        except (ValueError, json.JSONDecodeError):
            self.send(400, {'error': '请求格式无效。'}); return
        path = urlsplit(self.path).path
        if path == '/api/config':
            try:
                if data.get('forget'):
                    self.server.config.forget()
                else:
                    self.server.config.save(str(data.get('key', '')), str(data.get('region', 'beijing')))
                self.send(200, self.server.config.public())
            except ValueError as exc:
                self.send(400, {'error': str(exc)})
        elif path == '/api/prewarm':
            voice = data.get('voice', 'Serena')
            ids = data.get('ids', [])
            if not isinstance(ids, list) or not 1 <= len(ids) <= 20 or any(not isinstance(i, str) or i not in self.server.questions for i in ids) or voice not in VOICES:
                self.send(400, {'error': '一次可预生成 1 至 20 道题。'}); return
            if not self.server.config.public()['configured']:
                self.send(422, {'error': '请先保存百炼 API Key。'}); return
            with self.server.job_lock:
                if self.server.job and self.server.job['running']:
                    self.send(409, {'error': '已有一组音频在生成，请等待完成。'}); return
                self.server.job = {'running': True, 'total': len(ids), 'done': 0, 'errors': 0, 'error': ''}
            threading.Thread(target=self.prewarm, args=(ids, voice), daemon=True).start()
            self.send(202, {'started': True})
        else:
            self.send(404, {'error': '接口不存在。'})

    def prewarm(self, ids, voice):
        server = self.server
        def one(question_id):
            try:
                server.cache.get(server.questions[question_id]['prompt'], voice)
            except Exception as exc:
                with server.job_lock:
                    server.job['errors'] += 1
                    server.job['error'] = str(exc) if isinstance(exc, ValueError) else '生成失败，请重试。'
            finally:
                with server.job_lock: server.job['done'] += 1
        with ThreadPoolExecutor(max_workers=3) as executor:
            list(executor.map(one, ids))
        with server.job_lock: server.job['running'] = False


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument('--port', type=int, default=18765)
    args = cli.parse_args()
    server = PracticeServer(('127.0.0.1', args.port))
    print(f'Listening practice ready: http://127.0.0.1:{args.port}', flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()


if __name__ == '__main__':
    main()
