import { getCompanion, type Companion } from './ai';
import { duckBgm } from './bgm';

// ─── OpenAI voice mapping ─────────────────────────────────────────────────────

const VOICES: Record<Companion, string> = {
  arthur: 'onyx',
  elora:  'nova',
};

// ─── Global audio singleton ───────────────────────────────────────────────────
// Created once at module load — never re-created. This is the only element
// that ever plays TTS audio. Safari's autoplay unlock is bound to a specific
// Audio object; reusing this single instance keeps the unlock alive all session.

const globalAudio = new Audio();

const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

let activeObjectUrl: string | null = null;

function revokeActive(): void {
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
}

// ─── Sync unlock ──────────────────────────────────────────────────────────────
// MUST be called at the very top of any synchronous user-gesture handler,
// before any await. Plays a silent clip on globalAudio so Safari registers
// this object as "user-activated". All future .play() calls on the same
// object — even after async fetches — are then permitted.

export function unlockAudio(): void {
  globalAudio.src = SILENT_WAV;
  globalAudio.play().catch(() => {});
  globalAudio.pause();
}

// ─── STT feature detection ────────────────────────────────────────────────────

export const sttSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

// ─── Force-stop all audio (API player + synthesis queue) ─────────────────────
// Call this before starting any new audio and at the top of every user-gesture
// handler that triggers audio (send button, mic button). Guarantees a clean
// slate so old synthesis utterances can never bleed into the next playback.

let pendingBgmRestore: (() => void) | null = null;

export function stopAllAudio(): void {
  // Cut the API audio player
  globalAudio.pause();
  globalAudio.currentTime = 0;
  globalAudio.src = '';
  revokeActive();
  // Flush every queued and in-progress utterance from the synthesis engine
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  if (pendingBgmRestore) { pendingBgmRestore(); pendingBgmRestore = null; }
}

// Keep the old name exported as an alias so nothing else breaks.
export const stopSpeaking = stopAllAudio;

// ─── TTS public API ───────────────────────────────────────────────────────────

export interface SpeakOptions {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (msg: string) => void;
}

export function getOpenAIKey(): string {
  return localStorage.getItem('neverland_openai_tts_key') ?? '';
}
export function setOpenAIKey(key: string): void {
  localStorage.setItem('neverland_openai_tts_key', key.trim());
}

export function getOpenAIBaseUrl(): string {
  return localStorage.getItem('neverland_openai_base_url') ?? 'https://api.openai.com/v1';
}
export function setOpenAIBaseUrl(url: string): void {
  localStorage.setItem('neverland_openai_base_url', url.trim() || 'https://api.openai.com/v1');
}

// Native speech synthesis — last-resort fallback when fetch or play() fails.
function speakNative(text: string, opts: SpeakOptions): void {
  if (!window.speechSynthesis) {
    opts.onError?.('Audio unavailable and speech synthesis not supported.');
    opts.onEnd?.();
    return;
  }
  // Always cancel before queuing — prevents stale utterances from replaying.
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.onstart = () => opts.onStart?.();
  utterance.onend   = () => opts.onEnd?.();
  utterance.onerror = () => { opts.onError?.('Speech synthesis failed.'); opts.onEnd?.(); };
  window.speechSynthesis.speak(utterance);
}

