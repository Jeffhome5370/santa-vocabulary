import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, recordAnswer, deleteWord } from '../dist/engine.js';
import { WORDS } from '../dist/data.js';
import { dailyKnownCount, taipeiDay } from '../dist/design.js';

test('daily goal deduplicates correct card and quiz answers and ignores wrong/deleted words', () => {
  const state = emptyState();
  recordAnswer(state, WORDS[0].id, true, 'card', 'phone');
  recordAnswer(state, WORDS[0].id, true, 'quiz', 'phone');
  recordAnswer(state, WORDS[1].id, false, 'card', 'phone');
  const day = taipeiDay(new Date().toISOString());
  assert.equal(dailyKnownCount(WORDS, state, day), 1);
  deleteWord(state, WORDS, WORDS[0].id);
  assert.equal(dailyKnownCount(WORDS.slice(1), state, day), 0);
});

test('daily goal follows Taipei midnight and supports historical date-only entries', () => {
  const state = emptyState();
  state.history = [
    { wordId: 1, correct: true, at: '2026-10-27T15:59:59Z' },
    { wordId: 2, correct: true, at: '2026-10-27T16:00:00Z' },
    { wordId: 2, correct: true, at: '2026-10-28' },
    { wordId: 3, correct: false, at: '2026-10-28' },
  ];
  assert.equal(dailyKnownCount(WORDS, state, '2026-10-27'), 1);
  assert.equal(dailyKnownCount(WORDS, state, '2026-10-28'), 1);
});
