import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, KeyRound, Eye, EyeOff, Check, ExternalLink, Cpu, Sparkles, Music2, Volume1, VolumeX } from 'lucide-react';
import {
  getProvider, setProvider, getApiKey, setApiKey,
  getCompanion, setCompanion,
  getOpenAIKey, setOpenAIKey, getOpenAIBaseUrl, setOpenAIBaseUrl,
  type Provider, type Companion,
} from '../lib/ai';
import { getBgmVolume, setBgmVolume } from '../lib/bgm';

interface Props {
  open: boolean;
  onClose: () => void;
}

const PROVIDERS: { id: Provider; label: string; hint: string; placeholder: string; docsUrl: string; docsCta: string }[] = [
  { id: 'gemini',   label: 'Gemini',   hint: 'Free tier available — generous daily quota.', placeholder: 'AIzaSy…', docsUrl: 'https://aistudio.google.com/app/apikey', docsCta: 'Get key at Google AI Studio' },
  { id: 'deepseek', label: 'DeepSeek', hint: 'Highly capable & cost-effective model.',       placeholder: 'sk-…',    docsUrl: 'https://platform.deepseek.com/api_keys',  docsCta: 'Get key at DeepSeek Platform' },
];

const COMPANIONS: { id: Companion; name: string; chinese: string; vibe: string; voice: string }[] = [
  { id: 'arthur', name: 'Arthur', chinese: '亚瑟', vibe: 'Weathered. Deep. A confidant who\'s seen it all.', voice: 'onyx' },
  { id: 'elora',  name: 'Elora',  chinese: '伊洛拉', vibe: 'Ethereal. Warm. A soul who feels everything.',   voice: 'nova' },
];

const inputBase: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.09)',
  caretColor: 'rgba(148,210,235,0.8)',
};

function PasswordField({
  label, value, onChange, placeholder, show, onToggleShow,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder: string; show: boolean; onToggleShow: () => void;
}) {
  return (
    <div className="relative">
      <span className="block text-xs tracking-[0.14em] uppercase text-white/30 font-light mb-1.5">{label}</span>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl px-4 py-3 pr-12 text-sm font-light text-white/70 placeholder-white/18 outline-none"
          style={inputBase}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={onToggleShow}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
          style={{ color: 'rgba(255,255,255,0.25)' }}
        >
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </div>
  );
}

const DIVIDER = <div className="my-5" style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)' }} />;

