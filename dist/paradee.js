// Paradee 1.2 (Apache-2.0, https://github.com/sahilmahendrakar/paradee): an 8.5 MB English voice
// that runs in the browser. kokoro-js supplies eSpeak phonemes; ONNX Runtime runs the model.
const MODEL_BASE = 'https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.2/resolve/v1.2/';
const MODEL_URL = `${MODEL_BASE}onnx/paradee_int8.onnx`;
const CONFIG_URL = `${MODEL_BASE}config.json`;
const KOKORO_URL = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';
const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
const CACHE_NAME = 'santa-paradee-v1.2';
const MAX_PHONEMES = 510;
const MAX_CLIPS = 60;
export const SAMPLE_RATE = 24000;
// Order matches the model's voice input (config.json "voices").
export const PARADEE_VOICES = [
  { id: 'af_heart', label: '美式女聲' },
  { id: 'bf_isabella', label: '英式女聲' },
  { id: 'am_puck', label: '美式男聲' },
  { id: 'bm_fable', label: '英式男聲' },
];

// Paradee learned misaki's phoneme spelling; this is the repository's web/misaki.js conversion from eSpeak.
const E2M = [
  ['ʔˌn̩', 'ʔn'], ['ʔn̩', 'ʔn'], ['aɪ', 'I'], ['aʊ', 'W'], ['dʒ', 'ʤ'], ['eɪ', 'A'], ['e', 'A'], ['tʃ', 'ʧ'],
  ['ɔɪ', 'Y'], ['ʲo', 'jo'], ['ʲə', 'jə'], ['ʲ', ''], ['ɚ', 'əɹ'], ['r', 'ɹ'], ['x', 'k'], ['ç', 'k'], ['ɬ', 'l'], ['̃', ''],
];
export function toMisaki(ps, british = false) {
  if (british) ps = ps.split('eə').join('ɛː');
  for (const [a, b] of E2M) ps = ps.split(a).join(b);
  ps = ps.replace(/(\S)̩/gu, 'ᵊ$1').replace(/̩/g, '');
  ps = ps.replace(/əl(?=[\s;:,.!?—…"“”()]|$)/gu, 'ᵊl');
  ps = british ? ps.replace(/ɐ(?!n?(?:[\s;:,.!?—…"“”()]|$))/gu, 'ə')
    : ps.replace(/ɐ(?![\s;:,.!?—…"“”()]|$)/gu, 'ə');
  if (british) {
    ps = ps.split('iə').join('ɪə').split('əʊ').join('Q');
    ps = ps.replace(/(^|\s)ðɪ(?=\s|$)/gu, '$1ði');
  } else {
    ps = ps.split('oʊ').join('O').split('ɜːɹ').join('ɜɹ').split('ɜː').join('ɜɹ').split('ɪə').join('iə').split('ː').join('');
  }
  ps = ps.split('o').join('ɔ');
  return ps.split('ɾ').join('T').split('ʔ').join('t');
}

// Same as the Python package: unknown symbols are skipped and a 0 pad surrounds at most 510 ids.
export function tokenize(phonemes, vocab) {
  const ids = [];
  for (const symbol of phonemes) if (symbol in vocab && ids.length < MAX_PHONEMES) ids.push(vocab[symbol]);
  return BigInt64Array.from([0, ...ids, 0], BigInt);
}

export function paradeeSupported(scope = globalThis) {
  return typeof scope.WebAssembly === 'object' && typeof (scope.AudioContext || scope.webkitAudioContext) === 'function';
}

export function createParadeeEngine(options = {}) {
  const importModule = options.importModule ?? (url => import(url));
  const fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args));
  const cacheStorage = options.caches ?? globalThis.caches;
  const onChange = options.onChange || (() => {});
  let state = 'idle', loading = null, runQueue = Promise.resolve();
  const clips = new Map();
  const setState = next => { state = next; onChange(state); };

  // The model is stored under its pinned URL so later visits load it without downloading again.
  async function download(url) {
    let cache = null;
    try { cache = await cacheStorage?.open(CACHE_NAME); } catch { /* Private windows may block the Cache API. */ }
    const hit = await cache?.match(url).catch(() => null);
    if (hit) return hit;
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
    try { await cache?.put(url, response.clone()); } catch { /* A full cache only costs a repeat download. */ }
    return response;
  }

  async function initialize() {
    const [{ KokoroTTS }, ort, config, model] = await Promise.all([
      importModule(KOKORO_URL), importModule(`${ORT_BASE}ort.wasm.min.mjs`),
      download(CONFIG_URL).then(response => response.json()), download(MODEL_URL).then(response => response.arrayBuffer()),
    ]);
    ort.env.wasm.wasmPaths = ORT_BASE;
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'] });
    let british = false;
    const tts = new KokoroTTS(null, phonemes => ({ input_ids: tokenize(toMisaki(phonemes, british), config.vocab) }));
    tts.generate_from_ids = async (ids, { voice, speed }) => {
      const { waveform } = await session.run({
        input_ids: new ort.Tensor('int64', ids, [1, ids.length]),
        speed: new ort.Tensor('float32', Float32Array.of(speed), [1]),
        voice: new ort.Tensor('int64', BigInt64Array.of(BigInt(config.voices.indexOf(voice))), [1]),
      });
      return Float32Array.from(waveform.data);
    };
    return { generate(text, voice, speed) { british = voice.startsWith('b'); return tts.generate(text, { voice, speed }); } };
  }

  function load() {
    if (!loading) {
      setState('loading');
      loading = initialize().then(tts => { setState('ready'); return tts; }, error => { setState('failed'); throw error; });
    }
    return loading;
  }

  return {
    state: () => state,
    load,
    // Runs one generation at a time; onnxruntime-web rejects overlapping runs on one session.
    synthesize(text, voice = 'af_heart', speed = 1) {
      if (!PARADEE_VOICES.some(item => item.id === voice)) voice = 'af_heart';
      const key = `${voice}|${speed}|${text}`;
      if (clips.has(key)) { const clip = clips.get(key); clips.delete(key); clips.set(key, clip); return clip; }
      const clip = runQueue.then(() => load()).then(tts => tts.generate(text, voice, speed));
      runQueue = clip.catch(() => {});
      clips.set(key, clip);
      clip.catch(() => clips.delete(key));
      if (clips.size > MAX_CLIPS) clips.delete(clips.keys().next().value);
      return clip;
    },
  };
}
