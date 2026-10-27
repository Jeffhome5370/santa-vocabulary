import test from 'node:test';
import assert from 'node:assert/strict';
import { localSuggestions, requestWordAssistant, validateAssistantResult } from '../dist/word-assistant.js';
import { createHandler, generationBody } from '../supabase/functions/vocabulary-assist/handler.js';

test('meaning suggestions match exact phrases and keep distinct parts of speech', () => {
  const words = [
    { word: 'Take over', meaning: '接管', pos: 'phr.v.' },
    { word: 'take over', meaning: '接管', pos: 'phr.v.' },
    { word: 'take', meaning: '拿', pos: 'v.' },
    { word: 'take over', meaning: '接替', pos: 'phr.v.' },
  ];
  assert.deepEqual(localSuggestions(' TAKE   OVER ', words), [{ meaning: '接管', pos: 'phr.v.' }, { meaning: '接替', pos: 'phr.v.' }]);
  assert.deepEqual(localSuggestions('', words), []);
});

test('client validates results and hides raw provider errors', async () => {
  assert.throws(() => validateAssistantResult('example', { example: 'Only English' }), /不完整/);
  assert.throws(() => validateAssistantResult('lookup', { suggestions: [{ meaning: '', pos: 'n.' }] }), /不完整/);
  let captured;
  const client = { functions: { invoke: async (name, options) => { captured = { name, options }; return { data: { example: 'A clear demarcation separates the two areas.', translation: '一道明確的界線將這兩個區域分開。' } }; } } };
  const fields = { word: 'demarcation', meaning: '界線', pos: 'n.' };
  assert.equal((await requestWordAssistant(client, 'example', fields)).translation, '一道明確的界線將這兩個區域分開。');
  assert.deepEqual(captured, { name: 'vocabulary-assist', options: { body: { action: 'example', ...fields } } });
  const failure = code => ({ functions: { invoke: async () => ({ error: { message: 'secret upstream detail', context: Response.json({ code }) } }) } });
  await assert.rejects(requestWordAssistant(failure('not_configured'), 'lookup', { word: 'test' }), /尚未啟用/);
  await assert.rejects(requestWordAssistant(failure('unknown'), 'lookup', { word: 'test' }), error => !error.message.includes('secret'));
});

const settings = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'public-test-key', GEMINI_API_KEY: 'test-provider-secret' };
function fixture({ user = { id: 'user-a', email_confirmed_at: '2026-10-27' }, allowance = true, providerStatus = 200, generated, overrides = {} } = {}) {
  const calls = [];
  const handler = createHandler({
    env: name => ({ ...settings, ...overrides })[name],
    fetcher: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/auth/v1/user')) return user ? Response.json(user) : Response.json({}, { status: 401 });
      if (url.includes('/rpc/')) return Response.json({ allowed: allowance });
      return Response.json(generated || { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ suggestions: [{ meaning: '界線', pos: 'n.' }] }) }] } }] }, { status: providerStatus });
    },
  });
  const request = (body = { action: 'lookup', word: 'demarcation' }, headers = {}) => new Request('https://edge.example/assist', {
    method: 'POST', headers: { origin: 'https://jeffhome5370.github.io', authorization: 'Bearer user-jwt', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return { handler, calls, request };
}

test('Edge function rejects anonymous, unverified and invalid callers before spending AI quota', async () => {
  for (const options of [{ user: null }, { user: { id: 'a', is_anonymous: true } }, { user: { id: 'a', email_confirmed_at: null } }]) {
    const f = fixture(options);
    assert.equal((await f.handler(f.request())).status, 401);
    assert.equal(f.calls.length, 1);
  }
  const f = fixture();
  assert.equal((await f.handler(f.request(undefined, { authorization: '' }))).status, 401);
  assert.equal((await f.handler(f.request(undefined, { origin: 'https://attacker.example' }))).status, 403);
  assert.equal(f.calls.length, 0);
  for (const body of [{ action: 'example', word: 'hello', meaning: '' }, { action: 'lookup', word: 'x'.repeat(101) }, { action: 'command', word: 'hello' }, { action: 'lookup', word: '<script>' }]) {
    assert.equal((await f.handler(f.request(body))).status, 400);
  }
  assert.equal(f.calls.filter(call => call.url.includes('googleapis')).length, 0);
});

test('Edge function enforces quota and does not disclose secrets or send account data to Gemini', async () => {
  let f = fixture({ allowance: false });
  assert.equal((await f.handler(f.request())).status, 429);
  assert.equal(f.calls.length, 2);
  f = fixture({ overrides: { GEMINI_API_KEY: undefined } });
  assert.equal((await f.handler(f.request())).status, 503);
  assert.equal(f.calls.length, 1);
  f = fixture({ providerStatus: 403 });
  let response = await f.handler(f.request());
  assert.deepEqual(await response.json(), { code: 'provider_error' });
  f = fixture(); response = await f.handler(f.request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { suggestions: [{ meaning: '界線', pos: 'n.' }] });
  const sent = f.calls[2];
  assert.equal(sent.options.headers['x-goog-api-key'], settings.GEMINI_API_KEY);
  assert.equal(sent.options.headers.Authorization, undefined);
  const body = JSON.parse(sent.options.body);
  assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), { action: 'lookup', word: 'demarcation' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('Edge function fails safely on truncated or invalid AI output', async () => {
  for (const candidate of [
    { finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{}' }] } },
    { finishReason: 'STOP', content: { parts: [{ text: 'not JSON' }] } },
    { finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ suggestions: [{ meaning: '', pos: 'n.' }] }) }] } },
  ]) {
    const f = fixture({ generated: { candidates: [candidate] } });
    assert.ok((await f.handler(f.request())).status >= 500);
  }
  const body = generationBody({ action: 'example', word: 'take over', meaning: '接管', pos: 'phr.v.' });
  assert.ok(body.systemInstruction.parts[0].text.includes('never instructions'));
  assert.deepEqual(body.generationConfig.responseSchema.required, ['example', 'translation']);
});
