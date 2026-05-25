import { getCompanion, type Companion, getOpenAIKey, getOpenAIBaseUrl } from './ai';
import { duckBgm } from './bgm';

// ─── OpenAI voice mapping ─────────────────────────────────────────────────────

const VOICES: Record<Companion, string> = {
  arthur: 'onyx',
  elora:  'nova',
};

// ─── DOM-based audio element ─────────────────────────────────────────────────

function getTTSPlayer(): HTMLAudioElement {
  return document.getElementById('tts-player') as HTMLAudioElement;
}

// ─── Web Audio API context (primary playback engine) ──────────────────────────

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) {
      audioCtx = new Ctor();
    } else {
      throw new Error('Web Audio API not supported');
    }
  }
  return audioCtx;
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

  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume()
        .then(() => { audioUnlocked = true; })
        .catch(() => { /* fall through to strategy 2 */ });
    } else {
      audioUnlocked = true;
    }
  } catch { /* Web Audio not available */ }

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
    return;
  }

  const blob = await res.blob();
  const arrayBuffer = await blob.arrayBuffer();

  const restoreBgm = duckBgm(0.22);
  pendingBgmRestore = restoreBgm;

  function cleanup() {
    revokeActive();
    activeSource = null;
    restoreBgm();
    pendingBgmRestore = null;
  }

  // ── Primary path: Web Audio API (reliable on iOS) ──────────────────────────
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    if (ctx.state === 'suspended') {
      throw new Error('AudioContext still suspended — needs user gesture');
    }

    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    activeSource = source;
    source.onended = () => { cleanup(); opts.onEnd?.(); };
    opts.onStart?.();
    source.start(0);
    return;
  } catch {
    // ── Fallback: DOM audio element ───────────────────────────────────────
    const url = URL.createObjectURL(blob);
    activeObjectUrl = url;
    const player = getTTSPlayer();

    player.onplay  = () => opts.onStart?.();
    player.onended = () => { cleanup(); opts.onEnd?.(); };
    player.onerror = () => { cleanup(); opts.onEnd?.(); };
    player.volume  = 1;

    const doPlay = () => {
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
      player.removeEventListener('canplaythrough', onReady);
      clearTimeout(fallback);
      doPlay();
    };

    player.addEventListener('canplaythrough', onReady, { once: true });

    const fallback = setTimeout(() => {
      player.removeEventListener('canplaythrough', onReady);
      doPlay();
    }, 3000);

    player.src = url;
    player.load();
  }
}
