import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import wave
from server import PracticeServer
from speech import ConfigStore, SpeechCache


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        stream = io.BytesIO()
        with wave.open(stream, 'wb') as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000)
            wav.writeframes(b'\0\0' * 2400)
        cls.wav = stream.getvalue()
        cache = SpeechCache(Path(cls.temp.name) / 'audio', lambda text, voice: cls.wav)
        cls.server = PracticeServer(('127.0.0.1', 0), ConfigStore(Path(cls.temp.name) / 'credential.json'), cache)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True); cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join(); cls.temp.cleanup()

    def call(self, path, *, token=True, origin=None):
        headers = {}
        if token: headers['X-Session-Token'] = self.server.token
        if origin: headers['Origin'] = origin
        return urllib.request.urlopen(urllib.request.Request(self.base + path, headers=headers), timeout=5)

    # A permissive route would let any external site spend the speech quota.
    def test_audio_requires_session_token_and_same_origin(self):
        for args in [{'token': False}, {'origin': 'https://example.com'}]:
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.call('/api/audio/set-001-q01', **args)
            self.assertEqual(caught.exception.code, 403)

    # Unknown IDs and voices must not reach the speech synthesizer.
    def test_unknown_question_and_voice_are_rejected(self):
        for path, expected in [('/api/audio/missing', 404), ('/api/audio/set-001-q01?voice=missing', 400)]:
            with self.assertRaises(urllib.error.HTTPError) as caught: self.call(path)
            self.assertEqual(caught.exception.code, expected)

    # The frontend must receive a real audio file, not a JSON success placeholder.
    def test_audio_route_delivers_wav_bytes(self):
        with self.call('/api/audio/set-001-q01?voice=Serena') as response:
            self.assertEqual(response.headers['Content-Type'], 'audio/wav')
            self.assertEqual(response.read(), self.wav)

    # Serving the source tree could expose config or implementation files.
    def test_source_and_credentials_are_not_served(self):
        for path in ['/speech.py', '/.config/credentials.json', '/../../speech.py']:
            with self.assertRaises(urllib.error.HTTPError) as caught: self.call(path)
            self.assertEqual(caught.exception.code, 404)

    # A broken import route would make a large portion of the source unavailable.
    def test_bank_delivers_all_questions(self):
        with self.call('/api/bank') as response: bank = json.load(response)
        self.assertEqual(len(bank['questions']), 2046)
        self.assertEqual(len(bank['sets']), 257)
        self.assertEqual(bank['questions'][-1]['answer'], 'B')


if __name__ == '__main__': unittest.main()
