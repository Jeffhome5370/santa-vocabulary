import { WORDS } from './data.js';
import { STORAGE_KEY, emptyState, shuffle, getProgress, recordAnswer, toggleStar, matchesFilter, getStats, selectQuizWords, createQuestion, validateState, mergeStates, loadState } from './engine.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
let state = emptyState(), allowSave = true, storageWarning = false;
let filter = 'all', order = WORDS.map(word => word.id), cards = [], position = 0, flipped = false, currentView = 'cards';
let quiz = null, toastTimer;

function toast(message, duration = 4500) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, duration);
}
function save() {
  if (!allowSave) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch {
    if (!storageWarning) toast('瀏覽器無法儲存進度。請到學習紀錄匯出備份。', 8000);
    storageWarning = true;
  }
}
try { state = loadState(localStorage, WORDS); }
catch {
  allowSave = false;
  setTimeout(() => toast('原有進度無法讀取，目前以暫存模式練習。請匯出備份或匯入有效檔案；重設後可恢復儲存。', 12000), 0);
}
function renderStats() {
  const stats = getStats(WORDS, state);
  $('#stats').innerHTML = `<div class="stat"><span class="stat-label">單字總數</span><strong>${stats.total}</strong><small>個單字</small></div><div class="stat"><span class="stat-label">已熟悉</span><strong>${stats.known}</strong><small>/ ${stats.total}</small><span class="stat-bar"><i style="width:${stats.known / stats.total * 100}%"></i></span></div><div class="stat weak"><span class="stat-label">待加強</span><strong>${stats.weak}</strong><small>個單字</small></div><div class="stat"><span class="stat-label">測驗正確率</span><strong>${stats.accuracy === null ? '—' : `${stats.accuracy}%`}</strong></div>`;
  $('#all-count').textContent = WORDS.length;
  $('#weak-count').textContent = stats.weak;
  $('#deck-count').textContent = `${WORDS.length} 個單字`;
}
function statusBadge(word) {
  const p = getProgress(state, word.id);
  return p.reviews === 0 ? { text: '尚未複習', className: '' } : p.lastCorrect ? { text: '已熟悉', className: 'known' } : { text: '待加強', className: 'weak' };
}
function refreshCards(preferredId) {
  const map = new Map(WORDS.map(word => [word.id, word]));
  cards = order.map(id => map.get(id)).filter(word => matchesFilter(word, state, filter));
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
    const messages = { weak: ['目前沒有待加強的單字', '標記「還不熟」或在測驗中答錯後，就會出現在這裡。'], new: ['全部都複習過了！', '可以切換「待加強」或做一回選擇題。'], starred: ['收藏還是空的', '點字卡右上角的星號，把想多看幾次的單字留下來。'], all: ['沒有單字', '請重新載入網頁。'] };
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
  $('#back-word').textContent = enFront ? word.meaning : word.word;
  $('#back-word').lang = enFront ? 'zh-Hant' : 'en';
  $('#back-secondary').textContent = enFront ? `${word.word} · ${word.pos}` : `${word.meaning} · ${word.pos}`;
  $('#back-example').innerHTML = `<span lang="en">${escape(word.example)}</span><em>${escape(word.translation)}</em>`;
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
  recordAnswer(state, word.id, correct, 'card');
  save(); renderStats();
  if (matchesFilter(word, state, filter)) position = (position + 1) % cards.length;
  refreshCards();
  toast(correct ? '已標記熟悉，繼續下一張。' : '已加入待加強，下次優先練習。', 2200);
}
function setView(view) {
  if (!['cards', 'quiz', 'library', 'progress'].includes(view)) return;
  currentView = view;
  $$('.view').forEach(section => { section.hidden = section.id !== `${view}-view`; });
  $$('.nav-item').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  const headings = { cards: ['每天，記住一點', '翻一張卡，讓一個單字變熟悉。'], quiz: ['把記憶，練成直覺', '每回 10 題，讓熟悉變得更確定。'], library: ['你的單字，一頁收藏', '找到一個詞，再多認識它一點。'], progress: ['每一次，都有累積', '回頭看看，你已經走了多遠。'] };
  $('#page-title').innerHTML = `${headings[view][0]}<span class="orange">。</span>`;
  $('#page-description').textContent = headings[view][1];
  if (view === 'cards') refreshCards(cards[position]?.id);
  if (view === 'library') renderLibrary();
  if (view === 'progress') renderHistory();
}
function startQuiz() {
  quiz = { words: selectQuizWords(WORDS, state), direction: $('#quiz-direction').value, index: 0, answers: [], question: null, answered: false };
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
  recordAnswer(state, question.word.id, correct, 'quiz');
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
  $('#quiz-result').innerHTML = `<p class="eyebrow">PRACTICE MAKES PROGRESS</p><h2>這一回，你又前進了一點。</h2><div class="result-number">${correct}<small> / ${answers.length}</small></div><p class="muted">正確率 ${Math.round(correct / answers.length * 100)}%${answers.length < quiz.words.length ? ' · 本回提早結束，僅計已作答題目' : ''}</p><div class="result-review">${answers.map(answer => `<div class="result-row${answer.correct ? '' : ' wrong'}"><span>${answer.correct ? '✓' : '↻'} <strong>${escape(answer.word.word)}</strong></span><span>${escape(answer.word.meaning)}</span></div>`).join('')}</div><div class="result-actions"><button class="button primary" data-action="again">再練 10 題 →</button><button class="button outline" data-action="weak">翻卡複習待加強</button></div><p class="fine-print">結果已記錄在此瀏覽器；可到學習紀錄匯出備份。</p>`;
  quiz = null;
}
function renderLibrary() {
  const query = $('#search').value.trim().toLowerCase();
  const found = WORDS.filter(word => `${word.word} ${word.meaning} ${word.note}`.toLowerCase().includes(query));
  $('#search-count').textContent = `${found.length} 個單字`;
  $('#word-list').innerHTML = found.length ? found.map(word => {
    const p = getProgress(state, word.id), badge = statusBadge(word);
    return `<article class="word-row"><span class="word-number">${String(word.id).padStart(2, '0')}</span><div><h3 lang="en">${escape(word.word)}<small>${escape(word.pos)}</small></h3><p>${escape(word.meaning)}</p><details><summary>例句與用法</summary><p class="example-line" lang="en">${escape(word.example)}</p><p>${escape(word.translation)}</p>${word.note ? `<span class="card-note">${escape(word.note)}</span>` : ''}</details></div><div class="row-actions"><span class="badge ${badge.className}">${badge.text}</span><button class="star-button" data-star="${word.id}" aria-label="${p.starred ? '取消收藏' : '收藏'} ${escape(word.word)}" aria-pressed="${p.starred}">${p.starred ? '★' : '☆'}</button></div></article>`;
  }).join('') : '<div class="empty"><strong>沒有找到這個單字</strong>試試其他英文或中文關鍵字。</div>';
}
const dateLabel = at => /^\d{4}-\d{2}-\d{2}$/.test(at) ? at : new Date(at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
function renderHistory() {
  $('#recent-history').innerHTML = state.history.length ? state.history.slice(0, 30).map(entry => {
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
  const history = state.history.map(entry => `| ${new Date(entry.at).toLocaleString('zh-TW')} | ${WORDS.find(w => w.id === entry.wordId).word} | ${entry.source === 'quiz' ? '四選一' : '翻字卡'} | ${entry.correct ? (entry.source === 'quiz' ? '答對' : '已熟悉') : '待加強'} |`);
  download(`santa-review-${today()}.md`, `# Santa 單字複習紀錄\n\n匯出日期：${today()}\n\n已複習 ${stats.reviewed}／${stats.total} 筆；待加強 ${stats.weak} 筆。\n\n| 單字 | 意思 | 複習次數 | 最近狀態 | 最近複習 |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\n## 最近紀錄（最多 500 筆）\n\n| 日期 | 單字 | 題型 | 結果 |\n| --- | --- | --- | --- |\n${history.join('\n')}\n`, 'text/markdown;charset=utf-8');
}

$$('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$$('[data-filter]').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.filter; position = 0;
  $$('[data-filter]').forEach(item => item.classList.toggle('selected', item.dataset.filter === filter));
  refreshCards();
}));
$('#flashcard').addEventListener('click', flipCard);
$('#previous').addEventListener('click', () => moveCard(-1));
$('#next').addEventListener('click', () => moveCard(1));
$('#mark-known').addEventListener('click', () => markCard(true));
$('#mark-weak').addEventListener('click', () => markCard(false));
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
  if (!('speechSynthesis' in window)) { toast('此瀏覽器不支援朗讀功能。'); return; }
  if (!cards.length) return;
  speechSynthesis.cancel();
  const speech = new SpeechSynthesisUtterance(cards[position].word); speech.lang = 'en-US'; speech.rate = .85;
  speech.onerror = () => toast('目前無法播放發音，請稍後再試。');
  speechSynthesis.speak(speech);
});
document.addEventListener('keydown', event => {
  if (currentView !== 'cards' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target;
  if (target.closest('input,select,textarea,summary,a') || (target.closest('button') && target.id !== 'flashcard')) return;
  if (event.code === 'Space') { event.preventDefault(); flipCard(); }
  else if (event.key === 'ArrowLeft') { event.preventDefault(); moveCard(-1); }
  else if (event.key === 'ArrowRight') { event.preventDefault(); moveCard(1); }
});
$('#start-quiz').addEventListener('click', startQuiz);
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
  if (action === 'weak') {
    filter = 'weak'; position = 0;
    $$('[data-filter]').forEach(button => button.classList.toggle('selected', button.dataset.filter === filter));
    setView('cards');
  }
});
$('#search').addEventListener('input', renderLibrary);
$('#word-list').addEventListener('click', event => {
  const button = event.target.closest('[data-star]');
  if (button) { toggleStar(state, Number(button.dataset.star)); save(); renderLibrary(); }
});
$('#export-json').addEventListener('click', () => download(`santa-progress-${today()}.json`, JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2), 'application/json'));
$('#export-md').addEventListener('click', exportMarkdown);
$('#import-progress').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('檔案超過 2 MB，請選擇有效的進度備份。');
    const incoming = validateState(JSON.parse(await file.text()), WORDS);
    state = mergeStates(state, incoming, WORDS); allowSave = true; save();
    renderStats(); renderHistory(); refreshCards();
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
  state = emptyState(); allowSave = true; save(); renderStats(); renderHistory(); refreshCards();
  quiz = null; $('#quiz-active').hidden = true; $('#quiz-result').hidden = true; $('#quiz-setup').hidden = false;
  $('#reset-confirmation').hidden = true; $('#reset-progress').hidden = false;
  $('#reset-progress').focus();
  toast('學習進度已重設。');
});
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY) return;
  try { state = loadState(localStorage, WORDS); renderStats(); if (currentView === 'cards') refreshCards(); if (currentView === 'library') renderLibrary(); if (currentView === 'progress') renderHistory(); }
  catch { toast('其他分頁的進度無法讀取，目前的練習仍保留。'); }
});
renderStats(); refreshCards();
