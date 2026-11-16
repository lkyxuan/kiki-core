// kiki-core web UI. No framework: a little state, a few render functions.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const COLORS = ["#5b6cf0", "#13b5c8", "#22b573", "#ff4f8b", "#8b5cf6", "#1f8bff", "#ffb300", "#d24fe0", "#f0473c", "#ff7a1a"];

const api = async (path, opts = {}) => {
  const r = await fetch(path, { ...opts, headers: { "content-type": "application/json" }, body: opts.body && JSON.stringify(opts.body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};

// Read a server-sent event stream from a fetch response (POST-friendly).
async function readSSE(res, onEvent) {
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (line.startsWith("data: ")) onEvent(JSON.parse(line.slice(6)));
    }
  }
}

// Tiny Markdown: paragraphs, bold, italics, code, bullet lists, headings.
function md(src) {
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|\W)\*([^*]+)\*/g, "$1<i>$2</i>");
  const out = []; let list = null;
  for (const raw of String(src || "").split("\n")) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
    if (li) { if (!list) { list = []; } list.push(`<li>${inline(li[1])}</li>`); continue; }
    if (list) { out.push(`<ul>${list.join("")}</ul>`); list = null; }
    if (!line.trim()) continue;
    const h = line.match(/^#{1,4}\s+(.*)/);
    out.push(h ? `<p><b>${inline(h[1])}</b></p>` : `<p>${inline(line)}</p>`);
  }
  if (list) out.push(`<ul>${list.join("")}</ul>`);
  return out.join("");
}

// An agent's face: their portrait if they have one, otherwise the Kiki tile
// (tilted rounded square, two ink eyes) in their color.
const avatar = (who, cls = "", size = 0) => {
  const color = typeof who === "string" ? who : who.color;
  const pic = typeof who === "object" && /^p\d{3}$/.test(who.avatar || "") ? who.avatar : "";
  const sz = size ? `width:${size}px;height:${size}px;` : "";
  if (pic) return `<span class="av photo ${cls}" style="${sz}--c:${esc(color)}"><img src="/avatars/${pic}.webp" alt=""></span>`;
  return `<span class="av ${cls}" style="${sz}"><svg viewBox="0 0 64 64"><g transform="rotate(-9 32 32)"><rect x="7" y="7" width="50" height="50" rx="13" fill="${esc(color)}"/><g class="eyes"><rect x="21" y="21" width="8" height="22" rx="4" fill="#131419"/><rect x="35" y="21" width="8" height="22" rx="4" fill="#131419"/></g></g></svg></span>`;
};

const state = { agents: [], meetings: [], config: {}, view: { kind: "home" } };

async function refresh() {
  [state.agents, state.meetings, state.config] = await Promise.all([api("/api/agents"), api("/api/meetings"), api("/api/config")]);
  renderSide();
}

function renderSide() {
  const v = state.view;
  $("#agents").innerHTML = state.agents.map((a) => `
    <button class="item ${v.kind === "chat" && v.id === a.id ? "on" : ""}" data-chat="${esc(a.id)}">
      ${avatar(a, "", 30)}
      <span class="who"><div class="n">${esc(a.name)}</div><div class="r">${esc(a.role)}</div></span>
    </button>`).join("");
  $("#meetings").innerHTML = state.meetings.length
    ? state.meetings.map((m) => `<button class="item mt ${v.kind === "past" && v.id === m.id ? "on" : ""}" data-past="${esc(m.id)}"><span>${esc(m.topic)}</span></button>`).join("")
    : `<div class="item mt"><span>No meetings yet</span></div>`;
  const c = state.config;
  $("#model-label").textContent = c.mock ? "Demo mode" : c.hasKey ? c.model : "Add an API key";
}

// ---------------- views ----------------
function show(view) { state.view = view; renderSide(); render(); }

function render() {
  const v = state.view;
  if (v.kind === "chat") return renderChat(v.id);
  if (v.kind === "meeting") return renderMeeting(v.id);
  if (v.kind === "past") return renderPast(v.id);
  renderHome();
}

