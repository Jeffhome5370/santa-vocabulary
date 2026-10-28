import { visibleHistory, loadState } from './engine.js';

export const showEntry = ({ ready, signedIn, guestChosen, recovery, requested = false }) =>
  !ready || recovery || requested || (!signedIn && !guestChosen);

// Session refreshes should never move someone away from the word they are editing.
export function sessionView(previousUserId, nextUserId, event = '') {
  if (event === 'PASSWORD_RECOVERY') return 'account';
  return nextUserId && previousUserId !== nextUserId ? 'cards' : null;
}

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
