import { createSession, beginPlayback, finishPlayback, submitAnswer, advance, canReveal, updateRecord } from './core.js';

const $ = id => document.getElementById(id);
const labels = {practice:'日常练习', challenge:'限时挑战', review:'错题复习'};
const STORAGE = 'toefl-response-records-v1';
const SESSION = 'toefl-response-session-v1';
let bank, questionMap, setMap, status, records = {}, session = null, mode = 'practice', selected = '';
let audio = null, aborter = null, generation = 0, busy = false, timerInterval = null, toastTimeout;
const blobs = new Map();

function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimeout); toastTimeout = setTimeout(() => $('toast').hidden = true, 4200);
}

function showError(message) {
  $('pageError').textContent = message; $('pageError').hidden = !message;
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { toast('浏览器无法保存进度，请导出练习记录备份。'); }
}

function readStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function persist() {
  writeStorage(STORAGE, records);
  if (session) writeStorage(SESSION, {...session, selected});
}

async function api(path, body) {
  const response = await fetch(path, {headers: {'Content-Type':'application/json', 'X-Session-Token': status?.token || ''},
    ...(body !== undefined ? {method:'POST', body:JSON.stringify(body)} : {})});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '本机服务连接失败，请刷新页面。');
  return data;
}

function stopAudio() {
  generation += 1;
  aborter?.abort(); aborter = null;
  if (audio) { audio.pause(); audio.onended = null; audio.onerror = null; audio = null; }
  busy = false;
  $('questionWave').classList.remove('playing');
  clearInterval(timerInterval); timerInterval = null;
}

async function getAudio(id, voice, signal) {
  const key = `${id}:${voice}`;
  if (blobs.has(key)) return blobs.get(key);
  const response = await fetch(`/api/audio/${encodeURIComponent(id)}?voice=${encodeURIComponent(voice)}`, {
    headers: {'X-Session-Token':status.token}, signal});
  if (!response.ok) {
    const data = await response.json(); throw new Error(data.error || '音频生成失败，请重试。');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  blobs.set(key, url);
  if (blobs.size > 30) { const old = blobs.keys().next().value; URL.revokeObjectURL(blobs.get(old)); blobs.delete(old); }
  return url;
}

function updateStats() {
  const all = Object.values(records);
  const attempts = all.reduce((sum, item) => sum + item.attempts, 0);
  const wrong = all.reduce((sum, item) => sum + item.wrongCount, 0);
  const wrongIds = Object.keys(records).filter(id => records[id].wasWrong);
  $('attemptedStat').textContent = attempts;
  $('accuracyStat').textContent = attempts ? Math.round((attempts - wrong) / attempts * 100) + '%' : '—';
  $('wrongStat').textContent = wrongIds.length;
  $('wrongBadge').textContent = wrongIds.length;
}

function renderGrid() {
  const grid = $('questionGrid'); grid.replaceChildren();
  if (!session) { const span = document.createElement('span'); span.className = 'empty-grid'; span.textContent = '开始练习后显示'; grid.append(span); return; }
  session.ids.forEach((id, index) => {
    const item = document.createElement('span'); item.className = 'grid-item'; item.textContent = index + 1;
    const answer = session.answers[index];
    if (answer) {
      if (session.mode !== 'challenge' || session.completed) item.classList.add(answer.correct ? 'correct' : 'incorrect');
      else item.classList.add('done');
    }
    if (index === session.index && !session.completed) item.classList.add('current');
    grid.append(item);
  });
}

function setMode(value) {
  mode = value;
  document.querySelectorAll('.mode').forEach(button => { button.classList.toggle('active', button.dataset.mode === mode); button.setAttribute('aria-pressed', String(button.dataset.mode === mode)); });
  $('timeField').hidden = mode !== 'challenge';
}

function shuffled(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}

function startQuestions(questions, newMode) {
  stopAudio(); showError(''); selected = '';
  session = createSession(questions, newMode); session.seconds = Number($('timeSelect').value);
  session.voice = $('voiceSelect').value; session.speed = newMode === 'challenge' ? 1 : Number($('speedSelect').value);
  setMode(newMode); persist(); renderQuestion(); $('resumeButton').hidden = true;
  $('main').scrollIntoView({behavior:'smooth', block:'start'});
}

function startPractice() {
  let pool = $('setSelect').value === 'random' ? bank.questions : bank.questions.filter(q => q.setId === $('setSelect').value);
  if (mode === 'review') pool = pool.filter(q => records[q.id]?.wasWrong);
  if (!pool.length) { toast('所选范围还没有错题。可以选择“全部题库”，或先完成一组练习。'); return; }
  const amount = $('countSelect').value;
  if ($('setSelect').value === 'random') pool = shuffled(pool);
  if (amount !== 'all') pool = pool.slice(0, Number(amount));
  // Keep a random group manageable when "all" is selected.
  else if ($('setSelect').value === 'random') pool = pool.slice(0, 20);
  startQuestions(pool, mode);
}

function currentQuestion() { return questionMap.get(session.ids[session.index]); }

function renderChoices() {
  const question = currentQuestion();
  $('choices').replaceChildren();
  for (const letter of ['A','B','C','D']) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'choice';
    button.dataset.letter = letter;
    const badge = document.createElement('span'); badge.className = 'letter'; badge.textContent = letter;
    const text = document.createElement('span'); text.className = 'choice-text'; text.textContent = question.choices[letter];
    button.append(badge, text); button.addEventListener('click', () => selectAnswer(letter)); $('choices').append(button);
  }
  updateChoiceState();
}