function renderHome() {
  $("#main").innerHTML = `
    <div class="head"><h1>Your team</h1><span class="sp"></span></div>
    <div class="scroll"><div class="msgs">
      <div class="empty">
        <div class="row" style="justify-content:center;gap:16px;margin-bottom:20px">${state.agents.slice(0, 5).map((a) => avatar(a, "", 56)).join("")}</div>
        <p style="font-size:16px;color:var(--text);margin:0 0 6px">${state.agents.length} agents, ready when you are.</p>
        <p style="margin:0 0 20px">Pick one on the left to talk one-on-one, or call everyone into a meeting.</p>
        <button class="primary" id="home-meet">Start a meeting</button>
        ${!state.config.hasKey && !state.config.mock ? `<p class="hint" style="margin-top:16px">First, add an API key in Settings (DeepSeek, OpenAI, or any OpenAI-compatible endpoint).</p>` : ""}
      </div>
    </div></div>`;
  $("#home-meet").onclick = openNewMeeting;
}

async function renderChat(id) {
  const a = state.agents.find((x) => x.id === id);
  if (!a) return show({ kind: "home" });
  $("#main").innerHTML = `
    <div class="head">${avatar(a, "", 34)}
      <div><h1>${esc(a.name)}</h1><div class="sub">${esc(a.role)}${a.model ? ` · ${esc(a.model)}` : ""}</div></div>
      <span class="sp"></span>
      <button class="icon" id="clear" title="Clear chat"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>
      <button class="icon" id="edit" title="Edit agent"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
    </div>
    <div class="scroll" id="sc"><div class="msgs" id="msgs"></div></div>
    <div class="composer"><form id="f"><textarea id="t" rows="1" placeholder="Message ${esc(a.name)}…"></textarea><button class="primary" id="send">Send</button></form></div>`;
  const msgs = $("#msgs"), sc = $("#sc");
  const bubble = (role, html) => {
    const d = document.createElement("div");
    d.className = "msg " + (role === "user" ? "me" : "");
    d.innerHTML = (role === "user" ? "" : avatar(a, "", 28)) + `<div class="bubble">${html}</div>`;
    msgs.append(d); sc.scrollTop = sc.scrollHeight;
    return d.querySelector(".bubble");
  };
  const history = await api(`/api/agents/${encodeURIComponent(id)}/chat`);
  if (!history.length) msgs.innerHTML = `<div class="empty">Say hi to ${esc(a.name)}. ${esc(a.instructions.split(".")[0])}.</div>`;
  history.forEach((m) => bubble(m.role, m.role === "user" ? esc(m.content) : md(m.content)));

  $("#edit").onclick = () => openAgent(a);
  $("#clear").onclick = async () => { await api(`/api/agents/${encodeURIComponent(id)}/chat`, { method: "DELETE" }); render(); };
  const t = $("#t");
  t.oninput = () => { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; };
  t.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#f").requestSubmit(); } };
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const text = t.value.trim(); if (!text) return;
    if (!history.length) msgs.innerHTML = "";
    history.push({ role: "user", content: text });
    t.value = ""; t.oninput(); $("#send").disabled = true;
    bubble("user", esc(text));
    const b = bubble("assistant", ""); b.classList.add("caret");
    let full = "";
    const res = await fetch(`/api/agents/${encodeURIComponent(id)}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    await readSSE(res, (ev) => {
      if (ev.type === "token") { full += ev.t; b.innerHTML = md(full); sc.scrollTop = sc.scrollHeight; }
      if (ev.type === "error") b.innerHTML = `<span class="err">${esc(ev.message)}</span>`;
    });
    b.classList.remove("caret"); $("#send").disabled = false; t.focus();
  };
  t.focus();
}

// ---------------- meeting ----------------
let live = null; // EventSource of the running meeting

function renderMeeting(id) {
  const m = state.view.meta;
  const n = m.members.length;
  const seats = m.members.map((a, i) => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const x = 50 + 42 * Math.cos(ang), y = 50 + 42 * Math.sin(ang);
    return `<div class="seat" id="seat-${esc(a.id)}" style="left:${x}%;top:${y}%;--glow:${esc(a.color)}">${avatar(a)}<div class="nm">${esc(a.name)}</div><div class="rl">${esc(a.role)}</div></div>`;
  }).join("");
  $("#main").innerHTML = `
    <div class="head"><div><h1>${esc(m.topic)}</h1><div class="sub">Meeting · ${n} agents · ${m.rounds} rounds</div></div>
      <span class="sp"></span><button class="ghost" id="stop">Stop</button></div>
    <div class="room">
      <div class="stage"><div class="round-pill" id="pill">Getting seated…</div>
        <div class="table">${seats}<div class="center"><div class="topic" id="ctag">Topic</div><div class="line" id="line">${esc(m.topic)}</div><div class="speaker" id="spk"></div></div></div>
      </div>
      <div class="feed"><div class="list" id="feed"></div>
        <form id="say"><input id="say-t" placeholder="Jump in… the next speaker will answer you"><button class="primary">Say</button></form></div>
    </div>`;
  const feed = $("#feed"), byId = Object.fromEntries(m.members.map((a) => [a.id, a]));
  let cur = null, curText = "", curEl = null;
  const add = (html) => { const d = document.createElement("div"); d.innerHTML = html; const el = d.firstElementChild; feed.append(el); feed.scrollTop = feed.scrollHeight; return el; };

  live?.close();
  live = new EventSource(`/api/meetings/${encodeURIComponent(id)}/events`);
  live.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === "round") { $("#pill").textContent = `Round ${ev.round} of ${m.rounds}`; add(`<div class="divider">Round ${ev.round}</div>`); }
    if (ev.type === "user") add(`<div class="turn you">${avatar("#fd890c")}<div class="t"><div class="n">You</div><div class="x">${esc(ev.text)}</div></div></div>`);
    if (ev.type === "speaking") {
      document.querySelectorAll(".seat").forEach((s) => s.classList.remove("on"));
      document.querySelectorAll(".seat .av").forEach((s) => s.classList.remove("talking"));
      const seat = $(`#seat-${CSS.escape(ev.id)}`);
      seat?.classList.add("on"); seat?.querySelector(".av").classList.add("talking");
      cur = byId[ev.id]; curText = "";
      $("#spk").textContent = ev.kind === "minutes" ? `${cur.name} is writing the minutes…` : `${cur.name} is speaking`;
      $("#spk").style.color = cur.color;
      $("#ctag").textContent = ev.kind === "minutes" ? "Minutes" : `Round ${ev.round}`;
      $("#line").textContent = "";
      if (ev.kind === "minutes") {
        $("#pill").textContent = "Wrapping up";
        curEl = add(`<div class="minutes"><h3>Minutes<span class="sp"></span><button class="icon" title="Copy" id="copy"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg></button></h3><div class="body caret"></div></div>`).querySelector(".body");
      } else {
        curEl = add(`<div class="turn">${avatar(cur)}<div class="t"><div class="n">${esc(cur.name)}<i>${esc(cur.role)}</i></div><div class="x caret"></div></div></div>`).querySelector(".x");
      }
    }
    if (ev.type === "token" && curEl) {
      curText += ev.t;
      if (curEl.classList.contains("body")) { curEl.innerHTML = md(curText); $("#line").textContent = "Summing up what we agreed…"; }
      else { curEl.textContent = curText; $("#line").textContent = curText; }
      feed.scrollTop = feed.scrollHeight;
    }
    if (ev.type === "done") {
      curEl?.classList.remove("caret");
      const seat = cur && $(`#seat-${CSS.escape(cur.id)}`);
      seat?.querySelector(".av").classList.remove("talking"); seat?.classList.add("done");
    }
    if (ev.type === "error") add(`<div class="err">${esc(ev.message)}</div>`);
    if (ev.type === "end") {
      live.close(); live = null;
      document.querySelectorAll(".seat").forEach((s) => { s.classList.remove("on"); s.classList.add("done"); });
      $("#pill").textContent = ev.status === "finished" ? "Meeting over" : ev.status === "stopped" ? "Stopped" : "Something went wrong";
      $("#spk").textContent = ""; $("#ctag").textContent = "Topic"; $("#line").textContent = ev.status === "finished" ? "Minutes are ready." : m.topic;
      $("#stop").remove(); $("#say").remove();
      const copy = $("#copy"); if (copy) copy.onclick = () => navigator.clipboard.writeText(ev.minutes || "");
      refresh();
    }
  };
  $("#stop").onclick = () => api(`/api/meetings/${encodeURIComponent(id)}/stop`, { method: "POST" });
  $("#say").onsubmit = async (e) => {
    e.preventDefault();
    const t = $("#say-t"), text = t.value.trim(); if (!text) return;
    t.value = "";
    await api(`/api/meetings/${encodeURIComponent(id)}/say`, { method: "POST", body: { text } });
  };
}

