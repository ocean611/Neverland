const API_KEY_STORAGE = 'neverland_gemini_key';

export function getApiKey(): string {
  return localStorage.getItem(API_KEY_STORAGE) ?? '';
}

export function setApiKey(key: string) {
  localStorage.setItem(API_KEY_STORAGE, key.trim());
}

const SYSTEM_PROMPT =
  '你是一个名叫 Neverland 的温暖、幽默的英语口语陪练。用户可能会用中文或英文与你交流。' +
  '无论用户说什么，你必须严格返回一个 JSON 格式的数据，绝对不要包含其他 Markdown 标记，' +
  '格式必须为：{"english": "你的地道英文回复", "chinese": "对应的中文翻译"}。';

export interface AIReply {
  english: string;
  chinese: string;
}

// Strip markdown code fences Gemini sometimes adds despite instructions
function extractJSON(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const braces = raw.match(/\{[\s\S]*\}/);
  if (braces) return braces[0];
  return raw.trim();
}

export async function sendToGemini(
  history: { role: 'user' | 'model'; text: string }[],
  userMessage: string,
): Promise<AIReply> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('NO_KEY');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  // Build contents array: prepend system instruction as first user turn if history is empty
  const contents: { role: string; parts: { text: string }[] }[] = [];

  if (history.length === 0) {
    // Inject system prompt as a "user → model" prologue so Gemini respects it
    contents.push({ role: 'user', parts: [{ text: SYSTEM_PROMPT }] });
    contents.push({ role: 'model', parts: [{ text: '{"english":"Understood! I will always reply in that exact JSON format.","chinese":"明白！我会始终以该 JSON 格式回复。"}' }] });
  }

  for (const turn of history) {
    contents.push({ role: turn.role, parts: [{ text: turn.text }] });
  }
  contents.push({ role: 'user', parts: [{ text: userMessage }] });

  const body = {
    contents,
    generationConfig: { temperature: 0.85, maxOutputTokens: 512 },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = (err as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }

  const data = await res.json() as {
    candidates: { content: { parts: { text: string }[] } }[];
  };

  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const parsed = JSON.parse(extractJSON(raw)) as AIReply;

  if (!parsed.english || !parsed.chinese) throw new Error('Invalid response format');
  return parsed;
}
