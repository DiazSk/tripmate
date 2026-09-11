import { pauseAfter, rateFor, splitForSpeech, type SpeakHandle } from "./storyVoice";

/**
 * The optional **natural voice** for Story mode — Kokoro-82M, running in the browser.
 *
 * The default narrator is the platform's own `speechSynthesis` (storyVoice.ts), which costs
 * nothing and starts instantly but sounds like an OS voice because it is one. This is the opt-in
 * upgrade: an 82M-parameter open-weight TTS model (Apache-2.0) that reads like a person. It is
 * free in the sense that matters here — no key, no quota, no per-use cost — and not free in the
 * sense that matters to a phone: **an 88MB model download the first time it is switched on**,
 * cached by the browser afterwards. That is why it is a toggle and not the default.
 *
 * Three decisions in here are load-bearing, and all three were measured rather than assumed.
 *
 * **1. Loaded from a CDN at runtime, never through the bundler.** `kokoro-js` pulls in
 * `@huggingface/transformers`, which pulls in `onnxruntime-web` — a package that embeds a WASM
 * runtime as bytes. This repository has already shipped a production build with no globe at all
 * because SWC's minifier re-encoded exactly that kind of embedded-WASM byte string into something
 * no browser could parse; see the `@spz-loader/core` note at the top of CLAUDE.md, and
 * `scripts/verify-build.mjs`, which exists because of it. Rather than hand the same class of
 * dependency to the same minifier, the module is fetched as a real ES module at the moment the
 * traveller asks for it: no entry in `package.json`, nothing in any chunk, zero build risk, and
 * nothing downloaded for the people who never turn it on. The costs are honest and both stated in
 * the UI — it needs the network the first time, and it pins a third-party CDN.
 *
 * **2. Synthesis runs in a worker, and that is not an optimisation.** The first version generated
 * on the main thread with a one-sentence prefetch, on the theory that a few hundred ms of
 * inference would hide inside the previous sentence's playback. Measured in Chromium on the WASM
 * backend, one sentence blocked the main thread for **16.9 seconds** — the map froze solid and a
 * Next press took 18.4s to take effect. Prefetching cannot help with that; the prefetch runs on
 * the same thread. So the model lives in a module worker and the main thread only ever receives
 * finished audio.
 *
 * **3. The worker comes from a Blob, not a file.** `new Worker(new URL("./x.worker.ts",
 * import.meta.url))` is the idiomatic form and it is the one thing not to do here: this repo's
 * MapLibre notes record Turbopack failing to serve exactly that URL, killing the worker on its own
 * import with no error anywhere and not one tile ever parsed. A Blob URL has no bundler
 * involvement at all.
 *
 * **What is shared with the browser voice, and why that matters.** The sentence splitting, the
 * pause lengths and the per-sentence rate all come from storyVoice.ts. That pacing is the larger
 * half of sounding like a story and it is engine-independent, so this provider inherits it rather
 * than reimplementing it — improving either one improves both.
 */

/** Pinned, not `@latest`: this URL is loaded at runtime, so a breaking upstream release would
 *  break the feature in a browser rather than in a build. */
const MODULE_URL = "https://esm.sh/kokoro-js@1.2.1";
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

/**
 * `q8` — 88MB, against 326MB for `fp32` and an audible quality drop at `q4`.
 *
 * The whole point of the toggle is that the voice is better; a quantisation that gave that back to
 * save bandwidth would leave the feature with no reason to exist.
 */
const DTYPE = "q8";

/**
 * The narrator. `af_heart` is the model's highest-graded voice (an "A" overall, against "C"s and
 * "D"s for most of the roster) and is warm rather than newsreaderly, which is what a trip story
 * wants. Kokoro ships ~50 voices; that is not a user-facing choice today and does not need to be.
 */
const VOICE = "af_heart";

/**
 * How long one sentence may take to synthesise before the beat gives up and lets the platform
 * voice read it instead.
 *
 * The WASM backend is an order of magnitude slower than WebGPU and varies hugely by device, so
 * this is the difference between "a slower narrator" and "a film that stops". 12s is past any
 * plausible WebGPU time and past a reasonable WASM time on current hardware; a device slower than
 * that gets the platform voice, mid-beat, and nobody has to watch a caption sit still. See
 * `speakOn` in storyVoice.ts for where that handover happens.
 */
const SYNTHESIS_DEADLINE_MS = 12_000;

export type NaturalVoiceStatus = "idle" | "loading" | "ready" | "unavailable";

/**
 * The worker's whole program.
 *
 * A string rather than a file — see decision 3 above. It holds the model and answers two messages:
 * `load` (import the CDN module, fetch the weights, report byte progress) and `generate` (one
 * sentence in, one Float32Array out).
 *
 * The audio is **copied** into a fresh array before being transferred. Under the multi-threaded
 * WASM backend the model's output can be backed by a SharedArrayBuffer, and a SharedArrayBuffer
 * cannot appear in a transfer list — posting it directly throws. The copy costs a few hundred KB
 * per sentence and makes the transfer legal on every backend.
 */
