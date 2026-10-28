export const LEGACY_STORAGE_KEY = 'santa-vocabulary.progress.v1';
export const STORAGE_KEY = 'santa-vocabulary.progress.v2';
export const emptyState = (includeBaseWords = true) => ({ version: 2, progress: {}, history: [], customWords: [], includeBaseWords, wordChanges: [] });
const clock = value => value ? Date.parse(value) : -Infinity;
const changeDeleted = change => !!change?.deletedAt && clock(change.deletedAt) >= clock(change.restoredAt);
export const isWordDeleted = (state, id) => changeDeleted(state.wordChanges?.find(change => change.id === id));
export function allWords(base, state, { includeDeleted = false } = {}) {
  const changes = new Map((state.wordChanges || []).map(change => [change.id, change]));
  return [...(state.includeBaseWords === false ? [] : base), ...(state.customWords || [])]
    .filter(word => includeDeleted || !changeDeleted(changes.get(word.id)))
    .map(word => changes.has(word.id) ? { ...word, ...changes.get(word.id).fields } : word);
}
export const visibleHistory = (words, state) => { const ids = new Set(words.map(word => word.id)); return state.history.filter(entry => ids.has(entry.wordId)); };
export function guestForAccount(guest, account) {
  if (account.includeBaseWords !== false) return guest;
  const ids = new Set(guest.customWords.map(word => word.id));
  return { ...guest, includeBaseWords: false, wordChanges: (guest.wordChanges || []).filter(change => ids.has(change.id)), progress: Object.fromEntries(Object.entries(guest.progress).filter(([id]) => ids.has(Number(id)))), history: guest.history.filter(entry => ids.has(entry.wordId)) };
}
const normalize = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const WORD_LIMITS = { word: 100, meaning: 500, pos: 40, example: 1000, translation: 1000, note: 500 };
function validateWordFields(word) {
  const safe = {};
  for (const [field, max] of Object.entries(WORD_LIMITS)) {
    if (typeof word?.[field] !== 'string' || word[field].length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(word[field])) throw new Error('單字欄位格式不正確或文字過長。');
    safe[field] = word[field].trim();
  }
  if (!safe.word || !safe.meaning || !/[a-z]/i.test(safe.word)) throw new Error('請填寫英文單字與中文意思。');
  return safe;
}
const fieldsFrom = fields => Object.fromEntries(Object.keys(WORD_LIMITS).map(field => [field, String(fields[field] || '').trim()]));
const assertCapacity = state => {
  if (new TextEncoder().encode(JSON.stringify(state)).length > 1_800_000) throw new Error('資料接近容量上限，變更尚未儲存。請先匯出備份。');
};
export function validateCustomWords(input, base) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 500) throw new Error('自訂單字格式不正確，最多可加入 500 個單字。');
  const ids = new Set(base.map(word => word.id));
  return input.map(word => {
    if (!word || !Number.isSafeInteger(word.id) || word.id < 1_000_000 || ids.has(word.id)) throw new Error('自訂單字編號不正確或重複。');
    ids.add(word.id);
    return { id: word.id, ...validateWordFields(word) };
  }).sort((a, b) => a.id - b.id);
}
export function addCustomWord(state, base, fields) {
  if ((state.customWords || []).length >= 500) throw new Error('目前最多可加入 500 個自訂單字。');
  const numbers = crypto.getRandomValues(new Uint32Array(2));
  let id = 1_000_000 + (numbers[0] & 0xfffff) * 4294967296 + numbers[1];
  while ([...base, ...(state.customWords || [])].some(word => word.id === id)) id++;
  const word = validateCustomWords([{ id, ...fieldsFrom(fields) }], base)[0];
  if (allWords(base, state).some(existing => normalize(existing.word) === normalize(word.word) && normalize(existing.meaning) === normalize(word.meaning))) throw new Error('單字庫已經有相同的單字與意思。');
  const customWords = validateCustomWords([...(state.customWords || []), word], base);
  assertCapacity({ ...state, customWords });
  state.customWords = customWords;
  return word;
}
export function validateWordChanges(input, base, customWords) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > base.length + 500) throw new Error('單字修改紀錄格式不正確。');
  const known = new Set([...base, ...customWords].map(word => word.id)), seen = new Set();
  const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
  return input.map(change => {
    if (!change || !known.has(change.id) || seen.has(change.id) || !date(change.updatedAt)
      || typeof change.changeId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(change.changeId)
      || ![null, undefined].includes(change.deletedAt) && !date(change.deletedAt)
      || ![null, undefined].includes(change.restoredAt) && !date(change.restoredAt)) throw new Error('單字修改紀錄格式不正確。');
    seen.add(change.id);
    return { id: change.id, fields: validateWordFields(change.fields), updatedAt: change.updatedAt, changeId: change.changeId, deletedAt: change.deletedAt || null, restoredAt: change.restoredAt || null };
  }).sort((a, b) => a.id - b.id);
}
function getWordChange(state, word) {
  return state.wordChanges?.find(change => change.id === word.id) || { id: word.id, fields: validateWordFields(word), updatedAt: '1970-01-01T00:00:00.000Z', changeId: 'initial', deletedAt: null, restoredAt: null };
}
const nextWordTime = change => new Date(Math.max(Date.now(), ...['updatedAt', 'deletedAt', 'restoredAt'].map(key => clock(change[key]) + 1))).toISOString();
function putWordChange(state, base, change) {
  const wordChanges = validateWordChanges([...(state.wordChanges || []).filter(item => item.id !== change.id), change], base, state.customWords || []);
  assertCapacity({ ...state, wordChanges }); state.wordChanges = wordChanges;
}
function assertUniqueWord(state, base, word) {
  if (allWords(base, state).some(existing => existing.id !== word.id && normalize(existing.word) === normalize(word.word) && normalize(existing.meaning) === normalize(word.meaning))) throw new Error('單字庫已經有相同的單字與意思。');
}
export function updateWord(state, base, id, fields) {
  const current = allWords(base, state).find(word => word.id === id);
  if (!current) throw new Error('此單字已刪除或不存在，請重新開啟單字庫。');
  const word = { id, ...validateWordFields(fieldsFrom(fields)) };
  assertUniqueWord(state, base, word);
  const change = getWordChange(state, current);
  putWordChange(state, base, { ...change, fields: validateWordFields(word), updatedAt: nextWordTime(change), changeId: crypto.randomUUID() });
  return word;
}
export function deleteWord(state, base, id) {
  const word = allWords(base, state).find(word => word.id === id);
  if (!word) throw new Error('此單字已刪除或不存在。');
  const change = getWordChange(state, word);
  putWordChange(state, base, { ...change, deletedAt: nextWordTime(change) });
  return word;
}
export function restoreWord(state, base, id) {
  const word = allWords(base, state, { includeDeleted: true }).find(word => word.id === id);
  if (!word || !isWordDeleted(state, id)) throw new Error('此單字已復原或不存在。');
  assertUniqueWord(state, base, word);
  const change = getWordChange(state, word);
  putWordChange(state, base, { ...change, restoredAt: nextWordTime(change) });
  return word;
}
const ACTOR = crypto.randomUUID();
const emptyCounts = () => ({ baseCorrect: 0, baseWrong: 0, actors: {} });
const clearReviews = p => ({ ...p, reviews: 0, correct: 0, wrong: 0, lastCorrect: null, lastReviewed: null, counts: emptyCounts() });

