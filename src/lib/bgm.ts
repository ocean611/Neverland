//
// BGM module — uses Web Audio API (MediaElementSource → GainNode → destination)
// so volume control works on iOS where HTMLMediaElement.volume is read-only.
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

// ─── BGM gain node ────────────────────────────────────────────────────────────

let bgmGain: GainNode | null = null;
let bgmSource: MediaElementAudioSourceNode | null = null;

// Connect an <audio> element through a GainNode. Call once per element.
// After this, all volume control goes through the GainNode — el.volume is ignored.
export function setupBgm(el: HTMLAudioElement): void {
  if (bgmSource) return;
  const ctx = getSharedAudioContext();
  bgmSource = ctx.createMediaElementSource(el);
  bgmGain = ctx.createGain();
  bgmGain.gain.value = getBgmVolume();
  bgmSource.connect(bgmGain);
  bgmGain.connect(ctx.destination);
}

// ─── Volume get/set ───────────────────────────────────────────────────────────

export function getBgmVolume(): number {
  const v = parseFloat(localStorage.getItem(BGM_VOLUME_KEY) ?? '0.12');
  return isNaN(v) ? 0.12 : Math.min(1, Math.max(0, v));
}

export function setBgmVolume(v: number): void {
  const clamped = Math.min(1, Math.max(0, v));
  localStorage.setItem(BGM_VOLUME_KEY, String(clamped));
  // Update both the gain node (Web Audio path) and the DOM element (fallback)
  if (bgmGain) bgmGain.gain.value = clamped;
  const el = (window as Window & { __bgmEl?: HTMLAudioElement }).__bgmEl;
  if (el) el.volume = clamped;
}

// ─── BGM enabled ──────────────────────────────────────────────────────────────

export function getBgmEnabled(): boolean {
  return localStorage.getItem(BGM_ENABLED_KEY) === 'true';
}

export function setBgmEnabled(enabled: boolean): void {
  localStorage.setItem(BGM_ENABLED_KEY, String(enabled));
}

// ─── Duck / restore ───────────────────────────────────────────────────────────
// Fades BGM down while TTS speaks, then restores. Uses GainNode so it works on
// iOS (where HTMLMediaElement.volume is read-only) and Android.

export function duckBgm(duckRatio = 0.15): { restore: () => void; faded: Promise<void> } {
  const el = (window as Window & { __bgmEl?: HTMLAudioElement }).__bgmEl;
  if (!el || el.paused) return { restore: () => {}, faded: Promise.resolve() };

  const full = getBgmVolume();
  const ducked = full * duckRatio;
  const steps = 8;
  const stepMs = 25;
  let frame = 0;

  let resolveFaded: () => void;
  const faded = new Promise<void>(r => { resolveFaded = r; });

  const fadeDown = setInterval(() => {
    frame++;
    const v = Math.max(ducked, full - (full - ducked) * (frame / steps));
    if (bgmGain) bgmGain.gain.value = v;
    if (frame >= steps) {
      if (bgmGain) bgmGain.gain.value = ducked;
      clearInterval(fadeDown);
      resolveFaded();
    }
  }, stepMs);

  const restore = () => {
    clearInterval(fadeDown);
    let f = 0;
    const current = bgmGain ? bgmGain.gain.value : ducked;
    const fadeUp = setInterval(() => {
      f++;
      const v = Math.min(full, current + (full - current) * (f / steps));
      if (bgmGain) bgmGain.gain.value = v;
      if (f >= steps) {
        if (bgmGain) bgmGain.gain.value = full;
        clearInterval(fadeUp);
      }
    }, stepMs);
  };

  return { restore, faded };
}
