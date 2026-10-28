import { visibleHistory } from './engine.js';

export const taipeiDay = at => /^\d{4}-\d{2}-\d{2}$/.test(at)
  ? at : new Date(at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });

// The same word counts once per Taipei day, regardless of repeated card/quiz answers.
export function dailyKnownCount(words, state, day = taipeiDay(new Date().toISOString())) {
  return new Set(visibleHistory(words, state)
    .filter(entry => entry.correct && taipeiDay(entry.at) === day)
    .map(entry => entry.wordId)).size;
}
