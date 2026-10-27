import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('AI quota is per user, cannot be reset by clients, and enforces minute/day limits', async () => {
  const db = new PGlite();
  const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
  try {
    await db.exec(`create role anon nologin; create role authenticated nologin;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      grant usage on schema auth, public to authenticated, anon;
      insert into auth.users values ('${a}'),('${b}');`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261027175152_vocabulary_ai_quota.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261027175803_ai_quota_deny_direct_access.sql', import.meta.url), 'utf8'));
    const consume = async () => (await db.query('select public.consume_santa_ai_allowance() as result')).rows[0].result.allowed;
    await db.exec('set role anon');
    await assert.rejects(consume(), /permission denied/);
    await db.exec('reset role; set role authenticated');
    await assert.rejects(consume(), /Authentication required/);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [a]);
    for (let i = 0; i < 6; i++) assert.equal(await consume(), true);
    assert.equal(await consume(), false);
    await assert.rejects(db.exec('select * from santa_ai_private.usage'), /permission denied/);
    await assert.rejects(db.exec('update santa_ai_private.usage set day_count=0'), /permission denied/);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [b]);
    assert.equal(await consume(), true);
    await db.exec('reset role');
    await db.query("update santa_ai_private.usage set day_count=59,minute_start=now()-interval '2 minutes' where user_id=$1", [a]);
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [a]);
    assert.equal(await consume(), true); assert.equal(await consume(), false);
    await db.exec('reset role');
    await db.query("update santa_ai_private.usage set usage_day=current_date-2, minute_start=now()-interval '2 minutes' where user_id=$1", [a]);
    await db.exec('set role authenticated');
    assert.equal(await consume(), true);
  } finally { await db.close(); }
});
