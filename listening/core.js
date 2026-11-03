export function createSession(questions, mode = 'practice') {
  if (!questions.length) throw new Error('没有可练习的题目。');
  if (!['practice', 'challenge', 'review'].includes(mode)) throw new Error('无效模式。');
  return {ids: questions.map(q => q.id), mode, index: 0, answers: [], playCounts: {}, listened: {}, completed: false, startedAt: Date.now()};
}

export function beginPlayback(s) {
  const id = s.ids[s.index];
  if (s.completed || (s.mode === 'challenge' && s.playCounts[id])) throw new Error('本题只能听一次。');
  s.playCounts[id] = (s.playCounts[id] || 0) + 1;
}

export function finishPlayback(s) {
  s.listened[s.ids[s.index]] = true;
}

export function submitAnswer(s, letter, question) {
  if (s.completed || s.answers[s.index]) throw new Error('已经提交过本题。');
  if (!s.listened[s.ids[s.index]]) throw new Error('请先听完题干。');
  if (!['A','B','C','D',''].includes(letter)) throw new Error('无效选项。');
  const correctAnswer = question?.answer ?? s._answers?.[s.index];
  s.answers[s.index] = {id: s.ids[s.index], letter, correct: letter === correctAnswer, submittedAt: Date.now()};
}

export function advance(s) {
  if (!s.answers[s.index]) throw new Error('请先提交答案。');
  if (s.index === s.ids.length - 1) s.completed = true;
  else s.index += 1;
}

export function canReveal(s) {
  return s.mode === 'challenge' ? s.completed : !!s.answers[s.index];
}

export function updateRecord(record, letter, answer, date) {
  const correct = letter === answer;
  return {attempts: (record?.attempts || 0) + 1, wrongCount: (record?.wrongCount || 0) + Number(!correct),
    wasWrong: !!record?.wasWrong || !correct, lastCorrect: correct, lastChoice: letter, lastAt: date};
}
