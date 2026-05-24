const BGM_VOLUME_KEY = 'neverland_bgm_volume';
const BGM_ENABLED_KEY = 'neverland_bgm_enabled';

export function getBgmVolume(): number {
  const v = parseFloat(localStorage.getItem(BGM_VOLUME_KEY) ?? '0.12');
  return isNaN(v) ? 0.12 : Math.min(1, Math.max(0, v));
}

export function setBgmVolume(v: number): void {
  localStorage.setItem(BGM_VOLUME_KEY, String(Math.min(1, Math.max(0, v))));
  const el = (window as Window & { __bgmEl?: HTMLAudioElement }).__bgmEl;
  if (el) el.volume = Math.min(1, Math.max(0, v));
}

export function getBgmEnabled(): boolean {
  return localStorage.getItem(BGM_ENABLED_KEY) === 'true';
}

export function setBgmEnabled(enabled: boolean): void {
  localStorage.setItem(BGM_ENABLED_KEY, String(enabled));
}

// Duck BGM to a fraction of its current volume while TTS speaks, then restore.
export function duckBgm(duckRatio = 0.25): () => void {
  const el = (window as Window & { __bgmEl?: HTMLAudioElement }).__bgmEl;
  if (!el || el.paused) return () => {};
  const full = getBgmVolume();
  const ducked = full * duckRatio;
  const steps = 12;
  let frame = 0;

  const fadeDown = setInterval(() => {
    frame++;
    el.volume = Math.max(ducked, full - (full - ducked) * (frame / steps));
    if (frame >= steps) { el.volume = ducked; clearInterval(fadeDown); }
  }, 30);

  return () => {
    clearInterval(fadeDown);
    let f = 0;
    const fadeUp = setInterval(() => {
      f++;
      el.volume = Math.min(full, ducked + (full - ducked) * (f / steps));
      if (f >= steps) { el.volume = full; clearInterval(fadeUp); }
    }, 30);
  };
}
