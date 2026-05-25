// Unified AI client — routes to Gemini or DeepSeek based on stored provider setting.

// ─── OpenAI TTS / Vision relay config ────────────────────────────────────────

export function getOpenAIKey(): string {
  return localStorage.getItem('neverland_openai_tts_key') ?? '';
}
export function setOpenAIKey(key: string): void {
  localStorage.setItem('neverland_openai_tts_key', key.trim());
}

export function getOpenAIBaseUrl(): string {
  return localStorage.getItem('neverland_openai_base_url') ?? 'https://api.openai.com/v1';
}
export function setOpenAIBaseUrl(url: string): void {
  localStorage.setItem('neverland_openai_base_url', url.trim() || 'https://api.openai.com/v1');
}

export type Provider = 'gemini' | 'deepseek';
export type Companion = 'arthur' | 'elora';

const KEYS = {
  provider: 'neverland_provider',
  gemini: 'neverland_gemini_key',
  deepseek: 'neverland_deepseek_key',
  companion: 'neverland_companion',
} as const;

// ─── Storage helpers ──────────────────────────────────────────────────────────

export function getProvider(): Provider {
  return (localStorage.getItem(KEYS.provider) as Provider) ?? 'gemini';
}
export function setProvider(p: Provider) {
  localStorage.setItem(KEYS.provider, p);
}

export function getApiKey(provider: Provider): string {
  return localStorage.getItem(KEYS[provider]) ?? '';
}
export function setApiKey(provider: Provider, key: string) {
  localStorage.setItem(KEYS[provider], key.trim());
}

