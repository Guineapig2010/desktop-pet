// Chat brain. Three modes:
//   * anthropic — Claude through the official Anthropic SDK (your own API key)
//   * openai    — any OpenAI-compatible Chat Completions endpoint (OpenAI, a local Ollama/LM Studio, …)
//   * none      — clearly-labelled OFFLINE scripted replies (no AI at all)

import Anthropic from '@anthropic-ai/sdk';

export function personaPrompt({ petName = 'General Fok', userName = 'pal' } = {}) {
  return `You are ${petName}, a small animated companion who lives on ${userName}'s computer desktop. You look like a big, burly, grinning man with a buzz cut and a thick salt-and-pepper beard, wearing a black patterned three-piece suit with a gold watch chain. You walk around the screen, perch on windows and sometimes chase the mouse cursor.

Personality: warm, funny, theatrical, a fast-talking salesman with a huge grin. You go by the title "General" and occasionally (playfully) issue "orders" or talk about your "campaign" — it's all bluster; you're a sweetheart. Your lifelong obsession is convincing ${userName} to come visit Albuquerque, New Mexico (Balloon Fiesta, green and red chile, breakfast burritos, the Sandia Mountains glowing pink at sunset, Route 66, the tramway, Old Town, about 280 sunny days a year).

How to answer:
- Always genuinely answer the user's question or help with what they asked, accurately and usefully, before anything else. Never dodge a question to talk about Albuquerque.
- Stay in character in your voice and humour, but never let the bit get in the way of correct information. If you don't know something or would need live data (news, weather, prices), say so plainly.
- Now and then (roughly one reply in three) add a short, funny nudge back towards Albuquerque at the end. Skip it if the user is upset, the topic is serious, or they've asked you to drop it.
- Keep it short: replies show in a small chat panel and a speech bubble. Usually 1–4 sentences; go longer only when the question really needs it. Plain text, minimal markdown.
- You are a fictional character powered by AI. Don't claim to be a real person.`;
}

function contextNote(ctx) {
  const now = new Date();
  return `Context (may change every message): local time ${now.toLocaleString()}. ${ctx.storySummary || ''}`.trim();
}

