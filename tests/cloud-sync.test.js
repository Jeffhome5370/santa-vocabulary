import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS } from '../dist/data.js';
import { STORAGE_KEY, LEGACY_STORAGE_KEY, emptyState, recordAnswer, toggleStar, mergeStates, validateState, loadState } from '../dist/engine.js';
import { createSyncCoordinator, fingerprint, isCloudConfigured } from '../dist/cloud-sync.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function memoryServer() {
  const rows = new Map();
  const calls = [];
  return {
    rows, calls,
    async load(id) { calls.push(['load', id]); return structuredClone(rows.get(id) || { state: emptyState(), revision: 0 }); },
    async save(id, revision, state) {
      calls.push(['save', id]);
      const current = rows.get(id) || { state: emptyState(), revision: 0 };
      if (current.revision !== revision) return structuredClone({ ...current, applied: false });
      const next = { state: structuredClone(state), revision: revision + 1 };
      rows.set(id, next);
      return structuredClone({ ...next, applied: true });
    },
  };
}
function device(remote, initial = emptyState(), online = () => true) {
  let state = structuredClone(initial);
  const statuses = [];
  const controller = createSyncCoordinator({ remote, words: WORDS, getState: () => state, applyState: next => { state = next; }, onStatus: (phase) => statuses.push(phase), isOnline: online });
  return { controller, statuses, get state() { return state; } };
}