function updateChoiceState() {
  const question = currentQuestion(); const answer = session.answers[session.index];
  document.querySelectorAll('.choice').forEach(button => {
    button.classList.toggle('selected', button.dataset.letter === (answer?.letter || selected));
    button.disabled = !!answer;
    button.setAttribute('aria-pressed', String(button.dataset.letter === (answer?.letter || selected)));
    if (answer && canReveal(session)) {
      button.classList.toggle('correct-choice', button.dataset.letter === question.answer);
      button.classList.toggle('incorrect-choice', !answer.correct && button.dataset.letter === answer.letter);
    }
  });
  $('submitButton').disabled = !selected || !!answer;
}

function selectAnswer(letter) {
  if (!session || session.completed || !session.listened[session.ids[session.index]] || session.answers[session.index]) return;
  selected = letter; persist(); updateChoiceState();
}

function renderQuestion() {
  const question = currentQuestion(); const answer = session.answers[session.index];
  $('welcome').hidden = true; $('results').hidden = true; $('exercise').hidden = false;
  $('sessionModeLabel').textContent = labels[session.mode];
  $('sourceTitle').textContent = setMap.get(question.setId).title + ` · 原题 Q${question.number}`;
  $('currentNumber').textContent = String(session.index + 1).padStart(2,'0');
  $('totalNumber').textContent = '/ ' + session.ids.length;
  $('progressFill').style.width = `${session.answers.length / session.ids.length * 100}%`;
  $('voiceSelect').value = session.voice;
  $('speedSelect').value = String(session.speed);
  $('voiceSelect').disabled = session.mode === 'challenge' && !!session.playCounts[question.id];
  $('speedSelect').disabled = session.mode === 'challenge';
  $('choicesSection').hidden = !session.listened[question.id];
  $('submitButton').hidden = !session.listened[question.id] || !!answer;
  $('nextButton').hidden = !answer;
  $('nextButton').textContent = session.index === session.ids.length - 1 ? '结束并查看结果 →' : '下一题 →';
  $('feedback').hidden = !canReveal(session);
  $('timer').hidden = session.mode !== 'challenge' || !!answer || !session.listened[question.id];
  $('playButton').disabled = session.mode === 'challenge' && !!session.playCounts[question.id];
  $('playButton').textContent = session.playCounts[question.id] ? '↻ 再听一次' : '▶ 播放题干';
  if (session.mode === 'challenge' && session.playCounts[question.id]) $('playButton').textContent = '本题已播放';
  $('audioStatus').classList.remove('error');
  $('audioStatus').textContent = session.listened[question.id] ? '听过题干了，选择最合适的回应。' : '先听题干，播放结束后显示选项。';
  $('answerHint').textContent = answer ? (session.mode === 'challenge' ? '答案已保存，整组结束后核对。' : '留意这句话的意图，再听一次巩固。') : '不显示题干原文，先靠耳朵理解。';
  $('downloadButton').hidden = !canReveal(session);
  renderChoices(); renderGrid();
  if (canReveal(session)) renderFeedback();
  if (session.mode === 'challenge' && session.listened[question.id] && !answer) startTimer();
}