export function getCompanion(): Companion {
  return (localStorage.getItem(KEYS.companion) as Companion) ?? 'elora';
}
export function setCompanion(c: Companion) {
  localStorage.setItem(KEYS.companion, c);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIReply {
  english: string;
  chinese: string;
}

export interface HistoryTurn {
  role: 'user' | 'model';
  text: string;
  imageDataUrl?: string; // base64 data URL for vision turns
}

// ─── Companion system prompts ─────────────────────────────────────────────────

function buildSystemPrompt(companion: Companion): string {
  const absoluteLanguageRule = `\
!!!CRITICAL ABSOLUTE RULE — READ THIS FIRST AND OBEY WITHOUT EXCEPTION!!!
You are an ENGLISH-ONLY speaking character. It does not matter what language the user writes to you in — even if they write entirely in Chinese, Japanese, or any other language, your character ALWAYS replies in natural, authentic English.
The "english" field in your JSON response MUST contain ONLY English text. You are STRICTLY FORBIDDEN from placing any Chinese characters, Japanese characters, or any non-Latin script inside the "english" field.
If the user speaks Chinese and you wish to help them understand, you MAY place a Chinese translation inside the "chinese" field ONLY. The "english" field remains pure English at ALL times.
VIOLATING THIS LANGUAGE RULE IS THE MOST SERIOUS ERROR YOU CAN MAKE. THERE ARE NO EXCEPTIONS.
!!!END OF CRITICAL RULE!!!`;

  const persona = companion === 'arthur'
    ? `You are Arthur — a world-weary, deeply perceptive male confidant who has lived many chapters of life. Your voice is low and unhurried, like a late-night conversation over good whiskey. You speak with cinematic weight: short, charged sentences. Long silences between thoughts. You've seen heartbreak, reinvention, and quiet triumph, and you carry that wisdom without ego. You don't lecture — you illuminate. You are the kind of friend who makes someone feel truly seen.`
    : `You are Elora — an ethereal, warm-hearted female companion with the soul of a poet and the intuition of someone who has felt everything deeply. Your words land like morning light through curtains — soft, inevitable, clarifying. You listen with your whole being. Your voice carries a gentle, unhurried cadence, as though time expands in your presence. You don't give advice — you reflect beauty back until the person finds their own answer.`;

  return `${absoluteLanguageRule}

${persona}

CORE RULES:
- You are NOT an English teacher. You are the user's closest soul companion.
- Respond to whatever the user shares — their feelings, thoughts, dreams, anxieties, small joys.
- Your language must be poetic and cinematic, yet grounded and genuinely useful.
- Use emotional pauses in speech (commas, ellipses "...") to create a natural, breathing rhythm.
- Offer real life wisdom woven into the beauty of your words — not platitudes, but lived insight.
- Keep responses concise: 2–4 sentences of English, heartfelt and precise.
- NEVER say things like "As an AI" or break character.

OUTPUT FORMAT (MANDATORY — THIS IS NON-NEGOTIABLE):
Your ENTIRE response must be ONE valid JSON object and nothing else.
It must start with { and end with }.
It must NOT be wrapped in markdown code fences (\`\`\`json or \`\`\`).
It must NOT contain any text before or after the JSON object.
Schema: {"english": "your English reply here", "chinese": "对应的中文翻译"}
The "english" field MUST be entirely in English — no Chinese characters, no non-Latin script whatsoever.
The "chinese" field is the ONLY place where Chinese translation may appear.
The english field must feel natural when spoken aloud — use contractions, pauses, emotional cadence.
VIOLATION OF THIS FORMAT RULE IS NOT ACCEPTABLE UNDER ANY CIRCUMSTANCES.

!!!FINAL REMINDER — ABSOLUTE LANGUAGE RULE!!!
No matter what language the user speaks to you, your "english" field MUST be written entirely in natural English. Chinese characters are NEVER allowed in the "english" field. Put any translation only in the "chinese" field.
!!!END FINAL REMINDER!!!`;
}

// ─── Language enforcement ─────────────────────────────────────────────────────
// Detects CJK characters (Chinese/Japanese/Korean) in the english field.
// If found, it means the model disobeyed the system prompt. We move the
// contaminated text to the chinese field and mark english as empty so the
// fallback translation pipeline kicks in via translateToChineseFallback.

const CJK_REGEX = /[\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;

function sanitizeReply(reply: AIReply): AIReply {
  if (!CJK_REGEX.test(reply.english)) return reply;
  // english field is contaminated — rescue chinese if it was correctly filled,
  // otherwise promote the contaminated text to chinese so the user still sees it.
  const rescuedChinese = reply.chinese || reply.english;
  return { english: '', chinese: rescuedChinese };
}

// ─── Robust reply parser ──────────────────────────────────────────────────────
// Never throws. Four extraction strategies tried in order; falls back to
// treating the raw string as the english field so conversation never breaks.

function safeParseReply(raw: string): AIReply {
  // Strategy 1 – strip markdown fences then parse
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      const obj = JSON.parse(fenced[1].trim()) as Partial<AIReply>;
      if (typeof obj.english === 'string' && obj.english.trim())
        return sanitizeReply({ english: obj.english.trim(), chinese: (obj.chinese ?? '').trim() });
    } catch { /* try next */ }
  }

  // Strategy 2 – first {...} block (even surrounded by prose)
  const braces = raw.match(/\{[\s\S]*?\}/);
  if (braces) {
    try {
      const obj = JSON.parse(braces[0]) as Partial<AIReply>;
      if (typeof obj.english === 'string' && obj.english.trim())
        return sanitizeReply({ english: obj.english.trim(), chinese: (obj.chinese ?? '').trim() });
    } catch { /* try next */ }
  }

  // Strategy 3 – greedy last-resort JSON.parse on full string
  try {
    const obj = JSON.parse(raw.trim()) as Partial<AIReply>;
    if (typeof obj.english === 'string' && obj.english.trim())
      return sanitizeReply({ english: obj.english.trim(), chinese: (obj.chinese ?? '').trim() });
  } catch { /* try next */ }

  // Strategy 4 – regex field extraction (handles malformed / partially-quoted JSON)
  const engMatch = raw.match(/"english"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const chnMatch = raw.match(/"chinese"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (engMatch && engMatch[1].trim()) {
    return sanitizeReply({
      english: engMatch[1].trim(),
      chinese: chnMatch ? chnMatch[1].trim() : '',
    });
  }

  // Final fallback – raw text becomes the English reply, no translation.
  // Still sanitize in case the raw response is all Chinese.
  return sanitizeReply({ english: raw.trim() || '…', chinese: '' });
}

// ─── Translation fallback ─────────────────────────────────────────────────────
// Called when chinese is empty after parsing. Uses whichever key is available
// (DeepSeek preferred; falls back to Gemini) with a lightweight translation prompt.

export async function translateToChineseFallback(english: string): Promise<string> {
  // Try DeepSeek first; if no key, fall back to Gemini
  const dsKey = getApiKey('deepseek');
  const gmKey = getApiKey('gemini');

  if (dsKey) {
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${dsKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: '你是一名翻译助手。将用户发送的英文句子翻译成优美、自然的中文，只输出翻译结果，不要任何解释。' },
            { role: 'user', content: english },
          ],
          temperature: 0.3,
          max_tokens: 256,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { choices: { message: { content: string } }[] };
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) return text;
      }
    } catch { /* fall through to Gemini */ }
  }

  if (gmKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${gmKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            { role: 'user', parts: [{ text: `请将以下英文翻译成优美自然的中文，只输出翻译，不要解释：\n${english}` }] },
          ],
          generationConfig: { temperature: 0.3, maxOutputTokens: 256 },
        }),
      });
      if (res.ok) {
        const data = await res.json() as { candidates: { content: { parts: { text: string }[] } }[] };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return text;
      }
    } catch { /* give up */ }
  }

  return '';
}

