import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { friendlyAuthError } from '../dist/account.js';

test('signup allowlist fails closed, preserves verified members and remains private', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin;
      create role supabase_auth_admin nologin;
      create schema auth;
      create table auth.users(email text, email_confirmed_at timestamptz);
      insert into auth.users values ('owner@example.com',now()),('unverified@example.com',null);
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20261027165302_signup_email_allowlist.sql',import.meta.url),'utf8'));
    await db.exec("insert into santa_private.signup_allowlist(email) values ('friend@example.com'); insert into santa_private.signup_allowlist(email,enabled) values ('disabled@example.com',false)");
    await assert.rejects(db.exec("insert into santa_private.signup_allowlist(email) values ('UPPER@example.com')"), /check constraint/);
    await db.exec('set role supabase_auth_admin');
    const check = async email => (await db.query('select santa_private.check_signup_allowlist($1) as result',[{user:{email}}])).rows[0].result;
    assert.deepEqual(await check('owner@example.com'), {});
    assert.deepEqual(await check(' Friend@EXAMPLE.com '), {});
    for(const email of ['unverified@example.com','disabled@example.com','stranger@example.com','friend@example.com.attacker.test','',null]) {
      assert.equal((await check(email)).error.http_code,403);
    }
    assert.equal((await db.query("select santa_private.check_signup_allowlist('{}') as result")).rows[0].result.error.http_code,403);
    await assert.rejects(db.exec("insert into santa_private.signup_allowlist(email) values ('attacker@example.com')"), /permission denied/);
    for (const role of ['anon','authenticated']) {
      await db.exec(`reset role; set role ${role}`);
      await assert.rejects(db.query('select * from santa_private.signup_allowlist'), /permission denied/);
      await assert.rejects(db.query("select santa_private.check_signup_allowlist('{}')"), /permission denied/);
    }
  } finally { await db.close(); }
});

test('signup rejection displays an actionable message', () => {
  assert.equal(friendlyAuthError({message:'此 Email 尚未獲准註冊。請聯絡網站管理者。'}),'此 Email 尚未獲准註冊。請聯絡網站管理者加入白名單。');
});
