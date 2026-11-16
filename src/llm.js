// One function: stream a chat completion from any OpenAI-compatible endpoint
// (DeepSeek, OpenAI, OpenRouter, a local Ollama, ...). No SDK, just fetch.
import { getConfig } from "./store.js";

/**
 * @param {{role:string, content:string}[]} messages
 * @param {{model?:string, onToken?:(t:string)=>void, signal?:AbortSignal}} opts
 * @returns {Promise<string>} the full reply
 */
export async function chat(messages, { model, onToken = () => {}, signal } = {}) {
  if (process.env.KIKI_MOCK) return mock(messages, onToken, signal);
  const cfg = getConfig();
  if (!cfg.apiKey) throw new Error("No API key yet. Open Settings and paste one.");
  const res = await fetch(cfg.baseUrl.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: model || cfg.model, messages, stream: true }),
    signal,
  });
  if (!res.ok) throw new Error(`Model API ${res.status}: ${(await res.text()).slice(0, 300)}`);

  let full = "", buf = "";
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return full;
      try {
        const t = JSON.parse(data).choices?.[0]?.delta?.content;
        if (t) { full += t; onToken(t); }
      } catch { /* keep-alive or partial line */ }
    }
  }
  return full;
}

// KIKI_MOCK=1: canned replies so you can try the UI (and record a demo) without a key.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function mock(messages, onToken, signal) {
  const sys = messages[0]?.content || "";
  const name = (sys.match(/You are (\w+)/) || [])[1] || "Agent";
  const minutes = /meeting minutes/i.test(messages.at(-1)?.content || "");
  const lines = {
    Ava: "I'd keep v1 tiny: one page, three agents, one meeting. If people don't share the minutes, nothing else matters.",
    Leo: "Agree with Ava. Streaming plus plain files gets us there in two days. The risk is long meetings blowing the context, so I'd cap each turn at 80 words.",
    Mia: "Then the hook is the 30-second clip: three agents arguing, minutes at the end. I'd post it with the repo and track stars in week one.",
  };
  const round2 = /Round 2/.test(messages.at(-1)?.content || "");
  const lines2 = {
    Ava: "Leo's cap is right. And Mia, one clip is fine, but I want the minutes to be the thing people screenshot. That's the proof.",
    Leo: "Then I'll make minutes a first-class card with a copy button. Two days still holds if we skip file tools in v1.",
    Mia: "Deal. I'll post Thursday, then ask the first 20 stargazers what they'd want agents to discuss next.",
  };
  if (round2) Object.assign(lines, lines2);
  const text = minutes
    ? "**Decisions**\n- Ship v1 as one page with three starter agents and meetings.\n- Cap each turn at about 80 words.\n\n**Open questions**\n- Do we add file tools in v2 or keep it talk-only?\n\n**Action items**\n- Leo: build streaming and storage (2 days).\n- Mia: record the 30-second demo and post it.\n- Ava: write the README."
    : lines[name] || `${name} here. Sounds good to me, let's keep it simple.`;
  let out = "";
  for (const w of text.split(/(\s+)/)) {
    if (signal?.aborted) break;
    out += w; onToken(w);
    await sleep(28);
  }
  return out;
}
