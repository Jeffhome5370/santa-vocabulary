import { STORAGE_KEY, emptyState, validateState } from './engine.js';

export const PERSONAL_LIBRARY = 'personal';
export const libraryStorageKey = (userId, libraryId = PERSONAL_LIBRARY) =>
  libraryId === PERSONAL_LIBRARY ? `${STORAGE_KEY}.user.${userId}` : `${STORAGE_KEY}.user.${userId}.library.${libraryId}`;

// Public content never contains reviews, stars, history, or account details.
export function libraryContent(state, base) {
  const safe = validateState(state, base);
  return { includeBaseWords: safe.includeBaseWords, customWords: safe.customWords, wordChanges: safe.wordChanges };
}
export function applyLibraryContent(state, content, base) {
  const vocabulary = validateState({ ...emptyState(false), ...content }, base);
  const ids = new Set([...(vocabulary.includeBaseWords ? base : []), ...vocabulary.customWords].map(word => word.id));
  return validateState({ ...state, includeBaseWords: vocabulary.includeBaseWords, customWords: vocabulary.customWords, wordChanges: vocabulary.wordChanges,
    progress: Object.fromEntries(Object.entries(state.progress || {}).filter(([id]) => ids.has(Number(id)))),
    history: (state.history || []).filter(entry => ids.has(entry.wordId)),
  }, base);
}
export const canEditLibrary = (library, userId) => !library || !!userId && library.owner_id === userId && !library.deleted_at && !library.source_personal;
export function validateLibraryFields(fields) {
  const name = String(fields.name || '').trim(), description = String(fields.description || '').trim();
  const creator_name = String(fields.creator_name || '').trim() || '單字同好';
  if (!name || name.length > 80 || description.length > 500 || creator_name.length > 40) throw new Error('請填寫單字庫名稱（最多 80 字），說明最多 500 字，分享暱稱最多 40 字。');
  if (!['public', 'private'].includes(fields.visibility)) throw new Error('請選擇單字庫的分享範圍。');
  return { name, description, creator_name, visibility: fields.visibility };
}
const metadata = 'id,owner_id,name,description,creator_name,visibility,revision,created_at,updated_at,deleted_at,source_personal';
export function createLibraryRepository(client) {
  async function request(builder) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const { data, error } = await builder.abortSignal(controller.signal);
      if (error) throw error;
      return data;
    } finally { clearTimeout(timer); }
  }
  return {
    async list(userId, { offset = 0, size = 50, search = '' } = {}) {
      // RLS limits this to the caller's private libraries and public libraries.
      let query = client.from('santa_libraries').select(metadata).is('deleted_at', null).order('created_at', { ascending: false }).order('id');
      if (search.trim()) query = query.ilike('name', `%${search.trim().replace(/[%,_*\\]/g, '')}%`);
      return await request(query.range(offset, offset + size - 1));
    },
    async get(id) {
      const row = await request(client.from('santa_libraries').select('*').eq('id', id).is('deleted_at', null).maybeSingle());
      if (!row) throw new Error('這個單字庫已刪除、改為私人或無法存取，請切換其他單字庫。');
      return row;
    },
    async create(userId, fields, content) {
      return await request(client.from('santa_libraries').insert({ owner_id: userId, ...validateLibraryFields(fields), content }).select('*').single());
    },
    async getPersonalSharing(userId) {
      return await request(client.from('santa_libraries').select(metadata).eq('owner_id', userId).eq('source_personal',true).maybeSingle());
    },
    async sharePersonal(userId, fields, revision) {
      const safe=validateLibraryFields(fields);
      return await request(client.rpc('share_santa_personal_pocket',{p_expected_user_id:userId,p_base_revision:revision,p_name:safe.name,p_description:safe.description,p_creator_name:safe.creator_name,p_visibility:safe.visibility}));
    },
    async update(library, fields) {
      const row = await request(client.from('santa_libraries').update(fields).eq('id', library.id).eq('revision', library.revision).select('*').maybeSingle());
      if (!row) throw new Error('單字庫剛在其他裝置更新，或你已無編輯權限。請重新載入單字庫後再試。');
      return row;
    },
    async listDeleted(userId, { offset = 0, size = 50 } = {}) {
      return await request(client.from('santa_libraries').select(metadata).eq('owner_id', userId).not('deleted_at', 'is', null).order('deleted_at', { ascending:false }).order('id').range(offset, offset+size-1));
    },
    async remove(library) {
      return await request(client.rpc('set_santa_library_deleted', { p_library_id:library.id, p_base_revision:library.revision, p_deleted:true }));
    },
    async restore(library) {
      return await request(client.rpc('set_santa_library_deleted', { p_library_id:library.id, p_base_revision:library.revision, p_deleted:false }));
    },
    async loadProgress(userId, libraryId) {
      return await request(client.from('santa_library_progress').select('state,revision').eq('user_id', userId).eq('library_id', libraryId).maybeSingle());
    },
    async saveProgress(userId, libraryId, revision, state) {
      return await request(client.rpc('sync_santa_library_progress', { p_expected_user_id: userId, p_library_id: libraryId, p_base_revision: revision, p_state: state }));
    },
  };
}

export function createLibraryRemote(repository, libraryId, base, onLibrary = () => {}) {
  let library;
  const withContent = state => applyLibraryContent(state, library.content, base);
  return {
    async load(userId) {
      library = await repository.get(libraryId);
      onLibrary(library);
      const saved = await repository.loadProgress(userId, libraryId);
      return { state: withContent(saved?.state || emptyState(false)), revision: saved?.revision || 0 };
    },
    async save(userId, revision, state) {
      // The server also substitutes authoritative content, including if an owner
      // edits the library between this load and save.
      const result = await repository.saveProgress(userId, libraryId, revision, withContent(state));
      library = await repository.get(libraryId);
      onLibrary(library);
      return { ...result, state: withContent(result.state) };
    },
  };
}