export function resetAllCards(state) {
  const at = new Date(Math.max(Date.now(), clock(state.reviewReset?.at) + 1)).toISOString();
  state.reviewReset = { at, id: crypto.randomUUID() };
  state.progress = Object.fromEntries(Object.entries(state.progress).map(([id, p]) => [id, { ...clearReviews(p), updatedAt: at }]));
  state.history = state.history.filter(entry => entry.source === 'quiz');
}
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
  const quiz = visibleHistory(words, state).filter(entry => entry.source === 'quiz');
  return { total: words.length, reviewed: progress.filter(p => p.reviews > 0).length, known: progress.filter(p => p.lastCorrect === true).length, weak: progress.filter(p => p.lastCorrect === false).length, accuracy: quiz.length ? Math.round(quiz.filter(entry => entry.correct).length / quiz.length * 100) : null };
}
function scopeQuizWords(words, state, scope) {
  if (!['all', 'weak'].includes(scope)) throw new Error('請選擇有效的測驗範圍。');
  return scope === 'weak' ? words.filter(word => matchesFilter(word, state, 'weak')) : words;
}
export function selectQuizWords(words, state, count = 10, scope = 'all') {
  return shuffle(scopeQuizWords(words, state, scope)).slice(0, count);
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
export function quizCandidates(words, direction = 'en') {
  return words.filter(word => {
    try { for (const selected of direction === 'mixed' ? ['en', 'zh'] : [direction]) createQuestion(word, words, selected); return true; }
    catch { return false; }
  });
}
export function quizPool(words, state, scope = 'all', direction = 'en') {
  // Limit tested words, while the complete visible library supplies distractors.
  return scopeQuizWords(quizCandidates(words, direction), state, scope);
}
export function validateState(input, words) {
  const fail = () => { throw new Error('進度檔格式不正確，請選擇由 Santa 單字室匯出的 JSON。'); };
  if (!input || ![1, 2].includes(input.version) || typeof input.progress !== 'object' || !input.progress || Array.isArray(input.progress) || !Array.isArray(input.history) || input.history.length > 500) fail();
  const customWords = validateCustomWords(input.customWords, words);
  const ids = new Set([...words, ...customWords].map(w => w.id));
  const isDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const safe = emptyState();
  if (input.includeBaseWords !== undefined && typeof input.includeBaseWords !== 'boolean') fail();
  safe.includeBaseWords = input.includeBaseWords ?? true;
  safe.customWords = customWords;
  safe.wordChanges = validateWordChanges(input.wordChanges, words, customWords);
  if (input.reviewReset !== undefined) {
    const reset = input.reviewReset;
    if (!reset || typeof reset.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(reset.at) || !isDate(reset.at)
      || typeof reset.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(reset.id)) fail();
    safe.reviewReset = { at: reset.at, id: reset.id };
  }
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
  const reset = [a.reviewReset, b.reviewReset].filter(Boolean)
    .sort((x, y) => clock(y.at) - clock(x.at) || y.id.localeCompare(x.id))[0];
  if (reset) {
    result.reviewReset = { ...reset };
    for (const side of [a, b]) {
      if (side.reviewReset?.id === reset.id && side.reviewReset.at === reset.at) continue;
      side.progress = Object.fromEntries(Object.entries(side.progress).map(([id, p]) => [id, clearReviews(p)]));
      side.history = side.history.filter(entry => entry.source === 'quiz');
    }
  }
  result.includeBaseWords = a.includeBaseWords;
  const custom = new Map();
  for (const word of [...a.customWords, ...b.customWords]) {
    const existing = custom.get(word.id);
    if (!existing || JSON.stringify(word) > JSON.stringify(existing)) custom.set(word.id, word);
  }
  result.customWords = validateCustomWords([...custom.values()], words);
  const changes = new Map();
  for (const change of [...a.wordChanges, ...b.wordChanges]) {
    const previous = changes.get(change.id);
    if (!previous) { changes.set(change.id, change); continue; }
    const compare = clock(change.updatedAt) - clock(previous.updatedAt) || change.changeId.localeCompare(previous.changeId) || JSON.stringify(change.fields).localeCompare(JSON.stringify(previous.fields));
    const latest = compare > 0 ? change : previous;
    const later = field => clock(change[field]) > clock(previous[field]) ? change[field] : previous[field];
    changes.set(change.id, { ...latest, deletedAt: later('deletedAt'), restoredAt: later('restoredAt') });
  }
  result.wordChanges = validateWordChanges([...changes.values()], words, result.customWords);
  for (const word of [...words, ...result.customWords]) {
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
