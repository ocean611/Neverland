//
// BGM module — uses Web Audio API (MediaElementSource → GainNode → destination)
// so volume control works on iOS where HTMLMediaElement.volume is read-only.
//
// CRITICAL: createMediaElementSource() MUST be called while AudioContext is
// "running" (i.e. during a user gesture on iOS), NOT during React mount.
// Otherwise iOS Safari does not correctly route audio through the GainNode.
//

const BGM_VOLUME_KEY = 'neverland_bgm_volume';
const BGM_ENABLED_KEY = 'neverland_bgm_enabled';

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

// ─── BGM pipeline (lazy-init during first user gesture) ──────────────────────

let bgmGain: GainNode | null = null;
let bgmSource: MediaElementAudioSourceNode | null = null;
let pipelineReady = false;

// Connect an <audio> element through a GainNode.
// MUST be called from within a user gesture (click handler) on iOS so the
// AudioContext is in "running" state when createMediaElementSource() runs.
export function setupBgmPipeline(el: HTMLAudioElement): void {
  if (pipelineReady) return;

  const ctx = getSharedAudioContext();

  // Guard: on iOS, if context is still suspended (resume failed), bail out.
  // The pipeline will be attempted again on the next interaction.
  if (ctx.state !== 'running') {
    console.warn('[BGM] AudioContext not running yet, deferring pipeline setup');
    return;
  }

  try {
    bgmSource = ctx.createMediaElementSource(el);
    bgmGain = ctx.createGain();
    bgmGain.gain.value = getBgmVolume();
    bgmSource.connect(bgmGain);
    bgmGain.connect(ctx.destination);
    pipelineReady = true;
    console.log('[BGM] Pipeline connected: MediaElement → GainNode → destination');
  } catch (e) {
    console.error('[BGM] Failed to create MediaElementSource:', e);
  }
}

// ─── Volume get/set ───────────────────────────────────────────────────────────

export function getBgmVolume(): number {
  const v = parseFloat(localStorage.getItem(BGM_VOLUME_KEY) ?? '0.12');
  return isNaN(v) ? 0.12 : Math.min(1, Math.max(0, v));
}

export function setBgmVolume(v: number): void {
  const clamped = Math.min(1, Math.max(0, v));
  localStorage.setItem(BGM_VOLUME_KEY, String(clamped));

  // Web Audio path (all platforms, including iOS via GainNode)
  if (bgmGain) bgmGain.gain.value = clamped;

  // DOM fallback (desktop + Android where el.volume is writable)
  const el = (window as Window & { __bgmEl?: HTMLAudioElement }).__bgmEl;
  if (el) {
    try { el.volume = clamped; } catch { /* iOS read-only, silently ignored */ }
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
// Dual-path volume control:
//   Path A: GainNode (Web Audio — works on all platforms when pipeline is ready)
//   Path B: el.volume (DOM — works on desktop + most Android)
// On iOS, Path A is the only option; Path B is silently ignored.

export function duckBgm(duckRatio = 0.15): { restore: () => void; faded: Promise<void> } {
  const el = (window as Window & { __bgmEl?: HTMLAudioElement }).__bgmEl;
  if (!el || el.paused) return { restore: () => {}, faded: Promise.resolve() };

  const full = getBgmVolume();
  const ducked = full * duckRatio;
  const steps = 8;
  const stepMs = 25;

  let resolveFaded: () => void;
  const faded = new Promise<void>(r => { resolveFaded = r; });

  let frame = 0;
  const fadeDown = setInterval(() => {
    frame++;
    const v = Math.max(ducked, full - (full - ducked) * (frame / steps));

    // Path A: GainNode (effective on all platforms when pipeline is set up)
    if (bgmGain) bgmGain.gain.value = v;

    // Path B: el.volume (effective on desktop + Android; no-op on iOS)
    try { el.volume = v; } catch { /* iOS */ }

    if (frame >= steps) {
      if (bgmGain) bgmGain.gain.value = ducked;
      try { el.volume = ducked; } catch { /* iOS */ }
      clearInterval(fadeDown);
      resolveFaded();
    }
  }, stepMs);

  const restore = () => {
    clearInterval(fadeDown);
    let f = 0;
    const currentVol = bgmGain ? bgmGain.gain.value : ducked;
    const fadeUp = setInterval(() => {
      f++;
      const v = Math.min(full, currentVol + (full - currentVol) * (f / steps));

      if (bgmGain) bgmGain.gain.value = v;
      try { el.volume = v; } catch { /* iOS */ }

      if (f >= steps) {
        if (bgmGain) bgmGain.gain.value = full;
        try { el.volume = full; } catch { /* iOS */ }
        clearInterval(fadeUp);
      }
    }, stepMs);
  };

  return { restore, faded };
}
