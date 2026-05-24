import { getCompanion, type Companion } from './ai';
import { duckBgm } from './bgm';

// ─── OpenAI voice mapping ─────────────────────────────────────────────────────

const VOICES: Record<Companion, string> = {
  arthur: 'onyx',
  elora:  'nova',
};

// ─── Global TTS player ────────────────────────────────────────────────────────
// A single persistent <audio id="tts-player"> element declared in index.html.
// Reusing the same DOM element is the only reliable way to satisfy Safari's
// autoplay policy: once unlocked via a user gesture, the element stays
// unlocked for the entire session.

function getTTSPlayer(): HTMLAudioElement {
  return document.getElementById('tts-player') as HTMLAudioElement;
}

// A tiny silent WAV used to "burn" the autoplay permission in the same
// synchronous call stack as the user gesture, before any async work begins.
const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

let audioUnlocked = false;
let activeObjectUrl: string | null = null;

function revokeActive(): void {
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
}

// ─── Sync unlock (call inside a user-gesture handler, before any await) ───────
// Assigns a silent clip to the player and immediately plays+pauses it.
// Safari records this as "user-initiated playback" on this element, which
// allows subsequent async .play() calls on the same element to succeed.

export function unlockAudio(): void {
  if (audioUnlocked) return;
  const player = getTTSPlayer();
  player.src = SILENT_WAV;
  player.volume = 0;
  const p = player.play();
  if (p) {
    p.then(() => {
      player.pause();
      player.volume = 1;
      audioUnlocked = true;
    }).catch(() => { /* will retry on the next gesture */ });
  }
}

// ─── STT feature detection ────────────────────────────────────────────────────

export const sttSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

// ─── Stop playback ────────────────────────────────────────────────────────────

let pendingBgmRestore: (() => void) | null = null;

export function stopSpeaking(): void {
  const player = getTTSPlayer();
  player.pause();
  player.src = '';
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

// Web Speech API fallback — used when audio fails to load/play.
function fallbackSpeechSynthesis(text: string, opts: SpeakOptions): void {
  if (!window.speechSynthesis) {
    opts.onError?.('Audio playback failed and speech synthesis is unavailable.');
    opts.onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'en-US';
  utt.onstart  = () => opts.onStart?.();
  utt.onend    = () => opts.onEnd?.();
  utt.onerror  = () => { opts.onError?.('Speech synthesis failed.'); opts.onEnd?.(); };
  window.speechSynthesis.speak(utt);
}

export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  const player = getTTSPlayer();

  // Stop any current playback
  player.pause();
  player.src = '';
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

  // Convert response to blob → ObjectURL
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  activeObjectUrl = url;

  // Duck BGM while TTS is playing; restore when done or stopped
  const restoreBgm = duckBgm(0.22);
  pendingBgmRestore = restoreBgm;

  player.onplay  = () => opts.onStart?.();
  player.onended = () => { revokeActive(); restoreBgm(); pendingBgmRestore = null; opts.onEnd?.(); };

  // onerror on the audio element means the blob itself failed to decode —
  // fall through to speechSynthesis rather than showing an error.
  player.onerror = () => {
    revokeActive();
    restoreBgm();
    pendingBgmRestore = null;
    fallbackSpeechSynthesis(text, opts);
  };

  player.volume = 1;
  player.src    = url;

  try {
    await player.play();
  } catch (e: unknown) {
    const name = e instanceof DOMException ? e.name : '';
    if (name === 'NotAllowedError') {
      // Unlock failed — try speech synthesis so the user still hears something
      revokeActive();
      restoreBgm();
      pendingBgmRestore = null;
      fallbackSpeechSynthesis(text, {
        onStart: opts.onStart,
        onEnd:   opts.onEnd,
        // Don't surface a hard error — synthesis is the transparent fallback
      });
    } else {
      revokeActive();
      restoreBgm();
      pendingBgmRestore = null;
      opts.onError?.(`Playback failed: ${e instanceof Error ? e.message : String(e)}`);
      opts.onEnd?.();
    }
  }
}

// ─── STT via MediaRecorder → Whisper (with Web Speech API fallback) ──────────
// Primary path: MediaRecorder → Blob → File → Whisper API
// Fallback path: if Whisper fetch throws (e.g. Safari network block), silently
//   degrade to window.webkitSpeechRecognition / window.SpeechRecognition.

export interface RecognitionHandlers {
  onResult: (text: string) => void;
  onError: (msg: string) => void;
  onEnd: () => void;
}

// Detect the MIME type Safari actually supports at runtime.
// Safari 16+ supports audio/mp4 only; Chrome/Firefox support audio/webm.
function detectMime(): { mimeType: string; extension: string } {
  if (typeof MediaRecorder === 'undefined') return { mimeType: 'audio/mp4', extension: 'm4a' };
  if (MediaRecorder.isTypeSupported('audio/webm')) return { mimeType: 'audio/webm', extension: 'webm' };
  if (MediaRecorder.isTypeSupported('audio/mp4'))  return { mimeType: 'audio/mp4',  extension: 'm4a'  };
  if (MediaRecorder.isTypeSupported('audio/ogg'))  return { mimeType: 'audio/ogg',  extension: 'ogg'  };
  return { mimeType: '', extension: 'webm' };
}

// Web Speech API fallback — used when Whisper fetch fails (e.g. Safari network block).
// Starts a fresh recognition session and resolves once a result or error arrives.
function fallbackWebSpeech(handlers: RecognitionHandlers): boolean {
  const SR = (window as unknown as { SpeechRecognition?: new () => SpeechRecognition; webkitSpeechRecognition?: new () => SpeechRecognition }).SpeechRecognition
          ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognition }).webkitSpeechRecognition;
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
  rec.onend = () => { /* result/error fires first */ };

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
