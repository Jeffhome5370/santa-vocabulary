import { createParadeeEngine, paradeeSupported, PARADEE_VOICES, SAMPLE_RATE } from './paradee.js';

const PREFERENCES_KEY = 'santa-vocabulary.speech.v1';
const RATES = [0.85, 0.95, 1, 1.1];
// '' picks Paradee when the browser can run it; SYSTEM_AUTO keeps the device's automatic English voice.
const SYSTEM_AUTO = 'system';
const PARADEE_PREFIX = 'paradee:';
const isEnglish = voice => /^en(?:[-_]|$)/i.test(voice.lang || '');

export function chooseEnglishVoice(voices, preferredURI = '') {
  const english = voices.filter(isEnglish);
  const preferred = english.find(voice => voice.voiceURI === preferredURI);
  if (preferred) return preferred;
  const score = voice => {
    // Names are hints supplied by the OS, rather than a promise of audio quality.
    const quality = /natural|neural|premium|enhanced/i.test(voice.name) ? 1000 : /google/i.test(voice.name) ? 300 : 0;
    return quality + (/^en[-_]US$/i.test(voice.lang) ? 40 : 0) + (voice.default ? 10 : 0);
  };
  return english.map((voice, index) => ({ voice, index, score: score(voice) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.voice || null;
}

const defaultParadee = scope => paradeeSupported(scope) ? createParadeeEngine : null;

export function createSpeechPlayer(options = {}) {
  const synth = options.synth ?? globalThis.speechSynthesis;
  const Utterance = options.Utterance ?? globalThis.SpeechSynthesisUtterance;
  const AudioContextClass = options.AudioContext ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;
  const onError = options.onError || (() => {});
  let storage;
  try { storage = options.storage ?? globalThis.localStorage; } catch { storage = null; }
  let preferences = { voiceURI: '', rate: 1 };
  try {
    const saved = JSON.parse(storage?.getItem(PREFERENCES_KEY) || '{}');
    if (typeof saved.voiceURI === 'string') preferences.voiceURI = saved.voiceURI;
    if (RATES.includes(saved.rate)) preferences.rate = saved.rate;
  } catch { /* A damaged preference never stops vocabulary loading. */ }
  const listeners = new Set();
  let active = null, source = null, context = null, generation = 0, warned = false, paradeeBlocked = false;
  const notify = () => listeners.forEach(listener => listener());
  const paradeeFactory = options.paradee === undefined ? defaultParadee(globalThis) : options.paradee;
  const paradee = paradeeFactory?.({ onChange: notify }) ?? null;
  const available = !!synth && typeof Utterance === 'function';
  const voices = () => { try { return (synth?.getVoices() || []).filter(isEnglish); } catch { return []; } };
  synth?.addEventListener?.('voiceschanged', notify);
  voices(); // Prime asynchronously loaded voice lists without speaking.
  const paradeeVoice = () => {
    if (!paradee) return null;
    if (preferences.voiceURI === '') return PARADEE_VOICES[0].id;
    const id = preferences.voiceURI.startsWith(PARADEE_PREFIX) ? preferences.voiceURI.slice(PARADEE_PREFIX.length) : '';
    return PARADEE_VOICES.some(voice => voice.id === id) ? id : null;
  };
  const cancel = () => {
    generation++;
    if (source) { source.onended = null; try { source.stop(); } catch { /* Already finished. */ } source = null; }
    if (active) { active.onerror = null; active.onend = null; active = null; }
    synth?.cancel();
  };
  // Start and resume audio while the click still has mobile user activation.
  const audioContext = () => {
    if (!context && AudioContextClass) { try { context = new AudioContextClass(); } catch { context = null; } }
    if (!context) return null;
    if (context.state === 'running') return { audio: context, ready: Promise.resolve(true) };
    try {
      // A silent source unlocks Web Audio on iOS before model generation finishes.
      const resumed = context.resume?.();
      const silence = context.createBufferSource();
      silence.buffer = context.createBuffer(1, 1, context.sampleRate || SAMPLE_RATE);
      silence.connect(context.destination);
      silence.start();
      const ready = Promise.resolve(resumed).then(() => context.state === 'running', () => false);
      return { audio: context, ready };
    } catch { return { audio: context, ready: Promise.resolve(false) }; }
  };
  function speakSystem(text) {
    if (!available) { onError('此瀏覽器不支援朗讀，請換用支援語音的瀏覽器。'); return false; }
    try {
      cancel();
      const utterance = new Utterance(text);
      const voice = chooseEnglishVoice(voices(), preferences.voiceURI);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || 'en-US';
      utterance.rate = preferences.rate;
      utterance.pitch = 1;
      utterance.volume = 1;
      active = utterance;
      utterance.onend = () => { if (active === utterance) active = null; };
      utterance.onerror = event => {
        if (active !== utterance) return;
        active = null;
        if (!['canceled', 'interrupted'].includes(event.error)) onError('目前無法播放發音，請換個語音或稍後再試。');
      };
      if (synth.paused) synth.resume?.();
      synth.speak(utterance);
      return true;
    } catch {
      active = null;
      onError('目前無法播放發音，請換個語音或稍後再試。');
      return false;
    }
  }
  // Downloads the natural voice ahead of the first click; failures leave the device voice in use.
  const preload = () => { if (paradeeVoice() && paradee.state() === 'idle') paradee.load().catch(() => {}); };
  const waitForAudio = ready => {
    let timer;
    return Promise.race([ready, new Promise(resolve => { timer = setTimeout(() => resolve(false), 2500); })])
      .finally(() => clearTimeout(timer));
  };
  function speakParadee(text, voice, output) {
    cancel();
    const token = generation;
    const fallback = () => {
      if (token !== generation) return;
      paradeeBlocked = true;
      notify();
      if (!warned) { warned = true; onError('Paradee 在此裝置無法播放，已改用裝置語音；若沒聲音，請再點一次。'); }
      speakSystem(text);
    };
    waitForAudio(output.ready).then(ready => {
      if (token !== generation) return;
      if (!ready || output.audio.state !== 'running') { fallback(); return; }
      return paradee.synthesize(text, voice, preferences.rate).then(samples => {
        if (token !== generation) return;
        if (output.audio.state !== 'running') { fallback(); return; }
        const audio = output.audio;
        const buffer = audio.createBuffer(1, samples.length, SAMPLE_RATE);
        buffer.copyToChannel(samples, 0);
        const clip = audio.createBufferSource();
        clip.buffer = buffer;
        clip.connect(audio.destination);
        clip.onended = () => { if (source === clip) source = null; };
        source = clip;
        clip.start();
      });
    }).catch(fallback);
    return true;
  }
  return {
    available: available || !!paradee, voices,
    paradeeVoices: () => paradee ? PARADEE_VOICES : [],
    paradeeState: () => paradeeBlocked ? 'playback-failed' : paradee?.state() ?? 'unsupported',
    preferences: () => ({ ...preferences }),
    selectedVoice: () => chooseEnglishVoice(voices(), preferences.voiceURI),
    paradeeVoice,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setPreferences(patch) {
      if (typeof patch.voiceURI === 'string') { preferences.voiceURI = patch.voiceURI; paradeeBlocked = false; warned = false; }
      if (RATES.includes(patch.rate)) preferences.rate = patch.rate;
      try { storage?.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); } catch { /* Continue with session-only preferences. */ }
      preload();
      notify();
    },
    preload,
    speak(text) {
      text = String(text || '').trim().replace(/\s+/g, ' ');
      if (!text) return false;
      const voice = paradeeVoice();
      if (voice && !paradeeBlocked) {
        const output = audioContext();
        if (output && paradee.state() === 'ready') return speakParadee(text, voice, output);
        preload();
        if (!available && paradee.state() === 'loading') { onError('自然語音下載中，請稍候再按一次。'); return false; }
      }
      return speakSystem(text);
    },
    dispose() { cancel(); synth?.removeEventListener?.('voiceschanged', notify); listeners.clear(); context?.close?.(); },
  };
}

export function mountSpeechSettings(player, { voice, rate, status, preview }) {
  function option(value, label) {
    const item = document.createElement('option');
    item.value = value; item.textContent = label;
    return item;
  }
  function group(label, items) {
    const element = document.createElement('optgroup');
    element.label = label; element.append(...items);
    return element;
  }
  function render() {
    const preferences = player.preferences();
    const natural = player.paradeeVoices();
    const choices = player.voices();
    voice.replaceChildren();
    if (natural.length) {
      voice.append(option('', `自動選擇（Paradee 自然語音 · ${natural[0].label}）`));
      voice.append(group('Paradee 自然語音（首次約下載 20 MB）', natural.map(item => option(PARADEE_PREFIX + item.id, `${item.label} · ${item.id}`))));
      voice.append(option(SYSTEM_AUTO, '自動選擇裝置英文語音'));
    } else voice.append(option('', '自動選擇（優先自然英文語音）'));
    if (choices.length) voice.append(group('裝置內建語音', choices.map(item => option(item.voiceURI, `${item.name} · ${item.lang}`))));
    const values = [...voice.querySelectorAll('option')].map(item => item.value);
    voice.value = values.includes(preferences.voiceURI) ? preferences.voiceURI : '';
    rate.value = String(preferences.rate);
    voice.disabled = !player.available || voice.options.length < 2;
    rate.disabled = preview.disabled = !player.available;
    const naturalVoice = natural.find(item => item.id === player.paradeeVoice());
    const state = player.paradeeState();
    const selected = player.selectedVoice();
    const device = selected ? `裝置語音 ${selected.name}` : '系統預設英文語音';
    status.textContent = !player.available ? '此瀏覽器不支援朗讀。'
      : naturalVoice && state === 'ready' ? `目前語音：Paradee ${naturalVoice.label}，在此裝置上產生。語音選擇會保存在此裝置。`
      : naturalVoice && state === 'loading' ? `Paradee 自然語音下載中，完成前先使用${device}。`
      : naturalVoice && state === 'failed' ? `Paradee 自然語音無法載入，目前使用${device}。`
      : naturalVoice && state === 'playback-failed' ? `Paradee 在此裝置無法播放，目前使用${device}。若剛才沒有聲音，請再按一次。`
      : naturalVoice ? `已選擇 Paradee ${naturalVoice.label}，第一次朗讀時會下載語音。`
      : selected ? `目前語音：${selected.name}。可換一個聲音試聽；語音選擇會保存在此裝置。`
      : '語音清單尚未提供，會先使用系統預設英文語音。';
  }
  voice.addEventListener('change', () => player.setPreferences({ voiceURI: voice.value }));
  rate.addEventListener('change', () => player.setPreferences({ rate: Number(rate.value) }));
  preview.addEventListener('click', () => player.speak('A little practice every day makes learning feel natural.'));
  player.subscribe(render);
  render();
}