export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  // Silence everything — API audio AND any queued synthesis utterances.
  stopAllAudio();

  const key = getOpenAIKey();
  if (!key) {
    opts.onError?.('No OpenAI TTS key — add it in Settings to enable voice.');
    return;
  }

  const baseUrl = getOpenAIBaseUrl().replace(/\/$/, '');
  const voice   = VOICES[getCompanion()];

  try {
    // ── Fetch audio from OpenAI ──────────────────────────────────────────────
    const response = await fetch(`${baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice,
        speed: getCompanion() === 'arthur' ? 0.85 : 0.95,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenAI TTS ${response.status}: ${body.slice(0, 120)}`);
    }

    // ── Blob → ObjectURL ────────────────────────────────────────────────────
    const blob     = await response.blob();
    const audioUrl = URL.createObjectURL(blob);
    activeObjectUrl = audioUrl;

    // ── Duck BGM ─────────────────────────────────────────────────────────────
    const restoreBgm = duckBgm(0.22);
    pendingBgmRestore = restoreBgm;

    // ── Wire up events then assign src ────────────────────────────────────────
    globalAudio.onplay  = () => opts.onStart?.();
    globalAudio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      activeObjectUrl = null;
      restoreBgm();
      pendingBgmRestore = null;
      opts.onEnd?.();
    };
    globalAudio.onerror = () => {
      URL.revokeObjectURL(audioUrl);
      activeObjectUrl = null;
      restoreBgm();
      pendingBgmRestore = null;
      // Blob failed to decode — fall through to native synthesis
      speakNative(text, opts);
    };

    globalAudio.src = audioUrl;

    // ── Play on the already-unlocked singleton ────────────────────────────────
    await globalAudio.play();

  } catch (err: unknown) {
    // Covers: fetch network error, non-ok API response, NotAllowedError from play()
    revokeActive();
    if (pendingBgmRestore) { pendingBgmRestore(); pendingBgmRestore = null; }

    const isDomEx = err instanceof DOMException;
    if (isDomEx && (err as DOMException).name === 'NotAllowedError') {
      // Autoplay still blocked — silent fallback, no error toast
      speakNative(text, { onStart: opts.onStart, onEnd: opts.onEnd });
    } else {
      // Real error (network, API key, etc.) — show message then fallback
      const msg = err instanceof Error ? err.message : String(err);
      opts.onError?.(msg);
      speakNative(text, opts);
    }
  }
}

// ─── STT via MediaRecorder → Whisper (with Web Speech API fallback) ──────────

export interface RecognitionHandlers {
  onResult: (text: string) => void;
  onError: (msg: string) => void;
  onEnd: () => void;
}

function detectMime(): { mimeType: string; extension: string } {
  if (typeof MediaRecorder === 'undefined') return { mimeType: 'audio/mp4', extension: 'm4a' };
  if (MediaRecorder.isTypeSupported('audio/webm')) return { mimeType: 'audio/webm', extension: 'webm' };
  if (MediaRecorder.isTypeSupported('audio/mp4'))  return { mimeType: 'audio/mp4',  extension: 'm4a'  };
  if (MediaRecorder.isTypeSupported('audio/ogg'))  return { mimeType: 'audio/ogg',  extension: 'ogg'  };
  return { mimeType: '', extension: 'webm' };
}

function fallbackWebSpeech(handlers: RecognitionHandlers): boolean {
  const SR =
    (window as unknown as { SpeechRecognition?: new () => SpeechRecognition }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognition }).webkitSpeechRecognition;
  if (!SR) return false;

  console.log('[STT] Falling back to Web Speech API');
  const rec = new SR();
  rec.lang = navigator.language || 'zh-CN';
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  rec.onresult = (e: SpeechRecognitionEvent) => {
    const text = e.results[0]?.[0]?.transcript?.trim() ?? '';
    if (text) {
      handlers.onResult(text);
    } else {
      handlers.onError('未能识别到语音内容，请再试一次。');
      handlers.onEnd();
    }
  };
  rec.onerror = () => {
    handlers.onError('语音识别请求失败，请检查网络和 API Key。');
    handlers.onEnd();
  };
  rec.onend = () => {};

  try { rec.start(); return true; } catch { return false; }
}