export default function SettingsModal({ open, onClose }: Props) {
  const [provider, setLocalProvider]   = useState<Provider>('gemini');
  const [companion, setLocalCompanion] = useState<Companion>('elora');
  const [geminiKey,   setGeminiKey]   = useState('');
  const [deepseekKey, setDeepseekKey] = useState('');
  const [openaiKey,   setLocalOpenaiKey]   = useState('');
  const [openaiBase,  setLocalOpenaiBase]  = useState('');
  const [showGemini,   setShowGemini]   = useState(false);
  const [showDeepseek, setShowDeepseek] = useState(false);
  const [showOpenai,   setShowOpenai]   = useState(false);
  const [bgmVolume,   setBgmVolumeLocal] = useState(0.12);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLocalProvider(getProvider());
    setLocalCompanion(getCompanion());
    setGeminiKey(getApiKey('gemini'));
    setDeepseekKey(getApiKey('deepseek'));
    setLocalOpenaiKey(getOpenAIKey());
    setLocalOpenaiBase(getOpenAIBaseUrl());
    setBgmVolumeLocal(getBgmVolume());
    setShowGemini(false); setShowDeepseek(false); setShowOpenai(false);
    setSaved(false);
  }, [open]);

  const handleSave = () => {
    setProvider(provider);
    setCompanion(companion);
    if (geminiKey.trim())   setApiKey('gemini',   geminiKey.trim());
    if (deepseekKey.trim()) setApiKey('deepseek', deepseekKey.trim());
    setOpenAIKey(openaiKey.trim());
    setOpenAIBaseUrl(openaiBase.trim());
    setBgmVolume(bgmVolume);
    setSaved(true);
    setTimeout(onClose, 850);
  };

  const activeKey = provider === 'gemini' ? geminiKey : deepseekKey;
  const canSave   = activeKey.trim().length > 0;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[100]"
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            className="fixed inset-x-0 bottom-0 z-[101] flex justify-center md:inset-0 md:items-center"
            initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }}
          >
            <div
              className="w-full md:max-w-sm mx-auto rounded-t-3xl md:rounded-3xl px-6 pt-6 overflow-y-auto"
              style={{
                background: 'rgba(10,18,32,0.96)',
                backdropFilter: 'blur(40px)',
                WebkitBackdropFilter: 'blur(40px)',
                border: '1px solid rgba(255,255,255,0.09)',
                boxShadow: '0 -12px 60px rgba(0,0,0,0.5)',
                maxHeight: '92dvh',
                paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))',
              }}
            >
              {/* Handle */}
              <div className="w-10 h-1 rounded-full bg-white/10 mx-auto mb-6 md:hidden" />

              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(96,180,220,0.12)', border: '1px solid rgba(96,180,220,0.18)' }}>
                    <Cpu size={14} style={{ color: 'rgba(148,210,235,0.8)' }} />
                  </div>
                  <h2 className="font-serif text-lg font-light text-white/70">Settings</h2>
                </div>
                <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }} aria-label="Close">
                  <X size={14} style={{ color: 'rgba(255,255,255,0.4)' }} />
                </button>
              </div>

              {/* ── Soul Companion ── */}
              <div className="mb-0">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={11} style={{ color: 'rgba(148,210,235,0.5)' }} />
                  <p className="text-xs tracking-[0.14em] uppercase text-white/30 font-light">Soul Companion</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {COMPANIONS.map(c => {
                    const active = companion === c.id;
                    return (
                      <motion.button
                        key={c.id}
                        onClick={() => { setLocalCompanion(c.id); setSaved(false); }}
                        className="relative rounded-2xl p-3.5 text-left overflow-hidden"
                        style={{
                          background: active ? 'rgba(96,180,220,0.10)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${active ? 'rgba(148,210,235,0.22)' : 'rgba(255,255,255,0.07)'}`,
                        }}
                        whileTap={{ scale: 0.96 }}
                      >
                        {active && (
                          <motion.div
                            className="absolute inset-0 rounded-2xl"
                            layoutId="companion-glow"
                            style={{ background: 'radial-gradient(circle at 30% 30%, rgba(148,210,235,0.07) 0%, transparent 70%)' }}
                            transition={{ duration: 0.3 }}
                          />
                        )}
                        <p className="relative text-sm font-light" style={{ color: active ? 'rgba(148,210,235,0.85)' : 'rgba(255,255,255,0.45)' }}>
                          {c.name}
                          <span className="ml-1.5 text-[11px]" style={{ color: active ? 'rgba(148,210,235,0.45)' : 'rgba(255,255,255,0.22)' }}>{c.chinese}</span>
                        </p>
                        <p className="relative text-[10px] font-light mt-1 leading-relaxed" style={{ color: active ? 'rgba(148,210,235,0.45)' : 'rgba(255,255,255,0.2)' }}>
                          {c.vibe}
                        </p>
                        <p className="relative text-[10px] font-light mt-0.5" style={{ color: active ? 'rgba(148,210,235,0.3)' : 'rgba(255,255,255,0.12)' }}>
                          voice: {c.voice}
                        </p>
                        {active && <div className="absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(148,210,235,0.7)' }} />}
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {DIVIDER}

              {/* ── AI Engine ── */}
              <div className="mb-0">
                <p className="text-xs tracking-[0.14em] uppercase text-white/30 font-light mb-3">AI Engine</p>
                <div className="flex gap-2 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  {PROVIDERS.map(p => {
                    const active = provider === p.id;
                    return (
                      <motion.button
                        key={p.id}
                        onClick={() => { setLocalProvider(p.id); setSaved(false); }}
                        className="flex-1 py-2.5 rounded-lg text-sm font-light relative"
                        style={{ color: active ? 'rgba(148,210,235,0.85)' : 'rgba(255,255,255,0.3)' }}
                        whileTap={{ scale: 0.96 }}
                      >
                        {active && (
                          <motion.div className="absolute inset-0 rounded-lg" layoutId="provider-pill"
                            style={{ background: 'rgba(96,180,220,0.14)', border: '1px solid rgba(148,210,235,0.18)' }}
                            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                          />
                        )}
                        <span className="relative z-10">{p.label}</span>
                      </motion.button>
                    );
                  })}
                </div>
                <AnimatePresence mode="wait">
                  <motion.p key={provider} className="text-[11px] text-white/22 font-light mt-2 leading-relaxed"
                    initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
                    {PROVIDERS.find(p => p.id === provider)!.hint}
                  </motion.p>
                </AnimatePresence>
              </div>

              {DIVIDER}

              {/* ── AI API Keys ── */}
              <div className="space-y-4">
                <div style={{ opacity: provider === 'gemini' ? 1 : 0.4, transition: 'opacity 0.2s' }}>
                  <PasswordField label="Gemini API Key" value={geminiKey} onChange={v => { setGeminiKey(v); setSaved(false); }}
                    placeholder="AIzaSy…" show={showGemini} onToggleShow={() => setShowGemini(v => !v)} />
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] mt-1.5 transition-opacity hover:opacity-80"
                    style={{ color: 'rgba(148,210,235,0.4)' }}>
                    <ExternalLink size={10} />Get key at Google AI Studio
                  </a>
                </div>

                <div style={{ opacity: provider === 'deepseek' ? 1 : 0.4, transition: 'opacity 0.2s' }}>
                  <PasswordField label="DeepSeek API Key" value={deepseekKey} onChange={v => { setDeepseekKey(v); setSaved(false); }}
                    placeholder="sk-…" show={showDeepseek} onToggleShow={() => setShowDeepseek(v => !v)} />
                  <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] mt-1.5 transition-opacity hover:opacity-80"
                    style={{ color: 'rgba(148,210,235,0.4)' }}>
                    <ExternalLink size={10} />Get key at DeepSeek Platform
                  </a>
                </div>
              </div>

              {DIVIDER}

              {/* ── OpenAI TTS ── */}
              <div className="space-y-4">
                <p className="text-xs tracking-[0.14em] uppercase text-white/30 font-light">Voice (OpenAI TTS)</p>

                <PasswordField label="OpenAI TTS API Key" value={openaiKey} onChange={v => { setLocalOpenaiKey(v); setSaved(false); }}
                  placeholder="sk-…" show={showOpenai} onToggleShow={() => setShowOpenai(v => !v)} />

                <div>
                  <span className="block text-xs tracking-[0.14em] uppercase text-white/30 font-light mb-1.5">Base URL</span>
                  <input
                    type="text"
                    value={openaiBase}
                    onChange={e => { setLocalOpenaiBase(e.target.value); setSaved(false); }}
                    placeholder="https://api.openai.com/v1"
                    className="w-full rounded-xl px-4 py-3 text-sm font-light text-white/70 placeholder-white/18 outline-none"
                    style={inputBase}
                    spellCheck={false}
                    autoComplete="off"
                    autoCapitalize="off"
                  />
                  <p className="text-[11px] font-light mt-1.5 leading-relaxed" style={{ color: 'rgba(148,210,235,0.35)' }}>
                    Change to a proxy URL for regions with network restrictions.
                  </p>
                </div>

                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] transition-opacity hover:opacity-80"
                  style={{ color: 'rgba(148,210,235,0.4)' }}>
                  <ExternalLink size={10} />Get key at OpenAI Platform
                </a>
              </div>

              {DIVIDER}

              {/* ── Background Music ── */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(148,210,235,0.08)', border: '1px solid rgba(148,210,235,0.14)' }}>
                    <Music2 size={12} style={{ color: 'rgba(148,210,235,0.6)' }} />
                  </div>
                  <p className="text-xs tracking-[0.14em] uppercase text-white/30 font-light">Background Music</p>
                </div>

                <div className="flex items-center gap-3">
                  {/* Mute icon */}
                  <button
                    type="button"
                    onClick={() => { const next = bgmVolume === 0 ? 0.12 : 0; setBgmVolumeLocal(next); setBgmVolume(next); setSaved(false); }}
                    className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
                    aria-label={bgmVolume === 0 ? 'Unmute' : 'Mute'}
                  >
                    {bgmVolume === 0
                      ? <VolumeX size={13} style={{ color: 'rgba(255,255,255,0.25)' }} />
                      : <Volume1 size={13} style={{ color: 'rgba(148,210,235,0.6)' }} />
                    }
                  </button>

                  {/* Volume slider */}
                  <div className="flex-1 relative flex items-center">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={bgmVolume}
                      onChange={e => {
                        const v = parseFloat(e.target.value);
                        setBgmVolumeLocal(v);
                        setBgmVolume(v);
                        setSaved(false);
                      }}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{
                        background: `linear-gradient(to right, rgba(148,210,235,0.55) 0%, rgba(148,210,235,0.55) ${bgmVolume * 100}%, rgba(255,255,255,0.08) ${bgmVolume * 100}%, rgba(255,255,255,0.08) 100%)`,
                        outline: 'none',
                      }}
                    />
                  </div>

                  {/* Percentage */}
                  <span className="flex-shrink-0 text-[11px] font-light w-8 text-right tabular-nums" style={{ color: 'rgba(148,210,235,0.45)' }}>
                    {Math.round(bgmVolume * 100)}%
                  </span>
                </div>

                <p className="text-[11px] font-light mt-2 leading-relaxed" style={{ color: 'rgba(255,255,255,0.18)' }}>
                  BGM fades to {Math.round(bgmVolume * 15)}% while the AI speaks, then restores.
                </p>
              </div>

              {/* Privacy note */}
              <p className="text-[11px] text-white/18 font-light mt-5 mb-5 leading-relaxed">
                All keys are stored only in this browser's LocalStorage and never sent anywhere except the respective provider.
              </p>

              {/* Save */}
              <motion.button
                onClick={handleSave}
                disabled={!canSave}
                className="w-full py-3 rounded-xl font-light text-sm tracking-wide"
                style={{
                  background: saved ? 'rgba(56,180,120,0.18)' : canSave ? 'rgba(96,180,220,0.18)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${saved ? 'rgba(56,180,120,0.25)' : canSave ? 'rgba(148,210,235,0.22)' : 'rgba(255,255,255,0.07)'}`,
                  color: saved ? 'rgba(80,200,140,0.85)' : canSave ? 'rgba(148,210,235,0.8)' : 'rgba(255,255,255,0.2)',
                  cursor: canSave ? 'pointer' : 'not-allowed',
                }}
                whileTap={canSave ? { scale: 0.97 } : {}}
              >
                <AnimatePresence mode="wait" initial={false}>
                  {saved ? (
                    <motion.span key="ok" className="flex items-center justify-center gap-2"
                      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
                      <Check size={14} /> Saved
                    </motion.span>
                  ) : (
                    <motion.span key="save" className="flex items-center justify-center gap-2"
                      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
                      <KeyRound size={14} /> Save Settings
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
