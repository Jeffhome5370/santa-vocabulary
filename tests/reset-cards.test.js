import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS } from '../dist/data.js';
import { emptyState, addCustomWord, updateWord, toggleStar, recordAnswer, getProgress, getStats, resetAllCards, validateState, mergeStates } from '../dist/engine.js';
import { createSyncCoordinator } from '../dist/cloud-sync.js';

test('reset makes every card unseen while preserving vocabulary, edits, stars and quiz history', () => {
  const state = emptyState();
  const custom = addCustomWord(state, WORDS, {word:'curious',meaning:'好奇的'});
  updateWord(state, WORDS, custom.id, {...custom,meaning:'感到好奇的'});
  toggleStar(state, WORDS[0].id);
  recordAnswer(state, WORDS[0].id, true, 'card', 'phone');
  recordAnswer(state, WORDS[1].id, false, 'quiz', 'phone');
  const previous = structuredClone(state);
  resetAllCards(state);
  assert.deepEqual(state.customWords, previous.customWords);
  assert.deepEqual(state.wordChanges, previous.wordChanges);
  assert.equal(state.includeBaseWords, previous.includeBaseWords);
  assert.equal(getProgress(state, WORDS[0].id).starred, true);
  assert.equal(getStats(WORDS,state).reviewed, 0);
  assert.equal(getStats(WORDS,state).known, 0);
  assert.equal(getStats(WORDS,state).weak, 0);
  assert.deepEqual(state.history, previous.history.filter(e=>e.source==='quiz'));
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(state)),WORDS),state);
});

test('stale devices and backups cannot resurrect reset progress, and fresh reviews merge once', () => {
  const state=emptyState(); recordAnswer(state,1,true,'card','phone');
  const stale=structuredClone(state);
  resetAllCards(state);
  assert.equal(getProgress(mergeStates(state,stale,WORDS),1).reviews,0);
  assert.deepEqual(mergeStates(state,stale,WORDS),mergeStates(stale,state,WORDS));
  const phone=structuredClone(state), desktop=structuredClone(state);
  recordAnswer(phone,1,true,'card','phone'); recordAnswer(desktop,1,false,'card','desktop');
  const merged=mergeStates(mergeStates(phone,desktop,WORDS),stale,WORDS);
  assert.equal(getProgress(merged,1).reviews,2);
  assert.equal(merged.history.filter(e=>e.source==='card').length,2);
  assert.deepEqual(mergeStates(merged,phone,WORDS),merged);
  const earlier=structuredClone(merged); resetAllCards(merged);
  assert.equal(getProgress(mergeStates(earlier,merged,WORDS),1).reviews,0);
  assert.notEqual(merged.reviewReset.id,earlier.reviewReset.id);
});

test('cloud revision conflicts retain reset state and do not restore a stale remote review', async () => {
  let local=emptyState(); recordAnswer(local,1,true,'card','phone');
  let remoteState=structuredClone(local), revision=1;
  resetAllCards(local);
  const sync=createSyncCoordinator({words:WORDS,getState:()=>local,applyState:s=>{local=s;},remote:{
    load:async()=>({state:structuredClone(remoteState),revision}),
    save:async(id,base,state)=>{assert.equal(base,revision);remoteState=structuredClone(state);revision++;return {applied:true,state:remoteState,revision};},
  }});
  sync.setUser('my-account'); assert.equal(await sync.sync(),true);
  assert.equal(getProgress(remoteState,1).reviews,0);
  assert.deepEqual(local.reviewReset,remoteState.reviewReset);
  sync.dispose();
});

test('invalid reset markers are rejected before changing saved state', () => {
  for(const reviewReset of [null,{}, {at:'bad',id:'reset'}, {at:new Date().toISOString(),id:'__bad actor'}]) {
    assert.throws(()=>validateState({...emptyState(),reviewReset},WORDS));
  }
});
