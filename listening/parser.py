"""Import source questions and reference answers with strict set/number matching."""
import argparse
from collections import Counter
import json
from pathlib import Path
import re

HEADER = re.compile(r'^(?:\d{4}-\d{2}-\d{2}[ \t]+[^\n]+|[KT]PO[ \t]+\d+[ \t]*-[^\n]+)$', re.M)
MARKER = '音频文本（Audio）'
ANSWER_DIVIDER = '参考答案（Correct Answers）'


def compact(text):
    return re.sub(r'\s+', ' ', text).strip()


def sections(text):
    matches = list(HEADER.finditer(text))
    result = []
    occurrences = Counter()
    for i, match in enumerate(matches):
        title = compact(match.group())
        occurrences[title] += 1
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        result.append(((title, occurrences[title]), text[match.end():end]))
    return result


def parse_text(text):
    text = re.sub(r'^\s*闲鱼：留学考试资料库[^\n]*\n?', '', text, flags=re.M)
    if text.count(ANSWER_DIVIDER) != 1:
        raise ValueError('Expected exactly one reference-answer section.')
    source, reference = text.split(ANSWER_DIVIDER)
    source_sets, answer_sets = sections(source), sections(reference)
    if [key for key, _ in source_sets] != [key for key, _ in answer_sets]:
        raise ValueError('Question and answer set headings/order do not match.')
    bank = {'version': 1, 'sets': [], 'questions': []}
    for index, ((key, questions_text), (_, answers_text)) in enumerate(zip(source_sets, answer_sets), 1):
        title, occurrence = key
        set_id = f'set-{index:03d}'
        answer_matches = list(re.finditer(r'^Q(\d+)\.\s*正确答案[：:]\s*([ABCD])\s*$', answers_text, re.M))
        answers = {}
        for a_index, match in enumerate(answer_matches):
            number = int(match[1])
            if number in answers:
                raise ValueError(f'Duplicate answer: {title} Q{number}')
            end = answer_matches[a_index + 1].start() if a_index + 1 < len(answer_matches) else len(answers_text)
            explanation = answers_text[match.end():end]
            explanation = re.sub(r'^\s*Q\d+\.\s*解析[：:]\s*', '', explanation)
            answers[number] = (match[2], compact(explanation))
        set_questions = []
        for block in questions_text.split(MARKER)[1:]:
            match = re.search(r'^Q(\d+)\.[ \t]*Choose[^\n]*response\.[ \t]*$', block, re.M)
            if not match:
                raise ValueError(f'Missing question number: {title}')
            number = int(match[1])
            prompt = compact(block[:match.start()])
            choices_text = block[match.end():]
            choice_matches = list(re.finditer(r'^[ \t]*([ABCD])\.[ \t]+', choices_text, re.M))
            if [m[1] for m in choice_matches] != list('ABCD'):
                raise ValueError(f'Expected A-D choices: {title} Q{number}')
            choices = {}
            for c_index, c_match in enumerate(choice_matches):
                end = choice_matches[c_index + 1].start() if c_index + 1 < len(choice_matches) else len(choices_text)
                # Day-summary and source-label lines belong to the next source section.
                value = choices_text[c_match.end():end]
                value = re.sub(r'^\d{4}-\d{2}-\d{2}（[^\n]+\n?', '', value, flags=re.M)
                value = re.sub(r'^来源[：:][^\n]*\n?', '', value, flags=re.M)
                choices[c_match[1]] = compact(value)
            if not prompt or not all(choices.values()) or number not in answers:
                raise ValueError(f'Incomplete question/answer: {title} Q{number}')
            answer, explanation = answers.pop(number)
            if not explanation:
                raise ValueError(f'Missing explanation: {title} Q{number}')
            question = {'id': f'{set_id}-q{number:02d}', 'setId': set_id, 'number': number,
                        'prompt': prompt, 'choices': choices, 'answer': answer, 'explanation': explanation}
            set_questions.append(question)
        if answers or not set_questions:
            raise ValueError(f'Unmatched or empty question set: {title}')
        if [q['number'] for q in set_questions] != list(range(1, len(set_questions) + 1)):
            raise ValueError(f'Question numbers are not sequential: {title}')
        bank['sets'].append({'id': set_id, 'title': title, 'occurrence': occurrence,
                             'date': title[:10] if title[0].isdigit() else title[:3], 'count': len(set_questions)})
        bank['questions'].extend(set_questions)
    if len({q['id'] for q in bank['questions']}) != len(bank['questions']):
        raise ValueError('Duplicate stable question IDs.')
    return bank


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument('pdf', type=Path)
    cli.add_argument('--output', type=Path, default=Path('data/questions.json'))
    args = cli.parse_args()
    from pypdf import PdfReader
    reader = PdfReader(args.pdf)
    bank = parse_text('\n'.join(page.extract_text() for page in reader.pages))
    bank['source'] = {'filename': args.pdf.name, 'pages': len(reader.pages),
                      'note': '原资料题干与参考答案；未核验其真题来源。'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(bank, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'sets': len(bank['sets']), 'questions': len(bank['questions']),
                      'uniquePrompts': len({q['prompt'] for q in bank['questions']}),
                      'output': str(args.output)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
