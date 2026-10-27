import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS } from '../dist/data.js';
import { emptyState, allWords, addCustomWord, mergeStates, validateState, recordAnswer, getStats, visibleHistory, guestForAccount, quizCandidates } from '../dist/engine.js';
import { createRemote, createSyncCoordinator } from '../dist/cloud-sync.js';

test('A keeps 86 original words while a new B starts completely empty', async () => {
  const legacy = validateState({version:2,progress:{},history:[]},WORDS);
  assert.equal(allWords(WORDS,legacy).length,86);
  const remote = createRemote({from(){return {select(){return this;},eq(){return this;},maybeSingle(){return this;},abortSignal:async()=>({data:null,error:null})};}});
  const fresh = await remote.load('B');
  assert.equal(fresh.state.includeBaseWords,false);
  assert.deepEqual(allWords(WORDS,fresh.state),[]);
  assert.deepEqual(getStats([],fresh.state),{total:0,reviewed:0,known:0,weak:0,accuracy:null});
});

test('private library stays private after backup, guest import and adding words', () => {
  const b = emptyState(false), guest = emptyState();
  recordAnswer(guest,23,true,'quiz','visitor');
  const guestWord = addCustomWord(guest,WORDS,{word:'curious',meaning:'好奇的'});
  recordAnswer(guest,guestWord.id,false,'card','visitor');
  const imported = guestForAccount(guest,b);
  assert.equal(imported.history.length,1);
  assert.equal(imported.progress[23],undefined);
  const merged = mergeStates(b,imported,WORDS);
  assert.deepEqual(allWords(WORDS,merged).map(w=>w.word),['curious']);
  assert.equal(validateState(JSON.parse(JSON.stringify(merged)),WORDS).includeBaseWords,false);
  const a = mergeStates(emptyState(),merged,WORDS);
  assert.equal(allWords(WORDS,a).length,87);
});

test('hidden legacy reviews remain stored without affecting a private library', () => {
  const state = emptyState(false);
  recordAnswer(state,23,true,'quiz','legacy');
  assert.equal(getStats(allWords(WORDS,state),state).accuracy,null);
  assert.deepEqual(visibleHistory(allWords(WORDS,state),state),[]);
  assert.equal(mergeStates(state,emptyState(),WORDS).progress[23].correct,1);
});

test('empty and small libraries never produce an invalid four-choice quiz', () => {
  const state = emptyState(false);
  for(let i=0;i<4;i++) {
    assert.equal(quizCandidates(allWords(WORDS,state)).length,0);
    addCustomWord(state,WORDS,{word:['apple','banana','cherry','date'][i],meaning:['蘋果','香蕉','櫻桃','椰棗'][i]});
  }
  assert.equal(quizCandidates(allWords(WORDS,state),'mixed').length,4);
  state.customWords.forEach(w=>{w.meaning='相同意思';});
  assert.equal(quizCandidates(allWords(WORDS,state),'mixed').length,0);
});

test('cloud library mode overrides an older local cache before syncing', async () => {
  let state = emptyState();
  const cloud = createSyncCoordinator({words:WORDS,getState:()=>state,applyState:next=>{state=next;},remote:{load:async()=>({state:emptyState(false),revision:1}),save:async()=>{throw new Error('No upload expected');}}});
  cloud.setUser('B');
  assert.equal(await cloud.sync(),true);
  assert.equal(allWords(WORDS,state).length,0);
  cloud.dispose();
});
