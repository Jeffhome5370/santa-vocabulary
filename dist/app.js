import { dailyKnownCount, loadGuestState, showEntry, sessionView } from './design.js';
import { createSpeechPlayer, mountSpeechSettings } from './speech.js';
import { WORDS as BASE_WORDS } from './data.js';
import { STORAGE_KEY, emptyState, allWords, visibleHistory, guestForAccount, addCustomWord, updateWord, deleteWord, restoreWord, isWordDeleted, shuffle, getProgress, recordAnswer, toggleStar, matchesFilter, getStats, selectQuizWords, createQuestion, quizPool, validateState, mergeStates, loadState, resetAllCards } from './engine.js';
import { createAccountClient, friendlyAuthError } from './account.js';
import { createRemote, createSyncCoordinator, fingerprint } from './cloud-sync.js';
import { mountWordAssistant } from './word-assistant.js';
import { PERSONAL_LIBRARY, libraryStorageKey, libraryContent, applyLibraryContent, canEditLibrary, createLibraryRepository, createLibraryRemote } from './libraries.js';
import { mountLibraryPicker } from './library-ui.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
let state = emptyState(false), allowSave = true, storageWarning = false;
let WORDS = BASE_WORDS;
let filter = 'all', order = WORDS.map(word => word.id), cards = [], position = 0, flipped = false, currentView = 'cards';
let quiz = null, toastTimer;
let authClient = null, cloudSync = null, activeUser = null, authMode = 'signin', authBusy = false, authSubscription = null;
let reviewActor = crypto.randomUUID();
let syncPhase = 'guest', syncDetail;
let authReady = false, libraryReady = false;
let guestChosen = false;
let entranceRequested = location.hash === '#login';
let editingWordId = null, editingWordSnapshot = null, pendingDeleteId = null, pendingDeleteSnapshot = null;
let selectedLibrary = null, libraryRepository = null, librarySwitchGeneration = 0, librarySwitchBusy = false, libraryWriteBusy = false;
const activeStorageKey = () => activeUser ? libraryStorageKey(activeUser.id, selectedLibrary?.id) : STORAGE_KEY;
const loadCurrentState = () => activeUser ? loadState(localStorage, BASE_WORDS, activeStorageKey()) : loadGuestState(localStorage, BASE_WORDS);
const libraryEditable = () => canEditLibrary(selectedLibrary, activeUser?.id) && !librarySwitchBusy && !libraryWriteBusy;
const wordAssistant = mountWordAssistant({
  getClient: () => authClient, getUser: () => activeUser,
  getWords: () => allWords(BASE_WORDS, state),
});
const libraryPicker = mountLibraryPicker({
  getUser: () => activeUser, getRepository: () => libraryRepository, getLibrary: () => selectedLibrary,
  getState: () => state, base: BASE_WORDS, selectLibrary: switchLibrary,
  removeLibrary: async library => {
    const context = activeStorageKey();
    if (!selectedLibrary || selectedLibrary.id !== library.id || !libraryEditable()) throw new Error('請重新開啟要刪除的單字庫。');
    if (!await cloudSync?.sync()) throw new Error('請先確認雲端同步完成，再刪除單字庫，以保留最新學習進度。');
    if (context !== activeStorageKey()) throw new Error('帳號或單字庫已切換，請重新開啟管理。');
    await libraryRepository.remove(library);
    if (context !== activeStorageKey()) return;
    cloudSync?.dispose(); cloudSync=null;
    await switchLibrary(PERSONAL_LIBRARY);
  },
  contentChanged: library => { selectedLibrary = library; state = applyLibraryContent(state, library.content, BASE_WORDS); save({ upload:false }); repaintProgress(); libraryPicker.render(); },
  toast, openPocket: () => { setView('library'); $('#library-picker').focus(); },
});

