export const POS_CHOICES = [
  ['n.', '名詞'], ['v.', '動詞'], ['adj.', '形容詞'], ['adv.', '副詞'],
  ['prep.', '介系詞'], ['conj.', '連接詞'], ['pron.', '代名詞'],
  ['interj.', '感嘆詞'], ['phr.v.', '片語動詞'], ['phr.', '片語'],
];

export const normalizeWord = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

export function localSuggestions(word, words) {
  const match = normalizeWord(word), seen = new Set();
  return words.filter(item => match && normalizeWord(item.word) === match).flatMap(item => {
    const key = `${item.meaning}\0${item.pos || ''}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ meaning: item.meaning, pos: item.pos || '' }];
  }).slice(0, 6);
}

export function validateAssistantResult(action, data) {
  const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
  if (action === 'lookup' && Array.isArray(data?.suggestions) && data.suggestions.length <= 6) {
    if (data.suggestions.every(item => text(item?.meaning, 500) && typeof item.pos === 'string' && item.pos.length <= 40)) {
      return { suggestions: data.suggestions.map(item => ({ meaning: item.meaning.trim(), pos: item.pos.trim() })) };
    }
  }
  if (action === 'example' && text(data?.example, 1000) && text(data?.translation, 1000)) {
    return { example: data.example.trim(), translation: data.translation.trim() };
  }
  throw new Error('AI 回傳內容不完整，請重試或自行輸入。');
}

const ERROR_MESSAGES = {
  auth_required: '請先登入帳號，再使用 AI 建議。手動輸入仍可使用。',
  not_configured: 'AI 服務尚未啟用，請通知管理者完成設定；目前可自行輸入。',
  rate_limited: '已達 AI 使用限制。每帳號每分鐘最多 6 次、每天最多 60 次，請稍後再試。',
  provider_limited: 'AI 服務目前額度不足或忙碌，請稍後再試；已填內容會保留。',
  provider_error: 'AI 服務暫時無法使用，請稍後再試或自行輸入。',
  provider_timeout: 'AI 回覆逾時，請稍後重試；你已填寫的內容會保留。',
  invalid_input: '請確認英文單字、中文意思與詞性的長度及內容。',
};

export async function requestWordAssistant(client, action, fields) {
  if (!client) throw new Error(ERROR_MESSAGES.auth_required);
  let timer;
  let result;
  try {
    result = await Promise.race([
      client.functions.invoke('vocabulary-assist', { body: { action, ...fields } }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(ERROR_MESSAGES.provider_timeout)), 75000); }),
    ]);
  } finally { clearTimeout(timer); }
  const { data, error } = result;
  if (error) {
    let code;
    try { code = (await error.context?.json())?.code; } catch { /* Never display raw upstream errors. */ }
    throw new Error(ERROR_MESSAGES[code] || '無法取得 AI 建議，請檢查網路後再試；已填內容會保留。');
  }
  return validateAssistantResult(action, data);
}

export function mountWordAssistant({ getClient, getUser, getWords }) {
  const $ = selector => document.querySelector(selector);
  const field = name => $(`#new-${name}`);
  let epoch = 0, lookupRequest = 0, exampleRequest = 0, preview = null;
  let lookupBusy = false, exampleBusy = false;
  const status = (message = '', error = false) => {
    $('#word-assist-status').textContent = message;
    $('#word-assist-status').classList.toggle('error', error);
  };
  const hidePreview = () => { preview = null; $('#ai-example-preview').hidden = true; };
  const invalidate = () => { epoch++; hidePreview(); };
  const values = () => ({ word: field('word').value.trim(), meaning: field('meaning').value.trim(), pos: field('pos').value.trim() });
  const updatePos = () => {
    $('#pos-choices').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pos === field('pos').value.trim())));
  };
  const showChoices = (suggestions, source) => {
    $('#meaning-choices').replaceChildren();
    for (const suggestion of suggestions) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'suggestion-choice';
      button.textContent = `${suggestion.meaning}${suggestion.pos ? ` · ${suggestion.pos}` : ''}`;
      button.addEventListener('click', () => {
        invalidate(); field('meaning').value = suggestion.meaning; field('pos').value = suggestion.pos;
        updatePos(); status('已套用意思與詞性，你仍可自行修改。');
      });
      $('#meaning-choices').append(button);
    }
    $('#meaning-source').textContent = source;
  };
  const refreshLocal = () => {
    const suggestions = localSuggestions(field('word').value, getWords());
    showChoices(suggestions, suggestions.length ? '目前字庫的建議，點選即可帶入；也能自行輸入或查詢更多意思。' : '輸入英文後可查詢 AI 建議，也能直接填寫中文。');
  };
  for (const [pos, label] of POS_CHOICES) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'suggestion-choice'; button.dataset.pos = pos;
    button.textContent = `${pos} ${label}`; button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => { invalidate(); field('pos').value = pos; updatePos(); });
    $('#pos-choices').append(button);
  }
  field('word').addEventListener('input', () => { invalidate(); refreshLocal(); status(); });
  for (const name of ['meaning', 'pos', 'example', 'translation']) field(name).addEventListener('input', () => { invalidate(); updatePos(); status(); });
  const refreshAccount = () => {
    $('#word-assist-privacy').textContent = getUser()
      ? 'AI 查詢只傳送英文；生成例句時傳送英文、中文意思與詞性給 AI 服務，不傳送帳號或整份字庫。每帳號每分鐘 6 次、每天 60 次。建議請確認後再使用。'
      : '登入後可使用 AI。你仍可選擇目前字庫的建議、詞性，或自行輸入所有欄位。';
  };
  const canRequest = action => {
    if (!getUser()) { status(ERROR_MESSAGES.auth_required, true); return false; }
    const current = values();
    if (!current.word) { status('請先輸入英文單字或片語。', true); field('word').focus(); return false; }
    if (action === 'example' && !current.meaning) { status('請先選擇或輸入中文意思，讓例句符合你要學的用法。', true); field('meaning').focus(); return false; }
    return true;
  };
  $('#lookup-meanings').addEventListener('click', async () => {
    if (lookupBusy || !canRequest('lookup')) return;
    const request = ++lookupRequest, currentEpoch = epoch, userId = getUser().id;
    lookupBusy = true; $('#lookup-meanings').disabled = true; status('正在查詢中文意思與詞性…最多可能需要約一分鐘。');
    try {
      const data = await requestWordAssistant(getClient(), 'lookup', { word: values().word });
      if (request !== lookupRequest || currentEpoch !== epoch || userId !== getUser()?.id) return;
      showChoices(data.suggestions, data.suggestions.length ? 'AI 建議 · 點選意思會帶入對應詞性，所有欄位都可修改。' : '沒有找到適合的建議，請確認拼字或自行輸入。');
      status(data.suggestions.length ? '請選擇符合你要學的意思。' : '沒有找到建議，仍可自行填寫。');
    } catch (error) { if (request === lookupRequest && currentEpoch === epoch) status(error.message, true); }
    finally { if (request === lookupRequest) { lookupBusy = false; $('#lookup-meanings').disabled = false; } }
  });
  $('#generate-example').addEventListener('click', async () => {
    if (exampleBusy || !canRequest('example')) return;
    const request = ++exampleRequest, currentEpoch = epoch, userId = getUser().id;
    hidePreview(); exampleBusy = true; $('#generate-example').disabled = true; status('正在生成英文例句與繁體中文翻譯…最多可能需要約一分鐘。');
    try {
      const data = await requestWordAssistant(getClient(), 'example', values());
      if (request !== exampleRequest || currentEpoch !== epoch || userId !== getUser()?.id) return;
      preview = data; $('#ai-example-en').textContent = data.example; $('#ai-example-zh').textContent = data.translation;
      $('#ai-example-preview').hidden = false; status('例句已生成，確認後再按「套用這組例句」。');
    } catch (error) { if (request === exampleRequest && currentEpoch === epoch) status(error.message, true); }
    finally { if (request === exampleRequest) { exampleBusy = false; $('#generate-example').disabled = false; } }
  });
  $('#apply-ai-example').addEventListener('click', () => {
    if (!preview) return;
    field('example').value = preview.example; field('translation').value = preview.translation;
    invalidate(); status('例句與翻譯已套用，仍可直接修改；按「加入單字庫」才會儲存。');
  });
  $('#dismiss-ai-example').addEventListener('click', () => { hidePreview(); status('已保留原本的例句與翻譯。'); });
  return {
    refreshAccount,
    refreshFields() { invalidate(); refreshLocal(); updatePos(); refreshAccount(); },
    reset() {
      invalidate(); lookupRequest++; exampleRequest++; lookupBusy = false; exampleBusy = false;
      $('#lookup-meanings').disabled = false; $('#generate-example').disabled = false;
      showChoices([], '輸入英文後可查詢建議，也能直接填寫中文。'); status();
      $('#pos-choices').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', 'false'));
    },
  };
}