async function playCurrent() {
  if (!session || session.completed || busy) return;
  if (!status.configured) { openSettings(); return; }
  if (session.mode === 'challenge' && session.playCounts[session.ids[session.index]]) return;
  stopAudio(); const run = generation; const id = session.ids[session.index];
  busy = true; $('playButton').disabled = true; $('audioStatus').classList.remove('error');
  $('audioStatus').textContent = '正在准备云端语音；首次播放需要生成，之后直接读取本地缓存…';
  aborter = new AbortController();
  try {
    const url = await getAudio(id, session.voice, aborter.signal);
    if (run !== generation) return;
    audio = new Audio(url); audio.playbackRate = session.mode === 'challenge' ? 1 : session.speed;
    audio.preservesPitch = true;
    audio.onended = () => {
      if (run !== generation) return;
      busy = false; finishPlayback(session); persist(); $('questionWave').classList.remove('playing'); renderQuestion();
    };
    audio.onerror = () => playbackFailed('音频无法播放，请重试。', run);
    await audio.play();
    if (run !== generation) { audio?.pause(); return; }
    beginPlayback(session); persist();
    $('questionWave').classList.add('playing');
    $('audioStatus').textContent = '正在播放 · 听句意，也听重音和语调';
    $('voiceSelect').disabled = true; $('speedSelect').disabled = true;
    $('choicesSection').hidden = true; $('submitButton').hidden = true;
    $('playButton').textContent = '正在播放…';
  } catch (error) {
    if (error.name !== 'AbortError') playbackFailed(error.message || '音频生成失败，请重试。', run);
  }
}

function playbackFailed(message, run) {
  if (run !== generation) return;
  busy = false; audio?.pause(); $('questionWave').classList.remove('playing');
  // A broken audio file is not a successful listen: permit retry without consuming the challenge play.
  const id = session?.ids[session.index];
  if (session && !session.listened[id]) session.playCounts[id] = 0;
  $('playButton').disabled = false; $('playButton').textContent = '↻ 重试播放';
  $('audioStatus').textContent = message; $('audioStatus').classList.add('error');
  $('voiceSelect').disabled = false; $('speedSelect').disabled = session?.mode === 'challenge'; persist();
}

function startTimer() {
  clearInterval(timerInterval);
  if (!session.deadline) session.deadline = Date.now() + session.seconds * 1000;
  persist();
  const tick = () => {
    const remaining = Math.max(0, Math.ceil((session.deadline - Date.now()) / 1000));
    $('timer').textContent = remaining + 's'; $('timer').classList.toggle('urgent', remaining <= 5);
    if (!remaining) { clearInterval(timerInterval); timerInterval = null; commitAnswer(true); }
  };
  tick(); if (!session.answers[session.index]) timerInterval = setInterval(tick, 200);
}

function commitAnswer(timedOut = false) {
  if (!session || session.completed || session.answers[session.index] || (!selected && !timedOut)) return;
  clearInterval(timerInterval); timerInterval = null;
  const question = currentQuestion();
  submitAnswer(session, selected, question);
  session.answers[session.index].elapsedSeconds = session.mode === 'challenge' ? Math.max(0, session.seconds - Math.ceil((session.deadline - Date.now()) / 1000)) : null;
  records[question.id] = updateRecord(records[question.id], selected, question.answer, new Date().toISOString());
  session.deadline = null; persist(); updateStats(); renderQuestion();
  if (timedOut) toast(selected ? '时间到，已提交当前选项。' : '时间到，本题记为未作答。');
}