function toast(message, duration = 4500) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, duration);
}
function save({ upload = true } = {}) {
  if (!allowSave) return;
  try { localStorage.setItem(activeStorageKey(), JSON.stringify(state)); }
  catch {
    if (!storageWarning) toast('瀏覽器無法儲存進度。請到學習紀錄匯出備份。', 8000);
    storageWarning = true;
  }
  if (upload) cloudSync?.schedule();
}
try { state = loadGuestState(localStorage, BASE_WORDS); }
catch {
  allowSave = false;
  setTimeout(() => toast('原有進度無法讀取，目前以暫存模式練習。請匯出備份或匯入有效檔案；重設後可恢復儲存。', 12000), 0);
}
function renderStats() {
  const ready = authReady && !librarySwitchBusy && (!activeUser || libraryReady);
  WORDS = ready ? allWords(BASE_WORDS, state) : [];
  const ids = new Set(WORDS.map(word => word.id));
  order = [...order.filter(id => ids.has(id)), ...WORDS.filter(word => !order.includes(word.id)).map(word => word.id)];
  const stats = getStats(WORDS, state);
  $('#stats').innerHTML = `<button type="button" class="stat stat-link" data-open-pocket aria-label="口袋裡的單字 ${stats.total} 個，開啟單字口袋"><img src="./assets/dinotaeng/pocket.webp" class="ui-emoji" alt="" aria-hidden="true"><span><span class="stat-label">口袋裡的單字</span><strong>${stats.total}</strong><small>個</small></span></button><div class="stat"><img src="./assets/dinotaeng/sparkle.webp" class="ui-emoji" alt="" aria-hidden="true"><div><span class="stat-label">已經變熟悉</span><strong>${stats.known}</strong><small>個</small></div></div>`;
  const goal = dailyKnownCount(WORDS, state);
  $('#goal-count').textContent = `${Math.min(goal, 10)} / 10`;
  $('#goal-description').textContent = goal >= 10 ? '十顆棉花糖烤好了！記得休息一下。' : '烤熟 10 個不同的單字，慢慢累積。';
  $('#marshmallows').innerHTML = Array.from({ length: 10 }, (_, i) => `<img class="marshmallow ${i < goal ? 'filled' : ''}" src="./assets/dinotaeng/marshmallow.webp" alt="" aria-hidden="true">`).join('');
  $('#marshmallows').setAttribute('aria-label', `今天記住 ${goal} 個不同的單字`);
  $('#extended-stats').textContent = `已複習 ${stats.reviewed}／${stats.total} 個 · 待加強 ${stats.weak} 個 · 測驗正確率 ${stats.accuracy === null ? '尚無測驗紀錄' : stats.accuracy + '%'}`;
  $('#all-count').textContent = WORDS.length;
  $('#weak-count').textContent = stats.weak;
  $('#deck-count').textContent = `${WORDS.length} 個單字`;
  $('#open-add-word').disabled = !ready || !libraryEditable();
  $('#reset-all-cards').disabled = !ready;
  $('#confirm-reset-cards').disabled = !ready || !WORDS.length;
  renderQuizAvailability();
}
function statusBadge(word) {
  const p = getProgress(state, word.id);
  return p.reviews === 0 ? { text: '尚未複習', className: '' } : p.lastCorrect ? { text: '已熟悉', className: 'known' } : { text: '待加強', className: 'weak' };
}
function refreshCards(preferredId) {
  const map = new Map(WORDS.map(word => [word.id, word]));
  cards = order.map(id => map.get(id)).filter(word => word && matchesFilter(word, state, filter));
  if (preferredId && cards.some(word => word.id === preferredId)) position = cards.findIndex(word => word.id === preferredId);
  position = Math.min(position, Math.max(cards.length - 1, 0));
  renderCard();
}
function renderCard() {
  const empty = cards.length === 0;
  $('#empty-cards').hidden = !empty;
  $('#card-stage').hidden = empty;
  $('#card-actions').hidden = empty;
  if (empty) {
    if (!WORDS.length) {
      $('#empty-cards').innerHTML = !authReady || librarySwitchBusy || (activeUser && !libraryReady) ? '<strong>正在載入你的單字庫…</strong>' : selectedLibrary && !libraryEditable() ? '<strong>這份單字庫還沒有單字</strong>內容由建立者更新，也可以切換其他單字庫。<button class="button primary" id="empty-open-libraries">檢視其他單字庫 →</button>' : '<strong>你的單字庫還是空的</strong>到「單字庫」按「＋ 新增單字」，開始建立自己的字卡。<button class="button primary" id="empty-add-word">新增第一個單字 →</button>';
      return;
    }
    const messages = { weak: ['目前沒有待加強的單字', '標記「還不熟」或在測驗中答錯後，就會出現在這裡。'], new: ['全部都複習過了！', '可以切換「待加強」或做一回選擇題。'], starred: ['收藏還是空的', '點字卡右上角的星號，把想多看幾次的單字留下來。'], all: ['沒有單字', '到單字庫新增第一個單字。'] };
    const [title, body] = messages[filter];
    $('#empty-cards').innerHTML = `<strong>${title}</strong>${body}`;
    return;
  }
  const word = cards[position], p = getProgress(state, word.id), badge = statusBadge(word);
  const enFront = $('#direction').value === 'en';
  flipped = false;
  $('#flashcard').classList.remove('flipped');
  $('#flashcard').setAttribute('aria-pressed', 'false');
  $('#flashcard').setAttribute('aria-label', '翻開字卡');
  $('.front').setAttribute('aria-hidden', 'false');
  $('.back').setAttribute('aria-hidden', 'true');
  $('#front-word').textContent = enFront ? word.word : word.meaning;
  $('#front-word').lang = enFront ? 'en' : 'zh-Hant';
  $('#front-pos').textContent = word.pos;
  for (const [id, english] of [['front-word', enFront], ['back-word', !enFront]]) {
    const element = $('#' + id);
    if (english) { element.dataset.say = 'word'; element.setAttribute('role', 'button'); element.setAttribute('tabindex', '0'); element.setAttribute('aria-label', '朗讀英文單字 ' + word.word); }
    else { delete element.dataset.say; element.removeAttribute('role'); element.removeAttribute('tabindex'); element.removeAttribute('aria-label'); }
  }

  $('#back-word').textContent = enFront ? word.meaning : word.word;
  $('#back-word').lang = enFront ? 'zh-Hant' : 'en';
  $('#back-secondary').textContent = enFront ? `${word.word} · ${word.pos}` : `${word.meaning} · ${word.pos}`;
  $('#back-example').innerHTML = `<span lang="en" data-say="example" role="button" tabindex="0" aria-label="朗讀英文例句">${escape(word.example)}</span><em>${escape(word.translation)}</em>`;
  $('#back-note').textContent = word.note;
  $('#back-note').hidden = !word.note;
  $('#card-status').textContent = badge.text;
  $('#card-status').className = `badge ${badge.className}`;
  $('#star-card').textContent = p.starred ? '★' : '☆';
  $('#star-card').setAttribute('aria-pressed', String(p.starred));
  $('#star-card').setAttribute('aria-label', p.starred ? '取消收藏這個單字' : '收藏這個單字');
  $('#card-position').innerHTML = `${position + 1} <span>/ ${cards.length}</span>`;
  $('#position-bar').style.width = `${(position + 1) / cards.length * 100}%`;
  $('#previous').disabled = position === 0;
  $('#next').disabled = position === cards.length - 1;
  $('#mark-known').disabled = true;
  $('#mark-weak').disabled = true;
}
function flipCard() {
  if (!cards.length) return;
  flipped = !flipped;
  $('#flashcard').classList.toggle('flipped', flipped);
  $('#flashcard').setAttribute('aria-pressed', String(flipped));
  $('#flashcard').setAttribute('aria-label', flipped ? '翻回字卡正面' : '翻開字卡');
  $('.front').setAttribute('aria-hidden', String(flipped));
  $('.back').setAttribute('aria-hidden', String(!flipped));
  $('#mark-known').disabled = !flipped;
  $('#mark-weak').disabled = !flipped;
}
function moveCard(delta) {
  if (!cards.length) return;
  position = Math.max(0, Math.min(cards.length - 1, position + delta));
  renderCard();
}
function markCard(correct) {
  if (!flipped || !cards.length) return;
  const word = cards[position];
  recordAnswer(state, word.id, correct, 'card', reviewActor);
  save(); renderStats();
  if (matchesFilter(word, state, filter)) position = (position + 1) % cards.length;
  refreshCards();
  toast(correct ? '已標記熟悉，繼續下一張。' : '已加入待加強，下次優先練習。', 2200);
}
function setView(view) {
  if (!['cards', 'quiz', 'library', 'progress', 'account'].includes(view)) return;
  if (view === 'account' && !activeUser) { guestChosen = false; renderEntrance(); return; }
  currentView = view;
  $$('.view').forEach(section => { section.hidden = section.id !== `${view}-view`; });
  $$('.nav-item').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  const headings = { cards: ['每天，記住一點', '翻一張卡，讓一個單字變熟悉。'], quiz: ['把記憶，練成直覺', '每回最多 10 題，讓熟悉變得更確定。'], library: ['你的單字，一頁收藏', '目前有哪些單字，在這裡一次看清楚。'], progress: ['每一次，都有累積', '回頭看看，你已經走了多遠。'], account: ['每一份努力，都帶得走', '登入帳號，讓手機與電腦接續同一份進度。'] };
  $('#page-title').innerHTML = `${headings[view][0]}<span class="orange">。</span>`;
  $('#page-description').textContent = headings[view][1];
  if (view === 'cards') refreshCards(cards[position]?.id);
  if (view === 'library') renderLibrary();
  if (view === 'progress') renderHistory();
}
function renderQuizAvailability() {
  const ready = authReady && !librarySwitchBusy && (!activeUser || libraryReady);
  const scope = $('#quiz-scope').value;
  const weakCount = WORDS.filter(word => matchesFilter(word, state, 'weak')).length;
  $('#quiz-scope-weak').textContent = `只考再烤一下（${weakCount} 個）`;
  const pool = ready ? quizPool(WORDS, state, scope, $('#quiz-direction').value) : [];
  $('#start-quiz').disabled = !pool.length;
  let message;
  if (!ready) message = '正在載入你的單字庫…';
  else if (scope === 'weak' && !weakCount) message = '目前沒有「再烤一下」的單字。可先在翻字卡標記「還不熟，再烤一下」，或改選「全部單字」。';
  else if (!pool.length) message = '目前無法組成四個不同選項。請加入更多英文與中文意思不同的單字，或調整出題方式。';
  else if (scope === 'weak') message = '';
  else message = `從全部單字隨機抽出最多 ${Math.min(pool.length, 10)} 題，同一回不重複。`;
  $('#quiz-availability').textContent = message;
  $('#quiz-availability').hidden = !message;
  return pool;
}
function startQuiz() {
  const direction = $('#quiz-direction').value;
  const scope = $('#quiz-scope').value;
  const eligible = renderQuizAvailability();
  if (!eligible.length) { toast($('#quiz-availability').textContent); return; }
  quiz = { words: selectQuizWords(eligible, state, 10, scope), scope, direction, index: 0, answers: [], question: null, answered: false };
  $('#quiz-setup').hidden = true;
  $('#quiz-result').hidden = true;
  $('#quiz-active').hidden = false;
  renderQuestion();
}
function renderQuestion() {
  const question = createQuestion(quiz.words[quiz.index], WORDS, quiz.direction);
  quiz.question = question; quiz.answered = false;
  $('#quiz-position').textContent = `QUESTION ${String(quiz.index + 1).padStart(2, '0')} / ${quiz.words.length}`;
  $('#quiz-bar').style.width = `${quiz.index / quiz.words.length * 100}%`;
  $('#quiz-prompt').textContent = question.direction === 'en' ? '選出最符合的中文意思' : '選出對應的英文單字或片語';
  $('#quiz-word').textContent = question.prompt;
  $('#quiz-word').lang = question.direction === 'en' ? 'en' : 'zh-Hant';
  $('#quiz-options').innerHTML = question.options.map((option, index) => `<button class="option" data-choice="${option.id}"><span class="option-letter">${'ABCD'[index]}</span><span>${escape(option.text)}</span></button>`).join('');
  $('#quiz-feedback').hidden = true;
  $('#quiz-next').hidden = true;
}
function answerQuiz(id) {
  if (!quiz || quiz.answered) return;
  const question = quiz.question, correct = id === question.word.id;
  quiz.answered = true;
  quiz.answers.push({ word: question.word, correct, selected: question.options.find(option => option.id === id)?.text });
  recordAnswer(state, question.word.id, correct, 'quiz', reviewActor);
  save(); renderStats();
  $$('.option').forEach(button => {
    const choice = Number(button.dataset.choice);
    button.disabled = true;
    if (choice === question.word.id) { button.classList.add('correct'); button.insertAdjacentHTML('beforeend', '<span class="option-status">✓</span>'); }
    else if (choice === id) { button.classList.add('wrong'); button.insertAdjacentHTML('beforeend', '<span class="option-status">✕</span>'); }
  });
  const word = question.word;
  $('#quiz-feedback').className = `quiz-feedback${correct ? '' : ' wrong'}`;
  $('#quiz-feedback').innerHTML = `<strong>${correct ? '答對了！' : '再記一次，下次會更熟悉。'}</strong><p><b>${escape(word.word)}</b>＝${escape(word.meaning)}</p><p class="example-line"><span lang="en">${escape(word.example)}</span><br>${escape(word.translation)}</p>${word.note ? `<p>${escape(word.note)}</p>` : ''}`;
  $('#quiz-feedback').hidden = false;
  $('#quiz-next').textContent = quiz.index === quiz.words.length - 1 ? '查看本回成績 →' : '下一題 →';
  $('#quiz-next').hidden = false;
  $('#quiz-bar').style.width = `${(quiz.index + 1) / quiz.words.length * 100}%`;
  $('#quiz-next').focus({ preventScroll: true });
}
function finishQuiz() {
  const answers = quiz?.answers || [];
  if (!answers.length) { quiz = null; $('#quiz-active').hidden = true; $('#quiz-setup').hidden = false; return; }
  const correct = answers.filter(answer => answer.correct).length;
  $('#quiz-active').hidden = true;
  $('#quiz-result').hidden = false;
  $('#quiz-result').innerHTML = `<p class="eyebrow">PRACTICE MAKES PROGRESS</p><h2>這一回，你又前進了一點。</h2><div class="result-number">${correct}<small> / ${answers.length}</small></div><p class="muted">正確率 ${Math.round(correct / answers.length * 100)}%${answers.length < quiz.words.length ? ' · 本回提早結束，僅計已作答題目' : ''}</p><div class="result-review">${answers.map(answer => `<div class="result-row${answer.correct ? '' : ' wrong'}"><span>${answer.correct ? '✓' : '↻'} <strong>${escape(answer.word.word)}</strong></span><span>${escape(answer.word.meaning)}</span></div>`).join('')}</div><div class="result-actions"><button class="button primary" data-action="again">再測一回 →</button><button class="button outline" data-action="settings">調整測驗設定</button><button class="button outline" data-action="weak">翻卡複習待加強</button></div><p class="fine-print">結果已記錄在此瀏覽器；可到學習紀錄匯出備份。</p>`;
  quiz = null;
}
function renderLibrary() {
  const editable = libraryEditable();
  $('#library-view .library-overview > div > p:not([class])').textContent = editable ? '點擊單字即可編輯；也能新增、搜尋、收藏與復原字卡。' : '閱讀分享的單字、搜尋、收藏，或開始翻卡練習。內容由建立者管理。';
  const query = $('#search').value.trim().toLowerCase();
  const selected = $('#library-filter').value;
  const deleted = authReady && (!activeUser || libraryReady) ? allWords(BASE_WORDS, state, { includeDeleted: true }).filter(word => isWordDeleted(state, word.id)) : [];
  const candidates = selected === 'deleted' ? deleted : WORDS;
  const found = candidates.filter(word => `${word.word} ${word.meaning} ${word.note} ${word.example} ${word.translation}`.toLowerCase().includes(query) && (selected === 'deleted' || (selected === 'custom' ? word.id >= 1_000_000 : selected === 'known' ? getProgress(state, word.id).lastCorrect === true : matchesFilter(word, state, selected))));
  if ($('#library-sort').value !== 'source') found.sort((a, b) => a.word.localeCompare(b.word, 'en') * ($('#library-sort').value === 'az' ? 1 : -1));
  $('#library-total').textContent = WORDS.length;
  const customCount = WORDS.filter(word => word.id >= 1_000_000).length;
  $('#custom-word-count').textContent = `${state.includeBaseWords === false ? `個人單字庫 · ${customCount} 個單字` : `原始 ${WORDS.length - customCount} 個 · 自訂 ${customCount} 個`} · 已刪除 ${deleted.length} 個`;
  if (selectedLibrary) $('#custom-word-count').textContent = `${selectedLibrary.name} · ${WORDS.length} 個單字 · 已刪除 ${deleted.length} 個`;
  $('#library-filter option[value="custom"]').textContent = selectedLibrary ? '庫內新增單字' : '我的自訂單字';
  $('#search-count').textContent = selected === 'deleted' ? `已刪除 ${found.length}／${deleted.length}` : `顯示 ${found.length}／${WORDS.length}`;
  $('#word-list').innerHTML = found.length ? found.map(word => {
    const p = getProgress(state, word.id), badge = statusBadge(word);
    const actions = selected === 'deleted'
      ? `<span class="badge">已刪除</span>${editable ? `<button class="manage-word" data-restore="${word.id}" aria-label="復原 ${escape(word.word)}">復原</button>` : ''}`
      : `<span class="badge ${badge.className}">${badge.text}</span><button class="star-button" data-star="${word.id}" aria-label="${p.starred ? '取消收藏' : '收藏'} ${escape(word.word)}" aria-pressed="${p.starred}">${p.starred ? '★' : '☆'}</button><button class="study-word" data-study="${word.id}" aria-label="翻卡複習 ${escape(word.word)}">翻卡 ↗</button>${editable ? `<button class="manage-word delete" data-delete="${word.id}" aria-label="刪除 ${escape(word.word)}">刪除</button>` : ''}`;
    return `<article class="word-row"><span class="word-number">${word.id >= 1_000_000 ? '自訂' : String(word.id).padStart(2, '0')}</span><div><h3><button type="button" class="word-edit-title" data-edit="${word.id}" ${selected === 'deleted' || !editable ? 'disabled' : ''} aria-label="${editable ? '編輯' : '單字'} ${escape(word.word)}"><img src="./assets/dinotaeng/bobo.webp" class="row-emoji" alt="" aria-hidden="true"><span lang="en">${escape(word.word)}</span><small>${escape(word.pos)}</small></button></h3><p>${escape(word.meaning)}</p><details><summary>例句與用法</summary><p class="example-line" lang="en">${escape(word.example)}</p><p>${escape(word.translation)}</p>${word.note ? `<span class="card-note">${escape(word.note)}</span>` : ''}${!word.example && !word.translation && !word.note ? '<p>尚未填寫例句或用法。</p>' : ''}</details></div><div class="row-actions">${actions}</div></article>`;
  }).join('') : selected === 'deleted' && !deleted.length ? '<div class="empty"><strong>目前沒有已刪除的單字</strong>刪除的單字會保留在這裡，方便隨時復原。</div>' : WORDS.length || deleted.length ? '<div class="empty"><strong>沒有符合條件的單字</strong>試試其他關鍵字，或清除學習狀態篩選。</div>' : '<div class="empty"><strong>你的單字庫還是空的</strong>按上方「＋ 新增單字」，加入自己的第一個單字。</div>';
}
const dateLabel = at => /^\d{4}-\d{2}-\d{2}$/.test(at) ? at : new Date(at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
function renderHistory() {
  const history = visibleHistory(WORDS, state);
  $('#recent-history').innerHTML = history.length ? history.slice(0, 30).map(entry => {
    const word = WORDS.find(w => w.id === entry.wordId);
    return `<div class="history-row"><strong>${entry.correct ? '✓' : '↻'} ${escape(word.word)}</strong><span>${entry.source === 'quiz' ? '選擇題' : '翻字卡'} · ${entry.correct ? (entry.source === 'quiz' ? '答對' : '已熟悉') : '待加強'} · ${dateLabel(entry.at)}</span></div>`;
  }).join('') : '<p class="muted">還沒有練習紀錄。從一張字卡開始吧。</p>';
}
function download(filename, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const today = () => new Date().toLocaleDateString('en-CA');
function exportMarkdown() {
  const rows = WORDS.map(word => {
    const p = getProgress(state, word.id);
    return `| ${word.word} | ${word.meaning.replaceAll('|', '／')} | ${p.reviews} | ${p.lastCorrect === null ? '尚未複習' : p.lastCorrect ? '已熟悉' : '待加強'} | ${p.lastReviewed ? new Date(p.lastReviewed).toLocaleDateString('zh-TW') : '—'} |`;
  });
  const stats = getStats(WORDS, state);
  const history = visibleHistory(WORDS, state).map(entry => `| ${new Date(entry.at).toLocaleString('zh-TW')} | ${WORDS.find(w => w.id === entry.wordId).word} | ${entry.source === 'quiz' ? '四選一' : '翻字卡'} | ${entry.correct ? (entry.source === 'quiz' ? '答對' : '已熟悉') : '待加強'} |`);
  download(`santa-review-${today()}.md`, `# Santa 單字複習紀錄\n\n匯出日期：${today()}\n\n已複習 ${stats.reviewed}／${stats.total} 筆；待加強 ${stats.weak} 筆。\n\n| 單字 | 意思 | 複習次數 | 最近狀態 | 最近複習 |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\n## 最近紀錄（最多 500 筆）\n\n| 日期 | 單字 | 題型 | 結果 |\n| --- | --- | --- | --- |\n${history.join('\n')}\n`, 'text/markdown;charset=utf-8');
}

$$('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$('#stats').addEventListener('click', event => {
  if (event.target.closest('[data-open-pocket]')) {
    setView('library');
    $('#search').focus({ preventScroll: true });
  }
});
$$('[data-filter]').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.filter; position = 0;
  $$('[data-filter]').forEach(item => item.classList.toggle('selected', item.dataset.filter === filter));
  refreshCards();
}));
const speechPlayer = createSpeechPlayer({ onError: message => toast(message) });
mountSpeechSettings(speechPlayer, { voice: $('#speech-voice'), rate: $('#speech-rate'), status: $('#speech-status'), preview: $('#speech-preview') });
function speakText(text) { speechPlayer.speak(text); }
$('#flashcard').addEventListener('click', event => {
  const speech = event.target.closest('[data-say]');
  if (speech && cards.length) { event.stopPropagation(); speakText(speech.dataset.say === 'example' ? cards[position].example : cards[position].word); return; }
  flipCard();
});
$('#card-stage').addEventListener('click', event => { if (!event.target.closest('#flashcard, #star-card, #speak')) flipCard(); });
$('#previous').addEventListener('click', () => moveCard(-1));
$('#next').addEventListener('click', () => moveCard(1));
$('#mark-known').addEventListener('click', () => markCard(true));
$('#mark-weak').addEventListener('click', () => markCard(false));
let resetCardsContext = null;
$('#reset-all-cards').addEventListener('click', () => {
  resetCardsContext = activeStorageKey();
  $('#reset-cards-scope').textContent = activeUser ? '重置會同步至你的帳號。其他裝置請重新整理網站，以取得最新進度。' : '重置會儲存在目前瀏覽器的訪客資料。';
  if (selectedLibrary) $('#reset-cards-scope').textContent = `只重置你在「${selectedLibrary.name}」的練習進度，其他單字庫與其他人的紀錄不受影響。其他裝置請重新整理網站。`;
  $('#reset-cards-dialog').showModal();
  $('#cancel-reset-cards').focus();
});
$('#cancel-reset-cards').addEventListener('click', () => $('#reset-cards-dialog').close());
$('#confirm-reset-cards').addEventListener('click', () => {
  if (resetCardsContext !== activeStorageKey() || !authReady || (activeUser && !libraryReady)) {
    $('#reset-cards-dialog').close(); toast('帳號狀態已變更，請重新開啟重置確認。'); return;
  }
  resetAllCards(state); reviewActor = crypto.randomUUID();
  save(); position = 0; filter = 'all';
  $$('[data-filter]').forEach(button => button.classList.toggle('selected', button.dataset.filter === 'all'));
  repaintProgress(); refreshCards();
  $('#reset-cards-dialog').close(); $('#reset-all-cards').focus();
  toast('所有翻卡已重置。單字、收藏與測驗紀錄已保留。');
});
$('#direction').addEventListener('change', renderCard);
$('#shuffle').addEventListener('click', () => { order = shuffle(order); position = 0; refreshCards(); toast('已重新隨機排序。', 2000); });
$('#star-card').addEventListener('click', () => {
  if (!cards.length) return;
  const word = cards[position]; toggleStar(state, word.id); save();
  if (filter === 'starred') refreshCards();
  else {
    const starred = getProgress(state, word.id).starred;
    $('#star-card').textContent = starred ? '★' : '☆';
    $('#star-card').setAttribute('aria-pressed', String(starred));
    $('#star-card').setAttribute('aria-label', starred ? '取消收藏這個單字' : '收藏這個單字');
  }
});
$('#speak').addEventListener('click', () => {
  if (cards.length) speakText(cards[position].word);
});
document.addEventListener('keydown', event => {
  if ($('#app-shell').hidden || currentView !== 'cards' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target;
  const speech = target.closest('[data-say]');
  if (speech && cards.length && (event.code === 'Space' || event.key === 'Enter')) { event.preventDefault(); speakText(speech.dataset.say === 'example' ? cards[position].example : cards[position].word); return; }
  if (target.closest('input,select,textarea,summary,a') || (target.closest('button') && target.id !== 'flashcard')) return;
  if (event.code === 'Space' || (event.key === 'Enter' && target.id === 'flashcard')) { event.preventDefault(); flipCard(); }
  else if (event.key === 'ArrowLeft') { event.preventDefault(); moveCard(-1); }
  else if (event.key === 'ArrowRight') { event.preventDefault(); moveCard(1); }
});
$('#start-quiz').addEventListener('click', startQuiz);
$('#quiz-scope').addEventListener('change', renderQuizAvailability);
$('#quiz-direction').addEventListener('change', renderQuizAvailability);
$('#empty-cards').addEventListener('click', event => { if (event.target.closest('#empty-add-word')) { setView('library'); $('#open-add-word').click(); } if (event.target.closest('#empty-open-libraries')) { setView('library'); $('#library-picker').focus(); } });
$('#quiz-options').addEventListener('click', event => {
  const button = event.target.closest('[data-choice]');
  if (button && !button.disabled) answerQuiz(Number(button.dataset.choice));
});
$('#quiz-next').addEventListener('click', () => {
  if (!quiz?.answered) return;
  if (++quiz.index >= quiz.words.length) finishQuiz(); else renderQuestion();
});
$('#end-quiz').addEventListener('click', finishQuiz);
$('#quiz-result').addEventListener('click', event => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'again') startQuiz();
  if (action === 'settings') { $('#quiz-result').hidden = true; $('#quiz-setup').hidden = false; renderQuizAvailability(); $('#quiz-scope').focus(); }
  if (action === 'weak') {
    filter = 'weak'; position = 0;
    $$('[data-filter]').forEach(button => button.classList.toggle('selected', button.dataset.filter === filter));
    setView('cards');
  }
});
$('#search').addEventListener('input', renderLibrary);
$('#library-filter').addEventListener('change', renderLibrary);
$('#library-sort').addEventListener('change', renderLibrary);
$('#clear-library-filters').addEventListener('click', () => { $('#search').value = ''; $('#library-filter').value = 'all'; $('#library-sort').value = 'source'; renderLibrary(); });
function closeWordForm() {
  wordAssistant.reset();
  $('#add-word-panel').hidden = true;
  $('#open-add-word').setAttribute('aria-expanded', 'false');
  $('#add-word-form').reset();
  $('#add-word-message').textContent = '';
  editingWordId = null; editingWordSnapshot = null;
}
function openWordForm(word = null) {
  if (!libraryEditable()) { toast('這份單字庫由建立者管理，你可以閱讀與練習。'); return; }
  closeWordForm();
  closeDeleteWord();
  editingWordId = word?.id ?? null; editingWordSnapshot = word ? fingerprint(word) : null;
  $('#add-word-panel').hidden = false;
  $('#open-add-word').setAttribute('aria-expanded', 'true');
  $('#word-form-title').textContent = word ? '修正單字，讓記憶更準確。' : '把想記住的單字，放進來。';
  $('#save-word-button').textContent = word ? '儲存修改 →' : '加入單字庫 →';
  $('#add-word-storage').textContent = word ? `修改會保留原有學習紀錄與收藏。${activeUser ? '只更新你的帳號，並自動同步至雲端。' : '目前只儲存在此瀏覽器的訪客資料。'}` : activeUser ? '新增後會自動同步至你的帳號，只有你能使用。' : '目前是訪客模式，單字儲存在此瀏覽器；登入後可選擇合併至帳號。';
  if (selectedLibrary) $('#add-word-storage').textContent = `儲存至「${selectedLibrary.name}」。${selectedLibrary.visibility === 'public' ? '內容會同步更新給所有閱讀這份單字庫的人。' : '這份單字庫僅自己可見。'}學習進度與收藏仍各自保存。`;
  if (word) for (const key of ['word', 'meaning', 'pos', 'example', 'translation', 'note']) $(`#new-${key}`).value = word[key];
  wordAssistant.refreshFields();
  $('#new-word').focus();
}
$('#open-add-word').addEventListener('click', () => openWordForm());
$('#cancel-add-word').addEventListener('click', () => { closeWordForm(); $('#open-add-word').focus(); });
$('#add-word-form').addEventListener('submit', async event => {
  event.preventDefault();
  const message = $('#add-word-message');
  if (!allowSave) { message.textContent = '目前無法讀取原有資料，請先匯出備份並恢復儲存，再新增單字。'; return; }
  try {
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    const editing = editingWordId !== null;
    if (editing && fingerprint(allWords(BASE_WORDS, state).find(word => word.id === editingWordId)) !== editingWordSnapshot) throw new Error('這個單字已在其他分頁或裝置更新／刪除。請先複製尚未儲存的內容，再取消並重新開啟編輯。');
    let word;
    await commitLibraryChange(next => { word = editing ? updateWord(next, BASE_WORDS, editingWordId, fields) : addCustomWord(next, BASE_WORDS, fields); });
    closeWordForm(); $('#search').value = word.word; $('#library-filter').value = word.id >= 1_000_000 ? 'custom' : 'all'; renderLibrary();
    $('#search').focus();
    toast(editing ? `修改已儲存，學習紀錄已保留。${activeUser ? '正在同步至帳號。' : ''}` : activeUser ? '單字已加入，正在同步至帳號。' : '單字已加入此瀏覽器，現在就能翻卡複習。');
  } catch (error) {
    message.textContent = error.name === 'QuotaExceededError' || error.name === 'SecurityError' ? '瀏覽器無法儲存，這個單字尚未加入。請先備份並確認儲存空間。' : error.message;
  }
});
function closeDeleteWord() {
  pendingDeleteId = null; pendingDeleteSnapshot = null; $('#delete-word-panel').hidden = true;
  $('#delete-word-message').hidden = true; $('#delete-word-message').textContent = '';
}
async function commitLibraryChange(change) {
  if (!libraryEditable()) throw new Error('這份單字庫目前無法編輯，只有建立者能修改內容。');
  if (!allowSave) throw new Error('目前無法讀取原有資料，請先匯出備份並恢復儲存。');
  const next = structuredClone(state);
  change(next);
  if (selectedLibrary) {
    const context = activeStorageKey();
    libraryWriteBusy = true;
    try {
      const updated = await libraryRepository.update(selectedLibrary, { content: libraryContent(next, BASE_WORDS) });
      if (context !== activeStorageKey()) throw new Error('帳號或單字庫已切換，請重新開啟編輯。');
      selectedLibrary = updated;
      // Keep any reviews recorded while the content request was in flight.
      Object.assign(next, applyLibraryContent(state, updated.content, BASE_WORDS));
      libraryPicker.render();
    } finally { libraryWriteBusy = false; }
  }
  try { localStorage.setItem(activeStorageKey(), JSON.stringify(next)); }
  catch (error) { if (!selectedLibrary) throw error; toast('單字內容已儲存至雲端；此瀏覽器的儲存空間不足，請備份學習進度。',8000); }
  state = next; save(); repaintProgress();
}
$('#cancel-delete-word').addEventListener('click', () => { closeDeleteWord(); $('#search').focus(); });
$('#confirm-delete-word').addEventListener('click', async () => {
  const message = $('#delete-word-message');
  try {
    const word = WORDS.find(word => word.id === pendingDeleteId);
    if (!word) throw new Error('此單字已刪除或不存在，請按「保留單字」關閉。');
    if (fingerprint(word) !== pendingDeleteSnapshot) {
      pendingDeleteSnapshot = fingerprint(word); $('#delete-word-description').textContent = `「${word.word}」＝${word.meaning}`;
      throw new Error('這個單字剛在其他裝置更新，請確認上方最新內容後，再按一次確認。');
    }
    await commitLibraryChange(next => deleteWord(next, BASE_WORDS, word.id));
    if (editingWordId === word.id) closeWordForm();
    closeDeleteWord(); $('#search').focus(); toast('已移到「已刪除」，可在學習狀態篩選中復原。');
  } catch (error) { message.textContent = /QuotaExceededError|SecurityError/.test(error.name) ? '瀏覽器無法儲存，刪除尚未完成。請先備份並檢查儲存空間。' : error.message; message.hidden = false; }
});
$('#word-list').addEventListener('click', async event => {
  const edit = event.target.closest('[data-edit]');
  if (edit) { const word = WORDS.find(word => word.id === Number(edit.dataset.edit)); if (word) { closeDeleteWord(); openWordForm(word); } return; }
  const remove = event.target.closest('[data-delete]');
  if (remove) {
    const word = WORDS.find(word => word.id === Number(remove.dataset.delete)); if (!word) return;
    closeDeleteWord(); pendingDeleteId = word.id; pendingDeleteSnapshot = fingerprint(word);
    $('#delete-word-description').textContent = `「${word.word}」＝${word.meaning}`;
    $('#delete-word-panel').hidden = false; $('#cancel-delete-word').focus(); return;
  }
  const restore = event.target.closest('[data-restore]');
  if (restore) {
    try { await commitLibraryChange(next => restoreWord(next, BASE_WORDS, Number(restore.dataset.restore))); toast('單字已復原，原有學習紀錄與收藏已保留。'); }
    catch (error) { toast(/QuotaExceededError|SecurityError/.test(error.name) ? '瀏覽器無法儲存，復原尚未完成。' : error.message, 8000); }
    return;
  }
  const study = event.target.closest('[data-study]');
  if (study) {
    filter = 'all';
    $$('[data-filter]').forEach(button => button.classList.toggle('selected', button.dataset.filter === filter));
    position = order.indexOf(Number(study.dataset.study));
    setView('cards'); refreshCards(Number(study.dataset.study)); $('#flashcard').focus(); return;
  }
  const button = event.target.closest('[data-star]');
  if (button) { toggleStar(state, Number(button.dataset.star)); save(); renderLibrary(); }
});
$('#export-json').addEventListener('click', () => download(`santa-progress-${today()}.json`, JSON.stringify({ ...state, libraryId: selectedLibrary?.id || PERSONAL_LIBRARY, exportedAt: new Date().toISOString() }, null, 2), 'application/json'));
$('#export-md').addEventListener('click', exportMarkdown);
$('#import-progress').addEventListener('change', async event => {
  const importContext = activeStorageKey();
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('檔案超過 2 MB，請選擇有效的進度備份。');
    const payload = JSON.parse(await file.text());
    if (importContext !== activeStorageKey()) throw new Error('帳號或單字庫已切換，請重新選擇備份檔案。');
    if ((payload.libraryId || PERSONAL_LIBRARY) !== (selectedLibrary?.id || PERSONAL_LIBRARY)) throw new Error('這份備份屬於另一個單字庫，請先切換到對應的單字庫再匯入。');
    const incoming = selectedLibrary ? applyLibraryContent(payload, selectedLibrary.content, BASE_WORDS) : validateState(payload, BASE_WORDS);
    state = mergeStates(state, incoming, BASE_WORDS); allowSave = true; save();
    repaintProgress();
    toast('進度已匯入；相同單字保留較新的狀態。');
  } catch (error) { toast(error instanceof SyntaxError ? '這不是有效的 JSON 進度檔。原有進度已保留。' : error.message, 8000); }
  finally { event.target.value = ''; }
});
$('#reset-progress').addEventListener('click', () => {
  $('#reset-progress').hidden = true;
  $('#reset-confirmation').hidden = false;
  $('#cancel-reset').focus();
});
$('#cancel-reset').addEventListener('click', () => {
  $('#reset-confirmation').hidden = true;
  $('#reset-progress').hidden = false;
  $('#reset-progress').focus();
});
$('#confirm-reset').addEventListener('click', () => {
  if (activeUser) { toast('請先登出，再重設此裝置的訪客紀錄。雲端紀錄不會被刪除。'); return; }
  state = emptyState(false); allowSave = true; save(); renderStats(); renderHistory(); refreshCards();
  quiz = null; $('#quiz-active').hidden = true; $('#quiz-result').hidden = true; $('#quiz-setup').hidden = false;
  $('#reset-confirmation').hidden = true; $('#reset-progress').hidden = false;
  $('#reset-progress').focus();
  toast('學習進度已重設。');
});
window.addEventListener('storage', event => {
  if (event.key !== activeStorageKey()) return;
  try { const other = loadCurrentState(); state = mergeStates(state, other, BASE_WORDS); repaintProgress(); cloudSync?.schedule(); }
  catch { toast('其他分頁的進度無法讀取，目前的練習仍保留。'); }
});
function repaintProgress() {
  const previousWords = fingerprint(WORDS);
  renderStats();
  if (quiz && fingerprint(WORDS) !== previousWords) {
    quiz = null; $('#quiz-active').hidden = true; $('#quiz-result').hidden = true; $('#quiz-setup').hidden = false;
    if (currentView === 'quiz') toast('單字庫已更新，本回測驗已結束；已作答的紀錄保留，可重新開始。');
  }
  if (currentView === 'cards') refreshCards(cards[position]?.id);
  if (currentView === 'library') renderLibrary();
  if (currentView === 'progress') renderHistory();
}
function showAuthMessage(message, error = false) {
  $('#auth-message').textContent = message;
  $('#auth-message').hidden = !message;
  $('#auth-message').classList.toggle('error', error);
}
function setAuthMode(mode) {
  authMode = mode;
  const recovery = mode === 'recovery', forgot = mode === 'forgot', signup = mode === 'signup';
  $('#auth-tabs').hidden = recovery;
  $$('[data-auth-mode]').forEach(button => button.classList.toggle('selected', button.dataset.authMode === mode));
  $('#auth-email-field').hidden = recovery;
  $('#auth-email').required = !recovery;
  $('#auth-password-field').hidden = forgot;
  $('#auth-password').required = !forgot;
  $('#auth-password').minLength = mode === 'signin' ? 1 : 8;
  $('#auth-password').autocomplete = signup || recovery ? 'new-password' : 'current-password';
  $('#auth-password').value = '';
  $('#auth-confirm-field').hidden = !signup && !recovery;
  $('#auth-confirm').required = signup || recovery;
  $('#auth-confirm').value = '';
  $('#password-hint').hidden = !signup && !recovery;
  $('#auth-submit').textContent = { signin: '登入並同步 →', signup: '註冊帳號 →', forgot: '寄送重設密碼信 →', recovery: '更新密碼 →' }[mode];
  showAuthMessage('');
  renderEntrance();
}

