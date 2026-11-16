// Everything lives in plain files under ~/.kiki-core (or $KIKI_HOME):
//   config.json            API endpoint, key, default model
//   agents/<id>.md         one agent per file: front matter + instructions
//   chats/<id>.json        one-on-one chat history with that agent
//   meetings/<id>.md       minutes and transcript of each meeting
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HOME = process.env.KIKI_HOME || path.join(os.homedir(), ".kiki-core");
const dir = (...p) => path.join(HOME, ...p);

export const COLORS = ["#5b6cf0", "#13b5c8", "#22b573", "#ff4f8b", "#8b5cf6", "#1f8bff", "#ffb300", "#d24fe0", "#f0473c", "#ff7a1a"];

const STARTERS = [
  { name: "Ava", role: "Product lead", color: "#5b6cf0", avatar: "p084",
    instructions: "You own the product. You care about who the user is, what problem we solve, and what we should NOT build. You push for the smallest version that proves the idea." },
  { name: "Leo", role: "Engineer", color: "#13b5c8", avatar: "p006",
    instructions: "You build things. You think about effort, risk and what can ship this week. You call out hidden complexity and suggest simpler ways to get the same result." },
  { name: "Mia", role: "Growth", color: "#ff4f8b", avatar: "p019",
    instructions: "You get things in front of people. You think about the story, the channel, the first 100 users and how we will know it worked. You like concrete numbers." },
];

export function init() {
  for (const d of ["agents", "chats", "meetings"]) fs.mkdirSync(dir(d), { recursive: true });
  if (!fs.existsSync(dir("config.json"))) {
    saveConfig({ baseUrl: "https://api.deepseek.com/v1", apiKey: "", model: "deepseek-chat" });
  }
  if (fs.readdirSync(dir("agents")).length === 0) STARTERS.forEach((a) => saveAgent(a));
}

// ---------- config ----------
export function getConfig() {
  try { return JSON.parse(fs.readFileSync(dir("config.json"), "utf8")); } catch { return {}; }
}
export function saveConfig(c) {
  const cur = fs.existsSync(dir("config.json")) ? getConfig() : {};
  const next = { ...cur, ...c };
  fs.writeFileSync(dir("config.json"), JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}
export function publicConfig() {
  const c = getConfig();
  return { baseUrl: c.baseUrl || "", model: c.model || "", hasKey: !!c.apiKey, mock: !!process.env.KIKI_MOCK };
}

// ---------- agents ----------
const slug = (s) => (s || "agent").toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "-").replace(/^-|-$/g, "") || "agent";

function parseAgent(id, text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = {};
  if (m) for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { id, name: meta.name || id, role: meta.role || "", color: meta.color || COLORS[0], model: meta.model || "", avatar: meta.avatar || "", instructions: (m ? m[2] : text).trim() };
}

export function listAgents() {
  return fs.readdirSync(dir("agents")).filter((f) => f.endsWith(".md")).sort()
    .map((f) => parseAgent(f.slice(0, -3), fs.readFileSync(dir("agents", f), "utf8")));
}
export function getAgent(id) {
  const f = dir("agents", path.basename(id) + ".md");
  return fs.existsSync(f) ? parseAgent(id, fs.readFileSync(f, "utf8")) : null;
}
export function saveAgent(a) {
  let id = a.id;
  if (!id) {
    id = slug(a.name);
    let n = 2;
    while (fs.existsSync(dir("agents", id + ".md"))) id = `${slug(a.name)}-${n++}`;
  }
  const clean = (s) => String(s || "").replace(/\n/g, " ").trim();
  const used = listAgents().length;
  const body = `---\nname: ${clean(a.name) || "Agent"}\nrole: ${clean(a.role)}\ncolor: ${clean(a.color) || COLORS[used % COLORS.length]}\n${a.model ? `model: ${clean(a.model)}\n` : ""}${a.avatar ? `avatar: ${clean(a.avatar)}\n` : ""}---\n${(a.instructions || "").trim()}\n`;
  fs.writeFileSync(dir("agents", path.basename(id) + ".md"), body);
  return getAgent(id);
}
export function deleteAgent(id) {
  fs.rmSync(dir("agents", path.basename(id) + ".md"), { force: true });
  fs.rmSync(dir("chats", path.basename(id) + ".json"), { force: true });
}

// ---------- chats ----------
export function getChat(id) {
  try { return JSON.parse(fs.readFileSync(dir("chats", path.basename(id) + ".json"), "utf8")); } catch { return []; }
}
export function saveChat(id, msgs) {
  fs.writeFileSync(dir("chats", path.basename(id) + ".json"), JSON.stringify(msgs, null, 2));
}

// ---------- meetings ----------
export function saveMeeting(m) {
  const lines = [`# ${m.topic}`, "", `${new Date(m.startedAt).toLocaleString()} · ${m.members.map((x) => x.name).join(", ")}`, ""];
  if (m.minutes) lines.push("## Minutes", "", m.minutes.trim(), "");
  lines.push("## Transcript", "");
  for (const t of m.turns) lines.push(`**${t.name}**${t.round ? ` (round ${t.round})` : ""}: ${t.text.trim()}`, "");
  fs.writeFileSync(dir("meetings", m.id + ".md"), lines.join("\n"));
}
export function listMeetings() {
  return fs.readdirSync(dir("meetings")).filter((f) => f.endsWith(".md")).sort().reverse().slice(0, 30)
    .map((f) => ({ id: f.slice(0, -3), topic: (fs.readFileSync(dir("meetings", f), "utf8").match(/^# (.*)/) || [])[1] || f }));
}
export function getMeeting(id) {
  const f = dir("meetings", path.basename(id) + ".md");
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
}