async function renderPast(id) {
  const { markdown } = await api(`/api/meetings/${encodeURIComponent(id)}`);
  const [title, ...rest] = markdown.split("\n");
  $("#main").innerHTML = `<div class="head"><h1>${esc(title.replace(/^# /, ""))}</h1><span class="sp"></span><button class="ghost" id="cp">Copy Markdown</button></div>
    <div class="scroll"><div class="msgs"><div class="bubble" style="max-width:none">${md(rest.join("\n"))}</div></div></div>`;
  $("#cp").onclick = () => navigator.clipboard.writeText(markdown);
}

// ---------------- dialogs ----------------
function dialog(html, bind) {
  const d = $("#dlg"); $("#dlg-body").innerHTML = html; bind?.($("#dlg-body")); d.showModal();
}
const close = () => $("#dlg").close();

function openNewMeeting() {
  if (!state.config.hasKey && !state.config.mock) return openSettings("Add an API key first, then start the meeting.");
  const picked = new Set(state.agents.map((a) => a.id));
  let rounds = 2;
  dialog(`
    <h2>Start a meeting</h2>
    <label>What should the team discuss?<textarea id="topic" placeholder="e.g. How do we get our first 100 users?"></textarea></label>
    <label>Who's in the room <span class="hint">· the first one hosts and writes the minutes</span></label>
    <div class="row" id="who">${state.agents.map((a) => `<button type="button" class="chip on" data-id="${esc(a.id)}">${avatar(a)}${esc(a.name)}</button>`).join("")}</div>
    <label>Rounds</label>
    <div class="row" id="rounds">${[1, 2, 3].map((n) => `<button type="button" class="chip plain ${n === 2 ? "on" : ""}" data-n="${n}">${n}</button>`).join("")}</div>
    <div class="row end"><button type="button" class="ghost" id="x">Cancel</button><button class="primary" id="go">Start</button></div>`, (f) => {
    f.querySelector("#who").onclick = (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      picked.has(b.dataset.id) ? picked.delete(b.dataset.id) : picked.add(b.dataset.id);
      b.classList.toggle("on");
    };
    f.querySelector("#rounds").onclick = (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      rounds = Number(b.dataset.n); f.querySelectorAll("#rounds .chip").forEach((c) => c.classList.toggle("on", c === b));
    };
    f.querySelector("#x").onclick = close;
    f.querySelector("#go").onclick = async (e) => {
      e.preventDefault();
      const topic = f.querySelector("#topic").value.trim();
      const members = state.agents.filter((a) => picked.has(a.id));
      if (!topic || !members.length) return f.querySelector("#topic").focus();
      const { id } = await api("/api/meetings", { method: "POST", body: { topic, members: members.map((a) => a.id), rounds } });
      close();
      show({ kind: "meeting", id, meta: { topic, members, rounds } });
    };
    setTimeout(() => f.querySelector("#topic").focus());
  });
}