function renderEntrance() {
  const entry = showEntry({ ready: authReady, signedIn: !!activeUser, guestChosen, recovery: authMode === 'recovery', requested: entranceRequested });
  $('#entry-screen').hidden = !entry;
  $('#app-shell').hidden = entry;
  document.body.classList.toggle('entry-mode', entry);
  const slot = entry ? $('#entry-auth-slot') : $('#account-auth-slot');
  if ($('#account-panel').parentElement !== slot) slot.append($('#account-panel'));
  $('#entry-guest').disabled = !authReady || authBusy;
  $('#auth-submit').disabled = !authReady || authBusy;
  $('#entry-guest').hidden = !!activeUser || authMode === 'recovery';
  $('#entry-continue').hidden = !activeUser || !authReady || authMode === 'recovery';
  $('#signed-in-account').hidden = !activeUser || entry;
  $('.account-access-note').hidden = entry && !!activeUser;
  $('#entry-heading').textContent = authMode === 'recovery' ? '設定新的登入密碼' : '歡迎回到單字室';
  $('#entry-description').textContent = authMode === 'recovery' ? '更新密碼後，就能繼續你的單字練習。' : activeUser ? '你已登入，可以接著上次的練習。' : '登入帳號，接著上次的練習。';
  $('.skip').href = entry ? '#entry-main' : '#main';
}