const WORKER_SOURCE = `
let ready = null;
self.onmessage = async (event) => {
  const msg = event.data;
  if (msg.type === "load") {
    ready = (async () => {
      const mod = await import(msg.moduleUrl);
      return mod.KokoroTTS.from_pretrained(msg.modelId, {
        dtype: msg.dtype,
        device: msg.device,
        progress_callback: (report) =>
          self.postMessage({
            type: "progress",
            file: report.file,
            loaded: report.loaded,
            total: report.total,
          }),
      });
    })();
    try {
      await ready;
      self.postMessage({ type: "ready" });
    } catch (err) {
      ready = null;
      self.postMessage({ type: "failed", message: String((err && err.message) || err) });
    }
    return;
  }
  if (msg.type === "generate") {
    try {
      const tts = await ready;
      const out = await tts.generate(msg.text, { voice: msg.voice, speed: msg.speed });
      const copy = new Float32Array(out.audio);
      self.postMessage(
        { type: "audio", id: msg.id, audio: copy, samplingRate: out.sampling_rate },
        [copy.buffer]
      );
    } catch (err) {
      self.postMessage({
        type: "audioFailed",
        id: msg.id,
        message: String((err && err.message) || err),
      });
    }
  }
};
`;

let worker: Worker | null = null;
let loading: Promise<boolean> | null = null;
let audioContext: AudioContext | null = null;
let nextRequestId = 0;
/** In-flight `generate` calls, keyed by the id sent to the worker. */
const pending = new Map<
  number,
  {
    resolve: (audio: { audio: Float32Array; samplingRate: number }) => void;
    reject: (err: Error) => void;
  }
>();

/** Whether this browser could run it at all. Module workers and Web Audio are the two hard
 *  requirements; everything else degrades. */
export function naturalVoiceSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Worker !== "undefined" &&
    typeof AudioContext !== "undefined" &&
    typeof Blob !== "undefined" &&
    typeof URL.createObjectURL === "function"
  );
}

export function naturalVoiceReady(): boolean {
  return worker !== null;
}

/**
 * Whether WebGPU is actually usable, which `"gpu" in navigator` does not answer.
 *
 * Chrome exposes `navigator.gpu` in contexts where no adapter can be acquired — headless without
 * `--enable-unsafe-webgpu`, a blocklisted driver, a machine with no compatible GPU. Detecting by
 * property presence and passing `device: "webgpu"` on that basis is how this feature first failed:
 * the module loaded off the CDN, the weights downloaded, and the session then refused to
 * initialise, so the toggle went straight from "100%" to "couldn't load". Only `requestAdapter()`
 * returning something is evidence.
 */
async function webgpuUsable(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

/**
 * Download and initialise the model. Idempotent, and safe to call while a load is already running
 * — the second caller waits on the first rather than starting a second 88MB download.
 *
 * `onProgress` is a 0-1 fraction across the whole download, so the UI can say "41%" rather than
 * spinning for a minute with nothing to show. Resolves false on any failure (offline, CDN blocked,
 * no WASM, a worker that will not start); the caller stays on the browser voice and says so.
 */
export function loadNaturalVoice(onProgress?: (fraction: number) => void): Promise<boolean> {
  if (worker) return Promise.resolve(true);
  if (loading) return loading;
  if (!naturalVoiceSupported()) return Promise.resolve(false);

  loading = (async () => {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
    let candidate: Worker | null = null;
    try {
      candidate = new Worker(url, { type: "module" });
      const started = candidate;
      const device = (await webgpuUsable()) ? "webgpu" : "wasm";
      /** Per-file byte progress, summed into one fraction. transformers.js reports each shard
       *  separately and out of order, so totals are accumulated by file name rather than added as
       *  they arrive. */
      const bytes = new Map<string, { loaded: number; total: number }>();

      const ok = await new Promise<boolean>((resolve) => {
        started.onmessage = (event: MessageEvent) => {
          const msg = event.data;
          if (msg.type === "progress") {
            if (!onProgress || !msg.file || !msg.total) return;
            bytes.set(msg.file, { loaded: msg.loaded ?? 0, total: msg.total });
            let loaded = 0;
            let total = 0;
            for (const entry of bytes.values()) {
              loaded += entry.loaded;
              total += entry.total;
            }
            if (total > 0) onProgress(Math.min(1, loaded / total));
          } else if (msg.type === "ready") {
            resolve(true);
          } else if (msg.type === "failed") {
            console.error("[storyVoice] the natural voice could not be loaded:", msg.message);
            resolve(false);
          }
        };
        started.onerror = (event) => {
          console.error("[storyVoice] the natural voice's worker failed", event.message ?? event);
          resolve(false);
        };
        started.postMessage({
          type: "load",
          moduleUrl: MODULE_URL,
          modelId: MODEL_ID,
          dtype: DTYPE,
          device,
        });
      });

      if (!ok) {
        started.terminate();
        return false;
      }

      // Swap the load-time handler for the steady-state one that routes audio to its request.
      started.onmessage = (event: MessageEvent) => {
        const msg = event.data;
        const entry = pending.get(msg.id);
        if (!entry) return;
        pending.delete(msg.id);
        if (msg.type === "audio")
          entry.resolve({ audio: msg.audio, samplingRate: msg.samplingRate });
        else entry.reject(new Error(msg.message ?? "synthesis failed"));
      };
      worker = started;
      return true;
    } catch (err) {
      console.error("[storyVoice] the natural voice could not be loaded", err);
      candidate?.terminate();
      return false;
    } finally {
      // Safe the moment the worker has been constructed — it holds its own copy of the script.
      URL.revokeObjectURL(url);
      loading = null;
    }
  })();
  return loading;
}

/** One sentence to the worker, one Float32Array back, with a deadline. */
function generate(
  text: string,
  speed: number
): Promise<{ audio: Float32Array; samplingRate: number }> {
  const w = worker;
  if (!w) return Promise.reject(new Error("the natural voice is not loaded"));
  const id = ++nextRequestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`synthesis exceeded ${SYNTHESIS_DEADLINE_MS}ms`));
    }, SYNTHESIS_DEADLINE_MS);
    pending.set(id, {
      resolve: (audio) => {
        clearTimeout(timer);
        resolve(audio);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    w.postMessage({ type: "generate", id, text, voice: VOICE, speed });
  });
}

