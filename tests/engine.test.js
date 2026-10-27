import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS } from '../dist/data.js';
import { STORAGE_KEY, emptyState, recordAnswer, toggleStar, getStats, selectQuizWords, createQuestion, validateState, mergeStates, loadState } from '../dist/engine.js';

test('all 86 unique cards include bilingual examples and corrected vocabulary', () => {
  assert.equal(WORDS.length, 86);
  assert.equal(new Set(WORDS.map(word => word.id)).size, 86);
  for (const word of WORDS) for (const field of ['word', 'pos', 'meaning', 'example', 'translation']) assert.ok(word[field], `${word.id}: ${field}`);
  assert.equal(WORDS.find(word => word.id === 53).word, 'recurrence');
  assert.equal(WORDS.find(word => word.id === 61).meaning, '禮貌、禮遇');
  assert.match(WORDS.find(word => word.id === 85).meaning, /殿下/);
});
test('latest error has priority, then unseen words; stars alone are not reviews', () => {
  const state = emptyState();
  recordAnswer(state, 1, true, 'quiz');
  recordAnswer(state, 23, false, 'quiz');
  toggleStar(state, 5);
  const selected = selectQuizWords(WORDS, state);
  assert.equal(selected.length, 10);
  assert.equal(selected[0].id, 23);
  assert.equal(new Set(selected.map(word => word.id)).size, 10);
  assert.ok(!selected.some(word => word.id === 1));
  assert.equal(getStats(WORDS, state).reviewed, 2);
});
test('every direction has four distinct options and exactly one answer', () => {
  for (let round = 0; round < 8; round++) for (const word of WORDS) for (const direction of ['en', 'zh', 'mixed']) {
    const question = createQuestion(word, WORDS, direction);
    assert.equal(question.options.length, 4);
    assert.equal(new Set(question.options.map(option => option.text)).size, 4);
    assert.equal(question.options.filter(option => option.id === word.id).length, 1);
    assert.ok(['en', 'zh'].includes(question.direction));
  }
});
test('correcting a previously wrong card clears weak status without losing history', () => {
  const state = emptyState();
  recordAnswer(state, 23, false, 'quiz');
  recordAnswer(state, 23, true, 'card');
  const stats = getStats(WORDS, state);
  assert.equal(stats.weak, 0);
  assert.equal(stats.known, 1);
  assert.equal(stats.accuracy, 0); // self-assessment is excluded from quiz accuracy
  assert.equal(state.progress[23].reviews, 2);
  assert.equal(state.history.length, 2);
  validateState(state, WORDS);
});
test('reimport is idempotent and older backups do not erase newer review results', () => {
  const current = emptyState();
  recordAnswer(current, 23, true, 'quiz');
  current.progress[23].updatedAt = '2026-10-27T15:00:00.000Z';
  const backup = structuredClone(current);
  backup.progress[23].lastCorrect = false;
  backup.progress[23].updatedAt = '2026-10-26T15:00:00.000Z';
  const merged = mergeStates(current, backup, WORDS);
  assert.equal(merged.progress[23].lastCorrect, true);
  assert.equal(merged.progress[23].reviews, 1);
  assert.equal(merged.history.length, 1);
  assert.deepEqual(mergeStates(merged, backup, WORDS), merged);
});
test('malformed or hostile backups are rejected without modifying current state', () => {
  for (const bad of [null, {}, {version:1,progress:[],history:[]}, {version:1,progress:{999:{}},history:[]}, JSON.parse('{"version":1,"progress":{"__proto__":{}},"history":[]}')]) {
    assert.throws(() => validateState(bad, WORDS));
  }
  const current = emptyState(); recordAnswer(current, 1, true, 'quiz');
  const before = structuredClone(current);
  const bad = structuredClone(current); bad.progress[1].reviews = -1;
  assert.throws(() => mergeStates(current, bad, WORDS));
  assert.deepEqual(current, before);
});
test('saved state restores accurately; damaged storage is reported instead of overwritten', () => {
  const state = emptyState(); recordAnswer(state, 47, false, 'quiz');
  const storage = { getItem: key => key === STORAGE_KEY ? JSON.stringify(state) : null };
  assert.deepEqual(loadState(storage, WORDS), state);
  assert.throws(() => loadState({getItem: () => '{broken'}, WORDS));
  assert.deepEqual(loadState({getItem: () => null}, WORDS), emptyState());
});