function openAgent(a = null) {
  let color = a?.color || COLORS[state.agents.length % COLORS.length];
  dialog(`
    <h2>${a ? "Edit agent" : "New agent"}</h2>
    <div class="row" style="flex-wrap:nowrap">
      <label style="flex:1">Name<input id="name" value="${esc(a?.name || "")}" placeholder="e.g. Nora"></label>
      <label style="flex:1">Role<input id="role" value="${esc(a?.role || "")}" placeholder="e.g. Designer"></label>
    </div>
    <label>Color</label><div class="row" id="sw">${COLORS.map((c) => `<button type="button" class="sw ${c === color ? "on" : ""}" data-c="${c}" style="background:${c}"></button>`).join("")}</div>
    <label>How they think and work<textarea id="ins" rows="4" placeholder="What they care about, how they talk, what they push back on.">${esc(a?.instructions || "")}</textarea></label>
    <label>Model <span class="hint">· leave empty to use the default</span><input id="model" value="${esc(a?.model || "")}" placeholder="${esc(state.config.model || "")}"></label>
    <div class="row end">${a ? `<button type="button" class="ghost danger" id="del" style="margin-right:auto">Remove</button>` : ""}<button type="button" class="ghost" id="x">Cancel</button><button class="primary" id="ok">Save</button></div>`, (f) => {
    f.querySelector("#sw").onclick = (e) => {
      const b = e.target.closest(".sw"); if (!b) return;
      color = b.dataset.c; f.querySelectorAll(".sw").forEach((s) => s.classList.toggle("on", s === b));
    };
    f.querySelector("#x").onclick = close;
    const del = f.querySelector("#del");
    if (del) del.onclick = async () => { await api(`/api/agents/${encodeURIComponent(a.id)}`, { method: "DELETE" }); close(); await refresh(); show({ kind: "home" }); };
    f.querySelector("#ok").onclick = async (e) => {
      e.preventDefault();
      const body = { name: f.querySelector("#name").value, role: f.querySelector("#role").value, color, avatar: a?.avatar || "", instructions: f.querySelector("#ins").value, model: f.querySelector("#model").value };
      if (!body.name.trim()) return f.querySelector("#name").focus();
      const saved = a ? await api(`/api/agents/${encodeURIComponent(a.id)}`, { method: "PUT", body }) : await api("/api/agents", { method: "POST", body });
      close(); await refresh(); show({ kind: "chat", id: saved.id });
    };
  });
}

