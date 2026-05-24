const STORAGE_KEY = 'neverland_memories';

export interface Message {
  id: number;
  role: 'user' | 'ai';
  text: string;
  english?: string;
  chinese?: string;
  imageDataUrl?: string; // base64 data URL for vision messages
}

export interface MemoryRecord {
  id: string;
  title: string;
  summary: string;
  savedAt: string; // ISO string
  messages: Message[];
}

// ─── Poetic title fragments ───────────────────────────────────────────────────

const TITLE_ADJECTIVES = [
  'Quiet', 'Luminous', 'Drifting', 'Twilight', 'Wandering',
  'Tender', 'Fleeting', 'Velvet', 'Distant', 'Gilded',
  'Moonlit', 'Whispering', 'Gossamer', 'Breathless', 'Fading',
  'Silver', 'Woven', 'Unspoken', 'Hollow', 'Eternal',
];
const TITLE_NOUNS = [
  'Reverie', 'Constellation', 'Tide', 'Echo', 'Solstice',
  'Lantern', 'Horizon', 'Fragment', 'Whisper', 'Current',
  'Garden', 'Elegy', 'Threshold', 'Shimmer', 'Silence',
  'Requiem', 'Ember', 'Shore', 'Veil', 'Nocturne',
];

export function generateTitle(): string {
  const adj  = TITLE_ADJECTIVES[Math.floor(Math.random() * TITLE_ADJECTIVES.length)];
  const noun = TITLE_NOUNS[Math.floor(Math.random() * TITLE_NOUNS.length)];
  return `${adj} ${noun}`;
}

// ─── Poetic summary ───────────────────────────────────────────────────────────
// Returns a single lyrical sentence that evokes the mood of the conversation.

const SUMMARY_TEMPLATES = [
  (topic: string) => `A tender exchange where ${topic} drifted between silence and wonder.`,
  (topic: string) => `Words like light on still water — ${topic} gently illuminated.`,
  (topic: string) => `In the space between questions, ${topic} bloomed quietly.`,
  (topic: string) => `Thoughts of ${topic} woven softly into the evening air.`,
  (topic: string) => `Where language falters, ${topic} was felt more than spoken.`,
  (topic: string) => `A moment held gently, turning ${topic} over like a stone in the palm.`,
  (topic: string) => `${topic} — considered slowly, with the care of someone who knows it matters.`,
  (topic: string) => `The conversation found its way to ${topic}, and stayed there a while.`,
];

function extractTopic(messages: Message[]): string {
  const first = messages.find(m => m.role === 'user');
  if (!first) return 'something unnamed';
  const raw = first.text.trim();
  // Take the first meaningful phrase (up to ~30 chars, ending at a natural boundary)
  const shortened = raw.length > 38
    ? raw.slice(0, 35).replace(/\s+\S*$/, '') + '…'
    : raw;
  // Lowercase for mid-sentence embedding
  return shortened.charAt(0).toLowerCase() + shortened.slice(1);
}

export function generateSummary(messages: Message[]): string {
  const topic = extractTopic(messages);
  const template = SUMMARY_TEMPLATES[Math.floor(Math.random() * SUMMARY_TEMPLATES.length)];
  return template(topic);
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function loadMemories(): MemoryRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as MemoryRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveMemory(messages: Message[]): MemoryRecord {
  const record: MemoryRecord = {
    id: `mem_${Date.now()}`,
    title: generateTitle(),
    summary: generateSummary(messages),
    savedAt: new Date().toISOString(),
    messages,
  };
  const existing = loadMemories();
  localStorage.setItem(STORAGE_KEY, JSON.stringify([record, ...existing]));
  return record;
}

export function deleteMemory(id: string): void {
  const updated = loadMemories().filter(r => r.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}
