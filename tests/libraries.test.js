import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { WORDS } from '../dist/data.js';
import { emptyState, addCustomWord, recordAnswer, toggleStar, updateWord, deleteWord, resetAllCards, allWords } from '../dist/engine.js';
import { libraryContent, applyLibraryContent, libraryStorageKey, canEditLibrary, validateLibraryFields, createLibraryRemote } from '../dist/libraries.js';
import { createSyncCoordinator } from '../dist/cloud-sync.js';

test('shared content excludes private reviews and switching libraries isolates caches and progress', () => {
  const state=emptyState(false), word=addCustomWord(state,WORDS,{word:'journey',meaning:'旅程'});
  recordAnswer(state,word.id,true,'card','owner'); toggleStar(state,word.id);
  const content=libraryContent(state,WORDS);
  assert.deepEqual(Object.keys(content).sort(),['customWords','includeBaseWords','wordChanges']);
  const other=applyLibraryContent(emptyState(false),content,WORDS);
  assert.equal(other.history.length,0); assert.deepEqual(other.progress,{});
  assert.equal(allWords(WORDS,other)[0].word,'journey');
  const second=applyLibraryContent(state,{includeBaseWords:false,customWords:[],wordChanges:[]},WORDS);
  assert.deepEqual(second.progress,{}); assert.equal(second.history.length,0);
  assert.notEqual(libraryStorageKey('a','one'),libraryStorageKey('a','two'));
  assert.notEqual(libraryStorageKey('a','one'),libraryStorageKey('b','one'));
  assert.equal(libraryStorageKey('a'), 'santa-vocabulary.progress.v2.user.a');
  assert.equal(state.progress[word.id].correct,1);
});

test('a shared content update preserves only the learner own progress and follows deletions', () => {
  const owner=emptyState(false), word=addCustomWord(owner,WORDS,{word:'shared',meaning:'分享'});
  let learner=applyLibraryContent(emptyState(false),libraryContent(owner,WORDS),WORDS);
  recordAnswer(learner,word.id,false,'card','learner'); toggleStar(learner,word.id);
  updateWord(owner,WORDS,word.id,{...word,meaning:'共用的'});
  learner=applyLibraryContent(learner,libraryContent(owner,WORDS),WORDS);
  assert.equal(allWords(WORDS,learner)[0].meaning,'共用的');
  assert.equal(learner.progress[word.id].wrong,1); assert.equal(learner.progress[word.id].starred,true);
  deleteWord(owner,WORDS,word.id);
  learner=applyLibraryContent(learner,libraryContent(owner,WORDS),WORDS);
  assert.equal(allWords(WORDS,learner).length,0);
  assert.equal(learner.progress[word.id].wrong,1);
  assert.equal(owner.progress[word.id],undefined);
});

test('library fields require a name and valid visibility; only owner can edit', () => {
  assert.throws(()=>validateLibraryFields({name:'',visibility:'public'}));
  assert.throws(()=>validateLibraryFields({name:'Words',visibility:'everyone'}));
  assert.equal(validateLibraryFields({name:' Words ',visibility:'private'}).name,'Words');
  assert.equal(canEditLibrary({owner_id:'a'},'b'),false);
  assert.equal(canEditLibrary({owner_id:'a'},'a'),true);
  assert.equal(canEditLibrary(null,null),true);
});

test('library sync uses authoritative vocabulary, independent user progress and revision retries', async () => {
  const contentState=emptyState(false), word=addCustomWord(contentState,WORDS,{word:'practice',meaning:'練習'});
  let local=applyLibraryContent(emptyState(false),libraryContent(contentState,WORDS),WORDS);
  recordAnswer(local,word.id,false,'quiz','learner');
  const repository={
    get:async()=>({id:'library',content:libraryContent(contentState,WORDS)}),
    loadProgress:async()=>null,
    saveProgress:async(user,id,revision,next)=>{ assert.equal(user,'learner'); assert.equal(id,'library'); assert.equal(revision,0); return {applied:true,revision:1,state:next}; },
  };
  const sync=createSyncCoordinator({remote:createLibraryRemote(repository,'library',WORDS),words:WORDS,getState:()=>local,applyState:next=>{local=next;}});
  sync.setUser('learner');
  assert.equal(await sync.sync(),true); assert.equal(local.progress[word.id].wrong,1);
  sync.dispose();
});

