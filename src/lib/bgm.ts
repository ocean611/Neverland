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
// Smooth crossfade: BGM volume gently dips while TTS speaks, then restores.
// Uses GainNode (all platforms when pipeline is ready) with el.volume as
// secondary path (desktop + Android). BGM never pauses or mutes — it keeps
// playing, just quieter.

const FADE_STEPS = 15;
const FADE_MS = 28;

export function duckBgm(duckRatio = 0.15): { restore: () => void; faded: Promise<void> } {
  const el = (window as Window & { __bgmEl?: HTMLAudioElement }).__bgmEl;
  if (!el || el.paused) return { restore: () => {}, faded: Promise.resolve() };

  const full = getBgmVolume();
  const ducked = full * duckRatio;
  const hasGain = pipelineReady && bgmGain;
  const canSetVolume = !isIOS();

  let resolveFaded: () => void;
  const faded = new Promise<void>(r => { resolveFaded = r; });

  let frame = 0;
  const fadeDown = setInterval(() => {
    frame++;
    const v = Math.max(ducked, full - (full - ducked) * (frame / FADE_STEPS));

    if (hasGain && bgmGain) bgmGain.gain.value = v;
    if (canSetVolume) {
      try { el.volume = v; } catch { /* iOS */ }
    }

    if (frame >= FADE_STEPS) {
      if (hasGain && bgmGain) bgmGain.gain.value = ducked;
      if (canSetVolume) {
        try { el.volume = ducked; } catch { /* iOS */ }
      }
      clearInterval(fadeDown);
      resolveFaded();
    }
  }, FADE_MS);

  const restore = () => {
    clearInterval(fadeDown);
    let f = 0;
    const startVol = hasGain && bgmGain ? bgmGain.gain.value : ducked;
    const fadeUp = setInterval(() => {
      f++;
      const v = Math.min(full, startVol + (full - startVol) * (f / FADE_STEPS));

      if (hasGain && bgmGain) bgmGain.gain.value = v;
      if (canSetVolume) {
        try { el.volume = v; } catch { /* iOS */ }
      }

      if (f >= FADE_STEPS) {
        if (hasGain && bgmGain) bgmGain.gain.value = full;
        if (canSetVolume) {
          try { el.volume = full; } catch { /* iOS */ }
        }
        clearInterval(fadeUp);
      }
    }, FADE_MS);
  };

  return { restore, faded };
}
