import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, recordAnswer, deleteWord, allWords, addCustomWord, STORAGE_KEY, loadState } from '../dist/engine.js';
import { WORDS } from '../dist/data.js';
import { dailyKnownCount, taipeiDay, loadGuestState, showEntry, sessionView } from '../dist/design.js';

test('entrance waits for session discovery, permits guest choice, and protects password recovery', () => {
  const context = {ready:false, signedIn:false, guestChosen:false, recovery:false};
  assert.equal(showEntry(context),true);
  assert.equal(showEntry({...context,ready:true}),true);
  assert.equal(showEntry({...context,ready:true,guestChosen:true}),false);
  assert.equal(showEntry({...context,ready:true,signedIn:true}),false);
  assert.equal(showEntry({...context,ready:true,signedIn:true,requested:true}),true);
  assert.equal(showEntry({...context,ready:true,signedIn:true,recovery:true}),true);
  assert.equal(showEntry({...context,guestChosen:true}),true);
});

test('successful login opens cards while token refresh preserves the current editor', () => {
  assert.equal(sessionView(null,'my-account','SIGNED_IN'),'cards');
  assert.equal(sessionView('account-a','account-b','SIGNED_IN'),'cards');
  assert.equal(sessionView('my-account','my-account','TOKEN_REFRESHED'),null);
  assert.equal(sessionView('my-account','my-account','SIGNED_IN'),null);
  assert.equal(sessionView('my-account','my-account','PASSWORD_RECOVERY'),'account');
  assert.equal(sessionView('my-account',null,'SIGNED_OUT'),null);
});

test('fresh guests start empty and never read a signed-in account cache', () => {
  const account = emptyState();
  addCustomWord(account, WORDS, { word: 'private', meaning: '私人' });
  const values = new Map([[`${STORAGE_KEY}.user.my-account`, JSON.stringify(account)]]);
  const storage = { getItem: key => values.get(key) ?? null };
  assert.equal(allWords(WORDS, loadGuestState(storage, WORDS)).length, 0);
  assert.equal(allWords(WORDS, loadState(storage, WORDS, `${STORAGE_KEY}.user.my-account`)).length, WORDS.length + 1);
});

test('old guest starter decks are hidden while their additions and reviews remain recoverable', () => {
  const previous = emptyState();
  const custom = addCustomWord(previous, WORDS, { word: 'curious', meaning: '好奇的' });
  recordAnswer(previous, WORDS[0].id, true, 'card', 'guest');
  const saved = JSON.stringify(previous);
  const storage = { getItem: key => key === STORAGE_KEY ? saved : null };
  const guest = loadGuestState(storage, WORDS);
  assert.deepEqual(allWords(WORDS, guest).map(word => word.id), [custom.id]);
  assert.deepEqual(guest.progress, previous.progress);
  assert.deepEqual(guest.history, previous.history);
  assert.equal(storage.getItem(STORAGE_KEY), saved);
});

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
