import io
from pathlib import Path
import tempfile
import threading
import unittest
import wave
from speech import SpeechCache, ConfigStore, audio_key, request_body


def short_wav():
    out = io.BytesIO()
    with wave.open(out, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(24000)
        wav.writeframes(b'\0\0' * 2400)
    return out.getvalue()


class SpeechTests(unittest.TestCase):
    # Dropping voice/style from the key would replay stale or wrong-voice speech.
    def test_cache_key_separates_voices_and_style(self):
        self.assertNotEqual(audio_key('Hello', 'Serena', 'v1'), audio_key('Hello', 'Ethan', 'v1'))
        self.assertNotEqual(audio_key('Hello', 'Serena', 'v1'), audio_key('Hello', 'Serena', 'v2'))

    # Removing English/instruction parameters would turn connected speech into default reading.
    def test_payload_requests_english_connected_speech_without_changing_text(self):
        body = request_body("Could you send it to me?", 'Serena')
        self.assertEqual(body['model'], 'qwen3-tts-instruct-flash')
        self.assertEqual(body['input']['text'], "Could you send it to me?")
        self.assertEqual(body['input']['language_type'], 'English')
        self.assertIn('weak forms', body['input']['instructions'])
        self.assertIn('Do not add', body['input']['instructions'])

    # A failed download must never leave a completed-looking file in cache.
    def test_failed_generation_leaves_no_audio(self):
        with tempfile.TemporaryDirectory() as temp:
            def broken(text, voice):
                raise RuntimeError('service failed')
            cache = SpeechCache(Path(temp), broken)
            with self.assertRaises(RuntimeError):
                cache.get('Hello', 'Serena')
            self.assertEqual(list(Path(temp).glob('*.wav')), [])

    # Two simultaneous plays of a duplicate prompt must not charge twice.
    def test_concurrent_requests_share_one_completed_file(self):
        with tempfile.TemporaryDirectory() as temp:
            calls = []
            def synth(text, voice):
                calls.append((text, voice))
                return short_wav()
            cache = SpeechCache(Path(temp), synth)
            paths = []
            threads = [threading.Thread(target=lambda: paths.append(cache.get('Hello', 'Serena'))) for _ in range(5)]
            for t in threads: t.start()
            for t in threads: t.join()
            self.assertEqual(len(paths), 5)
            self.assertEqual(len(set(paths)), 1)
            self.assertEqual(len(calls), 1)
            self.assertGreater(paths[0].stat().st_size, 44)

    # Credential exposure in GET status or permissive file mode is a regression.
    def test_credentials_are_private_and_public_status_has_no_key(self):
        with tempfile.TemporaryDirectory() as temp:
            store = ConfigStore(Path(temp) / 'credentials.json')
            store.save('test-credential-123', 'beijing')
            self.assertTrue(store.public()['configured'])
            self.assertNotIn('test-credential-123', str(store.public()))
            self.assertEqual(store.path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(store.load()['key'], 'test-credential-123')


if __name__ == '__main__':
    unittest.main()
