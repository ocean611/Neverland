import { getCompanion, type Companion } from './ai';
import { duckBgm } from './bgm';

// ─── OpenAI voice mapping ─────────────────────────────────────────────────────

const VOICES: Record<Companion, string> = {
  arthur: 'onyx',
  elora:  'nova',
};

// ─── Single global Audio element ─────────────────────────────────────────────
// One persistent instance reused for every playback. Safari requires the audio
// context to be unlocked by a synchronous user gesture; reusing the same element
// keeps that unlock active for the entire session.

const globalAudio = new Audio();
globalAudio.preload = 'none';

let activeObjectUrl: string | null = null;

function revokeActive(): void {
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
}

// ─── Safari audio unlock ──────────────────────────────────────────────────────
// Call this inside any synchronous user-gesture handler (onClick, onPointerDown).
// Playing a silent clip on the SAME Audio element we use for real playback is
// the most reliable unlock strategy across all iOS Safari versions.

const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
let audioUnlocked = false;

export function unlockAudio(): void {
  if (audioUnlocked) return;
  globalAudio.src = SILENT_WAV;
  globalAudio.volume = 0;
  globalAudio.play()
    .then(() => { audioUnlocked = true; globalAudio.volume = 1; })
    .catch(() => { /* will retry on next gesture */ });
}

// ─── STT feature detection ────────────────────────────────────────────────────

export const sttSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

// ─── Stop playback ────────────────────────────────────────────────────────────

let pendingBgmRestore: (() => void) | null = null;

export function stopSpeaking(): void {
  globalAudio.pause();
  globalAudio.src = '';
  revokeActive();
  if (pendingBgmRestore) { pendingBgmRestore(); pendingBgmRestore = null; }
}

// ─── TTS via OpenAI ───────────────────────────────────────────────────────────

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

