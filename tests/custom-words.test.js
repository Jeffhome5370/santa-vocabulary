import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS } from '../dist/data.js';
import { emptyState, allWords, addCustomWord, validateState, mergeStates, recordAnswer, getStats, createQuestion, loadState, STORAGE_KEY } from '../dist/engine.js';
import { createSyncCoordinator } from '../dist/cloud-sync.js';

test('a custom word survives backup, reload, review and quiz generation', () => {
  const state = emptyState();
  const word = addCustomWord(state, WORDS, {word:' resilient ', meaning:'有韌性的', pos:'adj.', example:'She is resilient.', translation:'她很有韌性。'});
  assert.equal(word.word, 'resilient');
  assert.equal(allWords(WORDS, state).length, 87);
  recordAnswer(state, word.id, true, 'quiz', 'phone');
  const restored = loadState({getItem:key => key === STORAGE_KEY ? JSON.stringify(state) : null}, WORDS);
  assert.deepEqual(restored, state);
  assert.equal(getStats(allWords(WORDS, restored), restored).known, 1);
  assert.equal(createQuestion(word, allWords(WORDS, state)).options.filter(option => option.id === word.id).length, 1);
  assert.equal(WORDS.length, 86);
});

test('required fields, duplicates, invalid IDs and capacity fail without altering state', () => {
  const state = emptyState(), before = structuredClone(state);
  assert.throws(() => addCustomWord(state, WORDS, {word:' ',meaning:'意思'}));
  assert.throws(() => addCustomWord(state, WORDS, {word:'word',meaning:' '}));
  assert.throws(() => addCustomWord(state, WORDS, {word:'INNOVATIVE',meaning:'創新的'}), /已經有/);
  assert.throws(() => addCustomWord(state, WORDS, {word:'a'.repeat(101),meaning:'意思'}));
  assert.deepEqual(state, before);
  const word = addCustomWord(state, WORDS, {word:'resilient',meaning:'有韌性的'});
  assert.throws(() => validateState({...state,customWords:[{...word,id:1}]}, WORDS));
  assert.throws(() => validateState({...state,customWords:[word,word]}, WORDS));
  assert.throws(() => validateState({...state,customWords:Array(501).fill(word)}, WORDS));
  assert.deepEqual(validateState({version:2,progress:{},history:[]}, WORDS), emptyState());
});

test('different devices merge new vocabulary and its review history without duplicates', () => {
  const phone = emptyState(), desktop = emptyState();
  const a = addCustomWord(phone, WORDS, {word:'resilient',meaning:'有韌性的'});
  const b = addCustomWord(desktop, WORDS, {word:'curious',meaning:'好奇的'});
  recordAnswer(phone, a.id, true, 'card', 'phone');
  recordAnswer(desktop, b.id, false, 'quiz', 'desktop');
  const merged = mergeStates(phone, desktop, WORDS);
  assert.equal(merged.customWords.length, 2);
  assert.equal(merged.progress[a.id].correct, 1);
  assert.equal(merged.progress[b.id].wrong, 1);
  assert.deepEqual(mergeStates(merged, phone, WORDS), merged);
  assert.deepEqual(mergeStates(desktop, phone, WORDS), merged);
  assert.deepEqual(mergeStates(merged, {version:1,progress:{},history:[]}, WORDS), merged);
});

test('cloud sync learns remote custom word IDs before merging their progress', async () => {
  const remoteState = emptyState();
  const word = addCustomWord(remoteState, WORDS, {word:'resilient',meaning:'有韌性的'});
  recordAnswer(remoteState, word.id, false, 'card', 'remote');
  let state = emptyState(); const phases = [];
  const controller = createSyncCoordinator({words: WORDS, getState:()=>state, applyState:next=>{state=next;},onStatus:phase=>phases.push(phase), remote:{load:async()=>({state:remoteState,revision:1}),save:async()=>{throw new Error('No write needed');}}});
  controller.setUser('my-account');
  assert.equal(await controller.sync(), true);
  assert.equal(state.customWords[0].word, 'resilient');
  assert.equal(state.progress[word.id].wrong, 1);
  assert.equal(phases.at(-1), 'synced');
  controller.dispose();
});