/**
 * Speak one beat with the natural voice, honouring the same sentence pauses as the browser voice.
 *
 * **Synthesis is prefetched one sentence ahead.** Even in a worker, generating a sentence takes
 * from a few hundred ms (WebGPU) to a few seconds (WASM), and adding that to the front of every
 * pause would turn the chosen 420ms and 700ms silences into ragged ones of unpredictable length.
 * So sentence *n+1* is requested the moment sentence *n* starts playing, and the pause that
 * follows it is real silence rather than the model thinking.
 *
 * Any failure — a synthesis error, or a device too slow for `SYNTHESIS_DEADLINE_MS` — calls
 * `onError`, and `speakOn` hands the same beat to the platform voice from there.
 */
export function speakNatural(
  text: string,
  handlers: { onEnd?: () => void; onError?: () => void } = {}
): SpeakHandle {
  const chunks = splitForSpeech(text);
  if (!worker || chunks.length === 0) {
    const timer = setTimeout(() => handlers.onError?.(), 0);
    return { cancel: () => clearTimeout(timer) };
  }

  // Created on demand rather than at import: an AudioContext constructed before a user gesture
  // starts `suspended` in every current browser. By the time a beat is spoken, Play has been
  // pressed. The `resume()` below covers a tab that was backgrounded anyway.
  audioContext ??= new AudioContext();
  const context = audioContext;

  let done = false;
  let index = 0;
  let source: AudioBufferSourceNode | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const settle = (outcome: "end" | "error") => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (outcome === "end") handlers.onEnd?.();
    else handlers.onError?.();
  };

  const synthesize = (i: number): Promise<AudioBuffer | null> =>
    i >= chunks.length
      ? Promise.resolve(null)
      : generate(chunks[i], rateFor(i, chunks.length)).then(({ audio, samplingRate }) => {
          const buffer = context.createBuffer(1, audio.length, samplingRate);
          // `set` on the channel rather than `copyToChannel`, whose type demands a
          // `Float32Array<ArrayBuffer>` while a worker message yields `ArrayBufferLike`.
          buffer.getChannelData(0).set(audio);
          return buffer;
        });

  /** The sentence after the one about to play, already in flight. */
  let ahead: Promise<AudioBuffer | null> = synthesize(0);

  const playNext = async () => {
    if (done) return;
    let buffer: AudioBuffer | null;
    try {
      buffer = await ahead;
    } catch (err) {
      console.warn(
        "[storyVoice] natural voice synthesis failed, handing this beat back to the platform voice",
        err
      );
      settle("error");
      return;
    }
    if (done) return;
    if (!buffer) {
      settle("end");
      return;
    }
    // Request the next sentence before this one plays, so its pause is silence.
    ahead = synthesize(index + 1);
    // Nothing awaits that promise until the next `playNext`; without this a slow device logs an
    // unhandled rejection in the gap between sentences.
    ahead.catch(() => {});

    if (context.state === "suspended") await context.resume();
    if (done) return;

    source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => {
      if (done) return;
      const pause = pauseAfter(chunks[index], index, chunks.length);
      index += 1;
      if (index >= chunks.length) {
        settle("end");
        return;
      }
      timer = setTimeout(playNext, pause);
    };
    source.start();
  };

  void playNext();

  return {
    cancel: () => {
      done = true;
      clearTimeout(timer);
      if (source) {
        // `onended` fires on an explicit stop() too; `done` is already true so it no-ops.
        try {
          source.stop();
        } catch {
          // Already stopped, or never started. Nothing to undo.
        }
        source = null;
      }
      // The in-flight generate is deliberately *not* cancelled — the worker has no cancel, and its
      // result is dropped by the `done` guard. It costs one wasted sentence of inference, off the
      // main thread, where nobody can feel it.
    },
  };
}
