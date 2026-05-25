import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Image, Send, BookmarkPlus, Check, AlertCircle, Volume2, VolumeX, RotateCcw, X } from 'lucide-react';
import type { Message } from '../lib/storage';
import { sendMessage as sendToAI, translateToChineseFallback, getApiKey, getProvider } from '../lib/ai';
import { speak, stopSpeaking, unlockAudio } from '../lib/speech';

interface ChatMessage extends Message {
  isThinking?: boolean;
  error?: string;
}

type VoiceState = 'idle' | 'speaking';

let nextId = 100;

// ─── StardustOrb ──────────────────────────────────────────────────────────────

function StardustOrb({ thinking }: { thinking: boolean }) {
  const active = thinking;

  const coreColor = thinking
    ? 'rgba(60,200,200,0.45)'
    : 'rgba(80,140,180,0.32)';

  const glowColor = thinking
    ? 'rgba(60,200,200,0.14)'
    : 'rgba(80,140,180,0.10)';

  const borderColor = thinking
    ? 'rgba(103,232,249,0.15)'
    : 'rgba(148,210,235,0.08)';

  const particleColor = 'rgba(148,210,235,0.35)';

  return (
    <div className="relative flex items-center justify-center w-44 h-44">
      {/* Outer glow */}
      <motion.div
        className="absolute rounded-full"
        style={{ width: 176, height: 176, background: `radial-gradient(circle, ${glowColor} 0%, transparent 70%)` }}
        animate={{ scale: [1, 1.12, 1], opacity: [0.5, 0.9, 0.5] }}
        transition={{ duration: active ? 2.2 : 4, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* Inner ring */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 134, height: 134,
          background: `radial-gradient(circle, ${thinking ? 'rgba(60,200,200,0.18)' : 'rgba(80,140,180,0.12)'} 0%, transparent 65%)`,
          border: `1px solid ${borderColor}`,
        }}
        animate={{ scale: [1, 1.08, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: active ? 2.2 : 4, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
      />

      {/* Thinking spinner */}
      <AnimatePresence>
        {thinking && (
          <motion.div
            className="absolute rounded-full"
            style={{ width: 100, height: 100, border: '1.5px solid transparent', borderTopColor: 'rgba(103,232,249,0.5)', borderRightColor: 'rgba(103,232,249,0.15)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, rotate: 360 }}
            exit={{ opacity: 0 }}
            transition={{ rotate: { duration: 1.8, repeat: Infinity, ease: 'linear' }, opacity: { duration: 0.3 } }}
          />
        )}
      </AnimatePresence>

      {/* Orbit particles */}
      {[...Array(8)].map((_, i) => {
        const angle = (i / 8) * 2 * Math.PI;
        const r = 40;
        return (
          <motion.div
            key={i}
            className="absolute rounded-full"
            style={{
              width: i % 3 === 0 ? 3 : 2,
              height: i % 3 === 0 ? 3 : 2,
              background: particleColor,
              translateX: Math.cos(angle) * r,
              translateY: Math.sin(angle) * r,
            }}
            animate={{ opacity: [0.2, 0.8, 0.2], scale: [0.8, 1.4, 0.8] }}
            transition={{ duration: active ? 1.8 : 3.5, repeat: Infinity, ease: 'easeInOut', delay: i * 0.2 }}
          />
        );
      })}

      {/* Core sphere */}
      <motion.div
        className="relative rounded-full"
        style={{
          width: 78, height: 78,
          background: `radial-gradient(circle at 38% 35%, rgba(255,255,255,0.12) 0%, ${coreColor} 40%, rgba(10,30,50,0.6) 100%)`,
          boxShadow: `0 0 30px ${thinking ? 'rgba(60,200,200,0.3)' : 'rgba(80,140,180,0.2)'}, inset 0 0 20px rgba(255,255,255,0.06)`,
          border: '1px solid rgba(255,255,255,0.12)',
        }}
        animate={{ scale: [1, active ? 1.08 : 1.06, 1] }}
        transition={{ duration: active ? 2.2 : 4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <div className="absolute rounded-full" style={{ width: 28, height: 28, top: 11, left: 13, background: 'radial-gradient(circle, rgba(255,255,255,0.18) 0%, transparent 70%)' }} />
      </motion.div>
    </div>
  );
}

// ─── Chat bubbles ─────────────────────────────────────────────────────────────

interface AIBubbleProps {
  msg: ChatMessage;
  isSpeaking: boolean;
  onSpeak: (text: string) => void;
  onStop: () => void;
  onRetryTranslation: () => void;
}

function AIBubble({ msg, isSpeaking, onSpeak, onStop, onRetryTranslation }: AIBubbleProps) {
  const [expanded, setExpanded] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => { if (msg.chinese) setRetrying(false); }, [msg.chinese]);

  if (msg.isThinking) {
    return (
      <div className="flex justify-start">
        <motion.div
          className="rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2"
          style={{ background: 'rgba(30,70,100,0.3)', border: '1px solid rgba(96,180,220,0.10)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          {[0, 0.18, 0.36].map(d => (
            <motion.div key={d} className="w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(148,210,235,0.5)' }} animate={{ opacity: [0.3, 1, 0.3], y: [0, -4, 0] }} transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut', delay: d }} />
          ))}
        </motion.div>
      </div>
    );
  }

  if (msg.error) {
    return (
      <div className="flex justify-start">
        <motion.div
          className="max-w-[82%] min-w-0 rounded-2xl rounded-tl-sm px-4 py-3 flex items-start gap-2 overflow-hidden"
          style={{ background: 'rgba(180,40,40,0.15)', border: '1px solid rgba(220,80,80,0.2)' }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <AlertCircle size={14} className="text-red-400/70 mt-0.5 flex-shrink-0" />
          <p className="text-xs font-light text-red-300/60 leading-relaxed break-words overflow-hidden min-w-0">{msg.error}</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex justify-start items-end gap-2">
      <motion.div
        className="max-w-[78%] rounded-2xl rounded-tl-sm px-4 py-3 cursor-pointer select-none"
        style={{ background: 'rgba(30,70,100,0.35)', border: '1px solid rgba(96,180,220,0.12)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', boxShadow: '0 2px 16px rgba(0,0,0,0.25)' }}
        initial={{ opacity: 0, y: 8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
        whileTap={{ scale: 0.98 }}
        onClick={() => setExpanded(e => !e)}
      >
        <p className="font-serif text-sm font-light italic leading-relaxed text-white/70 break-words overflow-hidden">
          "{msg.english}"
        </p>
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="t"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ height: { duration: 0.35, ease: [0.4, 0, 0.2, 1] }, opacity: { duration: 0.25, delay: expanded ? 0.08 : 0 } }}
              style={{ overflow: 'hidden' }}
            >
              <div className="mt-2.5 pt-2.5" style={{ borderTop: '1px solid rgba(148,210,235,0.1)' }}>
                {msg.chinese ? (
                  <p className="text-sm font-light leading-relaxed text-sky-200/50 break-words overflow-hidden">{msg.chinese}</p>
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-light" style={{ color: 'rgba(148,210,235,0.25)', fontStyle: 'italic' }}>
                      {retrying ? '正在获取翻译…' : '翻译未能加载'}
                    </p>
                    {!retrying && (
                      <motion.button
                        onClick={e => {
                          e.stopPropagation();
                          setRetrying(true);
                          onRetryTranslation();
                        }}
                        className="flex items-center justify-center w-5 h-5 rounded-md flex-shrink-0"
                        style={{ background: 'rgba(148,210,235,0.08)', border: '1px solid rgba(148,210,235,0.14)' }}
                        whileTap={{ scale: 0.87 }}
                        aria-label="Retry translation"
                      >
                        <RotateCcw size={10} style={{ color: 'rgba(148,210,235,0.45)' }} />
                      </motion.button>
                    )}
                    {retrying && (
                      <motion.div
                        className="w-3 h-3 rounded-full border border-t-transparent flex-shrink-0"
                        style={{ borderColor: 'rgba(148,210,235,0.35)', borderTopColor: 'transparent' }}
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      />
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="mt-1.5 flex items-center gap-1">
          <span className="text-[10px] text-white/20 tracking-wide">{expanded ? 'tap to collapse' : 'tap to translate'}</span>
          <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }} style={{ display: 'inline-block', fontSize: 10, color: 'rgba(148,210,235,0.3)' }}>▾</motion.span>
        </div>
      </motion.div>

      {/* Speaker button */}
      {msg.english && (
        <motion.button
          onClick={e => { e.stopPropagation(); isSpeaking ? onStop() : onSpeak(msg.english!); }}
          className="flex-shrink-0 w-7 h-7 rounded-xl flex items-center justify-center mb-0.5"
          style={{
            background: isSpeaking ? 'rgba(80,200,140,0.15)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${isSpeaking ? 'rgba(80,200,140,0.25)' : 'rgba(255,255,255,0.08)'}`,
          }}
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.2 }}
          whileTap={{ scale: 0.87 }}
          aria-label={isSpeaking ? 'Stop' : 'Read aloud'}
        >
          {isSpeaking
            ? <VolumeX size={12} style={{ color: 'rgba(80,200,140,0.8)' }} />
            : <Volume2 size={12} style={{ color: 'rgba(148,210,235,0.5)' }} />
          }
        </motion.button>
      )}
    </div>
  );
}

function UserBubble({ msg }: { msg: ChatMessage }) {
  return (
    <div className="flex justify-end">
      <motion.div
        className="max-w-[78%] rounded-2xl rounded-tr-sm overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
        initial={{ opacity: 0, y: 8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      >
        {msg.imageDataUrl && (
          <img
            src={msg.imageDataUrl}
            alt="Attached"
            className="w-full max-h-52 object-cover"
            style={{ borderBottom: msg.text ? '1px solid rgba(255,255,255,0.07)' : undefined }}
          />
        )}
        {msg.text && (
          <p className="px-4 py-3 text-sm font-light leading-relaxed text-white/60 break-words overflow-hidden">{msg.text}</p>
        )}
      </motion.div>
    </div>
  );
}

// ─── Save button ──────────────────────────────────────────────────────────────

function SaveButton({ onSave }: { onSave: () => void }) {
  const [saved, setSaved] = useState(false);
  const handle = () => {
    if (saved) return;
    onSave();
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };
  return (
    <motion.button
      onClick={handle}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
      style={{ background: saved ? 'rgba(56,180,120,0.15)' : 'rgba(255,255,255,0.06)', border: `1px solid ${saved ? 'rgba(56,180,120,0.25)' : 'rgba(255,255,255,0.09)'}`, backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
      whileTap={{ scale: 0.93 }}
      aria-label="Save memory"
    >
      <AnimatePresence mode="wait" initial={false}>
        {saved ? (
          <motion.span key="ok" className="flex items-center gap-1.5" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={{ duration: 0.2 }}>
            <Check size={13} style={{ color: 'rgba(80,200,140,0.85)' }} />
            <span className="text-[11px] font-light tracking-wide" style={{ color: 'rgba(80,200,140,0.75)' }}>Saved</span>
          </motion.span>
        ) : (
          <motion.span key="save" className="flex items-center gap-1.5" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={{ duration: 0.2 }}>
            <BookmarkPlus size={13} style={{ color: 'rgba(255,255,255,0.4)' }} />
            <span className="text-[11px] font-light tracking-wide text-white/35">Save Memory</span>
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

// ─── No-key warning ───────────────────────────────────────────────────────────

function NoKeyBanner() {
  return (
    <motion.div
      className="mx-4 mb-3 px-3 py-2.5 rounded-xl flex items-center gap-2"
      style={{ background: 'rgba(180,120,30,0.12)', border: '1px solid rgba(220,160,50,0.18)' }}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <AlertCircle size={13} className="text-amber-400/60 flex-shrink-0" />
      <p className="text-[11px] font-light text-amber-300/50 leading-relaxed">
        No API key set. Tap the settings icon to add your key.
      </p>
    </motion.div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

interface Props {
  onSave: (messages: Message[]) => void;
}

export default function TheGarden({ onSave }: Props) {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [isThinking, setIsThinking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(() => !!getApiKey(getProvider()));
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const micErrorTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); });
  }, [messages, isThinking]);

  useEffect(() => {
    if (micErrorTimeout.current) clearTimeout(micErrorTimeout.current);
    if (!micError) return;
    const ms = micError.length > 40 ? 7000 : 4000;
    micErrorTimeout.current = setTimeout(() => setMicError(null), ms);
    return () => {
      if (micErrorTimeout.current) clearTimeout(micErrorTimeout.current);
    };
  }, [micError]);

  // ─── TTS helpers ────────────────────────────────────────────────────────────

  const speakMessage = useCallback((text: string, id: number) => {
    stopSpeaking();
    setSpeakingId(id);
    setVoiceState('speaking');
    speak(text, {
      onEnd: () => { setSpeakingId(null); setVoiceState('idle'); },
      onError: (msg) => { setSpeakingId(null); setVoiceState('idle'); setMicError(msg); },
    });
  }, []);

  const stopSpeakingNow = useCallback(() => {
    stopSpeaking();
    setSpeakingId(null);
    setVoiceState('idle');
  }, []);

  // ─── Translation retry ────────────────────────────────────────────────────────

  const retryTranslation = useCallback(async (id: number, english: string) => {
    if (!english) return;
    const chinese = await translateToChineseFallback(english);
    if (chinese) {
      setMessages(prev => prev.map(m => m.id === id ? { ...m, chinese } : m));
    }
  }, []);

  // ─── Core send ───────────────────────────────────────────────────────────────

  const buildHistory = (msgs: ChatMessage[]) =>
    msgs
      .filter(m => !m.isThinking && !m.error)
      .map(m => ({
        role: m.role === 'ai' ? 'model' as const : 'user' as const,
        text: m.role === 'ai' ? (m.english ?? '') : m.text,
        imageDataUrl: m.imageDataUrl,
      }));

  const sendMessage = async (text: string, imageOverride?: string | null) => {
    const trimmed = text.trim();
    const image = imageOverride !== undefined ? imageOverride : selectedImage;
    if (!trimmed && !image) return;
    if (isThinking) return;

    const key = getApiKey(getProvider());
    setHasKey(!!key);

    const userMsg: ChatMessage = { id: nextId++, role: 'user', text: trimmed, imageDataUrl: image ?? undefined };
    const thinkingMsg: ChatMessage = { id: nextId++, role: 'ai', text: '', isThinking: true };

    setMessages(prev => [...prev, userMsg, thinkingMsg]);
    setInputText('');
    setSelectedImage(null);
    setIsThinking(true);

    try {
      const historyWithout = buildHistory(messages);
      const reply = await sendToAI(historyWithout, trimmed, image);
      const aiId = nextId++;

      setMessages(prev => {
        const without = prev.filter(m => !m.isThinking);
        const aiMsg: ChatMessage = { id: aiId, role: 'ai', text: '', english: reply.english, chinese: reply.chinese };
        return [...without, aiMsg];
      });

      if (!reply.chinese && reply.english) {
        retryTranslation(aiId, reply.english);
      }

      speakMessage(reply.english, aiId);
    } catch (err) {
      const raw = (err as Error).message ?? 'Unknown error';
      const friendly = raw === 'NO_KEY'
        ? 'No API key found. Please add your key in Settings.'
        : `Something went wrong: ${raw}`;
      setMessages(prev => {
        const without = prev.filter(m => !m.isThinking);
        return [...without, { id: nextId++, role: 'ai', text: '', error: friendly }];
      });
    } finally {
      setIsThinking(false);
    }
  };

  const handleSend = () => { unlockAudio(); sendMessage(inputText); };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleImageChange = (file: File | null) => {
    if (!file) { setSelectedImage(null); return; }
    const reader = new FileReader();
    reader.onload = (ev) => setSelectedImage(ev.target?.result as string ?? null);
    reader.readAsDataURL(file);
    // Reset the input so selecting the same file again triggers onChange
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const savableMessages: Message[] = messages
    .filter(m => !m.isThinking && !m.error)
    .map(({ id, role, text, english, chinese, imageDataUrl }) => ({ id, role, text, english, chinese, imageDataUrl }));

  const orbLabel = isThinking
    ? 'Thinking…'
    : voiceState === 'speaking'
    ? 'Speaking…'
    : 'Type below to begin';

  return (
    <div className="flex flex-col h-full" onClick={unlockAudio}>

      {/* ── Scrollable content ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar">

        {/* Orb hero */}
        <div className="relative flex flex-col items-center pt-5 pb-3 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <motion.div
              className="absolute rounded-full"
              style={{ width: 300, height: 300, top: '-15%', left: '-20%', background: 'radial-gradient(circle, rgba(40,100,150,0.14) 0%, transparent 65%)', filter: 'blur(48px)' }}
              animate={{ x: [0, 20, 0], y: [0, -15, 0] }}
              transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>

          {savableMessages.length > 0 && (
            <div className="absolute top-4 right-4 z-20">
              <SaveButton onSave={() => onSave(savableMessages)} />
            </div>
          )}

          <motion.p
            className="font-serif text-lg font-light italic text-white/30 mb-4 z-10"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            What's on your mind?
          </motion.p>

          <div className="z-10">
            <StardustOrb thinking={isThinking} />
          </div>

          <div className="z-10 h-8 flex items-center justify-center mt-3">
            <motion.p
              key={orbLabel}
              className="text-[11px] tracking-[0.18em] uppercase text-white/25"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              {orbLabel}
            </motion.p>
          </div>
        </div>

        {/* Divider */}
        <div className="mx-6 mb-5" style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)' }} />

        {/* No key banner */}
        {!hasKey && <NoKeyBanner />}

        {/* Error toast for TTS failures */}
        <AnimatePresence>
          {micError && (
            <motion.div
              className="mx-4 mb-3 px-3 py-3 rounded-xl flex items-start gap-2.5 cursor-pointer"
              style={{ background: 'rgba(180,40,40,0.16)', border: '1px solid rgba(220,80,80,0.22)' }}
              initial={{ opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.25 }}
              onClick={() => setMicError(null)}
            >
              <AlertCircle size={14} className="text-red-400/70 flex-shrink-0 mt-0.5" />
              <p className="text-[11.5px] font-light text-red-200/65 leading-relaxed">{micError}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chat messages */}
        <div className="px-4 space-y-3 pb-40">
          {messages.length === 0 && (
            <motion.p
              className="text-center text-xs text-white/18 font-light italic pt-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
            >
              Your conversation will appear here…
            </motion.p>
          )}
          {messages.map(msg =>
            msg.role === 'ai'
              ? (
                <AIBubble
                  key={msg.id}
                  msg={msg}
                  isSpeaking={speakingId === msg.id}
                  onSpeak={(text) => speakMessage(text, msg.id)}
                  onStop={stopSpeakingNow}
                  onRetryTranslation={() => retryTranslation(msg.id, msg.english ?? '')}
                />
              )
              : <UserBubble key={msg.id} msg={msg} />
          )}
        </div>
      </div>

      {/* ── Input bar ── */}
      <div className="flex-shrink-0 px-4 pb-3 pt-2">
        {/* Image preview */}
        <AnimatePresence>
          {selectedImage && (
            <motion.div
              className="relative mb-2 w-fit"
              initial={{ opacity: 0, y: 6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.96 }}
              transition={{ duration: 0.2 }}
            >
              <img
                src={selectedImage}
                alt="preview"
                className="h-20 max-w-[180px] rounded-xl object-cover"
                style={{ border: '1px solid rgba(148,210,235,0.2)', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}
              />
              <motion.button
                onClick={() => setSelectedImage(null)}
                className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(20,30,45,0.95)', border: '1px solid rgba(255,255,255,0.18)' }}
                whileTap={{ scale: 0.88 }}
                aria-label="Remove image"
              >
                <X size={10} style={{ color: 'rgba(255,255,255,0.7)' }} />
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        <div
          className="flex items-center gap-2 px-3 py-2.5 rounded-2xl"
          style={{ background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,0.10)', boxShadow: '0 8px 32px rgba(0,0,0,0.35)' }}
        >
          {/* Image upload */}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => handleImageChange(e.target.files?.[0] ?? null)} />
          <motion.button
            onClick={() => fileInputRef.current?.click()}
            className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-xl"
            style={{ background: selectedImage ? 'rgba(96,180,220,0.15)' : 'rgba(255,255,255,0.04)', border: `1px solid ${selectedImage ? 'rgba(96,180,220,0.25)' : 'rgba(255,255,255,0.07)'}` }}
            whileTap={{ scale: 0.92 }}
            aria-label="Upload image"
          >
            <Image size={16} style={{ color: selectedImage ? 'rgba(148,210,235,0.8)' : 'rgba(255,255,255,0.3)' }} />
          </motion.button>

          {/* Text input */}
          <input
            ref={textInputRef}
            type="text"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={selectedImage ? 'Ask about the image…' : 'Say something…'}
            disabled={isThinking}
            className="flex-1 bg-transparent text-base font-light text-white/65 placeholder-white/18 outline-none min-w-0"
            style={{ caretColor: 'rgba(148,210,235,0.8)' }}
          />

          {/* Send button */}
          {(() => {
            const canSend = (!!inputText.trim() || !!selectedImage) && !isThinking;
            return (
              <motion.button
                onClick={handleSend}
                disabled={!canSend}
                className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full transition-all"
                style={{
                  background: canSend ? 'rgba(96,180,220,0.2)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${canSend ? 'rgba(148,210,235,0.25)' : 'rgba(255,255,255,0.07)'}`,
                }}
                whileTap={canSend ? { scale: 0.9 } : {}}
                aria-label="Send"
              >
                <Send size={16} style={{ color: canSend ? 'rgba(148,210,235,0.8)' : 'rgba(255,255,255,0.2)' }} />
              </motion.button>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