const PRESETS = [
  ["DeepSeek", "https://api.deepseek.com/v1", "deepseek-chat"],
  ["OpenAI", "https://api.openai.com/v1", "gpt-4o-mini"],
  ["OpenRouter", "https://openrouter.ai/api/v1", "openai/gpt-4o-mini"],
  ["Ollama (local)", "http://127.0.0.1:11434/v1", "llama3.1"],
];

function openSettings(note = "") {
  const c = state.config;
  dialog(`
    <h2>Model</h2>
    ${note ? `<div class="hint" style="color:var(--accent)">${esc(note)}</div>` : ""}
    <div class="row" id="pre">${PRESETS.map(([n], i) => `<button type="button" class="chip plain" data-i="${i}">${n}</button>`).join("")}</div>
    <label>API base URL<input id="base" value="${esc(c.baseUrl)}"></label>
    <label>API key <span class="hint">· stored only on this computer, in ~/.kiki-core/config.json</span><input id="key" type="password" placeholder="${c.hasKey ? "•••••••• (saved, leave empty to keep)" : "sk-…"}"></label>
    <label>Default model<input id="model" value="${esc(c.model)}"></label>
    ${c.mock ? `<div class="hint">Demo mode is on (KIKI_MOCK=1): replies are canned and no key is used.</div>` : ""}
    <div class="row end"><button type="button" class="ghost" id="x">Cancel</button><button class="primary" id="ok">Save</button></div>`, (f) => {
    f.querySelector("#pre").onclick = (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      const [, url, model] = PRESETS[b.dataset.i];
      f.querySelector("#base").value = url; f.querySelector("#model").value = model;
      f.querySelectorAll("#pre .chip").forEach((x) => x.classList.toggle("on", x === b));
    };
    f.querySelector("#x").onclick = close;
    f.querySelector("#ok").onclick = async (e) => {
      e.preventDefault();
      state.config = await api("/api/config", { method: "POST", body: { baseUrl: f.querySelector("#base").value, model: f.querySelector("#model").value, apiKey: f.querySelector("#key").value } });
      close(); renderSide(); render();
    };
  });
}

// ---------------- wiring ----------------
document.addEventListener("click", (e) => {
  const chat = e.target.closest("[data-chat]"); if (chat) return show({ kind: "chat", id: chat.dataset.chat });
  const past = e.target.closest("[data-past]"); if (past) return show({ kind: "past", id: past.dataset.past });
});
$("#new-meeting").onclick = openNewMeeting;
$("#add-agent").onclick = () => openAgent();
$("#open-settings").onclick = () => openSettings();
$(".brand").onclick = () => show({ kind: "home" });

await refresh();
render();