function renderFeedback() {
  const question = currentQuestion(), answer = session.answers[session.index];
  $('resultBadge').textContent = answer.correct ? '正确' : '再理解一次';
  $('resultBadge').classList.toggle('missed', !answer.correct);
  $('resultText').textContent = answer.correct ? `选项 ${question.answer} 是最合适的回应` : `参考答案 ${question.answer} · 你的选择 ${answer.letter || '未作答'}`;
  $('transcript').textContent = question.prompt;
  $('explanation').textContent = question.explanation;
}

function nextQuestion() {
  if (!session?.answers[session.index]) return;
  stopAudio(); selected = ''; advance(session); session.deadline = null; persist();
  if (session.completed) renderResults(); else { renderQuestion(); $('playButton').focus(); }
}

function renderResults() {
  stopAudio(); $('welcome').hidden = true; $('exercise').hidden = true; $('results').hidden = false;
  const correct = session.answers.filter(answer => answer.correct).length;
  $('score').textContent = correct; $('scoreTotal').textContent = '/ ' + session.ids.length;
  $('accuracy').textContent = Math.round(correct / session.ids.length * 100) + '%';
  $('resultNote').textContent = '错题已保存在本机。打开每题可查看原文、选项与参考解析；这不是官方分数。';
  $('reviewSessionButton').disabled = correct === session.ids.length;
  $('reviewList').replaceChildren();
  session.ids.forEach((id, index) => {
    const question = questionMap.get(id), answer = session.answers[index];
    const details = document.createElement('details'); details.className = 'review-card';
    const summary = document.createElement('summary');
    const number = document.createElement('span'); number.className = 'review-label'; number.textContent = String(index + 1).padStart(2,'0');
    const prompt = document.createElement('span'); prompt.className = 'review-prompt'; prompt.textContent = question.prompt;
    const outcome = document.createElement('span'); outcome.className = 'review-result' + (answer.correct ? '' : ' missed'); outcome.textContent = answer.correct ? '正确' : '错题';
    summary.append(number, prompt, outcome); details.append(summary);
    const content = document.createElement('div'); content.className = 'review-content';
    for (const letter of ['A','B','C','D']) { const p = document.createElement('div'); p.className = 'review-option' + (letter === question.answer ? ' right' : ''); p.textContent = `${letter}. ${question.choices[letter]}`; content.append(p); }
    const source = document.createElement('p'); source.textContent = `${setMap.get(question.setId).title} · 原题 Q${question.number} · 你的选择：${answer.letter || '未作答'}`;
    const explanation = document.createElement('p'); explanation.textContent = question.explanation;
    const button = document.createElement('button'); button.className = 'button quiet'; button.textContent = '▶ 重听题干';
    const message = document.createElement('span'); message.className = 'review-audio-message';
    button.addEventListener('click', () => playReview(id, button, message));
    content.append(source, explanation, button, message); details.append(content); $('reviewList').append(details);
  });
  renderGrid(); $('main').scrollIntoView({behavior:'smooth', block:'start'});
}

async function playReview(id, button, message) {
  if (!status.configured) { openSettings(); return; }
  stopAudio(); const run = generation; button.disabled = true; message.textContent = '正在准备音频…';
  try {
    const url = await getAudio(id, $('voiceSelect').value);
    if (run !== generation) { button.disabled = false; message.textContent = ''; return; }
    audio = new Audio(url); audio.playbackRate = Number($('speedSelect').value); audio.preservesPitch = true;
    audio.onended = () => { button.disabled = false; message.textContent = '播放完毕'; };
    audio.onerror = () => { button.disabled = false; message.textContent = '播放失败，请重试。'; };
    await audio.play(); message.textContent = '正在播放'; button.disabled = false;
  } catch (error) { button.disabled = false; message.textContent = error.message; }
}

