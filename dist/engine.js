export const STORAGE_KEY = 'santa-vocabulary.progress.v1';
export const emptyState = () => ({ version: 1, progress: {}, history: [] });
export const shuffle = items => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
export const getProgress = (state, id) => state.progress[id] || { reviews: 0, correct: 0, wrong: 0, lastCorrect: null, lastReviewed: null, starred: false, updatedAt: null };
export function recordAnswer(state, id, correct, source) {
  const previous = getProgress(state, id);
  const at = new Date().toISOString();
  state.progress[id] = { ...previous, reviews: previous.reviews + 1, correct: previous.correct + Number(correct), wrong: previous.wrong + Number(!correct), lastCorrect: correct, lastReviewed: at, updatedAt: at };
  state.history.unshift({ id: crypto.randomUUID(), wordId: id, correct, source, at });
  state.history = state.history.slice(0, 500);
}
export function toggleStar(state, id) {
  const p = getProgress(state, id);
  state.progress[id] = { ...p, starred: !p.starred, updatedAt: new Date().toISOString() };
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
  if (!input || input.version !== 1 || typeof input.progress !== 'object' || !input.progress || Array.isArray(input.progress) || !Array.isArray(input.history) || input.history.length > 500) fail();
  const ids = new Set(words.map(w => w.id));
  const isDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const safe = emptyState();
  for (const [key, p] of Object.entries(input.progress)) {
    if (!/^\d+$/.test(key) || !ids.has(Number(key)) || !p || typeof p !== 'object') fail();
    for (const field of ['reviews', 'correct', 'wrong']) if (!Number.isSafeInteger(p[field]) || p[field] < 0) fail();
    if (p.reviews !== p.correct + p.wrong || typeof p.starred !== 'boolean' || ![null, true, false].includes(p.lastCorrect) || (p.lastReviewed !== null && !isDate(p.lastReviewed)) || (p.updatedAt !== null && !isDate(p.updatedAt))) fail();
    if ((p.reviews === 0) !== (p.lastCorrect === null) || (p.reviews > 0 && !isDate(p.lastReviewed))) fail();
    safe.progress[key] = { reviews: p.reviews, correct: p.correct, wrong: p.wrong, lastCorrect: p.lastCorrect, lastReviewed: p.lastReviewed, starred: p.starred, updatedAt: p.updatedAt };
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
    result.progress[word.id] = !left ? right : !right ? left : (Date.parse(right.updatedAt || right.lastReviewed || 0) > Date.parse(left.updatedAt || left.lastReviewed || 0) ? right : left);
  }
  const history = new Map([...a.history, ...b.history].map(entry => [entry.id, entry]));
  result.history = [...history.values()].sort((x, y) => Date.parse(y.at) - Date.parse(x.at)).slice(0, 500);
  return result;
}
export function loadState(storage, words) {
  const saved = storage.getItem(STORAGE_KEY);
  return saved ? validateState(JSON.parse(saved), words) : emptyState();
}
