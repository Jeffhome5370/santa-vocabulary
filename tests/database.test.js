import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { emptyState, recordAnswer } from '../dist/engine.js';

test('actual PostgreSQL migration isolates users and rejects stale writes', async () => {
  const db = new PGlite();
  const userA = '11111111-1111-4111-8111-111111111111';
  const userB = '22222222-2222-4222-8222-222222222222';
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      grant usage on schema auth, public to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
      insert into auth.users values ('${userA}'), ('${userB}');
    `);
    const migration = await readFile(new URL('../supabase/migrations/202610270001_progress.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    // Applying the same migration twice must not widen access or destroy rows.
    await db.exec(migration);
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from public.santa_progress'), /permission denied/);
    await assert.rejects(db.query('select public.sync_santa_progress($1,0,$2)', [userA, emptyState()]), /permission denied/);
    await db.exec('reset role; set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userA]);
    const stateA = emptyState(); recordAnswer(stateA, 23, true, 'quiz', 'test-A');
    let result = await db.query('select public.sync_santa_progress($1,0,$2) as result', [userA, stateA]);
    assert.equal(result.rows[0].result.applied, true);
    assert.equal(result.rows[0].result.revision, 1);
    result = await db.query('select public.sync_santa_progress($1,0,$2) as result', [userA, emptyState()]);
    assert.equal(result.rows[0].result.applied, false);
    assert.equal(result.rows[0].result.state.progress['23'].correct, 1);
    await assert.rejects(db.query('select public.sync_santa_progress($1,0,$2)', [userB, emptyState()]), /Authentication changed/);
    await assert.rejects(db.query('insert into public.santa_progress(user_id) values ($1)', [userB]), /row-level security/);
    await assert.rejects(db.query('select public.sync_santa_progress($1,null,$2)', [userA, stateA]), /Invalid revision/);
    await assert.rejects(db.query('select public.sync_santa_progress($1,1,$2)', [userA, {version:2,progress:{}}]), /Invalid progress payload/);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userB]);
    assert.equal((await db.query('select * from public.santa_progress')).rows.length, 0);
    const stateB = emptyState(); recordAnswer(stateB, 47, false, 'quiz', 'test-B');
    await db.query('select public.sync_santa_progress($1,0,$2)', [userB, stateB]);
    const visible = (await db.query('select user_id,state from public.santa_progress')).rows;
    assert.equal(visible.length, 1);
    assert.equal(visible[0].user_id, userB);
    assert.equal(visible[0].state.progress['47'].wrong, 1);
    assert.equal((await db.query('update public.santa_progress set revision = 999 where user_id = $1 returning user_id', [userA])).rows.length, 0);
    await assert.rejects(db.query('delete from public.santa_progress where user_id = $1', [userB]), /permission denied/);
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int as count from public.santa_progress')).rows[0].count, 2);
  } finally { await db.close(); }
});
