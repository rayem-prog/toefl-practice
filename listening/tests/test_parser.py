import unittest
from parser import parse_text

FIXTURE = '''托福听力真题
2026-09-12 Response Set 1
音频文本（Audio）
Mind grabbing the attendance sheet?
Q1. Choose the best response.
  A. Sure, I'll get it
闲鱼：留学考试资料库
right away.
  B. I'm planning to attend.
  C. I skipped class.
  D. Leave it outside.
音频文本（Audio）
How did you enjoy the movie?
Q2. Choose the most appropriate response.
  A. I haven't seen it yet.
  B. I would prefer not to.
  C. Maybe in class.
  D. On campus.
2026-09-12 Response Set 1
音频文本（Audio）
Did you know office hours were cancelled?
Q1. Choose the best response.
  A. The lecture is over.
  B. I cancelled it.
  C. I wasn't aware.
  D. An office.
参考答案（Correct Answers）
2026-09-12 Response Set 1
Q1. 正确答案：A
Q1. 解析：A polite request.
Q2. 正确答案：A
Q2. 解析：A natural response.
2026-09-12 Response Set 1
Q1. 正确答案：C
Q1. 解析：This shares new information.
'''


class ParserTests(unittest.TestCase):
    # Overwriting duplicate set titles would silently assign the wrong answer.
    def test_duplicate_titles_and_page_breaks_preserve_alignment(self):
        bank = parse_text(FIXTURE)
        self.assertEqual(len(bank['questions']), 3)
        self.assertEqual(len(bank['sets']), 2)
        self.assertEqual(bank['questions'][0]['choices']['A'], "Sure, I'll get it right away.")
        self.assertEqual(bank['questions'][2]['answer'], 'C')
        self.assertNotEqual(bank['questions'][0]['id'], bank['questions'][2]['id'])
        self.assertEqual(bank['questions'][0]['prompt'], 'Mind grabbing the attendance sheet?')

    # A missing answer must stop import instead of shifting following answers.
    def test_missing_answer_is_rejected(self):
        damaged = FIXTURE.replace('Q2. 正确答案：A\nQ2. 解析：A natural response.\n', '')
        with self.assertRaises(ValueError):
            parse_text(damaged)

    # Import must not accept a three-choice question that looks playable.
    def test_missing_option_is_rejected(self):
        with self.assertRaises(ValueError):
            parse_text(FIXTURE.replace('  D. On campus.\n', ''))

    # Undated KPO sets must form separate sets instead of merging numbered answers.
    def test_kpo_heading_is_a_separate_set(self):
        bank = parse_text(FIXTURE.replace('2026-09-12 Response Set 1', 'KPO 3 - Dining Hall Feedback Station'))
        self.assertEqual(len(bank['sets']), 2)
        self.assertEqual(bank['questions'][2]['answer'], 'C')


if __name__ == '__main__':
    unittest.main()
