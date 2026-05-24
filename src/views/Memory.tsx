import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Feather, Star, Clock, ChevronDown, MessageCircle, Sparkles,
  Trash2, CalendarDays, ChevronLeft, ChevronRight, X,
} from 'lucide-react';
import type { MemoryRecord, Message } from '../lib/storage';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// ─── Mini bubbles (read-only, inside expanded card) ──────────────────────────

function MiniAIBubble({ msg }: { msg: Message }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex justify-start">
      <div
        className="max-w-[88%] rounded-xl rounded-tl-sm px-3 py-2 cursor-pointer select-none"
        style={{ background: 'rgba(30,70,100,0.3)', border: '1px solid rgba(96,180,220,0.10)' }}
        onClick={() => setOpen(v => !v)}
      >
        <p className="font-serif text-xs font-light italic leading-relaxed text-white/60">
          "{msg.english}"
        </p>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ height: { duration: 0.3, ease: [0.4, 0, 0.2, 1] }, opacity: { duration: 0.2, delay: open ? 0.06 : 0 } }}
              style={{ overflow: 'hidden' }}
            >
              <div className="mt-2 pt-2" style={{ borderTop: '1px solid rgba(148,210,235,0.08)' }}>
                <p className="text-xs font-light leading-relaxed text-sky-200/40">{msg.chinese}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="mt-1 flex items-center gap-1">
          <span className="text-[9px] text-white/15">{open ? 'collapse' : 'translate'}</span>
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.25 }}
            style={{ display: 'inline-block', fontSize: 9, color: 'rgba(148,210,235,0.2)' }}
          >▾</motion.span>
        </div>
      </div>
    </div>
  );
}

function MiniUserBubble({ msg }: { msg: Message }) {
  return (
    <div className="flex justify-end">
      <div
        className="max-w-[84%] rounded-xl rounded-tr-sm px-3 py-2"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}
      >
        <p className="text-xs font-light leading-relaxed text-white/50">{msg.text}</p>
      </div>
    </div>
  );
}

// ─── Delete confirm button ────────────────────────────────────────────────────

function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm) {
      setConfirm(true);
      timerRef.current = setTimeout(() => setConfirm(false), 2800);
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
      onDelete();
    }
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <motion.button
      onClick={handleClick}
      className="flex items-center gap-1 px-2 py-1 rounded-lg flex-shrink-0"
      style={{
        background: confirm ? 'rgba(200,60,60,0.18)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${confirm ? 'rgba(220,80,80,0.3)' : 'rgba(255,255,255,0.07)'}`,
        transition: 'background 0.2s, border-color 0.2s',
      }}
      whileTap={{ scale: 0.92 }}
      aria-label={confirm ? 'Confirm delete' : 'Delete memory'}
    >
      <AnimatePresence mode="wait" initial={false}>
        {confirm ? (
          <motion.span key="confirm" className="flex items-center gap-1"
            initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.15 }}>
            <Trash2 size={10} style={{ color: 'rgba(240,100,100,0.8)' }} />
            <span className="text-[10px] font-light" style={{ color: 'rgba(240,100,100,0.7)' }}>Remove?</span>
          </motion.span>
        ) : (
          <motion.span key="idle" className="flex items-center"
            initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.15 }}>
            <Trash2 size={10} style={{ color: 'rgba(255,255,255,0.2)' }} />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

// ─── Memory card ─────────────────────────────────────────────────────────────

interface CardProps {
  record: MemoryRecord;
  index: number;
  onDelete: (id: string) => void;
  highlight?: boolean;
  cardRef?: React.RefObject<HTMLDivElement | null>;
}

