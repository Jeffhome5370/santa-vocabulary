import { visibleHistory, loadState } from './engine.js';

// Guest visitors start without the shared starter deck. Keep their own additions
// and saved reviews intact; account caches and cloud libraries are loaded separately.
export function loadGuestState(storage, words) {
  return { ...loadState(storage, words), includeBaseWords: false };
}

export const taipeiDay = at => /^\d{4}-\d{2}-\d{2}$/.test(at)
  ? at : new Date(at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });

// The same word counts once per Taipei day, regardless of repeated card/quiz answers.
export function dailyKnownCount(words, state, day = taipeiDay(new Date().toISOString())) {
  return new Set(visibleHistory(words, state)
    .filter(entry => entry.correct && taipeiDay(entry.at) === day)
    .map(entry => entry.wordId)).size;
}
