import { getCompanion, type Companion, getOpenAIKey, getOpenAIBaseUrl } from './ai';
import { duckBgm, getSharedAudioContext, resumeAudioContext } from './bgm';

// ─── OpenAI voice mapping ─────────────────────────────────────────────────────

const VOICES: Record<Companion, string> = {
  arthur: 'onyx',
  elora:  'nova',
};

// ─── DOM-based audio element ─────────────────────────────────────────────────

function getTTSPlayer(): HTMLAudioElement {
  let el = document.getElementById('tts-player') as HTMLAudioElement;
  if (!el) {
    el = document.createElement('audio');
    el.id = 'tts-player';
    el.preload = 'auto';
    document.body.appendChild(el);
  }
  return el;
}

// ─── TTS gain node (shared AudioContext, separate gain for TTS boost) ─────────

let ttsGain: GainNode | null = null;

function getTTSGain(): GainNode {
  if (!ttsGain) {
    const ctx = getSharedAudioContext();
    ttsGain = ctx.createGain();
    ttsGain.gain.value = 1.5; // Boost TTS volume above BGM
    ttsGain.connect(ctx.destination);
  }
  return ttsGain;
}

let activeSource: AudioBufferSourceNode | null = null;
let activeObjectUrl: string | null = null;

function revokeActive(): void {
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
}

// ─── Safari / mobile audio unlock ────────────────────────────────────────────

const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
let audioUnlocked = false;

export function unlockAudio(): void {
  if (audioUnlocked) return;

  resumeAudioContext()
    .then(() => { audioUnlocked = true; })
    .catch(() => { /* fall through to strategy 2 */ });

  const player = getTTSPlayer();
  player.src = SILENT_WAV;
  player.volume = 0;
  player.load();
  player.play()
    .then(() => { player.pause(); player.currentTime = 0; player.volume = 1; audioUnlocked = true; })
    .catch(() => { /* strategy 1 may have already succeeded */ });
}

// ─── Stop playback ────────────────────────────────────────────────────────────

let pendingBgmRestore: (() => void) | null = null;

export function stopSpeaking(): void {
  if (activeSource) {
    try { activeSource.stop(); } catch { /* already stopped */ }
    activeSource = null;
  }
  const player = getTTSPlayer();
  player.pause();
  revokeActive();
  if (pendingBgmRestore) { pendingBgmRestore(); pendingBgmRestore = null; }
}

// ─── TTS via OpenAI ───────────────────────────────────────────────────────────

export interface SpeakOptions {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (msg: string) => void;
}

const TTS_CJK_REGEX = /[　-鿿가-힯豈-﫿︰-﹏＀-￯]/;

export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  stopSpeaking();

  if (!text || !text.trim() || TTS_CJK_REGEX.test(text)) {
    opts.onEnd?.();
    return;
  }

  const key = getOpenAIKey();
  if (!key) {
    opts.onError?.('No OpenAI TTS key — add it in Settings to enable voice.');
    return;
  }

  const baseUrl = getOpenAIBaseUrl().replace(/\/$/, '');
  const voice   = VOICES[getCompanion()];

  const ttsUrl = `${baseUrl}/audio/speech`;
  console.log('[TTS] Calling:', ttsUrl);

  // Start BGM duck immediately — before the TTS network call — so music
  // fades while we wait for the API response.
  const { restore: restoreBgm, faded: bgmFaded } = duckBgm(0.15);
  pendingBgmRestore = restoreBgm;

  let res: Response;
  try {
    res = await fetch(ttsUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'tts-1', input: text, voice, speed: getCompanion() === 'arthur' ? 0.85 : 0.95 }),
    });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      opts.onError?.('无法连接到 OpenAI 服务器。如在中国大陆使用，请在 Settings → Voice → Base URL 中设置代理地址。');
    } else {
      opts.onError?.(`Voice network error: ${msg}`);
    }
    restoreBgm(); pendingBgmRestore = null;
    return;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[TTS] Failed:', res.status, body.slice(0, 200));
    if (res.status === 404) {
      opts.onError?.(`接口不存在 (404)。请检查 Base URL 是否正确：${ttsUrl}`);
    } else {
      opts.onError?.(`OpenAI TTS ${res.status}: ${body.slice(0, 120)}`);
    }
    restoreBgm(); pendingBgmRestore = null;
    return;
  }

  let blob: Blob;
  try {
    blob = await res.blob();
  } catch {
    restoreBgm(); pendingBgmRestore = null;
    return;
  }

  function cleanup() {
    revokeActive();
    activeSource = null;
    restoreBgm();
    pendingBgmRestore = null;
  }

  // ── Primary path: Web Audio API (gain-boosted, reliable on iOS) ──────────
  try {
    const ctx = getSharedAudioContext();
    await resumeAudioContext();

    if (ctx.state === 'suspended') {
      throw new Error('AudioContext still suspended — needs user gesture');
    }

    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    // Route through gain node for volume boost
    source.connect(getTTSGain());

    activeSource = source;
    source.onended = () => { cleanup(); opts.onEnd?.(); };

    // Wait for BGM to finish fading down before starting speech
    await bgmFaded;
    opts.onStart?.();
    source.start(0);
    return;
  } catch (e) {
    console.warn('[TTS] Web Audio path failed, falling back to DOM:', e);
  }

  // ── Fallback: DOM audio element ──────────────────────────────────────────
  try {
    const url = URL.createObjectURL(blob);
    activeObjectUrl = url;
    const player = getTTSPlayer();

    player.onplay  = () => opts.onStart?.();
    player.onended = () => { cleanup(); opts.onEnd?.(); };
    player.onerror = () => { cleanup(); opts.onEnd?.(); };
    player.volume  = 1;

    const doPlay = async () => {
      await bgmFaded;
      player.play().catch((e: unknown) => {
        const name = e instanceof DOMException ? e.name : '';
        if (name === 'NotAllowedError') {
          opts.onError?.('Tap anywhere first to enable audio, then press the speaker button again.');
        } else {
          opts.onError?.(`Playback failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        cleanup();
        opts.onEnd?.();
      });
    };

    const onReady = () => {
      player.removeEventListener('canplay', onReady);
      clearTimeout(fallback);
      doPlay();
    };

    player.addEventListener('canplay', onReady, { once: true });

    const fallback = setTimeout(() => {
      player.removeEventListener('canplay', onReady);
      doPlay();
    }, 1000);

    player.src = url;
    player.load();
  } catch {
    cleanup();
  }
}