function MemoryCard({ record, index, onDelete, highlight, cardRef }: CardProps) {
  const [expanded, setExpanded] = useState(false);
  const msgCount = record.messages.length;

  return (
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -8 }}
      transition={{ duration: 0.4, delay: index * 0.07, ease: [0.4, 0, 0.2, 1] }}
    >
      <div
        className="rounded-2xl overflow-hidden transition-shadow duration-500"
        style={{
          background: 'rgba(255,255,255,0.05)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: highlight
            ? '1px solid rgba(148,210,235,0.35)'
            : '1px solid rgba(255,255,255,0.09)',
          boxShadow: highlight
            ? '0 0 24px rgba(148,210,235,0.15), 0 4px 24px rgba(0,0,0,0.3)'
            : '0 4px 24px rgba(0,0,0,0.3)',
        }}
      >
        {/* Card header */}
        <button
          className="w-full text-left px-4 pt-4 pb-3"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <Star size={11} className="text-amber-300/40 fill-amber-300/20 flex-shrink-0" />
                <h3 className="font-serif text-base font-light text-white/75 truncate">{record.title}</h3>
              </div>
              <p className="text-xs font-light text-white/38 leading-relaxed line-clamp-2 pr-2 italic">
                {record.summary}
              </p>
            </div>
            <motion.div
              animate={{ rotate: expanded ? 180 : 0 }}
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
              className="flex-shrink-0 mt-0.5"
            >
              <ChevronDown size={15} style={{ color: 'rgba(255,255,255,0.2)' }} />
            </motion.div>
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-2 mt-3">
            <div className="flex items-center gap-1.5">
              <Clock size={10} className="text-white/20" />
              <span className="text-[10px] text-white/25 font-light">{formatDate(record.savedAt)}</span>
            </div>
            <span className="text-white/10">·</span>
            <span className="text-[10px] text-white/20 font-light">{formatTime(record.savedAt)}</span>
            <span className="text-white/10">·</span>
            <div className="flex items-center gap-1">
              <MessageCircle size={10} className="text-white/18" />
              <span className="text-[10px] text-white/20">{msgCount}</span>
            </div>
            {/* Push delete to the right */}
            <div className="flex-1" />
            <DeleteButton onDelete={() => onDelete(record.id)} />
          </div>
        </button>

        {/* Expandable conversation */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="history"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ height: { duration: 0.4, ease: [0.4, 0, 0.2, 1] }, opacity: { duration: 0.3, delay: expanded ? 0.05 : 0 } }}
              style={{ overflow: 'hidden' }}
            >
              <div
                className="mx-4 mb-4 pt-3 space-y-2"
                style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
              >
                <p className="text-[9px] tracking-[0.18em] uppercase text-white/18 mb-3">Full conversation</p>
                {record.messages.map(msg =>
                  msg.role === 'ai'
                    ? <MiniAIBubble key={msg.id} msg={msg} />
                    : <MiniUserBubble key={msg.id} msg={msg} />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ─── Calendar view ────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DAY_NAMES = ['Su','Mo','Tu','We','Th','Fr','Sa'];

// Group memories by YYYY-MM-DD
function groupByDate(memories: MemoryRecord[]): Record<string, MemoryRecord[]> {
  const map: Record<string, MemoryRecord[]> = {};
  for (const m of memories) {
    const key = m.savedAt.slice(0, 10); // YYYY-MM-DD
    if (!map[key]) map[key] = [];
    map[key].push(m);
  }
  return map;
}

interface CalendarViewProps {
  memories: MemoryRecord[];
  onClose: () => void;
  onSelectMemory: (id: string) => void;
}

function CalendarView({ memories, onClose, onSelectMemory }: CalendarViewProps) {
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [selected, setSelected] = useState<string | null>(null); // YYYY-MM-DD

  const grouped = groupByDate(memories);

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    setSelected(null);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    setSelected(null);
  };

  // Build grid: padding days + month days
  const firstDow = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  const pad = (n: number) => String(n).padStart(2, '0');
  const dateKey = (d: number) => `${year}-${pad(month + 1)}-${pad(d)}`;
  const isToday = (d: number) =>
    d === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  const selectedMemories = selected ? (grouped[selected] ?? []) : [];

  return (
    <motion.div
      className="absolute inset-0 z-50 flex flex-col"
      style={{
        background: 'linear-gradient(160deg, #07090e 0%, #0a0e18 55%, #060b13 100%)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
      }}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
    >
      {/* Star field */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {Array.from({ length: 40 }).map((_, i) => (
          <div key={i} className="absolute rounded-full bg-white"
            style={{
              width: i % 9 === 0 ? '2px' : '1px', height: i % 9 === 0 ? '2px' : '1px',
              top: `${(i * 43 + 7) % 100}%`, left: `${(i * 67 + 13) % 100}%`,
              opacity: ((i * 17) % 30) / 100 + 0.03,
            }}
          />
        ))}
      </div>

      {/* Header */}
      <div className="relative flex-shrink-0 flex items-center justify-between px-5 pt-6 pb-4">
        <div>
          <p className="text-[10px] tracking-[0.22em] uppercase text-white/25 font-light mb-0.5">Calendar</p>
          <h2 className="font-serif text-xl font-light text-white/65">Memory Archive</h2>
        </div>
        <motion.button
          onClick={onClose}
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}
          whileTap={{ scale: 0.9 }}
          aria-label="Close calendar"
        >
          <X size={14} style={{ color: 'rgba(255,255,255,0.35)' }} />
        </motion.button>
      </div>

      {/* Month nav */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 pb-4">
        <motion.button
          onClick={prevMonth}
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
          whileTap={{ scale: 0.9 }}
          aria-label="Previous month"
        >
          <ChevronLeft size={14} style={{ color: 'rgba(255,255,255,0.35)' }} />
        </motion.button>

        <motion.div
          key={`${year}-${month}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
          className="text-center"
        >
          <p className="font-serif text-lg font-light text-white/70 tracking-wide">
            {MONTH_NAMES[month]}
          </p>
          <p className="text-[11px] text-white/25 font-light tracking-[0.12em]">{year}</p>
        </motion.div>

        <motion.button
          onClick={nextMonth}
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
          whileTap={{ scale: 0.9 }}
          aria-label="Next month"
        >
          <ChevronRight size={14} style={{ color: 'rgba(255,255,255,0.35)' }} />
        </motion.button>
      </div>

      {/* Day labels */}
      <div className="flex-shrink-0 grid grid-cols-7 px-4 pb-2">
        {DAY_NAMES.map(d => (
          <div key={d} className="text-center text-[10px] tracking-widest uppercase text-white/20 font-light">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="flex-shrink-0 px-4 pb-3">
        <motion.div
          key={`${year}-${month}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
          className="grid grid-cols-7 gap-y-1"
        >
          {cells.map((day, idx) => {
            if (day === null) return <div key={`empty-${idx}`} />;
            const key = dateKey(day);
            const hasMemories = !!grouped[key]?.length;
            const count = grouped[key]?.length ?? 0;
            const isSelected = selected === key;
            const isTodayCell = isToday(day);

            return (
              <motion.button
                key={key}
                onClick={() => setSelected(isSelected ? null : key)}
                className="relative flex flex-col items-center justify-center h-10 rounded-xl mx-0.5"
                style={{
                  background: isSelected
                    ? 'rgba(148,210,235,0.15)'
                    : hasMemories
                    ? 'rgba(148,210,235,0.05)'
                    : 'transparent',
                  border: isSelected
                    ? '1px solid rgba(148,210,235,0.3)'
                    : hasMemories
                    ? '1px solid rgba(148,210,235,0.12)'
                    : '1px solid transparent',
                  transition: 'background 0.2s, border-color 0.2s',
                }}
                whileTap={{ scale: 0.88 }}
                aria-label={`${MONTH_NAMES[month]} ${day}`}
              >
                <span
                  className="text-[13px] font-light leading-none"
                  style={{
                    color: isSelected
                      ? 'rgba(148,210,235,0.9)'
                      : isTodayCell
                      ? 'rgba(200,235,248,0.8)'
                      : hasMemories
                      ? 'rgba(255,255,255,0.65)'
                      : 'rgba(255,255,255,0.2)',
                    fontWeight: isTodayCell ? 400 : 300,
                  }}
                >
                  {day}
                </span>
                {/* Dot(s) for memories */}
                {hasMemories && (
                  <div className="flex gap-[3px] mt-0.5">
                    {Array.from({ length: Math.min(count, 3) }).map((_, di) => (
                      <div
                        key={di}
                        className="rounded-full"
                        style={{
                          width: 3, height: 3,
                          background: isSelected ? 'rgba(148,210,235,0.8)' : 'rgba(148,210,235,0.45)',
                        }}
                      />
                    ))}
                  </div>
                )}
                {/* Today ring */}
                {isTodayCell && (
                  <div className="absolute inset-0 rounded-xl pointer-events-none"
                    style={{ border: '1px solid rgba(200,235,248,0.2)' }}
                  />
                )}
              </motion.button>
            );
          })}
        </motion.div>
      </div>

      {/* Divider */}
      <div className="mx-5 flex-shrink-0" style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)' }} />

      {/* Selected day memories */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4">
        <AnimatePresence mode="wait">
          {selected && selectedMemories.length > 0 ? (
            <motion.div
              key={selected}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="space-y-2"
            >
              <p className="text-[10px] tracking-[0.18em] uppercase text-white/22 font-light mb-3">
                {new Date(selected + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
              {selectedMemories.map((mem) => (
                <motion.button
                  key={mem.id}
                  onClick={() => { onSelectMemory(mem.id); onClose(); }}
                  className="w-full text-left rounded-xl px-4 py-3"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    backdropFilter: 'blur(16px)',
                    WebkitBackdropFilter: 'blur(16px)',
                  }}
                  whileTap={{ scale: 0.98 }}
                >
                  <div className="flex items-start gap-2.5">
                    <Star size={10} className="text-amber-300/35 fill-amber-300/15 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="font-serif text-sm font-light text-white/70 truncate">{mem.title}</p>
                      <p className="text-[11px] font-light text-white/32 italic leading-relaxed mt-0.5 line-clamp-1">
                        {mem.summary}
                      </p>
                      <p className="text-[10px] text-white/20 mt-1">{formatTime(mem.savedAt)}</p>
                    </div>
                    <ChevronRight size={12} className="flex-shrink-0 mt-0.5 text-white/15" />
                  </div>
                </motion.button>
              ))}
            </motion.div>
          ) : selected && selectedMemories.length === 0 ? (
            <motion.div
              key="empty-day"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="text-center pt-6"
            >
              <p className="text-sm font-light text-white/22 italic">No memories on this day.</p>
            </motion.div>
          ) : (
            <motion.div
              key="prompt"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="text-center pt-8"
            >
              <div className="flex items-center justify-center mb-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(148,210,235,0.06)', border: '1px solid rgba(148,210,235,0.1)' }}>
                  <CalendarDays size={16} style={{ color: 'rgba(148,210,235,0.3)' }} />
                </div>
              </div>
              <p className="text-sm font-light text-white/22 italic">
                Tap a glowing date to see what bloomed there.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <motion.div
      className="flex flex-col items-center justify-center h-full px-8 text-center"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    >
      <div className="relative mb-6">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{
            background: 'radial-gradient(circle, rgba(80,140,180,0.15) 0%, transparent 70%)',
            border: '1px solid rgba(148,210,235,0.1)',
          }}
        >
          <Feather size={28} style={{ color: 'rgba(148,210,235,0.3)' }} />
        </div>
        <motion.div
          className="absolute -top-1 -right-1"
          animate={{ rotate: [0, 15, -10, 0], opacity: [0.4, 0.8, 0.4] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Sparkles size={14} style={{ color: 'rgba(148,210,235,0.4)' }} />
        </motion.div>
      </div>
      <h3 className="font-serif text-xl font-light text-white/40 mb-3">Nothing yet</h3>
      <p className="text-sm font-light text-white/22 leading-relaxed max-w-[220px]">
        Save a conversation from The Garden and it will bloom here.
      </p>
    </motion.div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

interface Props {
  memories: MemoryRecord[];
  onDelete: (id: string) => void;
}

export default function Memory({ memories, onDelete }: Props) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, React.RefObject<HTMLDivElement | null>>>({});

  // Ensure each memory has a ref
  for (const m of memories) {
    if (!cardRefs.current[m.id]) {
      cardRefs.current[m.id] = { current: null };
    }
  }

  const handleSelectMemory = (id: string) => {
    setHighlightId(id);
    // Scroll to card and clear highlight after a moment
    setTimeout(() => {
      cardRefs.current[id]?.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    setTimeout(() => setHighlightId(null), 2200);
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* Section header */}
      <div className="flex-shrink-0 px-5 pt-6 pb-4">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="flex items-center gap-2 mb-1">
            <Feather size={12} className="text-sky-300/40" />
            <span className="text-[10px] tracking-[0.22em] uppercase text-white/25 font-light">Memory</span>
          </div>
          <div className="flex items-end justify-between">
            <h2 className="font-serif text-2xl font-light text-white/65">Fragments &amp; Echoes</h2>
            <div className="flex items-center gap-2 pb-0.5">
              {memories.length > 0 && (
                <span
                  className="text-xs text-white/25 font-light"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '2px 8px' }}
                >
                  {memories.length}
                </span>
              )}
              {/* Calendar button */}
              <motion.button
                onClick={() => setCalendarOpen(true)}
                className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
                whileTap={{ scale: 0.9 }}
                aria-label="Open memory calendar"
              >
                <CalendarDays size={14} style={{ color: 'rgba(148,210,235,0.5)' }} />
              </motion.button>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Content */}
      {memories.length === 0 ? (
        <div className="flex-1"><EmptyState /></div>
      ) : (
        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-6 space-y-3">
          <AnimatePresence>
            {memories.map((record, i) => (
              <MemoryCard
                key={record.id}
                record={record}
                index={i}
                onDelete={onDelete}
                highlight={highlightId === record.id}
                cardRef={cardRefs.current[record.id]}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Calendar overlay */}
      <AnimatePresence>
        {calendarOpen && (
          <CalendarView
            memories={memories}
            onClose={() => setCalendarOpen(false)}
            onSelectMemory={handleSelectMemory}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
