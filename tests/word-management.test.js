import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS } from '../dist/data.js';
import { emptyState, allWords, addCustomWord, updateWord, deleteWord, restoreWord, isWordDeleted, recordAnswer, toggleStar, validateState, mergeStates, getStats, visibleHistory, guestForAccount } from '../dist/engine.js';
import { createSyncCoordinator } from '../dist/cloud-sync.js';

test('editing original/custom words keeps IDs, reviews, stars and original shared data', () => {
  const state = emptyState(), original = structuredClone(WORDS[0]);
  const custom = addCustomWord(state, WORDS, {word:'resilent',meaning:'打錯的中文'});
  for (const word of [WORDS[0],custom]) { recordAnswer(state,word.id,true,'card','editor'); toggleStar(state,word.id); }
  const beforeProgress = structuredClone(state.progress);
  updateWord(state, WORDS, original.id, {...original,meaning:'自己修正的意思'});
  updateWord(state, WORDS, custom.id, {...custom,word:'resilient',meaning:'有韌性的'});
  assert.deepEqual(WORDS[0], original);
  assert.equal(allWords(WORDS,state).find(word=>word.id===custom.id).word,'resilient');
  assert.deepEqual(state.progress,beforeProgress);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(state)),WORDS),state);
  assert.equal(allWords(WORDS,emptyState())[0].meaning,original.meaning);
  const before = structuredClone(state);
  assert.throws(()=>updateWord(state,WORDS,custom.id,{word:'',meaning:'錯誤'}));
  assert.throws(()=>updateWord(state,WORDS,custom.id,allWords(WORDS,state).find(word=>word.id===original.id)),/已經有/);
  assert.deepEqual(state,before);
});

test('deleted words leave cards/stats/history, remain in backup, and restore their progress', () => {
  const state=emptyState(false), custom=addCustomWord(state,WORDS,{word:'resilient',meaning:'有韌性的'});
  recordAnswer(state,custom.id,false,'quiz','phone'); toggleStar(state,custom.id);
  const progress=structuredClone(state.progress);
  deleteWord(state,WORDS,custom.id);
  assert.equal(allWords(WORDS,state).length,0);
  assert.equal(allWords(WORDS,state,{includeDeleted:true}).length,1);
  assert.equal(visibleHistory(allWords(WORDS,state),state).length,0);
  assert.equal(getStats(allWords(WORDS,state),state).total,0);
  assert.equal(isWordDeleted(state,custom.id),true);
  const restored=validateState(JSON.parse(JSON.stringify(state)),WORDS);
  restoreWord(restored,WORDS,custom.id);
  assert.deepEqual(restored.progress,progress);
  assert.equal(getStats(allWords(WORDS,restored),restored).weak,1);
  assert.equal(restored.history.length,1);
});

test('stale devices/backups cannot undo edits or resurrect deletions; explicit restore merges', () => {
  const state=emptyState(false), word=addCustomWord(state,WORDS,{word:'resilent',meaning:'有韌性的'});
  const stale=structuredClone(state);
  updateWord(state,WORDS,word.id,{...word,word:'resilient'});
  const changed=mergeStates(stale,state,WORDS);
  assert.equal(allWords(WORDS,changed)[0].word,'resilient');
  deleteWord(state,WORDS,word.id);
  const offline=structuredClone(stale);
  updateWord(offline,WORDS,word.id,{...word,meaning:'離線修改'});
  const merged=mergeStates(state,offline,WORDS);
  assert.equal(allWords(WORDS,merged).length,0);
  assert.deepEqual(mergeStates(offline,state,WORDS),merged);
  assert.deepEqual(mergeStates(merged,stale,WORDS),merged);
  restoreWord(merged,WORDS,word.id);
  const restored=mergeStates(state,merged,WORDS);
  assert.equal(allWords(WORDS,restored).length,1);
  assert.equal(isWordDeleted(mergeStates(restored,state,WORDS),word.id),false);
  deleteWord(restored,WORDS,word.id);
  assert.equal(allWords(WORDS,mergeStates(restored,merged,WORDS)).length,0);
});

test('validation rejects duplicate/unknown mutations and restore refuses a duplicate word', () => {
  const state=emptyState(false), word=addCustomWord(state,WORDS,{word:'resilient',meaning:'有韌性的'});
  updateWord(state,WORDS,word.id,{...word,meaning:'能恢復的'});
  const bad=structuredClone(state); bad.wordChanges[0].id=999999;
  assert.throws(()=>validateState(bad,WORDS));
  assert.throws(()=>validateState({...state,wordChanges:[...state.wordChanges,...state.wordChanges]},WORDS));
  deleteWord(state,WORDS,word.id);
  addCustomWord(state,WORDS,{word:'resilient',meaning:'能恢復的'});
  const before=structuredClone(state);
  assert.throws(()=>restoreWord(state,WORDS,word.id),/已經有/);
  assert.deepEqual(state,before);
  const guest=emptyState(); updateWord(guest,WORDS,WORDS[0].id,{...WORDS[0],meaning:'訪客修改'});
  assert.equal(guestForAccount(guest,emptyState(false)).wordChanges.length,0);
});

test('cloud revision retry preserves remote deletion plus a newer local text edit', async () => {
  const original=emptyState(false), word=addCustomWord(original,WORDS,{word:'resilient',meaning:'有韌性的'});
  let state=structuredClone(original), remoteState=structuredClone(original), revision=1, saveCalls=0;
  updateWord(state,WORDS,word.id,{...word,meaning:'本機修正'});
  const sync=createSyncCoordinator({words:WORDS,getState:()=>state,applyState:next=>{state=next;},remote:{
    load:async()=>({state:structuredClone(remoteState),revision}),
    save:async(id,base,candidate)=>{
      if(saveCalls++===0){ deleteWord(remoteState,WORDS,word.id); revision++; return {applied:false,state:structuredClone(remoteState),revision}; }
      assert.equal(base,revision); remoteState=structuredClone(candidate); revision++; return {applied:true,state:remoteState,revision};
    },
  }});
  sync.setUser('my-account'); assert.equal(await sync.sync(),true);
  assert.equal(allWords(WORDS,state).length,0);
  assert.equal(state.wordChanges[0].fields.meaning,'本機修正');
  assert.equal(allWords(WORDS,remoteState).length,0);
  sync.dispose();
});