function openSettings() {
  $('regionSelect').value = status.region;
  $('keyInput').value = '';
  $('keyInput').placeholder = status.configured ? '已保存；留空保留当前 Key' : 'sk-…（只保存在本机）';
  $('setupStatus').textContent = ''; $('setupStatus').classList.remove('error');
  $('forgetKey').hidden = !status.configured;
  $('settingsDialog').showModal();
}

function connectionStatus() {
  $('connection').textContent = status.configured ? 'Qwen 已配置' : '等待连接 Qwen';
  $('connection').classList.toggle('connected', status.configured);
}

async function saveSettings(event) {
  event.preventDefault(); $('saveKey').disabled = true; $('setupStatus').classList.remove('error');
  $('setupStatus').textContent = '正在保存并生成试听…';
  const key = $('keyInput').value; $('keyInput').value = '';
  try {
    await api('/api/config', {key, region:$('regionSelect').value});
    status = await api('/api/status'); connectionStatus();
    $('forgetKey').hidden = false;
    if (session && !session.completed) {
      $('setupStatus').textContent = '已保存。关闭设置后点击播放题干。';
    } else {
      stopAudio(); const url = await getAudio(bank.questions[0].id, 'Serena');
      audio = new Audio(url); await audio.play();
      $('setupStatus').textContent = '连接成功，正在试听：“Mind grabbing the attendance sheet?”';
    }
  } catch (error) { $('setupStatus').textContent = error.message; $('setupStatus').classList.add('error'); }
  finally { $('saveKey').disabled = false; $('keyInput').placeholder = '已保存时留空保留当前 Key'; }
}

