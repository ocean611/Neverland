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

// ─── Web Audio API context (primary playback engine) ──────────────────────────
// WebAudio is more reliable than <audio> elements on iOS Safari because:
//   - Its unlock is a simple AudioContext.resume() during a user gesture
//   - It doesn't suffer from the "display:none blocks audio pipeline" issue
//   - decodeAudioData + AudioBufferSourceNode gives precise playback control

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
// Call this inside any synchronous user-gesture handler (onClick, onPointerDown).
// Strategy 1 (primary): Resume the Web Audio context. Modern iOS accepts this
//   as a valid "user initiated audio" signal, which then allows all future
//   AudioContext operations (decodeAudioData, source.start()) to produce sound.
// Strategy 2 (fallback): Play a silent WAV on the DOM <audio> element to unlock
//   the HTMLMediaElement pipeline for BGM and as a secondary guarantee.

const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
let audioUnlocked = false;

export function unlockAudio(): void {
  if (audioUnlocked) return;

  // Strategy 1 — Web Audio context resume (most reliable on iOS 15+)
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

  // Strategy 2 — DOM audio element (legacy iOS, also unlocks BGM element)
  const player = getTTSPlayer();
  player.src = SILENT_WAV;
  player.volume = 0;
  player.load();
  player.play()
    .then(() => { player.pause(); player.currentTime = 0; player.volume = 1; audioUnlocked = true; })
    .catch(() => { /* strategy 1 may have already succeeded */ });
}

// ─── STT feature detection ────────────────────────────────────────────────────

export const sttSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

// ─── Stop playback ────────────────────────────────────────────────────────────

let pendingBgmRestore: (() => void) | null = null;

export function stopSpeaking(): void {
  // Stop Web Audio source
  if (activeSource) {
    try { activeSource.stop(); } catch { /* already stopped */ }
    activeSource = null;
  }
  // Also stop DOM audio element (used as fallback)
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

const TTS_CJK_REGEX = /[　-鿿가-힯豈-﫿︰-﹏＀-￯]/;

export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  // Stop current playback
  stopSpeaking();

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
  } catch (webAudioErr) {
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
        void (async () => {
          try {
            // Safari bug: the final dataavailable chunk may arrive AFTER onstop.
            // Wait one microtask tick so late chunks land before we assemble.
            await new Promise(r => setTimeout(r, 50));

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
            console.log('[STT] Calling:', whisperUrl);

            try {
              const res = await fetch(whisperUrl, {
                method: 'POST',
                headers: { Authorization: `Bearer ${key}` },
                body: form,
              });

              if (!res.ok) {
                const body = await res.text().catch(() => '');
                console.error('[STT] Whisper error', res.status, body.slice(0, 200));
                if (res.status === 404) {
                  settle(() => {
                    handlers.onError(`语音接口不存在 (404)。请检查 Base URL：${whisperUrl}`);
                    handlers.onEnd();
                  });
                } else if (res.status === 401 || res.status === 403) {
                  settle(() => {
                    handlers.onError('OpenAI API Key 无效或已过期，请在设置中更新。');
                    handlers.onEnd();
                  });
                } else {
                  settle(() => {
                    handlers.onError(`语音识别失败 (${res.status})：${body.slice(0, 120)}`);
                    handlers.onEnd();
                  });
                }
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
              if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
                settle(() => {
                  handlers.onError('无法连接到 OpenAI 服务器。如在中国大陆使用，请在 Settings 中设置代理 URL。');
                  handlers.onEnd();
                });
              } else {
                settle(() => {
                  handlers.onError(`语音识别请求失败：${msg}。请检查网络和 API Key。`);
                  handlers.onEnd();
                });
              }
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
