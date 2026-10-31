import { PERSONAL_LIBRARY, canEditLibrary, libraryContent, validateLibraryFields } from './libraries.js';

const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export function mountLibraryPicker({ getUser, getRepository, getLibrary, getState, base, selectLibrary, removeLibrary, contentChanged, toast, openPocket }) {
  const $ = selector => document.querySelector(selector);
  let rows = [], offset = 0, hasMore = false, loading = false, generation = 0, accountId = null, editing = false, dialogKey, submitting = false;
  let pendingDelete = null, trashRows = [], trashOffset = 0, trashMore = false, trashLoading = false, trashGeneration = 0;
  function render() {
    const user = getUser(), active = getLibrary();
    const own = rows.filter(row => row.owner_id === user?.id), others = rows.filter(row => row.owner_id !== user?.id);
    const options = list => list.map(row => `<option value="${esc(row.id)}">${esc(row.name)}${row.owner_id === user?.id ? '' : ' · '+esc(row.creator_name)}</option>`).join('');
    const extra = active && !rows.some(row => row.id === active.id) ? options([active]) : '';
    $('#library-picker').innerHTML = `<option value="${PERSONAL_LIBRARY}">我的私人單字口袋</option>${extra}<optgroup label="我的單字庫">${options(own)}</optgroup><optgroup label="大家的公開單字庫">${options(others)}</optgroup>`;
    $('#library-picker').value = active?.id || PERSONAL_LIBRARY;
    $('#library-picker').disabled = !user || loading;
    $('#create-library').disabled = !user || loading;
    $('#manage-library').hidden = !active || !canEditLibrary(active, user?.id);
    $('#refresh-libraries').disabled = !user || loading;
    $('#library-discovery').hidden = !user;
    $('#library-trash').hidden = !user;
    $('#library-load-more').hidden = !hasMore;
    $('#library-load-more').disabled = loading;
    $('#library-current-name').textContent = active?.name || '我的私人單字口袋';
    $('#library-current-description').textContent = active ? `${active.description || '把想學會的單字，慢慢收進來。'} · ${active.visibility === 'public' ? '公開分享' : '僅自己可見'} · ${canEditLibrary(active,user?.id) ? '由你建立' : '分享者：'+active.creator_name}` : '原有單字與學習紀錄都保留在這裡，只有你能看見。';
    $('#library-access-note').textContent = !user ? '登入後即可建立多個單字庫，或練習其他人公開分享的單字庫。訪客口袋維持獨立。' : active && !canEditLibrary(active,user.id) ? '你正在練習他人分享的單字庫，內容由建立者管理；收藏與學習紀錄只屬於你。' : active?.visibility === 'public' ? '這份單字庫已公開；新增、編輯與刪除的內容也會更新給其他使用者。學習進度仍各自保存。' : '目前內容僅自己可見。建立新單字庫時，可選擇是否公開分享。';
    $('#active-library-name').textContent = active?.name || '我的私人單字口袋';
    $('#library-catalog').innerHTML = rows.length ? rows.map(row => `<article class="library-tile"><span class="library-tile-tag">${row.owner_id === user?.id ? '我的單字庫' : '公開分享'}${row.visibility === 'private' ? ' · 私人' : ''}</span><h3>${esc(row.name)}</h3><p>${esc(row.description || '一起多認識一些單字。')}</p><div><small>${row.owner_id === user?.id ? '由你建立' : esc(row.creator_name)}</small><button type="button" class="text-button" data-select-library="${esc(row.id)}">${row.id === active?.id ? '目前檢視中' : '開啟單字庫 ↗'}</button></div></article>`).join('') : `<p class="muted">${loading ? '正在載入單字庫…' : '目前沒有符合的單字庫。可以建立第一份，再邀請大家一起練習。'}</p>`;
  }
  function renderTrash() {
    $('#library-trash-list').innerHTML = trashRows.map(row => `<article class="library-trash-row"><div><strong>${esc(row.name)}</strong><small>刪除於 ${esc(new Date(row.deleted_at).toLocaleDateString('zh-TW'))}</small></div><button type="button" class="button outline" data-restore-library="${esc(row.id)}" ${trashLoading ? 'disabled' : ''}>復原單字庫</button></article>`).join('');
    $('#library-trash-more').hidden = !trashMore;
    $('#library-trash-more').disabled = trashLoading;
  }
  async function refreshTrash({ more = false } = {}) {
    const user = getUser(); if (!user || !getRepository()) return;
    const token = ++trashGeneration, id = user.id;
    trashLoading = true;
    if (!more) { trashRows=[]; trashOffset=0; }
    renderTrash(); $('#library-trash-status').textContent='正在載入已刪除單字庫…';
    try {
      const page = await getRepository().listDeleted(id,{offset:trashOffset});
      if (token !== trashGeneration || getUser()?.id !== id) return;
      trashRows=[...trashRows,...page].filter((row,i,all)=>all.findIndex(item=>item.id===row.id)===i);
      trashOffset+=page.length; trashMore=page.length===50;
      $('#library-trash-status').textContent=trashRows.length ? '復原後會恢復原本分享範圍，單字與學習進度也會保留。' : '目前沒有已刪除的單字庫。';
    } catch { if (token===trashGeneration) $('#library-trash-status').textContent='無法載入，請稍後重新開啟此區重試。'; }
    finally { if(token===trashGeneration) {trashLoading=false;renderTrash();} }
  }
  async function refresh({ more = false } = {}) {
    const user = getUser();
    if (!user || !getRepository()) { render(); return; }
    const token = ++generation, id = user.id;
    loading = true;
    if (!more) { rows = []; offset = 0; }
    render(); $('#library-catalog-status').textContent = '正在載入單字庫…';
    try {
      const page = await getRepository().list(id, { offset, search: $('#library-catalog-search').value });
      if (token !== generation || getUser()?.id !== id) return;
      rows = [...rows, ...page].filter((row, i, all) => all.findIndex(item => item.id === row.id) === i);
      offset += page.length; hasMore = page.length === 50;
      $('#library-catalog-status').textContent = `${rows.length} 份可檢視的單字庫${hasMore ? '，可繼續載入' : ''}`;
    } catch {
      if (token === generation && getUser()?.id === id) $('#library-catalog-status').textContent = '單字庫載入失敗，請檢查連線後按「重新載入」。';
    } finally { if (token === generation) { loading = false; render(); } }
  }
  async function choose(id) {
    if (loading || !getUser()) return;
    loading = true; render();
    try { await selectLibrary(id); }
    catch (error) { toast(error.message || '無法切換單字庫，請稍後再試。'); }
    finally { loading = false; render(); }
  }
  function openDialog(manage) {
    const user = getUser(), library = getLibrary();
    if (!user || manage && !canEditLibrary(library,user.id)) return;
    editing = manage; dialogKey = `${user.id}:${library?.id || PERSONAL_LIBRARY}`;
    $('#library-form').reset(); $('#library-form-message').textContent = '';
    $('#library-dialog-title').textContent = manage ? '管理這份單字庫' : '建立一個新的單字庫';
    $('#library-name').value = manage ? library.name : '';
    $('#library-description').value = manage ? library.description : '';
    $('#library-creator').value = manage ? library.creator_name : '';
    $('#library-visibility').value = manage ? library.visibility : 'private';
    $('#library-copy-field').hidden = manage;
    pendingDelete=null;
    $('#delete-library').hidden=!manage;
    $('#library-delete-confirmation').hidden=true;
    $('#save-library').disabled=false;
    $('#save-library').textContent = manage ? '儲存設定' : '建立單字庫';
    $('#library-dialog').showModal(); $('#library-name').focus();
  }
  $('#library-picker').addEventListener('change', event => { void choose(event.target.value); });
  $('#library-catalog').addEventListener('click', event => { const button=event.target.closest('[data-select-library]'); if(button) void choose(button.dataset.selectLibrary); });
  $('#refresh-libraries').addEventListener('click', () => { void refresh(); });
  $('#library-load-more').addEventListener('click', () => { void refresh({ more: true }); });
  $('#library-search-form').addEventListener('submit', event => { event.preventDefault(); void refresh(); });
  $('#create-library').addEventListener('click', () => openDialog(false));
  $('#manage-library').addEventListener('click', () => openDialog(true));
  $('#cancel-library').addEventListener('click', () => $('#library-dialog').close());
  $('#delete-library').addEventListener('click', () => {
    const user=getUser(), active=getLibrary();
    if (submitting || !editing || !active || !canEditLibrary(active,user?.id) || `${user.id}:${active.id}`!==dialogKey) return;
    pendingDelete={...active};
    $('#library-delete-description').textContent=`確定要刪除「${active.name}」嗎？刪除後其他人也無法再開啟這份單字庫。單字與所有人的學習進度會保留，可在「已刪除單字庫」復原。`;
    $('#library-delete-confirmation').hidden=false; $('#delete-library').hidden=true; $('#save-library').disabled=true;
    $('#cancel-delete-library').focus();
  });
  $('#cancel-delete-library').addEventListener('click', () => {
    if(submitting) return;
    pendingDelete=null; $('#library-delete-confirmation').hidden=true; $('#delete-library').hidden=false; $('#save-library').disabled=false;
    $('#delete-library').focus();
  });
  $('#confirm-delete-library').addEventListener('click', async () => {
    if(submitting || !pendingDelete) return;
    const user=getUser(), active=getLibrary(), key=`${user?.id}:${active?.id || PERSONAL_LIBRARY}`;
    if(!user || key!==dialogKey || active?.id!==pendingDelete.id || !canEditLibrary(active,user.id)) {$('#library-dialog').close();return;}
    submitting=true; $('#confirm-delete-library').disabled=true; $('#cancel-delete-library').disabled=true; $('#library-form-message').textContent='正在同步並刪除單字庫…';
    try {
      await removeLibrary(pendingDelete);
      if(getUser()?.id!==user.id) return;
      pendingDelete=null; $('#library-dialog').close(); $('#library-delete-confirmation').hidden=true;
      toast('單字庫已刪除，可在「已刪除單字庫」復原。');
      void refresh(); if($('#library-trash').open) void refreshTrash();
    } catch { if(getUser()?.id===user.id) $('#library-form-message').textContent='刪除尚未完成。請確認連線與同步狀態；如果單字庫剛被更新，請關閉視窗、重新載入後再試。'; }
    finally { submitting=false; $('#confirm-delete-library').disabled=false; $('#cancel-delete-library').disabled=false; $('#save-library').disabled=!!pendingDelete; render(); }
  });
  $('#library-trash').addEventListener('toggle', () => {if($('#library-trash').open) void refreshTrash();});
  $('#library-trash-more').addEventListener('click', () => {if(!trashLoading) void refreshTrash({more:true});});
  $('#library-trash-list').addEventListener('click', async event => {
    const button=event.target.closest('[data-restore-library]');
    if(!button || trashLoading) return;
    const library=trashRows.find(row=>row.id===button.dataset.restoreLibrary), user=getUser();
    if(!library || library.owner_id!==user?.id) return;
    const token=++trashGeneration;
    trashLoading=true; renderTrash();
    try {
      await getRepository().restore(library);
      if(getUser()?.id!==user.id || token!==trashGeneration) return;
      toast('單字庫已復原，原有單字與學習進度已保留。');
      void refresh(); await refreshTrash();
    } catch { if(getUser()?.id===user.id && token===trashGeneration) $('#library-trash-status').textContent='復原尚未完成，請確認連線後重新開啟此區再試。'; }
    finally {if(token===trashGeneration) {trashLoading=false;renderTrash();}}
  });
  $('#active-library-pocket').addEventListener('click', openPocket);
  $('#library-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting || pendingDelete) return;
    const user = getUser(), active = getLibrary(), key = `${user?.id}:${active?.id || PERSONAL_LIBRARY}`;
    if (!user || key !== dialogKey) { $('#library-dialog').close(); return; }
    submitting = true; $('#save-library').disabled = true;
    try {
      const fields = validateLibraryFields(Object.fromEntries(new FormData(event.currentTarget)));
      const repository = getRepository();
      const content = $('#library-copy').checked ? libraryContent(getState(),base) : { includeBaseWords:false, customWords:[], wordChanges:[] };
      const result = editing ? await repository.update(active, fields) : await repository.create(user.id, fields, content);
      if (`${getUser()?.id}:${getLibrary()?.id || PERSONAL_LIBRARY}` !== key) return;
      if (editing) contentChanged(result);
      else await selectLibrary(result.id);
      $('#library-dialog').close();
      toast(editing ? '單字庫設定已儲存。' : '新單字庫已建立，可以開始加入單字。');
      void refresh();
    } catch(error) { if (`${getUser()?.id}:${getLibrary()?.id || PERSONAL_LIBRARY}` === key) $('#library-form-message').textContent = error.message || '儲存失敗，請稍後再試。'; }
    finally { submitting=false; $('#save-library').disabled=false; render(); }
  });
  return {
    render, refresh,
    accountChanged() {
      const id = getUser()?.id || null;
      if (id === accountId) { render(); return; }
      accountId=id; generation++; rows=[]; offset=0; hasMore=false; loading=false;
      trashGeneration++; trashRows=[]; trashOffset=0; trashMore=false; trashLoading=false; pendingDelete=null;
      $('#library-trash').open=false; $('#library-trash-status').textContent=''; renderTrash();
      $('#library-dialog').close(); $('#library-catalog-search').value=''; $('#library-catalog-status').textContent='';
      render(); if (id) void refresh();
    },
  };
}