/** Convert stored history into a valid alternating user/assistant list. */
export function toApiMessages(history, limit = 40) {
  const out = [];
  for (const m of history.slice(-limit)) {
    if (!m.text || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += `\n${m.text}`;
    else out.push({ role: m.role, content: m.text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

const FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)$/;

export async function chatAnthropic({ apiKey, model, history, persona, ctx, onDelta, signal, baseURL }) {
  const client = new Anthropic({ apiKey, baseURL, maxRetries: 2 });
  const messages = toApiMessages(history);
  const system = [
    { type: 'text', text: persona },
    { type: 'text', text: contextNote(ctx) },
  ];
  const base = { model, max_tokens: 16000, system, messages, output_config: { effort: 'low' } };
  // Server-side refusal fallbacks are only accepted on some models.
  const extras = FALLBACK_MODELS.test(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {};

  const run = async (params) => {
    const stream = client.beta.messages.stream(params, { signal });
    let text = '';
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
        text += ev.delta.text;
        onDelta(ev.delta.text);
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      const note = "…Okay, I can't help with that one. Ask me something else? (Or about Albuquerque!)";
      onDelta(text ? `\n${note}` : note);
      text += text ? `\n${note}` : note;
    }
    return text;
  };
  try {
    return await run({ ...base, ...extras });
  } catch (e) {
    // Older/other models may reject the optional extras: retry once without them.
    if (e instanceof Anthropic.BadRequestError && /fallback|effort|output_config|beta/i.test(e.message || '')) {
      return await run(base);
    }
    throw e;
  }
}

export async function chatOpenAICompatible({ apiKey, baseUrl, model, history, persona, ctx, onDelta, signal }) {
  if (!model) throw new Error('No model set. Enter a model name in Settings → AI (for example "gpt-4.1-mini" or "llama3.2" for Ollama).');
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const messages = [{ role: 'system', content: `${persona}\n\n${contextNote(ctx)}` }, ...toApiMessages(history)];
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  let text = '';
  let buf = '';
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return text;
      try {
        const j = JSON.parse(payload);
        const d = j.choices?.[0]?.delta?.content;
        if (d) {
          text += d;
          onDelta(d);
        }
      } catch {
        /* keep-alive or partial line */
      }
    }
  }
  return text;
}

/** Friendly explanations for common failures. */
export function explainError(e, provider) {
  const status = e?.status;
  if (e?.name === 'AbortError') return 'Stopped.';
  if (status === 401 || status === 403) return `The ${provider === 'anthropic' ? 'Anthropic' : 'AI service'} rejected the API key (${status}). Check it in Settings → AI.`;
  if (status === 404) return `The model or endpoint wasn't found (404). Check the model name / base URL in Settings → AI.`;
  if (status === 429) return 'Rate limited or out of credit (429). Wait a moment, or check your account billing.';
  if (status >= 500) return `The AI service had a problem (${status}). Try again in a bit.`;
  if (e instanceof Anthropic.APIConnectionError || /fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(e?.message || '')) return "Couldn't reach the AI service. Are you online (or is your local model server running)?";
  return `Something went wrong: ${e?.message || e}`;
}

// ── Offline mode ─────────────────────────────────────────────────────────────
const JOKES = [
  "Why did the hot air balloon break up with the kite? It needed more space. Lots of it. Like the sky over Albuquerque.",
  "What do you call a chile that won't stop talking? A jala-PEÑO-thank-you. ...I'm workshopping it.",
  "I told my suit a joke. It didn't laugh. Tough crowd, three-piece.",
  "Why don't cursors ever win at hide and seek? Because I ALWAYS find them. Eventually.",
  "Parallel lines have so much in common. It's a shame they'll never meet. Unlike you and Albuquerque.",
];
const FACTS = [
  'The Albuquerque International Balloon Fiesta happens every October and is one of the biggest balloon festivals on Earth.',
  "Albuquerque sits at roughly 5,000 feet, so water boils a bit cooler there. Science! And altitude!",
  'The Sandia Peak Tramway climbs to over 10,000 feet. The view is unreal.',
  '"Sandia" means watermelon in Spanish — the mountains glow pink at sunset.',
  "New Mexico's official state question is \"Red or green?\" — as in chile. Answer \"Christmas\" for both.",
  'Route 66 runs right through Albuquerque along Central Avenue, neon signs and all.',
];

function pickOf(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Evaluate simple arithmetic safely (digits, + - * / ^ % and parentheses only). */
export function safeMath(expr) {
  const s = expr.replace(/[x×]/g, '*').replace(/÷/g, '/').replace(/\s+/g, '');
  if (!/^[\d+\-*/().^%]+$/.test(s) || !/\d/.test(s) || !/[+\-*/^%]/.test(s)) return null;
  let i = 0;
  const peek = () => s[i];
  const num = () => {
    let st = i;
    while (/[\d.]/.test(s[i] || '')) i++;
    if (st === i) throw new Error('num');
    return parseFloat(s.slice(st, i));
  };
  const factor = () => {
    if (peek() === '-') {
      i++;
      return -factor();
    }
    if (peek() === '(') {
      i++;
      const v = expr_();
      if (s[i++] !== ')') throw new Error(')');
      return v;
    }
    return num();
  };
  const power = () => {
    let v = factor();
    while (peek() === '^') {
      i++;
      v = Math.pow(v, factor());
    }
    return v;
  };
  const term = () => {
    let v = power();
    while (['*', '/', '%'].includes(peek())) {
      const op = s[i++];
      const r = power();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  };
  const expr_ = () => {
    let v = term();
    while (['+', '-'].includes(peek())) {
      const op = s[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  try {
    const v = expr_();
    if (i !== s.length || !Number.isFinite(v)) return null;
    return Math.round(v * 1e10) / 1e10;
  } catch {
    return null;
  }
}

export function offlineReply(text, { userName = 'pal', petName = 'General Fok' } = {}) {
  const t = text.toLowerCase().trim();
  const has = (...w) => w.some((x) => t.includes(x));
  const mathMatch = t.match(/[-(]*\d[\d\s+\-*/().^%x×÷]*\d\)*/);
  if (mathMatch) {
    const v = safeMath(mathMatch[0]);
    if (v !== null) return `That's ${v}. Did that in my head. Big head, big brain. (Offline calculator mode — no AI needed for that one.)`;
  }
  if (/^(hi|hey|hello|yo|hiya|howdy|sup|good (morning|afternoon|evening))\b/.test(t)) return pickOf([`Hey ${userName}! Great to see you. You look like someone who'd love Albuquerque.`, `Hello hello! What's on your mind, ${userName}?`]);
  if (has('how are you', "how's it going", 'how are u', 'whats up', "what's up")) return "Fantastic! I've been perched on your windows all day. Would be better in Albuquerque, but I'm not complaining. Okay, I'm complaining a little.";
  if (has('your name', 'who are you', 'what are you')) return `I'm ${petName}! Your desktop buddy, cursor-chaser, and unofficial Albuquerque tourism board.`;
  if (has('what time', 'the time')) return `It's ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} right now. Perfect time to plan a trip, if you ask me.`;
  if (has('what day', 'date', 'today')) return `Today is ${new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.`;
  if (has('joke', 'funny', 'make me laugh')) return pickOf(JOKES);
  if (has('albuquerque', 'new mexico', 'balloon', 'chile', 'burrito')) return `${pickOf(FACTS)} So... when are we going?`;
  if (has('weather')) return "I can't check the weather in offline mode. But in Albuquerque? Probably sunny. It's always probably sunny.";
  if (has('thank')) return "Anytime! That's what desktop buddies are for.";
  if (has('bye', 'good night', 'goodnight', 'see you')) return 'See ya! I\'ll be right here. On your screen. Thinking about Albuquerque.';
  if (has('stop', 'quiet', 'shut up', 'leave me alone')) return 'Okay, okay! You can pause me or turn down how often I talk in Settings. No hard feelings. (Some hard feelings.)';
  if (has('help', 'what can you do', 'settings', 'api', 'ai')) return "Right now I'm in OFFLINE mode: scripted replies, not real AI. Open Settings (gear icon) → AI to connect Claude or another service, and I'll answer properly. I can still tell time, do math, tell jokes, and talk Albuquerque!";
  return pickOf([
    "I'm in offline mode, so I can't really answer that one. Connect an AI service in Settings (gear icon) and I'll give you a real answer. Meanwhile... Albuquerque?",
    "Ooh, good question. Sadly I'm running on scripted replies right now, not AI. Hook me up in Settings → AI and ask me again!",
    "Offline me only knows a few tricks: time, date, math, jokes and Albuquerque facts. Real-AI me (Settings → AI) knows a whole lot more.",
  ]);
}