test('PostgreSQL libraries enforce public/private access, immutable ownership and private per-library reviews', async () => {
  const db=new PGlite(), A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
  const owner=emptyState(false), word=addCustomWord(owner,WORDS,{word:'forest',meaning:'森林'});
  const content=libraryContent(owner,WORDS);
  async function actor(id) { await db.exec('reset role; set role authenticated'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); }
  try {
    await db.exec(`create role anon nologin; create role authenticated nologin;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
      grant usage on schema public,auth to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;
      insert into auth.users values('${A}'),('${B}');`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261031080803_shared_word_libraries.sql',import.meta.url),'utf8'));
    await actor(A);
    const create=async visibility=>(await db.query("insert into public.santa_libraries(owner_id,name,visibility,content) values($1,'English',$2,$3) returning *",[A,visibility,content])).rows[0];
    const publicLib=await create('public'), privateLib=await create('private'), otherLib=await create('public');
    await assert.rejects(db.query("insert into public.santa_libraries(owner_id,name) values($1,'spoof')",[B]),/row-level security/);
    await assert.rejects(db.query('update public.santa_libraries set owner_id=$1 where id=$2',[B,publicLib.id]),/permission denied/);
    const row=(await db.query("update public.santa_libraries set name='Updated' where id=$1 and revision=1 returning *",[publicLib.id])).rows[0];
    assert.equal(row.revision,2);
    assert.equal((await db.query("update public.santa_libraries set name='stale' where id=$1 and revision=1 returning *",[publicLib.id])).rows.length,0);
    await assert.rejects(db.query('update public.santa_libraries set content=$1 where id=$2',[{...content,history:[{secret:true}]},publicLib.id]),/check constraint/);
    await assert.rejects(db.query('update public.santa_libraries set content=$1 where id=$2',[{...content,customWords:[...content.customWords,...content.customWords]},publicLib.id]),/check constraint/);
    recordAnswer(owner,word.id,true,'card','owner');
    await db.query('select public.sync_santa_library_progress($1,$2,0,$3)',[A,publicLib.id,owner]);
    await actor(B);
    assert.equal((await db.query('select * from public.santa_libraries')).rows.length,2);
    assert.equal((await db.query('select * from public.santa_libraries where id=$1',[privateLib.id])).rows.length,0);
    assert.equal((await db.query("update public.santa_libraries set name='hacked' where id=$1 returning *",[publicLib.id])).rows.length,0);
    assert.equal((await db.query('select * from public.santa_library_progress')).rows.length,0);
    const learner=applyLibraryContent(emptyState(false),content,WORDS); recordAnswer(learner,word.id,false,'quiz','learner');
    const result=(await db.query('select public.sync_santa_library_progress($1,$2,0,$3) result',[B,publicLib.id,learner])).rows[0].result;
    assert.equal(result.applied,true); assert.equal(result.state.progress[word.id].wrong,1);
    const stale=(await db.query('select public.sync_santa_library_progress($1,$2,0,$3) result',[B,publicLib.id,learner])).rows[0].result;
    assert.equal(stale.applied,false);
    await assert.rejects(db.query('select public.sync_santa_library_progress($1,$2,0,$3)',[A,publicLib.id,learner]),/Authentication changed/);
    await assert.rejects(db.query('select public.sync_santa_library_progress($1,$2,0,$3)',[B,privateLib.id,learner]),/not accessible/);
    await db.query('select public.sync_santa_library_progress($1,$2,0,$3)',[B,otherLib.id,emptyState(false)]);
    assert.equal((await db.query('select * from public.santa_library_progress')).rows.length,2);
    const reset=structuredClone(learner); resetAllCards(reset);
    await db.query('select public.sync_santa_library_progress($1,$2,1,$3)',[B,publicLib.id,reset]);
    await assert.rejects(db.query('select public.sync_santa_library_progress($1,$2,2,$3)',[B,publicLib.id,learner]),/reset is missing or stale/);
    await actor(A);
    assert.equal((await db.query('select * from public.santa_library_progress')).rows[0].state.progress[word.id].correct,1);
    await db.query("update public.santa_libraries set visibility='private' where id=$1",[publicLib.id]);
    await actor(B);
    await assert.rejects(db.query('select public.sync_santa_library_progress($1,$2,2,$3)',[B,publicLib.id,reset]),/not accessible/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from public.santa_libraries'),/permission denied/);
    await assert.rejects(db.query('select * from public.santa_library_progress'),/permission denied/);
    await assert.rejects(db.query('select public.sync_santa_library_progress($1,$2,0,$3)',[A,publicLib.id,learner]),/permission denied/);
  } finally { await db.close(); }
});
