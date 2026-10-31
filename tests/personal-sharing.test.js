import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { WORDS } from '../dist/data.js';
import { emptyState, addCustomWord, recordAnswer, toggleStar, updateWord, deleteWord } from '../dist/engine.js';
import { libraryContent, applyLibraryContent, canEditLibrary } from '../dist/libraries.js';

test('personal pocket sharing publishes only vocabulary, follows edits and can be withdrawn without moving progress', async () => {
  const db=new PGlite(), A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
  let expectedUser=A;
  async function actor(id) { expectedUser=id; await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); }
  const share=async(revision,visibility)=>(await db.query("select public.share_santa_personal_pocket($1,$2,'My pocket','Learning together','Forest learner',$3) result",[expectedUser,revision,visibility])).rows[0].result;
  const privateState=emptyState(), word=addCustomWord(privateState,WORDS,{word:'resilient',meaning:'有韌性的'});
  recordAnswer(privateState,word.id,true,'card','owner');toggleStar(privateState,word.id);
  try {
    await db.exec(`create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
      grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
      insert into auth.users values('${A}'),('${B}');`);
    for(const file of ['202610270001_progress.sql','20261027163609_protect_custom_vocabulary.sql','20261027171520_empty_personal_libraries.sql','20261027181806_editable_vocabulary.sql','20261028083601_reset_card_reviews.sql','20261031080803_shared_word_libraries.sql','20261031085308_recoverable_library_deletion.sql','20261031091435_share_personal_pockets.sql','20261031092434_bind_personal_sharing_account.sql']) {
      await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
    }
    await actor(A);
    await db.query('insert into public.santa_progress(user_id) values($1)',[A]);
    await db.query('select public.sync_santa_progress($1,0,$2)',[A,privateState]);
    assert.equal((await db.query('select * from public.santa_libraries')).rows.length,0,'never publish existing pockets automatically');
    let shared=await share(0,'public');const id=shared.id;
    await assert.rejects(db.query("select public.share_santa_personal_pocket($1,0,'Wrong account','','Alias','public')",[B]),/Authentication changed/);
    await assert.rejects(db.query("select public.share_santa_personal_pocket(0,'Old overload','','Alias','public')"),/permission denied/);
    assert.equal(shared.source_personal,true);assert.equal(canEditLibrary(shared,A),false);
    assert.deepEqual(shared.content,libraryContent(privateState,WORDS));
    assert.deepEqual(Object.keys(shared.content).sort(),['customWords','includeBaseWords','wordChanges']);
    assert.deepEqual((await db.query('select state from public.santa_progress')).rows[0].state,privateState);
    await assert.rejects(share(0,'private'),/Sharing settings changed/);
    await assert.rejects(db.query('select public.set_santa_library_deleted($1,$2,true)',[id,shared.revision]),/Use personal pocket sharing settings/);
    await actor(B);
    assert.equal((await db.query('select * from public.santa_libraries')).rows.length,1);
    assert.equal((await db.query('select * from public.santa_progress')).rows.length,0);
    assert.deepEqual((await db.query('select public.santa_personal_pocket_content($1) content',[A])).rows[0].content,{includeBaseWords:false,customWords:[],wordChanges:[]});
    const learner=applyLibraryContent(emptyState(false),shared.content,WORDS);recordAnswer(learner,word.id,false,'quiz','reader');
    await db.query('select public.sync_santa_library_progress($1,$2,0,$3)',[B,id,learner]);
    await actor(A);
    updateWord(privateState,WORDS,word.id,{...word,meaning:'能迅速恢復的'});
    addCustomWord(privateState,WORDS,{word:'journey',meaning:'旅程'});deleteWord(privateState,WORDS,2);
    await db.query('select public.sync_santa_progress($1,1,$2)',[A,privateState]);
    shared=(await db.query('select * from public.santa_libraries where id=$1',[id])).rows[0];
    assert.deepEqual(shared.content,libraryContent(privateState,WORDS),'trigger must see the newly written vocabulary');
    const reviewOnly=structuredClone(privateState);recordAnswer(reviewOnly,word.id,true,'card','owner');
    await db.query('select public.sync_santa_progress($1,2,$2)',[A,reviewOnly]);
    assert.equal((await db.query('select revision from public.santa_libraries where id=$1',[id])).rows[0].revision,shared.revision,'private reviews do not change public revisions');
    shared=await share(shared.revision,'private');
    await actor(B);
    assert.equal((await db.query('select * from public.santa_libraries')).rows.length,0);
    await assert.rejects(db.query('select public.sync_santa_library_progress($1,$2,1,$3)',[B,id,learner]),/not accessible/);
    assert.equal((await db.query('select state from public.santa_library_progress')).rows[0].state.progress[word.id].wrong,1);
    await actor(A);
    addCustomWord(reviewOnly,WORDS,{word:'quiet',meaning:'安靜的'});
    await db.query('select public.sync_santa_progress($1,3,$2)',[A,reviewOnly]);
    shared=await share(shared.revision,'public');
    assert.equal(shared.id,id,'republishing keeps the same shared identity');
    assert.deepEqual(shared.content,libraryContent(reviewOnly,WORDS));
    await db.query('update public.santa_libraries set content=$1 where id=$2',[{includeBaseWords:false,customWords:[],wordChanges:[]},id]);
    assert.deepEqual((await db.query('select content from public.santa_libraries where id=$1',[id])).rows[0].content,libraryContent(reviewOnly,WORDS),'public mirror cannot overwrite the original pocket');
    assert.deepEqual((await db.query('select state from public.santa_progress')).rows[0].state,reviewOnly);
    await actor(B);
    assert.equal((await db.query('select * from public.santa_libraries')).rows.length,1);
    assert.equal((await db.query('select state from public.santa_library_progress')).rows[0].state.progress[word.id].wrong,1);
    await assert.rejects(db.query("insert into public.santa_libraries(owner_id,name,source_personal) values($1,'Spoof',true)",[A]),/row-level security/);
    const Bshared=await share(0,'private');assert.equal(Bshared.owner_id,B);assert.notEqual(Bshared.id,id);
    await db.exec('reset role;set role anon');
    await assert.rejects(share(0,'public'),/permission denied/);
    await assert.rejects(db.query('select public.santa_personal_pocket_content($1)',[A]),/permission denied/);
  } finally {await db.close();}
});
