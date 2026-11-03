import test from 'node:test';
import assert from 'node:assert/strict';
import { createParadeeEngine, toMisaki, tokenize } from '../dist/paradee.js';
import { createSpeechPlayer } from '../dist/speech.js';

test('eSpeak phonemes are rewritten in misaki spelling for American and British voices', () => {
  assert.equal(toMisaki('hˈaɪ ðɛɹ'), 'hˈI ðɛɹ');
  assert.equal(toMisaki('ɡˈoʊ'), 'ɡˈO');
  assert.equal(toMisaki('ɡˈəʊ', true), 'ɡˈQ');
  assert.equal(toMisaki('wˈɔːɾɚ'), 'wˈɔTəɹ');
});

test('tokens follow the Python package: unknown symbols skipped, padded, at most 510 phonemes', () => {
  assert.deepEqual([...tokenize('ab?', { a: 5, b: 6 })], [0n, 5n, 6n, 0n]);
  assert.equal(tokenize('a'.repeat(600), { a: 1 }).length, 512);
});

function fakeEngine({ fail = false } = {}) {
  const calls = [], states = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  class KokoroTTS {
    constructor(_, tokenizer) { this.tokenizer = tokenizer; }
    async generate(text, options) { return this.generate_from_ids(this.tokenizer(text === 'hello' ? 'hɛlˈoʊ' : 'ɡˈəʊ').input_ids, options); }
  }
  class Tensor { constructor(type, data) { this.type = type; this.data = data; } }
  const ort = {
    env: { wasm: {} }, Tensor,
    InferenceSession: { async create() {
      return { async run(feed) {
        calls.push({ ids: [...feed.input_ids.data], voice: Number(feed.voice.data[0]), speed: feed.speed.data[0] });
        await gate;
        return { waveform: { data: [0.5, -0.5] } };
      } };
    } },
  };
  const vocab = Object.fromEntries([...'hɛlˈOɡQ'].map((symbol, index) => [symbol, index + 1]));
  const engine = createParadeeEngine({
    importModule: async url => url.includes('kokoro') ? { KokoroTTS } : ort,
    fetch: async url => fail ? { ok: false, status: 404 } : { ok: true, json: async () => ({ vocab, voices: ['af_heart', 'bf_isabella', 'am_puck', 'bm_fable'] }), arrayBuffer: async () => new ArrayBuffer(1), url },
    caches: null,
    onChange: state => states.push(state),
  });
  return { engine, calls, states, release };
}

test('the engine loads once, runs one generation at a time and reuses clips', async () => {
  const { engine, calls, states, release } = fakeEngine();
  const first = engine.synthesize('hello', 'af_heart', 1);
  const second = engine.synthesize('go', 'bm_fable', 0.95);
  assert.equal(engine.synthesize('hello', 'af_heart', 1), first);
  release();
  assert.deepEqual([...await first], [0.5, -0.5]);
  await second;
  assert.deepEqual(states, ['loading', 'ready']);
  assert.deepEqual(calls.map(call => call.voice), [0, 3]);
  assert.equal(calls[1].speed, Float32Array.of(0.95)[0]);
  assert.deepEqual(calls[0].ids, [0n, 1n, 2n, 3n, 4n, 5n, 0n]); // hɛlˈoʊ -> hɛlˈO
  assert.deepEqual(calls[1].ids, [0n, 6n, 4n, 7n, 0n]); // British ɡˈəʊ -> ɡˈQ
});

test('a failed download marks the engine failed instead of retrying on every click', async () => {
  const { engine, states } = fakeEngine({ fail: true });
  await assert.rejects(engine.synthesize('hello'));
  assert.equal(engine.state(), 'failed');
  assert.deepEqual(states, ['loading', 'failed']);
});

