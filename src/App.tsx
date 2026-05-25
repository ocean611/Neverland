import { useState, useRef, useEffect } from 'react';
import { Flower2, BookMarked, Settings, Music2 } from 'lucide-react';
import { motion } from 'framer-motion';
import TheGarden from './views/TheGarden';
import Memory from './views/Memory';
import SettingsModal from './components/SettingsModal';
import { loadMemories, saveMemory, deleteMemory, type MemoryRecord, type Message } from './lib/storage';
import { getBgmVolume, setBgmEnabled, setupBgmPipeline, resumeAudioContext } from './lib/bgm';

const BGM_URL = 'https://vewuxryfkugfffjfhhuk.supabase.co/storage/v1/object/public/assets/124803335-1-208.mp3';

type Tab = 'garden' | 'memory';

const NAV_ITEMS: { id: Tab; label: string; Icon: typeof Flower2 }[] = [
  { id: 'garden', label: 'The Garden', Icon: Flower2 },
  { id: 'memory', label: 'Memory', Icon: BookMarked },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('garden');
  const [memories, setMemories] = useState<MemoryRecord[]>(() => loadMemories());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bgmPlaying, setBgmPlaying] = useState(false);
  const bgmRef = useRef<HTMLAudioElement>(null);

  const handleSave = (messages: Message[]) => {
    saveMemory(messages);
    setMemories(loadMemories());
  };

  const handleDelete = (id: string) => {
    deleteMemory(id);
    setMemories(loadMemories());
  };

  // Sync volume from storage on mount and whenever settings close
  useEffect(() => {
    const el = bgmRef.current;
    if (!el) return;
    el.volume = getBgmVolume();
  }, [settingsOpen]);

  // Expose bgm element globally so TTS can duck it.
  // Pipeline (MediaElement → GainNode) is set up lazily on first user tap
  // because iOS requires the AudioContext to be "running" when
  // createMediaElementSource() is called.
  useEffect(() => {
    const el = bgmRef.current;
    if (el) {
      (window as Window & { __bgmEl?: HTMLAudioElement }).__bgmEl = el;
    }
  }, []);

  const toggleBgm = async () => {
    const el = bgmRef.current;
    if (!el) return;
    if (bgmPlaying) {
      el.pause();
      setBgmPlaying(false);
      setBgmEnabled(false);
    } else {
      // 1) Resume AudioContext (requires user gesture on iOS)
      await resumeAudioContext();
      // 2) Now that context is running, wire BGM through GainNode
      setupBgmPipeline(el);
      // 3) Start playback — audio routes through the GainNode pipeline
      el.play().catch(() => {});
      setBgmPlaying(true);
      setBgmEnabled(true);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#080a0f] flex items-stretch justify-center">
      {/* BGM — loop, low volume, off by default to respect autoplay policy */}
      <audio ref={bgmRef} src={BGM_URL} loop preload="none" crossOrigin="anonymous" style={{ display: 'none' }} onEnded={() => setBgmPlaying(false)} />
      <div
        className="relative flex flex-col w-full md:max-w-md md:border-x md:border-white/[0.07] overflow-hidden"
        style={{
          height: '100dvh',
          background: 'linear-gradient(160deg, #080a0f 0%, #0b0f18 50%, #070c14 100%)',
        }}
      >
        {/* Star field */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
          {Array.from({ length: 60 }).map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full bg-white"
              style={{
                width: i % 7 === 0 ? '2px' : '1px',
                height: i % 7 === 0 ? '2px' : '1px',
                top: `${(i * 37 + 11) % 100}%`,
                left: `${(i * 53 + 7) % 100}%`,
                opacity: ((i * 13) % 35) / 100 + 0.04,
                animation: `float ${4 + (i % 6)}s ease-in-out infinite`,
                animationDelay: `${(i * 0.3) % 8}s`,
              }}
            />
          ))}
        </div>

        {/* Header */}
        <header
          className="relative z-50 flex-shrink-0 flex items-center glass-strong"
          style={{
            height: 56,
            borderTop: 'none',
            borderLeft: 'none',
            borderRight: 'none',
            paddingTop: 'env(safe-area-inset-top, 0px)',
            paddingLeft: '1rem',
            paddingRight: '1rem',
          }}
        >
          {/* Left: settings button */}
          <motion.button
            onClick={() => setSettingsOpen(true)}
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}
            whileTap={{ scale: 0.92 }}
            aria-label="Settings"
          >
            <Settings size={15} style={{ color: 'rgba(255,255,255,0.3)' }} />
          </motion.button>

          {/* Center: title */}
          <h1
            className="flex-1 text-center font-serif text-[26px] font-light tracking-[0.12em] text-glow select-none"
            style={{
              background: 'linear-gradient(135deg, rgba(200,225,240,0.9) 0%, rgba(148,197,220,0.75) 50%, rgba(180,215,235,0.85) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Neverland
          </h1>

          {/* Right: BGM toggle */}
          <motion.button
            onClick={toggleBgm}
            className="w-9 h-9 rounded-xl flex items-center justify-center relative"
            style={{
              background: bgmPlaying ? 'rgba(148,197,220,0.12)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${bgmPlaying ? 'rgba(148,197,220,0.22)' : 'rgba(255,255,255,0.07)'}`,
              transition: 'background 0.25s, border-color 0.25s',
            }}
            whileTap={{ scale: 0.92 }}
            aria-label={bgmPlaying ? 'Pause music' : 'Play music'}
          >
            <Music2
              size={15}
              style={{
                color: bgmPlaying ? 'rgba(148,197,220,0.8)' : 'rgba(255,255,255,0.3)',
                filter: bgmPlaying ? 'drop-shadow(0 0 5px rgba(148,197,220,0.45))' : 'none',
                transition: 'color 0.25s, filter 0.25s',
              }}
            />
            {bgmPlaying && (
              <span
                className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
                style={{ background: 'rgba(148,210,235,0.75)', boxShadow: '0 0 6px rgba(148,210,235,0.6)' }}
              />
            )}
          </motion.button>
        </header>

        {/* Main content */}
        <main className="relative z-10 flex-1 min-h-0">
          <div
            className="absolute inset-0 transition-opacity duration-300"
            style={{ opacity: activeTab === 'garden' ? 1 : 0, pointerEvents: activeTab === 'garden' ? 'auto' : 'none' }}
          >
            <TheGarden onSave={handleSave} />
          </div>
          <div
            className="absolute inset-0 transition-opacity duration-300"
            style={{ opacity: activeTab === 'memory' ? 1 : 0, pointerEvents: activeTab === 'memory' ? 'auto' : 'none' }}
          >
            <Memory memories={memories} onDelete={handleDelete} />
          </div>
        </main>

        {/* Bottom navigation */}
        <nav
          className="relative z-50 flex-shrink-0 glass-strong"
          style={{
            borderBottom: 'none',
            borderLeft: 'none',
            borderRight: 'none',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}
        >
          <div className="flex items-center justify-around h-16 px-6">
            {NAV_ITEMS.map(({ id, label, Icon }) => {
              const isActive = activeTab === id;
              return (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className="flex flex-col items-center gap-1 px-6 py-1 relative transition-all duration-300"
                  aria-label={label}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {isActive && (
                    <span
                      className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full"
                      style={{
                        background: 'linear-gradient(90deg, rgba(148,197,220,0.7), rgba(100,160,190,0.5))',
                        boxShadow: '0 0 8px rgba(148,197,220,0.5)',
                      }}
                    />
                  )}
                  <Icon
                    size={20}
                    style={{
                      color: isActive ? 'rgba(148,197,220,0.85)' : 'rgba(255,255,255,0.25)',
                      filter: isActive ? 'drop-shadow(0 0 6px rgba(148,197,220,0.4))' : 'none',
                    }}
                  />
                  <span
                    className="text-[10px] tracking-wider uppercase font-light transition-all duration-300"
                    style={{
                      color: isActive ? 'rgba(148,197,220,0.75)' : 'rgba(255,255,255,0.2)',
                      letterSpacing: '0.12em',
                    }}
                  >
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Settings modal — outside the app column so it covers full viewport */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