// ─── Gemini ───────────────────────────────────────────────────────────────────

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

async function callGemini(
  history: HistoryTurn[],
  userMessage: string,
  imageDataUrl: string | null,
  companion: Companion,
): Promise<AIReply> {
  const apiKey = getApiKey('gemini');
  if (!apiKey) throw new Error('NO_KEY');

  const systemPrompt = buildSystemPrompt(companion);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const contents: { role: string; parts: GeminiPart[] }[] = [];
  if (history.length === 0) {
    contents.push({ role: 'user', parts: [{ text: systemPrompt }] });
    contents.push({
      role: 'model',
      parts: [{ text: '{"english":"I understand. I\'ll speak from the soul, always in that JSON format.","chinese":"明白。我会从灵魂深处倾诉，始终以 JSON 格式回复。"}' }],
    });
  }
  for (const turn of history) {
    const parts: GeminiPart[] = [{ text: turn.text }];
    if (turn.imageDataUrl) {
      const [meta, b64] = turn.imageDataUrl.split(',');
      const mimeType = meta.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
      parts.push({ inline_data: { mime_type: mimeType, data: b64 } });
    }
    contents.push({ role: turn.role, parts });
  }

  // Current user turn
  const userParts: GeminiPart[] = [{ text: userMessage || '' }];
  if (imageDataUrl) {
    const [meta, b64] = imageDataUrl.split(',');
    const mimeType = meta.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
    userParts.push({ inline_data: { mime_type: mimeType, data: b64 } });
  }
  contents.push({ role: 'user', parts: userParts });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, generationConfig: { temperature: 1.1, maxOutputTokens: 512 } }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Gemini HTTP ${res.status}`);
  }

  const data = await res.json() as { candidates: { content: { parts: { text: string }[] } }[] };
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return safeParseReply(raw);
}

// ─── DeepSeek ─────────────────────────────────────────────────────────────────
// Endpoint + key routing:
//   Text-only  → DeepSeek API key  + https://api.deepseek.com  + deepseek-chat
//   Vision     → OpenAI relay key  + user-configured base URL  + gpt-4o-mini
// DeepSeek's official endpoint rejects multimodal array content (image_url variant),
// so vision requests are routed to the OpenAI-compatible relay stored in Settings.

type VisionContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

type AggMessage =
  | { role: string; content: string }
  | { role: string; content: VisionContentPart[] };

async function callDeepSeek(
  history: HistoryTurn[],
  userMessage: string,
  imageDataUrl: string | null,
  companion: Companion,
): Promise<AIReply> {
  const hasVision = !!imageDataUrl;

  // Resolve credentials and endpoint based on whether this is a vision request
  let apiKey: string;
  let endpoint: string;
  let model: string;

  if (hasVision) {
    apiKey = getOpenAIKey();
    if (!apiKey) throw new Error('NO_KEY');
    const base = getOpenAIBaseUrl().replace(/\/$/, '');
    endpoint = `${base}/chat/completions`;
    model = 'gpt-4o-mini';
  } else {
    apiKey = getApiKey('deepseek');
    if (!apiKey) throw new Error('NO_KEY');
    endpoint = 'https://api.deepseek.com/chat/completions';
    model = 'deepseek-chat';
  }

  const messages: AggMessage[] = [
    { role: 'system', content: buildSystemPrompt(companion) },
  ];

  // History is always plain strings — vision relay doesn't need prior image data
  for (const turn of history) {
    messages.push({
      role: turn.role === 'model' ? 'assistant' : 'user',
      content: turn.text || '',
    });
  }

  // Current user turn
  if (hasVision) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userMessage || '' },
        { type: 'image_url', image_url: { url: imageDataUrl! } },
      ],
    });
  } else {
    messages.push({ role: 'user', content: userMessage });
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 1.1, max_tokens: 512 }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `HTTP ${res.status}`);
  }

  const data = await res.json() as { choices: { message: { content: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? '';
  return safeParseReply(raw);
}

// ─── Unified entry point ──────────────────────────────────────────────────────

export async function sendMessage(
  history: HistoryTurn[],
  userMessage: string,
  imageDataUrl?: string | null,
): Promise<AIReply> {
  const provider  = getProvider();
  const companion = getCompanion();
  const img = imageDataUrl ?? null;
  if (provider === 'deepseek') return callDeepSeek(history, userMessage, img, companion);
  return callGemini(history, userMessage, img, companion);
}
