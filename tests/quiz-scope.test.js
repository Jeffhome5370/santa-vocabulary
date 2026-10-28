import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS } from '../dist/data.js';
import { emptyState, recordAnswer, quizPool, selectQuizWords, createQuestion, allWords, deleteWord } from '../dist/engine.js';

test('weak-only quizzes never add known or unseen words to fill a round', () => {
  const state=emptyState();
  recordAnswer(state,1,false,'card','learner');
  recordAnswer(state,2,false,'quiz','learner');
  recordAnswer(state,3,true,'card','learner');
  const before=structuredClone(state);
  const pool=quizPool(WORDS,state,'weak','mixed');
  assert.deepEqual(new Set(pool.map(w=>w.id)),new Set([1,2]));
  const selected=selectQuizWords(pool,state,10,'weak');
  assert.equal(selected.length,2);
  assert.deepEqual(new Set(selected.map(w=>w.id)),new Set([1,2]));
  assert.equal(quizPool(WORDS,state,'all','mixed').length,WORDS.length);
  assert.deepEqual(state,before);
});

test('one weak word can be tested in all directions with four valid library options', () => {
  const state=emptyState(); recordAnswer(state,1,false,'card','learner');
  for(const direction of ['en','zh','mixed']) {
    const pool=quizPool(WORDS.slice(0,4),state,'weak',direction);
    assert.equal(pool.length,1);
    const question=createQuestion(pool[0],WORDS.slice(0,4),direction);
    assert.equal(question.word.id,1);
    assert.equal(question.options.length,4);
    assert.equal(new Set(question.options.map(option=>option.text)).size,4);
    assert.equal(question.options.filter(option=>option.id===1).length,1);
  }
  recordAnswer(state,1,true,'quiz','learner');
  assert.equal(quizPool(WORDS,state,'weak').length,0);
});

test('empty, deleted and untestable weak pools stay empty rather than falling back to all words', () => {
  const state=emptyState();
  assert.deepEqual(quizPool(WORDS,state,'weak'),[]);
  recordAnswer(state,1,false,'card','learner');
  assert.deepEqual(quizPool(WORDS.slice(0,3),state,'weak'),[]);
  const duplicate=WORDS.slice(0,4).map(w=>({...w,meaning:'同一意思'}));
  assert.deepEqual(quizPool(duplicate,state,'weak'),[]);
  deleteWord(state,WORDS,1);
  assert.deepEqual(quizPool(allWords(WORDS,state),state,'weak'),[]);
  assert.throws(()=>quizPool(WORDS,state,'invalid'));
});

test('large weak pools are capped at ten unique targets', () => {
  const state=emptyState();
  for(const word of WORDS.slice(0,15)) recordAnswer(state,word.id,false,'card','learner');
  const selected=selectQuizWords(quizPool(WORDS,state,'weak'),state,10,'weak');
  assert.equal(selected.length,10);
  assert.equal(new Set(selected.map(w=>w.id)).size,10);
  assert.ok(selected.every(w=>w.id<=15));
});