test('legacy 8/10 backups migrate without changing review totals or history', () => {
  const legacy = { version: 1, progress: {23:{ reviews: 10, correct: 8, wrong: 2, lastCorrect: false, lastReviewed:'2026-10-27',starred:false,updatedAt:'2026-10-27'}}, history: [] };
  const migrated = validateState(legacy, WORDS);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.progress[23].reviews, 10);
  recordAnswer(migrated, 23, true, 'quiz', 'phone');
  assert.equal(migrated.progress[23].reviews, 11);
  assert.equal(migrated.progress[23].correct, 9);
  assert.deepEqual(mergeStates(migrated, legacy, WORDS), migrated);
});
test('two devices reviewing the same word merge all attempts exactly once', () => {
  const phone = emptyState(), desktop = emptyState();
  recordAnswer(phone, 23, true, 'quiz', 'phone');
  recordAnswer(desktop, 23, false, 'quiz', 'desktop');
  const merged = mergeStates(phone, desktop, WORDS);
  assert.equal(merged.progress[23].reviews, 2);
  assert.equal(merged.progress[23].correct, 1);
  assert.equal(merged.progress[23].wrong, 1);
  assert.equal(merged.history.length, 2);
  assert.deepEqual(mergeStates(merged, phone, WORDS), merged);
  assert.equal(fingerprint(mergeStates(desktop, phone, WORDS)), fingerprint(merged));
});
test('a later star change cannot replace a newer review result from another device', () => {
  const base = emptyState(); recordAnswer(base, 23, false, 'quiz', 'old');
  base.progress[23].lastReviewed = '2026-10-25T00:00:00Z';
  const phone = structuredClone(base), desktop = structuredClone(base);
  recordAnswer(phone, 23, true, 'quiz', 'phone');
  phone.progress[23].lastReviewed = '2026-10-26T00:00:00Z';
  toggleStar(desktop, 23);
  desktop.progress[23].starredAt = desktop.progress[23].updatedAt = '2026-10-27T00:00:00Z';
  const merged = mergeStates(phone, desktop, WORDS);
  assert.equal(merged.progress[23].lastCorrect, true);
  assert.equal(merged.progress[23].starred, true);
  assert.equal(merged.progress[23].reviews, 2);
});
test('review totals survive the 500-event display limit', () => {
  const phone = emptyState(), desktop = emptyState();
  for(let i=0;i<520;i++) recordAnswer(phone, 23, true, 'quiz', 'phone');
  recordAnswer(desktop, 23, false, 'quiz', 'desktop');
  const merged = mergeStates(phone, desktop, WORDS);
  assert.equal(merged.history.length, 500);
  assert.equal(merged.progress[23].reviews, 521);
  assert.equal(merged.progress[23].wrong, 1);
  validateState(merged, WORDS);
});
test('guest legacy data never becomes an account cache by accident', () => {
  const legacy = { version:1,progress:{},history:[] };
  const storage = { getItem: key => key === LEGACY_STORAGE_KEY ? JSON.stringify(legacy) : null };
  assert.equal(loadState(storage, WORDS).version, 2);
  assert.deepEqual(loadState(storage, WORDS, `${STORAGE_KEY}.user.other-user`), emptyState());
});
test('secret keys and insecure endpoints are not accepted as browser configuration', () => {
  assert.equal(isCloudConfigured({supabaseUrl:'https://example.supabase.co',publishableKey:'sb_publishable_example_public_key'}), true);
  assert.equal(isCloudConfigured({supabaseUrl:'http://example.supabase.co',publishableKey:'sb_publishable_example_public_key'}), false);
  assert.equal(isCloudConfigured({supabaseUrl:'https://example.supabase.co',publishableKey:'sb_secret_do_not_ship'}), false);
  assert.equal(isCloudConfigured({supabaseUrl:'https://example.supabase.co',publishableKey:`eyJ.${btoa(JSON.stringify({role:'service_role'}))}.signature`}), false);
});
test('concurrent cloud writers retry revisions without losing either device', async () => {
  const remote = memoryServer(), left = device(remote), right = device(remote);
  recordAnswer(left.state, 23, true, 'quiz', 'phone');
  recordAnswer(right.state, 23, false, 'quiz', 'desktop');
  left.controller.setUser('same-user'); right.controller.setUser('same-user');
  assert.deepEqual(await Promise.all([left.controller.sync(), right.controller.sync()]), [true, true]);
  const cloud = remote.rows.get('same-user').state;
  assert.equal(cloud.progress[23].reviews, 2);
  assert.equal(cloud.history.length, 2);
  left.controller.dispose(); right.controller.dispose();
});
test('new local edits during an upload are sent in the next round', async () => {
  const remote = memoryServer(), waiting = deferred(), entered = deferred();
  const actualSave = remote.save.bind(remote); let uploads = 0;
  remote.save = async (...args) => { if (++uploads === 1) { entered.resolve(); await waiting.promise; } return actualSave(...args); };
  const phone = device(remote); phone.controller.setUser('user');
  recordAnswer(phone.state, 23, true, 'quiz', 'phone');
  const promise = phone.controller.sync();
  await entered.promise;
  recordAnswer(phone.state, 47, false, 'quiz', 'phone');
  waiting.resolve();
  assert.equal(await promise, true);
  assert.equal(remote.rows.get('user').state.progress[47].wrong, 1);
  assert.equal(uploads, 2);
  phone.controller.dispose();
});
test('a slow previous-account request cannot apply state to the next account', async () => {
  const remote = memoryServer(), waiting = deferred(), entered = deferred();
  const original = remote.load.bind(remote);
  remote.load = async id => { if (id === 'A') { entered.resolve(); await waiting.promise; } return original(id); };
  const client = device(remote); client.controller.setUser('A');
  const promise = client.controller.sync(); await entered.promise;
  client.controller.setUser('B'); waiting.resolve();
  assert.equal(await promise, false);
  assert.equal(remote.calls.filter(call => call[0] === 'save' && call[1] === 'A').length, 0);
  assert.equal(await client.controller.sync(), true);
  client.controller.dispose();
});
test('offline and server failures preserve local work and do not report success', async () => {
  const remote = memoryServer(), offline = device(remote, emptyState(), () => false);
  recordAnswer(offline.state, 23, true, 'quiz', 'phone');
  offline.controller.setUser('user'); assert.equal(await offline.controller.sync(), false);
  assert.deepEqual(remote.calls, []); assert.ok(!offline.statuses.includes('synced'));
  assert.equal(offline.state.progress[23].correct, 1); offline.controller.dispose();
  remote.save = async () => { throw new Error('server unavailable'); };
  const failed = device(remote, offline.state); failed.controller.setUser('user');
  assert.equal(await failed.controller.sync(), false);
  assert.equal(failed.state.progress[23].correct, 1);
  assert.equal(failed.statuses.at(-1), 'error'); failed.controller.dispose();
});
test('server JSON object key ordering does not cause an endless sync loop', async () => {
  const remote = memoryServer(); const originalSave = remote.save.bind(remote);
  remote.save = async (...args) => JSON.parse(fingerprint(await originalSave(...args)));
  const phone = device(remote); recordAnswer(phone.state, 23, true, 'quiz', 'phone');
  phone.controller.setUser('user'); assert.equal(await phone.controller.sync(), true);
  assert.equal(remote.calls.filter(call => call[0] === 'save').length, 1);
  phone.controller.dispose();
});
