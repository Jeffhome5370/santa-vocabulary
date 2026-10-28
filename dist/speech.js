const PREFERENCES_KEY = 'santa-vocabulary.speech.v1';
const RATES = [0.85, 0.95, 1, 1.1];
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

export function createSpeechPlayer(options = {}) {
  const synth = options.synth ?? globalThis.speechSynthesis;
  const Utterance = options.Utterance ?? globalThis.SpeechSynthesisUtterance;
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
  let active = null;
  const available = !!synth && typeof Utterance === 'function';
  const voices = () => { try { return (synth?.getVoices() || []).filter(isEnglish); } catch { return []; } };
  const notify = () => listeners.forEach(listener => listener());
  synth?.addEventListener?.('voiceschanged', notify);
  voices(); // Prime asynchronously loaded voice lists without speaking.
  const cancel = () => {
    if (active) { active.onerror = null; active.onend = null; active = null; }
    synth?.cancel();
  };
  return {
    available, voices,
    preferences: () => ({ ...preferences }),
    selectedVoice: () => chooseEnglishVoice(voices(), preferences.voiceURI),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setPreferences(patch) {
      if (typeof patch.voiceURI === 'string') preferences.voiceURI = patch.voiceURI;
      if (RATES.includes(patch.rate)) preferences.rate = patch.rate;
      try { storage?.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); } catch { /* Continue with session-only preferences. */ }
      notify();
    },
    speak(text) {
      if (!available) { onError('此瀏覽器不支援朗讀，請換用支援語音的瀏覽器。'); return false; }
      text = String(text || '').trim().replace(/\s+/g, ' ');
      if (!text) return false;
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
    },
    dispose() { cancel(); synth?.removeEventListener?.('voiceschanged', notify); listeners.clear(); },
  };
}

export function mountSpeechSettings(player, { voice, rate, status, preview }) {
  function render() {
    const preferences = player.preferences();
    const choices = player.voices();
    voice.replaceChildren();
    const automatic = document.createElement('option');
    automatic.value = ''; automatic.textContent = '自動選擇（優先自然英文語音）'; voice.append(automatic);
    for (const item of choices) {
      const option = document.createElement('option');
      option.value = item.voiceURI; option.textContent = `${item.name} · ${item.lang}`;
      voice.append(option);
    }
    voice.value = choices.some(item => item.voiceURI === preferences.voiceURI) ? preferences.voiceURI : '';
    rate.value = String(preferences.rate);
    voice.disabled = !player.available || !choices.length;
    rate.disabled = preview.disabled = !player.available;
    const selected = player.selectedVoice();
    status.textContent = !player.available ? '此瀏覽器不支援朗讀。' : selected
      ? `目前語音：${selected.name}。可換一個聲音試聽；語音選擇會保存在此裝置。`
      : '語音清單尚未提供，會先使用系統預設英文語音。';
  }
  voice.addEventListener('change', () => player.setPreferences({ voiceURI: voice.value }));
  rate.addEventListener('change', () => player.setPreferences({ rate: Number(rate.value) }));
  preview.addEventListener('click', () => player.speak('A little practice every day makes learning feel natural.'));
  player.subscribe(render);
  render();
}