function download(data, filename, mime) {
  const url = URL.createObjectURL(new Blob([data], {type:mime}));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizedRecords(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('练习记录格式不正确。');
  const result = {};
  for (const [id,item] of Object.entries(value)) {
    if (!questionMap.has(id)) continue;
    if (!item || !Number.isSafeInteger(item.attempts) || item.attempts < 1 || !Number.isSafeInteger(item.wrongCount) || item.wrongCount < 0 || item.wrongCount > item.attempts) throw new Error('记录中的作答次数不正确。');
    result[id] = {attempts:item.attempts, wrongCount:item.wrongCount, wasWrong:item.wrongCount > 0, lastCorrect:!!item.lastCorrect,
      lastChoice:['A','B','C','D',''].includes(item.lastChoice) ? item.lastChoice : '', lastAt:typeof item.lastAt === 'string' ? item.lastAt.slice(0,40) : ''};
  }
  return result;
}

function resume() {
  const saved = readStorage(SESSION, null);
  if (!saved || !Array.isArray(saved.ids) || saved.ids.some(id => !questionMap.has(id)) || !labels[saved.mode] || !Number.isInteger(saved.index) || saved.index < 0 || saved.index >= saved.ids.length || !Array.isArray(saved.answers) || !saved.listened || !saved.playCounts) {
    toast('没有可恢复的练习。'); return;
  }
  stopAudio(); session = saved; selected = ['A','B','C','D'].includes(saved.selected) ? saved.selected : '';
  session.voice = ['Serena','Ethan','Cherry'].includes(saved.voice) ? saved.voice : 'Serena';
  session.seconds = [10,15,20].includes(saved.seconds) ? saved.seconds : 15;
  session.speed = [0.8,1,1.2].includes(saved.speed) ? saved.speed : 1;
  session.answers.forEach(answer => { if (questionMap.has(answer.id)) answer.correct = answer.letter === questionMap.get(answer.id).answer; });
  setMode(session.mode); $('resumeButton').hidden = true;
  const id = session.ids[session.index];
  const interrupted = session.mode === 'challenge' && session.playCounts[id] && !session.listened[id];
  if (interrupted) { session.listened[id] = true; toast('上次听题中断；限时挑战不重复播放，可继续作答。'); }
  if (session.completed) renderResults(); else renderQuestion();
}

function bindEvents() {
  document.querySelectorAll('.mode').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  $('startButton').addEventListener('click', startPractice);
  $('playButton').addEventListener('click', playCurrent);
  $('submitButton').addEventListener('click', () => commitAnswer());
  $('nextButton').addEventListener('click', nextQuestion);
  $('resumeButton').addEventListener('click', resume);
  $('voiceSelect').addEventListener('change', () => { if (session) { session.voice = $('voiceSelect').value; persist(); } });
  $('speedSelect').addEventListener('change', () => { if (session) { session.speed = Number($('speedSelect').value); persist(); } });
  $('settingsButton').addEventListener('click', openSettings);
  $('closeSettings').addEventListener('click', () => $('settingsDialog').close());
  $('settingsForm').addEventListener('submit', saveSettings);
  $('forgetKey').addEventListener('click', async () => {
    try { await api('/api/config', {forget:true}); status = await api('/api/status'); connectionStatus(); $('setupStatus').textContent = '已移除本机保存的密钥。'; $('forgetKey').hidden = true; }
    catch (error) { $('setupStatus').textContent = error.message; }
  });
  $('againButton').addEventListener('click', startPractice);
  $('reviewSessionButton').addEventListener('click', () => startQuestions(session.answers.filter(a => !a.correct).map(a => questionMap.get(a.id)), 'review'));
  $('exportButton').addEventListener('click', () => download(JSON.stringify({version:1, exportedAt:new Date().toISOString(), records}, null, 2), '听后回应-练习记录.json', 'application/json'));
  $('importButton').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async event => {
    try {
      const file = event.target.files[0]; if (!file) return;
      if (file.size > 2_000_000) throw new Error('记录文件过大。');
      const imported = JSON.parse(await file.text());
      if (imported.version !== 1) throw new Error('不支持的练习记录版本。');
      const clean = sanitizedRecords(imported.records);
      for (const [id,item] of Object.entries(clean)) if (!records[id] || item.attempts >= records[id].attempts) records[id] = item;
      persist(); updateStats(); toast('练习记录已合并，不会重复累计导入的作答次数。');
    } catch (error) { toast(error.message || '无法读取记录文件。'); }
    finally { event.target.value = ''; }
  });
  $('downloadButton').addEventListener('click', async () => {
    try { const q = currentQuestion(); const url = await getAudio(q.id, session.voice); const a = document.createElement('a'); a.href = url; a.download = `${q.id}-${session.voice}.wav`; a.click(); }
    catch (error) { toast(error.message); }
  });
  document.addEventListener('keydown', event => {
    if ($('settingsDialog').open || ['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (!session || session.completed) return;
    const letter = ({'1':'A','2':'B','3':'C','4':'D'})[event.key] || event.key.toUpperCase();
    if (['A','B','C','D'].includes(letter)) { event.preventDefault(); selectAnswer(letter); }
    if (event.key === 'Enter' && document.activeElement?.tagName !== 'BUTTON') { event.preventDefault(); session.answers[session.index] ? nextQuestion() : commitAnswer(); }
  });
  window.addEventListener('beforeunload', persist);
}

async function init() {
  try {
    [bank, status] = await Promise.all([api('/api/bank'), api('/api/status')]);
    questionMap = new Map(bank.questions.map(q => [q.id,q])); setMap = new Map(bank.sets.map(s => [s.id,s]));
    try { records = sanitizedRecords(readStorage(STORAGE, {})); } catch { records = {}; }
    $('setSelect').replaceChildren(new Option('随机题目 · 全部题库', 'random'));
    bank.sets.forEach(set => $('setSelect').add(new Option(`${set.title}${set.occurrence > 1 ? ` (${set.occurrence})` : ''} · ${set.count}题`, set.id)));
    $('bankCount').textContent = `${bank.sets.length} 套 / ${bank.questions.length} 题`;
    $('startButton').disabled = false;
    $('resumeButton').hidden = !readStorage(SESSION, null);
    updateStats(); connectionStatus(); setMode('practice'); bindEvents();
  } catch (error) { showError(error.message || '题库加载失败，请刷新或重新启动练习器。'); $('connection').textContent = '连接失败'; }
}

init();
