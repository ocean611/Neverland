//
// BGM module — multi-strategy volume control that works on ALL platforms.
//
// Platform capabilities:
//   Desktop Chrome/Firefox:  el.volume writable + GainNode ✓
//   Android Chrome:          el.volume writable ✓ (most versions)
//   iOS Safari:              el.volume READ-ONLY ✗ — MUST use GainNode or el.muted
//
// Strategy (tried in order):
//   A) MediaElementSource → GainNode (smooth fade, all platforms when CORS ok)
//   B) el.volume (smooth fade, desktop + Android)
//   C) el.muted toggle (no fade but GUARANTEED on iOS)
//

const BGM_VOLUME_KEY = 'neverland_bgm_volume';
const BGM_ENABLED_KEY = 'neverland_bgm_enabled';

// ─── Detect iOS ──────────────────────────────────────────────────────────────

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// ─── Shared AudioContext ──────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;

export function getSharedAudioContext(): AudioContext {
  if (!audioCtx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error('Web Audio API not supported');
    audioCtx = new Ctor();
  }
  return audioCtx;
}

export function resumeAudioContext(): Promise<void> {
  try {
    const ctx = getSharedAudioContext();
    if (ctx.state === 'suspended') return ctx.resume().then(() => {});
  } catch { /* not available */ }
  return Promise.resolve();
}

// ─── BGM pipeline (MediaElementSource → GainNode → destination) ──────────────

let bgmGain: GainNode | null = null;
let bgmSource: MediaElementAudioSourceNode | null = null;
let pipelineReady = false;

// MUST be called while AudioContext is "running" (during a user gesture on iOS).
export function setupBgmPipeline(el: HTMLAudioElement): void {
  if (pipelineReady) return;

  const ctx = getSharedAudioContext();
  if (ctx.state !== 'running') return;

  try {
    bgmSource = ctx.createMediaElementSource(el);
    bgmGain = ctx.createGain();
    bgmGain.gain.value = getBgmVolume();
    bgmSource.connect(bgmGain);
    bgmGain.connect(ctx.destination);
    pipelineReady = true;
    console.log('[BGM] Pipeline ready — GainNode route active');
  } catch (e) {
    console.warn('[BGM] createMediaElementSource failed:', e, '— will use fallback strategies');
  }
}

export function isPipelineReady(): boolean {
  return pipelineReady;
}

// ─── Volume get/set ───────────────────────────────────────────────────────────

export function getBgmVolume(): number {
  const v = parseFloat(localStorage.getItem(BGM_VOLUME_KEY) ?? '0.12');
  return isNaN(v) ? 0.12 : Math.min(1, Math.max(0, v));
}

export function setBgmVolume(v: number): void {
  const clamped = Math.min(1, Math.max(0, v));
  localStorage.setItem(BGM_VOLUME_KEY, String(clamped));
  if (bgmGain) bgmGain.gain.value = clamped;
  const el = (window as Window & { __bgmEl?: HTMLAudioElement }).__bgmEl;
  if (el) {
    try { el.volume = clamped; } catch { /* iOS read-only */ }
  }
}

// ─── BGM enabled ──────────────────────────────────────────────────────────────

export function getBgmEnabled(): boolean {
  return localStorage.getItem(BGM_ENABLED_KEY) === 'true';
}

export function setBgmEnabled(enabled: boolean): void {
  localStorage.setItem(BGM_ENABLED_KEY, String(enabled));
}

// ─── Duck / restore ───────────────────────────────────────────────────────────
//
// Three strategies applied simultaneously for maximum coverage:
//   1. GainNode fade (when pipeline is ready — all platforms with CORS)
//   2. el.volume fade (desktop + Android)
//   3. el.muted toggle (iOS guaranteed fallback — no fade but ensures audibility)
//
// On iOS without pipeline, we mute BGM entirely while TTS plays.
// This isn't a smooth fade but guarantees the AI voice is heard clearly.

const FADE_STEPS = 8;
const FADE_MS = 25;

export function duckBgm(duckRatio = 0.15): { restore: () => void; faded: Promise<void> } {
  const el = (window as Window & { __bgmEl?: HTMLAudioElement }).__bgmEl;
  if (!el || el.paused) return { restore: () => {}, faded: Promise.resolve() };

  const full = getBgmVolume();
  const ducked = full * duckRatio;
  const usePipeline = pipelineReady && bgmGain;
  const useVolumeApi = !isIOS(); // el.volume not writable on iOS
  const useMutedFallback = isIOS() && !usePipeline;

  let resolveFaded: () => void;
  const faded = new Promise<void>(r => { resolveFaded = r; });

  // ── Path C: muted toggle (iOS, no pipeline, no volume API) ──────────────
  if (useMutedFallback) {
    console.log('[BGM] Duck via muted (iOS fallback)');
    el.muted = true;
    const restore = () => { el.muted = false; };
    // Resolve after a short delay so TTS has a gap before playing
    setTimeout(resolveFaded, 200);
    return { restore, faded };
  }

  // ── Path A+B: GainNode + el.volume fade ─────────────────────────────────
  console.log(`[BGM] Duck via ${usePipeline ? 'GainNode' : 'volume'} fade`);
  let frame = 0;
  const fadeDown = setInterval(() => {
    frame++;
    const v = Math.max(ducked, full - (full - ducked) * (frame / FADE_STEPS));

    if (usePipeline && bgmGain) bgmGain.gain.value = v;
    if (useVolumeApi) {
      try { el.volume = v; } catch { /* iOS */ }
    }

    if (frame >= FADE_STEPS) {
      if (usePipeline && bgmGain) bgmGain.gain.value = ducked;
      if (useVolumeApi) {
        try { el.volume = ducked; } catch { /* iOS */ }
      }
      clearInterval(fadeDown);
      resolveFaded();
    }
  }, FADE_MS);

  const restore = () => {
    clearInterval(fadeDown);
    let f = 0;
    const startVol = usePipeline && bgmGain ? bgmGain.gain.value : ducked;
    const fadeUp = setInterval(() => {
      f++;
      const v = Math.min(full, startVol + (full - startVol) * (f / FADE_STEPS));

      if (usePipeline && bgmGain) bgmGain.gain.value = v;
      if (useVolumeApi) {
        try { el.volume = v; } catch { /* iOS */ }
      }

      if (f >= FADE_STEPS) {
        if (usePipeline && bgmGain) bgmGain.gain.value = full;
        if (useVolumeApi) {
          try { el.volume = full; } catch { /* iOS */ }
        }
        clearInterval(fadeUp);
      }
    }, FADE_MS);
  };

  return { restore, faded };
}