function leaveEntrance() {
  entranceRequested = false;
  if (location.hash === '#login') history.replaceState(null, '', location.pathname + location.search);
}

window.addEventListener('hashchange', () => { entranceRequested = location.hash === '#login'; renderEntrance(); });
$('#entry-continue').addEventListener('click', () => {
  leaveEntrance(); setView('cards'); renderEntrance(); $('#main').focus();
});

$('#entry-guest').addEventListener('click', () => {
  if (!authReady || activeUser || authMode === 'recovery') return;
  guestChosen = true;
  leaveEntrance();
  setView('cards'); renderEntrance(); $('#main').focus();
});
function setSyncStatus(phase, detail) {
  syncPhase = phase; syncDetail = detail;
  const labels = { guest: '訪客模式', syncing: '同步中…', synced: '已同步至雲端', offline: '離線中 · 等待同步', error: '尚未同步成功' };
  $('#sync-phase').textContent = labels[phase] || '準備同步';
  $('#sync-phase').dataset.phase = phase;
  $('#sync-now').disabled = phase === 'syncing' || !activeUser;
  $('#cloud-dot').dataset.phase = phase;
  if (activeUser) $('#account-pill-label').textContent = phase === 'synced' ? '已登入 · 已同步' : phase === 'syncing' ? '正在同步' : phase === 'offline' ? '離線待同步' : '帳號與同步';
  if (phase === 'synced') {
    $('#last-sync').textContent = `最近確認 ${new Date(detail).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
    $('#sync-detail').textContent = '清除瀏覽器資料後，再登入同一帳號即可取回已同步紀錄。';
  } else if (phase === 'error') {
    $('#sync-detail').textContent = '本次雲端同步未完成。紀錄保留在此裝置，請檢查連線後按「立即同步」重試。';
  } else if (phase === 'offline') {
    $('#sync-detail').textContent = '目前先保存在此裝置；網路恢復後會自動重試。';
  } else $('#sync-detail').textContent = '';
}
function renderAccount() {
  libraryPicker.accountChanged();
  $('#signed-in-account').hidden = !activeUser;
  $('#auth-section').hidden = !authClient || (!!activeUser && authMode !== 'recovery');
  $('#account-email').textContent = activeUser?.email || '';
  $('#account-pill-label').textContent = activeUser ? '帳號與同步' : '帳號登入';
  $('#storage-label').textContent = activeUser ? '帳號模式 · 自動同步雲端' : '訪客模式 · 進度儲存在此瀏覽器';
  $('.reset-section').hidden = !!activeUser;
  const progressDescription = $('#progress-view .progress-panel > div:first-child .muted');
  progressDescription.textContent = activeUser ? '此帳號啟用雲端同步，也可匯出備份。請確認帳號頁顯示「已同步至雲端」。' : '訪客紀錄保存在此瀏覽器。登入帳號可啟用雲端同步，或先匯出 JSON 備份。';
  $('#guest-import-offer').hidden = true;
  if (activeUser) {
    try {
      const guest = guestForAccount(loadGuestState(localStorage, BASE_WORDS), state);
      const reviewed = getStats(allWords(BASE_WORDS, guest), guest).reviewed;
      const hasStars = Object.values(guest.progress).some(p => p.starred);
      const hasNew = fingerprint(mergeStates(state, guest, BASE_WORDS)) !== fingerprint(state);
      if (!selectedLibrary && libraryReady && hasNew && (reviewed > 0 || hasStars || guest.customWords.length || guest.wordChanges?.length)) {
        $('#guest-import-description').textContent = `此瀏覽器另有 ${reviewed} 個單字的訪客練習紀錄、${guest.customWords.length} 個自訂單字及 ${guest.wordChanges?.length || 0} 筆單字修改／刪除紀錄。要加入目前帳號嗎？`;
        $('#guest-import-offer').hidden = false;
      }
    } catch { /* A damaged guest backup must not block an account. */ }
    setSyncStatus(syncPhase === 'guest' ? 'syncing' : syncPhase, syncDetail);
  } else setSyncStatus('guest');
  renderEntrance();
}
function clearActiveQuiz() {
  quiz = null; $('#quiz-active').hidden = true; $('#quiz-result').hidden = true; $('#quiz-setup').hidden = false;
}
function setupCloudSync() {
  cloudSync?.dispose();
  const userId = activeUser.id, libraryId = selectedLibrary?.id || PERSONAL_LIBRARY;
  const context = activeStorageKey();
  const isCurrent = () => activeUser?.id === userId && (selectedLibrary?.id || PERSONAL_LIBRARY) === libraryId && activeStorageKey() === context;
  const remote = selectedLibrary ? createLibraryRemote(libraryRepository, libraryId, BASE_WORDS, library => {
    if (!isCurrent()) return;
    if (selectedLibrary.revision > library.revision) return;
    selectedLibrary = library;
    state = applyLibraryContent(state, library.content, BASE_WORDS);
    libraryPicker.render();
  }) : createRemote(authClient);
  cloudSync = createSyncCoordinator({
    remote, words: BASE_WORDS, getState: () => state,
    applyState: next => {
      if (!isCurrent()) return;
      if (state.includeBaseWords !== next.includeBaseWords) clearActiveQuiz();
      state = selectedLibrary ? applyLibraryContent(next, selectedLibrary.content, BASE_WORDS) : next;
      libraryReady = true; allowSave = true; save({ upload: false }); repaintProgress(); renderAccount();
    },
    onStatus: (phase, detail) => {
      if (!isCurrent()) return;
      if (selectedLibrary && phase === 'error' && (detail?.code === '42501' || /無法存取|已改為私人/.test(detail?.message || ''))) {
        libraryReady = false; closeWordForm(); closeDeleteWord(); clearActiveQuiz(); repaintProgress();
        toast('這份單字庫已改為私人或無法存取，請切換其他單字庫。');
      }
      setSyncStatus(phase, detail);
    }, isOnline: () => navigator.onLine,
  });
  cloudSync.setUser(userId);
}
async function switchLibrary(id) {
  if (!activeUser || !libraryRepository || librarySwitchBusy || libraryWriteBusy) throw new Error('請先登入，或等待目前操作完成。');
  if (id === (selectedLibrary?.id || PERSONAL_LIBRARY)) return;
  const userId = activeUser.id, token = ++librarySwitchGeneration;
  librarySwitchBusy = true;
  closeWordForm(); closeDeleteWord(); clearActiveQuiz(); repaintProgress();
  try {
    const library = id === PERSONAL_LIBRARY ? null : await libraryRepository.get(id);
    if (activeUser?.id !== userId || token !== librarySwitchGeneration) return;
    await cloudSync?.sync();
    if (activeUser?.id !== userId || token !== librarySwitchGeneration) return;
    cloudSync?.dispose(); cloudSync = null;
    selectedLibrary = library;
    try { localStorage.setItem(`${STORAGE_KEY}.user.${userId}.active-library`, library?.id || PERSONAL_LIBRARY); } catch { /* Selection can still work without persistent storage. */ }
    try { state = loadCurrentState(); allowSave = true; }
    catch { state = emptyState(false); allowSave = false; toast('此單字庫的本機副本無法讀取，正在嘗試從雲端恢復。'); }
    if (library) state = applyLibraryContent(state, library.content, BASE_WORDS);
    libraryReady = !!library || !!localStorage.getItem(activeStorageKey());
    order=[]; position=0; filter='all';
    $$('[data-filter]').forEach(button => button.classList.toggle('selected',button.dataset.filter==='all'));
    $('#search').value=''; $('#library-filter').value='all';
    setupCloudSync();
    librarySwitchBusy = false; repaintProgress(); renderAccount(); libraryPicker.render();
    const synced = await cloudSync.sync();
    if (activeUser?.id === userId && token === librarySwitchGeneration) toast(synced ? `已切換到「${library?.name || '我的私人單字口袋'}」。` : '已切換單字庫；這個裝置的進度會在連線恢復後再同步。');
  } finally {
    if (token === librarySwitchGeneration) { librarySwitchBusy=false; repaintProgress(); libraryPicker.render(); }
  }
}
async function activateSession(session, event = '') {
  const next = session?.user || null;
  const accountChanged = activeUser?.id !== next?.id;
  const destination = sessionView(activeUser?.id, next?.id, event);
  if (activeUser?.id !== next?.id) guestChosen = false;
  if (activeUser?.id !== next?.id) {
    librarySwitchGeneration++; librarySwitchBusy = false;
    cloudSync?.dispose(); cloudSync = null;
    selectedLibrary = null;
    activeUser = next;
    closeWordForm();
    closeDeleteWord();
    reviewActor = crypto.randomUUID();
    syncPhase = 'guest'; syncDetail = undefined; $('#last-sync').textContent = '';
    try { state = loadCurrentState(); libraryReady = !next || !!localStorage.getItem(activeStorageKey()); allowSave = true; }
    catch { state = emptyState(false); libraryReady = false; allowSave = false; showAuthMessage('此裝置的進度副本無法讀取；雲端同步會嘗試取回已保存的紀錄。', true); }
    quiz = null; $('#quiz-active').hidden = true; $('#quiz-result').hidden = true; $('#quiz-setup').hidden = false;
    repaintProgress();
    if (next && authClient) setupCloudSync();
  } else if (next) activeUser = next;
  if (event === 'PASSWORD_RECOVERY') { setAuthMode('recovery'); setView('account'); }
  else if (authMode === 'recovery' && !next) setAuthMode('signin');
  else if (destination && !entranceRequested) setView(destination);
  renderAccount();
  if (next) {
    await cloudSync?.sync();
    if (accountChanged && activeUser?.id === next.id) {
      let remembered;
      try { remembered = localStorage.getItem(`${STORAGE_KEY}.user.${next.id}.active-library`); } catch { /* Use the private pocket. */ }
      if (remembered && remembered !== PERSONAL_LIBRARY) {
        try { await switchLibrary(remembered); }
        catch { toast('上次的單字庫目前無法存取，先開啟你的私人單字口袋。'); }
      }
    }
  }
}
async function initializeAccounts() {
  $('#account-loading').hidden = false;
  try {
    authClient = await createAccountClient();
    $('#account-unavailable').hidden = !!authClient;
    if (!authClient) { renderAccount(); return; }
    libraryRepository = createLibraryRepository(authClient);
    const subscription = authClient.auth.onAuthStateChange((event, session) => {
      setTimeout(() => { void activateSession(session, event).catch(() => setSyncStatus('error')); }, 0);
    });
    authSubscription = subscription.data.subscription;
    const { data, error } = await authClient.auth.getSession();
    if (error) throw error;
    await activateSession(data.session);
  } catch (error) {
    showAuthMessage(friendlyAuthError(error), true);
    if (!authClient) $('#account-unavailable').hidden = false;
  } finally { authReady = true; $('#account-loading').hidden = true; repaintProgress(); renderAccount(); }
}
$$('[data-auth-mode]').forEach(button => button.addEventListener('click', () => setAuthMode(button.dataset.authMode)));
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!authClient || !authReady || authBusy) return;
  if ((authMode === 'signup' || authMode === 'recovery') && $('#auth-password').value !== $('#auth-confirm').value) { showAuthMessage('兩次輸入的密碼不同，請再確認。', true); return; }
  authBusy = true; $('#auth-submit').disabled = true; showAuthMessage('處理中…');
  const email = $('#auth-email').value.trim(), password = $('#auth-password').value;
  const redirectTo = new URL('./', location.href).href;
  try {
    if (authMode === 'forgot') {
      const { error } = await authClient.auth.resetPasswordForEmail(email, { redirectTo }); if (error) throw error;
      showAuthMessage('如果這個 Email 已註冊，將收到重設密碼信。請檢查收件匣與垃圾郵件。');
    } else if (authMode === 'recovery') {
      const { error } = await authClient.auth.updateUser({ password }); if (error) throw error;
      setAuthMode('signin'); renderAccount(); showAuthMessage('密碼已更新。');
    } else if (authMode === 'signup') {
      const { data, error } = await authClient.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } }); if (error) throw error;
      if (data.session) { leaveEntrance(); await activateSession(data.session); setView('cards'); showAuthMessage('帳號已建立，已啟用雲端同步。'); }
      else showAuthMessage('請檢查 Email，點選驗證信中的連結後再登入。若已註冊，可改用登入或忘記密碼。');
    } else {
      const { data, error } = await authClient.auth.signInWithPassword({ email, password }); if (error) throw error;
      leaveEntrance(); await activateSession(data.session); setView('cards'); showAuthMessage('已登入。請確認上方的同步狀態。');
    }
  } catch (error) { showAuthMessage(friendlyAuthError(error), true); }
  finally { authBusy = false; $('#auth-submit').disabled = false; $('#auth-password').value = ''; $('#auth-confirm').value = ''; }
});
$('#sync-now').addEventListener('click', () => { void cloudSync?.sync(); });
$('#sign-out').addEventListener('click', async () => {
  if (!authClient || authBusy) return;
  authBusy = true; $('#sign-out').disabled = true;
  try {
    await cloudSync?.sync();
    const { error } = await authClient.auth.signOut({ scope: 'local' }); if (error) throw error;
    await activateSession(null); setAuthMode('signin'); showAuthMessage('已登出。登入後即可繼續練習。');
  } catch (error) { showAuthMessage(friendlyAuthError(error), true); }
  finally { authBusy = false; $('#sign-out').disabled = false; }
});
$('#merge-guest').addEventListener('click', async () => {
  if (!activeUser || !cloudSync || selectedLibrary) return;
  try {
    state = mergeStates(state, guestForAccount(loadGuestState(localStorage, BASE_WORDS), state), BASE_WORDS); allowSave = true; save(); repaintProgress(); renderAccount();
    const success = await cloudSync.sync();
    toast(success ? '訪客紀錄已加入帳號並同步。' : '訪客紀錄已加入此帳號的本機副本，等待雲端同步。');
  } catch { showAuthMessage('訪客紀錄無法讀取。請先匯出備份，原有帳號紀錄仍保留。', true); }
});
window.addEventListener('online', () => { cloudSync?.schedule(0); });
window.addEventListener('offline', () => { if (activeUser) setSyncStatus('offline'); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && activeUser) cloudSync?.schedule(0); });
setInterval(() => { if (!document.hidden && activeUser) cloudSync?.schedule(0); }, 45000);
setAuthMode('signin'); renderStats(); refreshCards(); renderAccount();
void initializeAccounts();
