// Local HTTP server: a JSON API plus the web page. Binds to 127.0.0.1 only.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "./store.js";
import { chat } from "./llm.js";
import { startMeeting, getLive, interject, stop } from "./meeting.js";

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok, fail) => {
  let s = "";
  req.on("data", (c) => { s += c; if (s.length > 1e6) req.destroy(); });
  req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { fail(e); } });
});
const sse = (res) => {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  return (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
};

function chatSystem(agent) {
  const team = store.listAgents().filter((a) => a.id !== agent.id).map((a) => `${a.name} (${a.role})`).join(", ");
  return `You are ${agent.name}${agent.role ? `, ${agent.role}` : ""} on the user's AI team${team ? ` with ${team}` : ""}.\n${agent.instructions}\n\nTalk like a sharp colleague: short, direct, useful. Reply in the user's language.`;
}

async function route(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const parts = p.split("/").filter(Boolean);

  // ----- config -----
  if (p === "/api/config" && req.method === "GET") return json(res, 200, store.publicConfig());
  if (p === "/api/config" && req.method === "POST") {
    const b = await readBody(req);
    const patch = {};
    for (const k of ["baseUrl", "model", "apiKey"]) if (typeof b[k] === "string" && (k !== "apiKey" || b[k])) patch[k] = b[k].trim();
    store.saveConfig(patch);
    return json(res, 200, store.publicConfig());
  }

  // ----- agents -----
  if (p === "/api/agents" && req.method === "GET") return json(res, 200, store.listAgents());
  if (p === "/api/agents" && req.method === "POST") return json(res, 200, store.saveAgent(await readBody(req)));
  if (parts[1] === "agents" && parts[2] && !parts[3]) {
    if (req.method === "DELETE") { store.deleteAgent(parts[2]); return json(res, 200, { ok: true }); }
    if (req.method === "PUT") return json(res, 200, store.saveAgent({ ...(await readBody(req)), id: parts[2] }));
  }

  // ----- one-on-one chat -----
  if (parts[1] === "agents" && parts[3] === "chat") {
    const agent = store.getAgent(parts[2]);
    if (!agent) return json(res, 404, { error: "no such agent" });
    if (req.method === "GET") return json(res, 200, store.getChat(agent.id));
    if (req.method === "DELETE") { store.saveChat(agent.id, []); return json(res, 200, { ok: true }); }
    const { text } = await readBody(req);
    const history = store.getChat(agent.id);
    history.push({ role: "user", content: String(text || ""), at: Date.now() });
    const send = sse(res);
    try {
      const reply = await chat(
        [{ role: "system", content: chatSystem(agent) }, ...history.slice(-30).map(({ role, content }) => ({ role, content }))],
        { model: agent.model, onToken: (t) => send({ type: "token", t }) });
      history.push({ role: "assistant", content: reply, at: Date.now() });
      store.saveChat(agent.id, history);
      send({ type: "end" });
    } catch (e) {
      send({ type: "error", message: e.message });
    }
    return res.end();
  }

  // ----- meetings -----
  if (p === "/api/meetings" && req.method === "GET") return json(res, 200, store.listMeetings());
  if (p === "/api/meetings" && req.method === "POST") {
    const b = await readBody(req);
    const all = store.listAgents();
    const members = (b.members || []).map((id) => all.find((a) => a.id === id)).filter(Boolean);
    if (!b.topic || !members.length) return json(res, 400, { error: "Need a topic and at least one agent." });
    const m = startMeeting({ topic: String(b.topic), members, rounds: Number(b.rounds) || 2 });
    return json(res, 200, { id: m.id });
  }
  if (parts[1] === "meetings" && parts[2]) {
    const m = getLive(parts[2]);
    if (parts[3] === "events") {
      if (!m) return json(res, 404, { error: "not live" });
      const send = sse(res);
      m.events.forEach(send);
      m.listeners.add(send);
      req.on("close", () => m.listeners.delete(send));
      return;
    }
    if (parts[3] === "say" && m) { interject(m, String((await readBody(req)).text || "")); return json(res, 200, { ok: true }); }
    if (parts[3] === "stop" && m) { stop(m); return json(res, 200, { ok: true }); }
    const md = store.getMeeting(parts[2]);
    return md ? json(res, 200, { markdown: md }) : json(res, 404, { error: "not found" });
  }

  // ----- static -----
  const file = path.join(WEB, p === "/" ? "index.html" : path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
  if (file.startsWith(WEB) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    return fs.createReadStream(file).pipe(res);
  }
  json(res, 404, { error: "not found" });
}

export function serve(port = 4747) {
  store.init();
  const server = http.createServer((req, res) => route(req, res).catch((e) => {
    if (!res.headersSent) json(res, 500, { error: e.message }); else res.end();
  }));
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}
