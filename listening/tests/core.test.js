import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, beginPlayback, finishPlayback, submitAnswer, advance, canReveal, updateRecord } from '../core.js';

const questions = [{id:'one',answer:'A'}, {id:'two',answer:'C'}];

// An early reveal would leak the transcript and turn listening into reading.
test('practice reveals only after the learner listens and submits', () => {
  const s = createSession(questions, 'practice');
  assert.equal(canReveal(s), false);
  assert.throws(() => submitAnswer(s, 'A'));
  beginPlayback(s); finishPlayback(s); submitAnswer(s, 'A', questions[0]);
  assert.equal(canReveal(s), true);
  assert.equal(s.answers[0].correct, true);
});

// Resetting playback count on reload would allow multiple challenge plays.
test('challenge allows one playback and reveals only after the final submission', () => {
  const s = createSession(questions, 'challenge');
  beginPlayback(s); finishPlayback(s);
  assert.throws(() => beginPlayback(s));
  submitAnswer(s, 'B');
  assert.equal(canReveal(s), false);
  advance(s);
  beginPlayback(s); finishPlayback(s); submitAnswer(s, 'C');
  assert.equal(canReveal(s), false);
  advance(s);
  assert.equal(s.completed, true);
  assert.equal(canReveal(s), true);
});

// A later right answer must not erase the history of a missed question.
test('records preserve errors while marking later successful review', () => {
  let record = updateRecord(undefined, 'B', 'A', '2026-10-08');
  record = updateRecord(record, 'A', 'A', '2026-10-09');
  assert.equal(record.attempts, 2);
  assert.equal(record.wrongCount, 1);
  assert.equal(record.lastCorrect, true);
  assert.equal(record.wasWrong, true);
});

// Changing an answer after submission or answering twice must not change score.
test('submitted answers cannot be changed or double counted', () => {
  const s = createSession(questions, 'practice');
  beginPlayback(s); finishPlayback(s); submitAnswer(s, 'D');
  assert.throws(() => submitAnswer(s, 'A'));
  assert.equal(s.answers.length, 1);
  assert.equal(s.answers[0].letter, 'D');
});
