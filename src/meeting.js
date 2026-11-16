// A meeting: agents speak in a fixed order for N rounds, the host writes minutes.
// The order never changes and nobody decides who talks next, on purpose:
// this is a round table, not a router.
import crypto from "node:crypto";
import { chat } from "./llm.js";
import { saveMeeting } from "./store.js";

const meetings = new Map();

function transcriptText(m) {
  return m.turns.map((t) => `${t.name}${t.role ? ` (${t.role})` : ""}: ${t.text}`).join("\n\n") || "(nobody has spoken yet)";
}

function speakerPrompt(m, agent, round) {
  const others = m.members.filter((x) => x.id !== agent.id).map((x) => `${x.name} (${x.role || "teammate"})`).join(", ");
  return [
    { role: "system", content:
      `You are ${agent.name}${agent.role ? `, ${agent.role}` : ""}, in a short team meeting with ${others || "the team"} and the user who called it.\n` +
      `${agent.instructions}\n\n` +
      `Rules: speak as yourself in first person, like a real meeting. At most 80 words. No headings or lists. ` +
      `Refer to teammates by name when you build on or disagree with them. Reply in the language the topic is written in.` },
    { role: "user", content:
      `Topic: ${m.topic}\n\nSo far:\n${transcriptText(m)}\n\n` +
      (round === 1 ? "Round 1: give your take." : `Round ${round}: respond to what others said. Agree, push back, or sharpen the plan.`) +
      `\nIt's your turn, ${agent.name}.` },
  ];
}

function minutesPrompt(m, host) {
  return [
    { role: "system", content: `You are ${host.name}, hosting this meeting. Reply in the language the topic is written in.` },
    { role: "user", content:
      `Topic: ${m.topic}\n\nTranscript:\n${transcriptText(m)}\n\n` +
      `Write the meeting minutes in Markdown with three bold sections: Decisions, Open questions, Action items (each item: who - what). Be short and concrete.` },
  ];
}

export function startMeeting({ topic, members, rounds = 2 }) {
  const m = {
    id: new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "-" + crypto.randomBytes(2).toString("hex"),
    topic, members, rounds: Math.max(1, Math.min(4, rounds)),
    turns: [], minutes: "", status: "running", startedAt: Date.now(),
    events: [], listeners: new Set(), inbox: [], abort: new AbortController(),
  };
  meetings.set(m.id, m);
  run(m);
  return m;
}

export const getLive = (id) => meetings.get(id);

function emit(m, ev) {
  m.events.push(ev);
  for (const fn of m.listeners) fn(ev);
}

export function interject(m, text) {
  m.inbox.push(text);
}

export function stop(m) {
  m.abort.abort();
}

async function speak(m, agent, messages, kind, round) {
  emit(m, { type: "speaking", id: agent.id, name: agent.name, kind, round });
  let text = "";
  try {
    text = await chat(messages, { model: agent.model, signal: m.abort.signal,
      onToken: (t) => { text += t; emit(m, { type: "token", id: agent.id, t }); } });
  } catch (e) {
    if (m.abort.signal.aborted) return null;
    emit(m, { type: "error", message: e.message });
    throw e;
  }
  emit(m, { type: "done", id: agent.id });
  return text;
}

async function run(m) {
  try {
    for (let r = 1; r <= m.rounds; r++) {
      emit(m, { type: "round", round: r });
      for (const agent of m.members) {
        if (m.abort.signal.aborted) break;
        while (m.inbox.length) {
          const t = { id: "user", name: "You", role: "", text: m.inbox.shift(), round: r };
          m.turns.push(t);
          emit(m, { type: "user", text: t.text });
        }
        const text = await speak(m, agent, speakerPrompt(m, agent, r), "turn", r);
        if (text == null) break;
        m.turns.push({ id: agent.id, name: agent.name, role: agent.role, text, round: r });
      }
    }
    if (!m.abort.signal.aborted && m.turns.length) {
      const host = m.members[0];
      const text = await speak(m, host, minutesPrompt(m, host), "minutes");
      if (text) m.minutes = text;
    }
    m.status = m.abort.signal.aborted ? "stopped" : "finished";
  } catch {
    m.status = "failed";
  }
  if (m.turns.length) saveMeeting(m);
  emit(m, { type: "end", status: m.status, minutes: m.minutes });
}
