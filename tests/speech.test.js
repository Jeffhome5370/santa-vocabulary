import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseEnglishVoice, createSpeechPlayer } from '../dist/speech.js';

const basic = { voiceURI: 'basic', name: 'English Desktop', lang: 'en-US', default: true };
const natural = { voiceURI: 'natural', name: 'English Natural', lang: 'en-GB' };
const chinese = { voiceURI: 'chinese', name: 'Chinese Natural', lang: 'zh-TW' };
function setup(saved = null) {
  let voices = [], written, handler;
  const errors = [], spoken = [];
  const synth = { paused: false, getVoices: () => voices, cancel() {}, speak: utterance => spoken.push(utterance),
    addEventListener: (_, callback) => { handler = callback; }, removeEventListener() {} };
  const storage = { getItem: () => saved, setItem: (_, value) => { written = JSON.parse(value); } };
  const player = createSpeechPlayer({ synth, Utterance: class { constructor(text) { this.text = text; } }, storage, onError: message => errors.push(message) });
  return { player, spoken, errors, synth, setVoices(value) { voices = value; handler(); }, saved: () => written };
}

test('automatic voice selection favors natural English and honors an explicit English voice', () => {
  assert.equal(chooseEnglishVoice([chinese, basic, natural]), natural);
  assert.equal(chooseEnglishVoice([basic, natural], 'basic'), basic);
  assert.equal(chooseEnglishVoice([chinese]), null);
  assert.equal(chooseEnglishVoice([basic], 'missing'), basic);
});

test('late voice loading updates subscribers and the next word or sentence uses preferences', () => {
  const env = setup(); let updates = 0;
  env.player.subscribe(() => updates++);
  env.player.speak('innovative'); assert.equal(env.spoken[0].lang, 'en-US');
  env.setVoices([basic, natural]); assert.equal(updates, 1);
  env.player.speak('The team proposed an innovative solution.');
  assert.equal(env.spoken[1].voice, natural); assert.equal(env.spoken[1].lang, 'en-GB');
  assert.equal(env.spoken[1].rate, 1);
  env.player.setPreferences({ voiceURI: 'basic', rate: 0.95 });
  env.player.speak('aspect');
  assert.equal(env.spoken[2].voice, basic); assert.equal(env.spoken[2].rate, 0.95);
  assert.deepEqual(env.saved(), { voiceURI: 'basic', rate: 0.95 });
});

test('rapid clicks interrupt speech without spurious playback errors', () => {
  const env = setup(); env.player.speak('first'); const first = env.spoken[0];
  env.player.speak('second'); assert.equal(first.onerror, null);
  env.spoken[1].onerror({ error: 'interrupted' }); assert.equal(env.errors.length, 0);
  env.player.speak('third'); env.spoken[2].onerror({ error: 'audio-busy' });
  assert.equal(env.errors.length, 1);
});

test('invalid stored preferences cannot break playback and storage failures remain nonfatal', () => {
  const env = setup('{broken'); env.setVoices([basic]); env.player.speak('test');
  assert.equal(env.spoken[0].rate, 1);
  env.player.setPreferences({ rate: 99 }); assert.equal(env.player.preferences().rate, 1);
  const player = createSpeechPlayer({ synth: env.synth, Utterance: class {}, storage: { getItem() { throw Error(); }, setItem() { throw Error(); } } });
  assert.doesNotThrow(() => player.setPreferences({ rate: 0.95 }));
});
