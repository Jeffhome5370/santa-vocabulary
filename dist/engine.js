export const LEGACY_STORAGE_KEY = 'santa-vocabulary.progress.v1';
export const STORAGE_KEY = 'santa-vocabulary.progress.v2';
export const emptyState = () => ({ version: 2, progress: {}, history: [] });
const ACTOR = crypto.randomUUID();
const emptyCounts = () => ({ baseCorrect: 0, baseWrong: 0, actors: {} });
const totals = counts => ({ correct: counts.baseCorrect + Object.values(counts.actors).reduce((sum, p) => sum + p.correct, 0), wrong: counts.baseWrong + Object.values(counts.actors).reduce((sum, p) => sum + p.wrong, 0) });
export const shuffle = items => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
export const getProgress = (state, id) => state.progress[id] || { reviews: 0, correct: 0, wrong: 0, lastCorrect: null, lastReviewed: null, starred: false, starredAt: null, updatedAt: null, counts: emptyCounts() };
export function recordAnswer(state, id, correct, source, actor = ACTOR) {
  const previous = getProgress(state, id);
  const at = new Date().toISOString();
  const counts = structuredClone(previous.counts || { baseCorrect: previous.correct, baseWrong: previous.wrong, actors: {} });
  const counter = counts.actors[actor] || { correct: 0, wrong: 0 };
  counts.actors[actor] = { correct: counter.correct + Number(correct), wrong: counter.wrong + Number(!correct) };
  const sum = totals(counts);
  state.progress[id] = { ...previous, ...sum, reviews: sum.correct + sum.wrong, counts, lastCorrect: correct, lastReviewed: at, updatedAt: at };
  state.history.unshift({ id: crypto.randomUUID(), wordId: id, correct, source, at });
  state.history = state.history.slice(0, 500);
}
export function toggleStar(state, id) {
  const p = getProgress(state, id);
  const at = new Date().toISOString();
  state.progress[id] = { ...p, starred: !p.starred, starredAt: at, updatedAt: at };
}
export function matchesFilter(word, state, filter) {
  const p = getProgress(state, word.id);
  return filter === 'all' || (filter === 'weak' && p.lastCorrect === false) || (filter === 'new' && p.reviews === 0) || (filter === 'starred' && p.starred);
}
export function getStats(words, state) {
  const progress = words.map(word => getProgress(state, word.id));
  const quiz = state.history.filter(entry => entry.source === 'quiz');
  return { total: words.length, reviewed: progress.filter(p => p.reviews > 0).length, known: progress.filter(p => p.lastCorrect === true).length, weak: progress.filter(p => p.lastCorrect === false).length, accuracy: quiz.length ? Math.round(quiz.filter(entry => entry.correct).length / quiz.length * 100) : null };
}
export function selectQuizWords(words, state, count = 10) {
  const weak = shuffle(words.filter(w => matchesFilter(w, state, 'weak')));
  const fresh = shuffle(words.filter(w => matchesFilter(w, state, 'new')));
  const known = shuffle(words.filter(w => getProgress(state, w.id).lastCorrect === true));
  return [...weak, ...fresh, ...known].slice(0, count);
}
const comparable = meaning => meaning.replace(/[\s，,、；;。.（）()]/g, '').toLowerCase();
export function createQuestion(word, words, direction = 'en') {
  const actualDirection = direction === 'mixed' ? (Math.random() < .5 ? 'en' : 'zh') : direction;
  const value = w => actualDirection === 'en' ? w.meaning : w.word;
  const sameMeaning = candidate => comparable(candidate.meaning) === comparable(word.meaning);
  const candidates = shuffle(words.filter(w => w.id !== word.id && !sameMeaning(w)));
  const matchingPart = candidates.filter(w => w.pos.split('/')[0] === word.pos.split('/')[0]);
  const used = new Set([value(word)]);
  const distractors = [];
  for (const candidate of [...matchingPart, ...candidates]) {
    if (!used.has(value(candidate))) {
      used.add(value(candidate));
      distractors.push(candidate);
    }
    if (distractors.length === 3) break;
  }
  if (distractors.length !== 3) throw new Error('單字數量不足以產生四個不同選項。');
  return { word, direction: actualDirection, prompt: actualDirection === 'en' ? word.word : word.meaning, options: shuffle([word, ...distractors]).map(w => ({ id: w.id, text: value(w) })) };
}
export function validateState(input, words) {
  const fail = () => { throw new Error('進度檔格式不正確，請選擇由 Santa 單字室匯出的 JSON。'); };
  if (!input || ![1, 2].includes(input.version) || typeof input.progress !== 'object' || !input.progress || Array.isArray(input.progress) || !Array.isArray(input.history) || input.history.length > 500) fail();
  const ids = new Set(words.map(w => w.id));
  const isDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const safe = emptyState();
  for (const [key, p] of Object.entries(input.progress)) {
    if (!/^\d+$/.test(key) || !ids.has(Number(key)) || !p || typeof p !== 'object') fail();
    for (const field of ['reviews', 'correct', 'wrong']) if (!Number.isSafeInteger(p[field]) || p[field] < 0) fail();
    if (p.reviews !== p.correct + p.wrong || typeof p.starred !== 'boolean' || ![null, true, false].includes(p.lastCorrect) || (p.lastReviewed !== null && !isDate(p.lastReviewed)) || (p.updatedAt !== null && !isDate(p.updatedAt))) fail();
    if ((p.reviews === 0) !== (p.lastCorrect === null) || (p.reviews > 0 && !isDate(p.lastReviewed))) fail();
    const counts = input.version === 1 ? { baseCorrect: p.correct, baseWrong: p.wrong, actors: {} } : p.counts;
    if (!counts || !Number.isSafeInteger(counts.baseCorrect) || counts.baseCorrect < 0 || !Number.isSafeInteger(counts.baseWrong) || counts.baseWrong < 0 || !counts.actors || typeof counts.actors !== 'object' || Array.isArray(counts.actors) || Object.keys(counts.actors).length > 10000) fail();
    const actors = {};
    for (const [actor, counter] of Object.entries(counts.actors)) {
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(actor) || ['__proto__', 'constructor', 'prototype'].includes(actor) || !counter || !Number.isSafeInteger(counter.correct) || counter.correct < 0 || !Number.isSafeInteger(counter.wrong) || counter.wrong < 0) fail();
      actors[actor] = { correct: counter.correct, wrong: counter.wrong };
    }
    const safeCounts = { baseCorrect: counts.baseCorrect, baseWrong: counts.baseWrong, actors };
    const sum = totals(safeCounts);
    if (!Number.isSafeInteger(sum.correct) || !Number.isSafeInteger(sum.wrong) || sum.correct !== p.correct || sum.wrong !== p.wrong) fail();
    const starredAt = input.version === 1 ? p.updatedAt : p.starredAt;
    if (starredAt !== null && !isDate(starredAt)) fail();
    safe.progress[key] = { reviews: p.reviews, correct: p.correct, wrong: p.wrong, lastCorrect: p.lastCorrect, lastReviewed: p.lastReviewed, starred: p.starred, starredAt, updatedAt: p.updatedAt, counts: safeCounts };
  }
  const historyIds = new Set();
  for (const e of input.history) {
    if (!e || typeof e.id !== 'string' || !e.id.length || e.id.length > 100 || historyIds.has(e.id) || !ids.has(e.wordId) || typeof e.correct !== 'boolean' || !['quiz', 'card'].includes(e.source) || !isDate(e.at)) fail();
    historyIds.add(e.id);
    safe.history.push({ id: e.id, wordId: e.wordId, correct: e.correct, source: e.source, at: e.at });
  }
  return safe;
}
export function mergeStates(current, incoming, words) {
  const a = validateState(current, words), b = validateState(incoming, words);
  const result = emptyState();
  for (const word of words) {
    const left = a.progress[word.id], right = b.progress[word.id];
    if (!left && !right) continue;
    if (!left || !right) { result.progress[word.id] = left || right; continue; }
    const clock = value => value ? Date.parse(value) : -Infinity;
    const choose = (x, y, field) => clock(x[field]) === clock(y[field]) ? (JSON.stringify(x) > JSON.stringify(y) ? x : y) : clock(x[field]) > clock(y[field]) ? x : y;
    const latestReview = choose(left, right, 'lastReviewed');
    const latestStar = choose(left, right, 'starredAt');
    const counts = { baseCorrect: Math.max(left.counts.baseCorrect, right.counts.baseCorrect), baseWrong: Math.max(left.counts.baseWrong, right.counts.baseWrong), actors: {} };
    for (const actor of new Set([...Object.keys(left.counts.actors), ...Object.keys(right.counts.actors)])) {
      const x = left.counts.actors[actor] || { correct: 0, wrong: 0 }, y = right.counts.actors[actor] || { correct: 0, wrong: 0 };
      counts.actors[actor] = { correct: Math.max(x.correct, y.correct), wrong: Math.max(x.wrong, y.wrong) };
    }
    const sum = totals(counts);
    result.progress[word.id] = { ...latestReview, ...sum, reviews: sum.correct + sum.wrong, counts, starred: latestStar.starred, starredAt: latestStar.starredAt, updatedAt: choose(left, right, 'updatedAt').updatedAt };
  }
  const history = new Map([...a.history, ...b.history].map(entry => [entry.id, entry]));
  result.history = [...history.values()].sort((x, y) => Date.parse(y.at) - Date.parse(x.at) || x.id.localeCompare(y.id)).slice(0, 500);
  return result;
}
export function loadState(storage, words, key = STORAGE_KEY) {
  const saved = storage.getItem(key) || (key === STORAGE_KEY ? storage.getItem(LEGACY_STORAGE_KEY) : null);
  return saved ? validateState(JSON.parse(saved), words) : emptyState();
}