function playerSetup({ state = 'ready', samples = Promise.resolve(Float32Array.of(0.1)), voiceURI = '', audioState = 'running', resumeFails = false, navigator } = {}) {
  const spoken = [], played = [], errors = [], synthesized = [];
  let unlocks = 0, resumes = 0;
  let engineState = state, loads = 0;
  const engine = {
    state: () => engineState,
    load: () => { loads++; engineState = 'loading'; return new Promise(() => {}); },
    synthesize: (text, voice, speed) => { synthesized.push({ text, voice, speed }); return samples; },
  };
  const synth = { getVoices: () => [], cancel() {}, speak: utterance => spoken.push(utterance.text), addEventListener() {}, removeEventListener() {} };
  class AudioContext {
    constructor() { this.state = audioState; this.destination = {}; }
    resume() { resumes++; if (resumeFails) return Promise.reject(new Error('blocked')); this.state = 'running'; return Promise.resolve(); }
    createBuffer() { return { copyToChannel(data) { this.data = data; } }; }
    createBufferSource() { return { connect() {}, start() { if (this.buffer.data) played.push(this.buffer.data); else unlocks++; }, stop() {} }; }
  }
  const storage = { getItem: () => JSON.stringify({ voiceURI }), setItem() {} };
  const player = createSpeechPlayer({ synth, Utterance: class { constructor(text) { this.text = text; } }, AudioContext, storage, navigator,
    paradee: () => engine, onError: message => errors.push(message) });
  return { player, spoken, played, errors, synthesized, loads: () => loads, unlocks: () => unlocks, resumes: () => resumes };
}

test('Paradee is the default voice once loaded and receives the chosen speed', async () => {
  const env = playerSetup();
  env.player.setPreferences({ rate: 0.85 });
  assert.equal(env.player.speak('resilient'), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(env.synthesized, [{ text: 'resilient', voice: 'af_heart', speed: 0.85 }]);
  assert.equal(env.played.length, 1);
  assert.deepEqual(env.spoken, []);
});

test('a mobile audio context is unlocked and resumed during the click', async () => {
  const env = playerSetup({ audioState: 'interrupted' });
  env.player.speak('resilient');
  assert.equal(env.unlocks(), 1);
  assert.equal(env.resumes(), 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.played.length, 1);
  assert.deepEqual(env.spoken, []);
});

test('Paradee selects the iPhone playback audio session before playing', async () => {
  const audioSession = { type: 'ambient' };
  const env = playerSetup({ navigator: { audioSession } });
  env.player.speak('resilient');
  assert.equal(audioSession.type, 'playback');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.played.length, 1);
});

test('a blocked mobile audio context uses the device voice with a notice', async () => {
  const env = playerSetup({ audioState: 'suspended', resumeFails: true });
  env.player.speak('adequate');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(env.spoken, ['adequate']);
  assert.deepEqual(env.synthesized, []);
  assert.equal(env.errors.length, 1);
  assert.equal(env.player.paradeeState(), 'playback-failed');
  env.player.speak('resilient');
  assert.deepEqual(env.spoken, ['adequate', 'resilient']);
  assert.equal(env.resumes(), 1);
});

test('while the model downloads the device voice speaks instead of staying silent', () => {
  const env = playerSetup({ state: 'idle', voiceURI: 'paradee:bf_isabella' });
  env.player.speak('adequate');
  assert.equal(env.loads(), 1);
  assert.deepEqual(env.spoken, ['adequate']);
  assert.deepEqual(env.synthesized, []);
});

test('choosing a device voice skips Paradee entirely', () => {
  const env = playerSetup({ voiceURI: 'system' });
  env.player.speak('take over');
  env.player.preload();
  assert.deepEqual(env.spoken, ['take over']);
  assert.equal(env.loads(), 0);
});

test('a generation failure falls back to the device voice with one notice', async () => {
  const env = playerSetup({ samples: Promise.reject(new Error('broken')) });
  env.player.speak('first');
  await new Promise(resolve => setImmediate(resolve));
  env.player.speak('second');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(env.spoken, ['first', 'second']);
  assert.equal(env.errors.length, 1);
});

test('a newer click discards an older clip that finishes later', async () => {
  let finish;
  const env = playerSetup({ samples: new Promise(resolve => { finish = resolve; }) });
  env.player.speak('old');
  env.player.speak('new');
  finish(Float32Array.of(0.2));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.played.length, 1);
});
