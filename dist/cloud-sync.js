import { emptyState, mergeStates, validateState } from './engine.js';

export function fingerprint(value) {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${fingerprint(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function isCloudConfigured(config) {
  try {
    const url = new URL(config.supabaseUrl);
    const key = config.publishableKey;
    if (typeof key !== 'string' || key.length < 25) return false;
    const anonJwt = key.startsWith('eyJ') && (() => { try { return JSON.parse(atob(key.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))).role === 'anon'; } catch { return false; } })();
    return url.protocol === 'https:' && !url.username && !url.password && (key.startsWith('sb_publishable_') || anonJwt);
  } catch { return false; }
}

export function createRemote(client) {
  async function request(builder) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try { return await builder.abortSignal(controller.signal); }
    finally { clearTimeout(timer); }
  }
  return {
    async load(userId) {
      const { data, error } = await request(client.from('santa_progress').select('state,revision').eq('user_id', userId).maybeSingle());
      if (error) throw error;
      return data || { state: emptyState(false), revision: 0 };
    },
    async save(userId, revision, state) {
      const { data, error } = await request(client.rpc('sync_santa_progress', { p_expected_user_id: userId, p_base_revision: revision, p_state: state }));
      if (error) throw error;
      return data;
    },
  };
}

// Optimistic revisions protect concurrent writers. Epoch checks prevent a slow
// request from a previous account changing the active account's local state.
export function createSyncCoordinator({ remote, words, getState, applyState, onStatus = () => {}, isOnline = () => true }) {
  let userId = null, epoch = 0, running = null, rerun = false, timer;
  const isCurrent = (id, generation) => id === userId && generation === epoch;
  async function perform(id, generation) {
    if (!isOnline()) { if (isCurrent(id, generation)) onStatus('offline'); return false; }
    if (isCurrent(id, generation)) onStatus('syncing');
    try {
      let remoteData = await remote.load(id);
      if (!isCurrent(id, generation)) return false;
      for (let attempt = 0; attempt < 6; attempt++) {
        const remoteState = validateState(remoteData.state, words);
        const candidate = mergeStates({ ...getState(), includeBaseWords: remoteState.includeBaseWords }, remoteState, words);
        if (!isCurrent(id, generation)) return false;
        if (fingerprint(candidate) === fingerprint(remoteState)) {
          applyState(candidate);
          onStatus('synced', new Date().toISOString());
          return true;
        }
        const result = await remote.save(id, remoteData.revision, candidate);
        if (!isCurrent(id, generation)) return false;
        if (result.applied) {
          const acknowledged = validateState(result.state, words);
          const merged = mergeStates({ ...getState(), includeBaseWords: acknowledged.includeBaseWords }, acknowledged, words);
          applyState(merged);
          // Local edits during this request may require one more server round.
          if (fingerprint(merged) !== fingerprint(acknowledged)) rerun = true;
          onStatus('synced', result.updated_at || new Date().toISOString());
          return true;
        }
        remoteData = { state: result.state, revision: result.revision };
      }
      throw new Error('多個裝置正在更新，請稍後再同步。');
    } catch (error) {
      if (isCurrent(id, generation)) onStatus(isOnline() ? 'error' : 'offline', error);
      return false;
    }
  }
  async function sync() {
    clearTimeout(timer);
    if (!userId) return false;
    if (running) { rerun = true; return running; }
    const id = userId, generation = epoch;
    running = (async () => {
      let success;
      do { rerun = false; success = await perform(id, generation); } while (rerun && success && isCurrent(id, generation));
      return success;
    })();
    try { return await running; }
    finally { running = null; if (userId && !isCurrent(id, generation)) schedule(0); }
  }
  function schedule(delay = 700) {
    clearTimeout(timer);
    if (userId) timer = setTimeout(() => { void sync(); }, delay);
  }
  return {
    setUser(id) { if (userId === id) return; clearTimeout(timer); userId = id; epoch++; rerun = false; },
    sync, schedule,
    dispose() { clearTimeout(timer); userId = null; epoch++; },
  };
}
