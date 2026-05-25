import { getCompanion, type Companion } from './ai';
import { duckBgm } from './bgm';

// ─── OpenAI voice mapping ─────────────────────────────────────────────────────

const VOICES: Record<Companion, string> = {
  arthur: 'onyx',
  elora:  'nova',
};

// ─── DOM-based audio element ─────────────────────────────────────────────────
// A persistent <audio id="tts-player"> element declared in index.html.
// It MUST be in the DOM (not created via new Audio()) — iOS Safari only
// persists autoplay permission for elements that are part of the document tree.
// Once unlocked by a user gesture, all subsequent .play() calls on this same
// element succeed without requiring another gesture.

function getTTSPlayer(): HTMLAudioElement {
  return document.getElementById('tts-player') as HTMLAudioElement;
}

let activeObjectUrl: string | null = null;

function revokeActive(): void {
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
}

// ─── Safari audio unlock ──────────────────────────────────────────────────────
// Call this inside any synchronous user-gesture handler (onClick, onPointerDown).
// Playing a silent clip on the SAME Audio element we use for real playback
// "burns" the autoplay lock so future async .play() calls succeed.

const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
let audioUnlocked = false;

export function unlockAudio(): void {
  if (audioUnlocked) return;
  const player = getTTSPlayer();
  player.src = SILENT_WAV;
  player.volume = 0;
  player.load();
  player.play()
    .then(() => { player.pause(); player.currentTime = 0; player.volume = 1; audioUnlocked = true; })
    .catch(() => { audioUnlocked = false; });
}

// ─── STT feature detection ────────────────────────────────────────────────────

export const sttSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

// ─── Stop playback ────────────────────────────────────────────────────────────

let pendingBgmRestore: (() => void) | null = null;

export function stopSpeaking(): void {
  const player = getTTSPlayer();
  player.pause();
  // NEVER set player.src = '' — it destroys the mobile audio unlock
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

const TTS_CJK_REGEX = /[\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;

export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  const player = getTTSPlayer();

  // Stop current playback WITHOUT clearing src — clearing src destroys the
  // mobile audio unlock that unlockAudio() achieved during a user gesture.
  player.pause();
  player.onplay = null;
  player.onended = null;
  player.onerror = null;
  revokeActive();

  // Hard gate: never send CJK text to the English TTS voice engine.
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

  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  activeObjectUrl = url;

  const restoreBgm = duckBgm(0.22);
  pendingBgmRestore = restoreBgm;

  function cleanup() {
    revokeActive();
    restoreBgm();
    pendingBgmRestore = null;
  }

  // Set event handlers BEFORE setting src to avoid mobile race conditions
  player.onplay  = () => opts.onStart?.();
  player.onended = () => { cleanup(); opts.onEnd?.(); };
  player.onerror = () => { cleanup(); opts.onEnd?.(); };
  player.volume  = 1;

  // On mobile, calling play() immediately after setting src fails because
  // not enough audio data has buffered. Wait for canplaythrough.
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

  // Safety fallback: if canplaythrough never fires, try anyway after 3s
  const fallback = setTimeout(() => {
    player.removeEventListener('canplaythrough', onReady);
    doPlay();
  }, 3000);

  // Set src last — triggers loading
  player.src = url;
  player.load();
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
  let stopTimeout: ReturnType<typeof setTimeout> | null = null;

  // Shared cleanup — ensures handlers always fire at most once and the
  // UI never gets stuck in "processing" state.
  let settled = false;
  const settle = (fn: () => void) => {
    if (settled) return;
    settled = true;
    if (stopTimeout) { clearTimeout(stopTimeout); stopTimeout = null; }
    fn();
  };

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

      recorder.onstop = () => {
        // Wrap everything so a throw inside onstop never leaves the UI stuck.
        void (async () => {
          try {
            // Safari bug: the final dataavailable chunk may arrive AFTER onstop.
            // Wait one microtask tick so late chunks land before we assemble.
            await new Promise(r => setTimeout(r, 50));

            // Stop mic tracks now that recording is fully done
            stream?.getTracks().forEach(t => t.stop());

            const totalSize = chunks.reduce((n, c) => n + (c instanceof Blob ? c.size : 0), 0);
            console.log(`[STT] onstop: ${chunks.length} chunks, ~${(totalSize / 1024).toFixed(1)} KB`);

            if (chunks.length === 0 || totalSize === 0) {
              settle(() => {
                handlers.onError('未录到音频 — 请确认已授予麦克风权限，说完话后再点一次麦克风按钮结束录音。');
                handlers.onEnd();
              });
              return;
            }

            // On mobile Safari, use the recorder's actual mimeType
            const actualMime = recorder?.mimeType || preferredMime || 'audio/mp4';
            const blob       = new Blob(chunks, { type: actualMime });
            const filename   = mimeToFilename(actualMime);

            console.log(`[STT] Sending blob: ${blob.size} bytes, type=${blob.type}, filename=${filename}`);

            if (blob.size === 0) {
              settle(() => {
                handlers.onError('未检测到声音，请确认麦克风正常工作后再试。');
                handlers.onEnd();
              });
              return;
            }

            const form = new FormData();
            form.append('file', blob, filename);
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
                settle(() => {
                  handlers.onError(`语音识别失败 (${res.status})：${body.slice(0, 120)}`);
                  handlers.onEnd();
                });
                return;
              }

              const data = await res.json() as { text?: string };
              const text = data.text?.trim() ?? '';
              console.log('[STT] Transcript:', text);

              if (text) {
                settle(() => {
                  handlers.onResult(text);
                  handlers.onEnd();
                });
              } else {
                settle(() => {
                  handlers.onError('未能识别到语音内容，请再试一次。');
                  handlers.onEnd();
                });
              }
            } catch (e) {
              console.error('[STT] fetch error:', e);
              const msg = e instanceof Error ? e.message : String(e);
              settle(() => {
                handlers.onError(`语音识别请求失败：${msg}。请检查网络和 API Key。`);
                handlers.onEnd();
              });
            }
          } catch (fatal) {
            console.error('[STT] onstop fatal error:', fatal);
            settle(() => {
              handlers.onError(`录音处理异常：${fatal instanceof Error ? fatal.message : String(fatal)}`);
              handlers.onEnd();
            });
          }
        })();
      };

      recorder.onerror = (e: Event) => {
        console.error('[STT] MediaRecorder error', e);
        stream?.getTracks().forEach(t => t.stop());
        settle(() => {
          handlers.onError('录音出错，请检查麦克风权限后重试。');
          handlers.onEnd();
        });
      };

      // Use 1000ms chunks — longer interval improves Safari reliability
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

      // Safety net: if onstop never fires (known mobile Safari bug),
      // force cleanup after 5 seconds so the UI doesn't hang forever.
      stopTimeout = setTimeout(() => {
        stream?.getTracks().forEach(t => t.stop());
        settle(() => {
          handlers.onError('录音结束超时，请重试。如持续出现，请尝试刷新页面。');
          handlers.onEnd();
        });
      }, 5000);
    } else {
      stream?.getTracks().forEach(t => t.stop());
      settle(() => {
        handlers.onError('录音尚未开始，请授予麦克风权限后重试。');
        handlers.onEnd();
      });
    }
  };
}
