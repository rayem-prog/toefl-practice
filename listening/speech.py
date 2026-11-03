"""Qwen connected-speech synthesis and atomic WAV cache. Never logs credentials."""
import base64
from collections import defaultdict
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
import wave

MODEL = 'qwen3-tts-instruct-flash'
VOICES = {'Serena': '英文女声 · Serena', 'Ethan': '英文男声 · Ethan', 'Cherry': '英文女声 · Cherry'}
REGIONS = {'beijing': 'https://dashscope.aliyuncs.com', 'singapore': 'https://dashscope-intl.aliyuncs.com'}
INSTRUCTIONS = (
    'Speak the supplied English text exactly, in a natural General American accent, '
    'as one speaker in a short university-campus conversation for a listening comprehension exercise. '
    'Use a normal conversational pace and natural connected speech, not slow word-by-word reading. '
    'Link consonants to following vowels across word boundaries; use fluent contractions and '
    'natural weak forms and unstressed schwa for function words, including articles, prepositions, '
    'pronouns and auxiliary verbs. Use natural American flapped t where appropriate. '
    'Stress the words that convey meaning and intent. Keep negation, contrast and question words '
    'audible; do not over-reduce them. Use intonation appropriate to a request, question or statement. '
    'Sound neutral and natural, not theatrical, cheerful advertising or a robotic announcer. '
    'Do not add, omit, paraphrase or repeat any words. No introduction, question numbers, music or sound effects.'
)
STYLE = hashlib.sha256(INSTRUCTIONS.encode()).hexdigest()[:16]


def audio_key(text, voice, style=STYLE):
    return hashlib.sha256(json.dumps(['qwen', MODEL, text, voice, style], ensure_ascii=False).encode()).hexdigest()


def request_body(text, voice):
    if voice not in VOICES or not text.strip() or len(text) > 600:
        raise ValueError('不支持的音色或题干长度。')
    return {'model': MODEL, 'input': {'text': text, 'voice': voice, 'language_type': 'English',
                                     'instructions': INSTRUCTIONS, 'optimize_instructions': False}}


class ConfigStore:
    def __init__(self, path=None):
        self.path = path or Path.home() / '.config/toefl-response/credentials.json'
        self.lock = threading.RLock()

    def load(self):
        with self.lock:
            if self.path.exists():
                return json.loads(self.path.read_text(encoding='utf-8'))
            return {'key': os.environ.get('DASHSCOPE_API_KEY', ''), 'region': 'beijing'}

    def save(self, key, region):
        if region not in REGIONS:
            raise ValueError('请选择北京或新加坡地域。')
        with self.lock:
            key = key.strip() or self.load().get('key', '')
            if not key or len(key) > 2048 or any(ord(c) < 33 for c in key):
                raise ValueError('请输入有效的百炼 API Key。')
            self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            fd, temp = tempfile.mkstemp(dir=self.path.parent, prefix='.credentials-')
            try:
                with os.fdopen(fd, 'w', encoding='utf-8') as out:
                    os.chmod(temp, 0o600)
                    json.dump({'key': key, 'region': region}, out)
                os.replace(temp, self.path)
            finally:
                if os.path.exists(temp): os.unlink(temp)

    def forget(self):
        with self.lock:
            self.path.unlink(missing_ok=True)

    def public(self):
        config = self.load()
        return {'configured': bool(config.get('key')), 'region': config.get('region', 'beijing'),
                'model': MODEL, 'voices': VOICES}


def wav_duration(data):
    try:
        with wave.open(io.BytesIO(data), 'rb') as wav:
            duration = wav.getnframes() / wav.getframerate()
            if duration <= 0 or duration > 120:
                raise ValueError('返回的语音时长无效。')
            return duration
    except (wave.Error, EOFError) as exc:
        raise ValueError('语音服务未返回有效 WAV 文件，请重试。') from exc


def synthesize(text, voice, config_store):
    config = config_store.load()
    if not config.get('key'):
        raise ValueError('请先在语音设置中保存百炼 API Key。')
    url = REGIONS[config['region']] + '/api/v1/services/aigc/multimodal-generation/generation'
    body = request_body(text, voice)
    request = urllib.request.Request(url, data=json.dumps(body).encode(),
                                     headers={'Authorization': 'Bearer ' + config['key'], 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            result = json.loads(response.read(2_000_000))
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise ValueError('百炼拒绝访问：请检查 Key 是否有效、地域是否一致，以及语音模型权限。') from None
        if exc.code == 429:
            raise ValueError('百炼请求过于频繁或额度不足，请稍后重试并检查控制台。') from None
        raise ValueError(f'百炼语音请求失败（HTTP {exc.code}），请检查模型权限后重试。') from None
    except (urllib.error.URLError, TimeoutError):
        raise ValueError('连接百炼超时或失败，请检查网络后重试。') from None
    output = result.get('output') or {}
    info = output.get('audio') or {}
    if info.get('data'):
        data = base64.b64decode(info['data'], validate=True)
    elif info.get('url'):
        # The documented non-streaming output is a temporary OSS WAV URL.
        asset = urllib.parse.urlsplit(info['url'])
        if asset.scheme not in ('https', 'http') or not (asset.hostname or '').endswith('.aliyuncs.com'):
            raise ValueError('语音服务返回了不支持的文件地址。')
        asset_url = urllib.parse.urlunsplit(('https', asset.netloc, asset.path, asset.query, ''))
        try:
            with urllib.request.urlopen(asset_url, timeout=45) as response:
                data = response.read(20_000_001)
        except (urllib.error.URLError, TimeoutError):
            raise ValueError('语音已生成，但文件下载失败，请重试。') from None
    else:
        raise ValueError('百炼没有返回语音，请检查语音模型权限、额度和地域。')
    if len(data) > 20_000_000:
        raise ValueError('返回的语音文件过大。')
    wav_duration(data)
    return data


class SpeechCache:
    def __init__(self, path, synth):
        self.path = Path(path)
        self.path.mkdir(parents=True, exist_ok=True)
        self.synth = synth
        self.locks = defaultdict(threading.Lock)
        self.lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(3)

    def target(self, text, voice):
        return self.path / (audio_key(text, voice) + '.wav')

    def get(self, text, voice):
        target = self.target(text, voice)
        with self.lock:
            lock = self.locks[target.name]
        with lock:
            if target.exists():
                wav_duration(target.read_bytes())
                return target
            with self.slots:
                data = self.synth(text, voice)
            wav_duration(data)
            fd, temp = tempfile.mkstemp(dir=self.path, prefix='.audio-', suffix='.tmp')
            try:
                with os.fdopen(fd, 'wb') as out: out.write(data)
                os.replace(temp, target)
            finally:
                if os.path.exists(temp): os.unlink(temp)
            return target