export function startListening(handlers: RecognitionHandlers): (() => void) | null {
  if (!sttSupported) {
    handlers.onError('此浏览器不支持麦克风录音，请使用 Safari 16+ 或 Chrome。');
    return null;
  }

  const key = getOpenAIKey();
  if (!key) {
    handlers.onError('请先在设置中填入 OpenAI API Key，才能使用语音输入。');
    return null;
  }

  const baseUrl = getOpenAIBaseUrl().replace(/\/$/, '');
  const { mimeType: preferredMime, extension } = detectMime();
  const chunks: BlobPart[] = [];
  let recorder: MediaRecorder | null = null;
  let stream:   MediaStream   | null = null;
  let stopped = false;

  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(s => {
      if (stopped) { s.getTracks().forEach(t => t.stop()); return; }
      stream = s;

      try {
        recorder = new MediaRecorder(s, preferredMime ? { mimeType: preferredMime } : {});
      } catch {
        recorder = new MediaRecorder(s);
      }

      console.log('[STT] MediaRecorder mimeType:', recorder.mimeType);

      recorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        stream?.getTracks().forEach(t => t.stop());

        const totalSize = chunks.reduce((n, c) => n + (c instanceof Blob ? c.size : 0), 0);
        console.log(`[STT] onstop: ${chunks.length} chunks, ~${(totalSize / 1024).toFixed(1)} KB`);

        if (chunks.length === 0 || totalSize === 0) {
          handlers.onError('未录到音频（大小为 0），请检查麦克风权限后重试。');
          handlers.onEnd();
          return;
        }

        const actualMime = recorder!.mimeType || preferredMime || 'audio/mp4';
        const actualExt  = actualMime.includes('webm') ? 'webm' : actualMime.includes('ogg') ? 'ogg' : extension;
        const blob       = new Blob(chunks, { type: actualMime });

        if (blob.size === 0) {
          handlers.onError('未检测到声音，请检查麦克风权限或重试。');
          handlers.onEnd();
          return;
        }

        const file = new File([blob], `speech.${actualExt}`, { type: actualMime });
        console.log(`[STT] Uploading File: ${file.size} bytes, name=${file.name}`);

        const form = new FormData();
        form.append('file', file);
        form.append('model', 'whisper-1');

        const whisperUrl = `${baseUrl}/audio/transcriptions`.replace(/([^:])\/\/+/g, '$1/');

        try {
          const res = await fetch(whisperUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}` },
            body: form,
          });

          if (!res.ok) {
            const body = await res.text().catch(() => '');
            console.error('[STT] Whisper error', res.status, body);
            handlers.onError(`语音识别失败 (${res.status})：${body.slice(0, 120)}`);
            handlers.onEnd();
            return;
          }

          const data = await res.json() as { text?: string };
          const text = data.text?.trim() ?? '';
          console.log('[STT] Transcript:', text);

          if (text) {
            handlers.onResult(text);
          } else {
            handlers.onError('未能识别到语音内容，请再试一次。');
            handlers.onEnd();
          }
        } catch (e) {
          console.warn('[STT] Whisper fetch failed, trying Web Speech API fallback:', e);
          if (!fallbackWebSpeech(handlers)) {
            const msg = e instanceof Error ? e.message : String(e);
            handlers.onError(`语音识别请求失败：${msg}。请检查网络和 API Key。`);
            handlers.onEnd();
          }
        }
      };

      recorder.onerror = (e: Event) => {
        console.error('[STT] MediaRecorder error', e);
        stream?.getTracks().forEach(t => t.stop());
        handlers.onError('录音出错，请检查麦克风权限后重试。');
        handlers.onEnd();
      };

      recorder.start(1000);
      console.log('[STT] Recording started');
    })
    .catch((e: unknown) => {
      console.error('[STT] getUserMedia error', e);
      const name = e instanceof DOMException ? e.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        handlers.onError('麦克风权限被拒绝，请在浏览器或系统设置中允许访问麦克风。');
      } else if (name === 'NotFoundError') {
        handlers.onError('未找到麦克风设备，请检查硬件连接。');
      } else {
        handlers.onError(`无法访问麦克风：${e instanceof Error ? e.message : String(e)}`);
      }
      handlers.onEnd();
    });

  return () => {
    stopped = true;
    if (recorder && recorder.state === 'recording') {
      try { recorder.requestData(); } catch { /* ignore */ }
      try { recorder.stop(); } catch { /* ignore */ }
    } else {
      stream?.getTracks().forEach(t => t.stop());
    }
  };
}