export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  // Stop any current playback and release the previous blob URL
  globalAudio.pause();
  globalAudio.src = '';
  revokeActive();

  const key = getOpenAIKey();
  if (!key) {
    opts.onError?.('No OpenAI TTS key — add it in Settings to enable voice.');
    return;
  }

  const baseUrl = getOpenAIBaseUrl().replace(/\/$/, '');
  const voice   = VOICES[getCompanion()];

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'tts-1', input: text, voice, speed: getCompanion() === 'arthur' ? 0.85 : 0.95 }),
    });
  } catch (e) {
    opts.onError?.(`Voice network error: ${(e as Error).message}`);
    return;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    opts.onError?.(`OpenAI TTS ${res.status}: ${body.slice(0, 120)}`);
    return;
  }

  // Convert stream to blob → ObjectURL → assign to the already-unlocked global element
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  activeObjectUrl = url;

  // Duck BGM while TTS is playing; restore when done or stopped
  const restoreBgm = duckBgm(0.22);
  pendingBgmRestore = restoreBgm;

  globalAudio.onplay  = () => opts.onStart?.();
  globalAudio.onended = () => { revokeActive(); restoreBgm(); pendingBgmRestore = null; opts.onEnd?.(); };
  globalAudio.onerror = () => { revokeActive(); restoreBgm(); pendingBgmRestore = null; opts.onEnd?.(); };
  globalAudio.volume  = 1;
  globalAudio.src     = url;

  globalAudio.play().catch((e: unknown) => {
    const name = e instanceof DOMException ? e.name : '';
    if (name === 'NotAllowedError') {
      opts.onError?.('Tap anywhere first to enable audio, then press the speaker button again.');
    } else {
      opts.onError?.(`Playback failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    revokeActive();
    opts.onEnd?.();
  });
}

// ─── STT via MediaRecorder → Whisper ─────────────────────────────────────────
// Uses the standard MediaRecorder API (works on Safari 16+, all modern browsers).
// On stop, the accumulated audio chunks are sent to the Whisper transcription
// endpoint using the same OpenAI key/base-URL stored for TTS.

export interface RecognitionHandlers {
  onResult: (text: string) => void;
  onError: (msg: string) => void;
  onEnd: () => void;
}

// Pick the best supported MIME type for the current browser.
// Safari only supports audio/mp4; Chrome/Firefox prefer audio/webm.
// We try webm first (better Whisper compatibility), fall back to mp4.
function bestMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

// Map MIME type to a Whisper-accepted filename (no subdirectory, explicit extension).
// Safari records audio/mp4 → speech.m4a; Chrome records audio/webm → speech.webm.
// The filename suffix is what matters — servers use it to detect codec, not the MIME header.
function mimeToFilename(mime: string): string {
  if (mime.startsWith('audio/webm')) return 'speech.webm';
  if (mime.startsWith('audio/ogg'))  return 'speech.ogg';
  if (mime.startsWith('audio/mp4'))  return 'speech.m4a';
  return 'speech.webm';
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
  const preferredMime = bestMimeType();
  const chunks: BlobPart[] = [];
  let recorder: MediaRecorder | null = null;
  let stream:   MediaStream   | null = null;
  let stopped = false;

  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(s => {
      if (stopped) { s.getTracks().forEach(t => t.stop()); return; }
      stream = s;

      // Create recorder — try preferred MIME, fall back to browser default
      try {
        recorder = new MediaRecorder(s, preferredMime ? { mimeType: preferredMime } : {});
      } catch {
        // Safari may throw if mimeType isn't supported despite isTypeSupported returning true
        recorder = new MediaRecorder(s);
      }

      console.log('[STT] MediaRecorder mimeType:', recorder.mimeType);

      recorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        // Stop mic tracks AFTER onstop fires so the final chunk is fully written
        stream?.getTracks().forEach(t => t.stop());

        const totalSize = chunks.reduce((n, c) => n + (c instanceof Blob ? c.size : 0), 0);
        console.log(`[STT] onstop: ${chunks.length} chunks, ~${(totalSize / 1024).toFixed(1)} KB`);

        if (chunks.length === 0 || totalSize === 0) {
          handlers.onError('未录到音频（大小为 0），请检查麦克风权限后重试。');
          handlers.onEnd();
          return;
        }

        const actualMime = recorder!.mimeType || preferredMime || 'audio/webm';
        const blob       = new Blob(chunks, { type: actualMime });
        const filename   = mimeToFilename(actualMime);

        console.log(`[STT] Sending blob: ${blob.size} bytes, type=${blob.type}, filename=${filename}`);

        // Guard: reject empty blob before hitting the network (Safari can produce these)
        if (blob.size === 0) {
          handlers.onError('未检测到声音，请检查麦克风权限或重试。');
          handlers.onEnd();
          return;
        }

        const form = new FormData();
        // Explicit filename with extension is required — Safari's server rejects
        // blobs without a suffix because it cannot infer the codec from MIME alone.
        // Do NOT set Content-Type header — let the browser add the multipart boundary.
        form.append('file', blob, filename);
        form.append('model', 'whisper-1');

        // Build the transcription URL from stored base URL, handling any trailing slash
        const whisperUrl = `${baseUrl}/audio/transcriptions`.replace(/([^:])\/\/+/g, '$1/');

        try {
          const res = await fetch(whisperUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${key}`,
              // Content-Type intentionally omitted — browser sets it with the FormData boundary
            },
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
          console.error('[STT] fetch error:', e);
          const msg = e instanceof Error ? e.message : String(e);
          handlers.onError(`语音识别请求失败：${msg}。请检查网络和 API Key。`);
          handlers.onEnd();
        }
      };

      recorder.onerror = (e: Event) => {
        console.error('[STT] MediaRecorder error', e);
        stream?.getTracks().forEach(t => t.stop());
        handlers.onError('录音出错，请检查麦克风权限后重试。');
        handlers.onEnd();
      };

      // Use 1000ms chunks — Safari flushes more reliably at longer intervals
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

  // Called when user taps mic again — triggers recorder.onstop which sends to Whisper
  return () => {
    stopped = true;
    if (recorder && recorder.state === 'recording') {
      // requestData flushes any buffered audio before stop fires onstop
      try { recorder.requestData(); } catch { /* ignore */ }
      try { recorder.stop(); } catch { /* ignore */ }
      // Tracks are stopped inside onstop, not here, to avoid losing the final chunk
    } else {
      stream?.getTracks().forEach(t => t.stop());
    }
  };
}
