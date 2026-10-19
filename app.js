const APP = {
  key: null,
  unlocked: false,
  entries: [],
  meta: null,
  loadedOK: false,
  filter: { search: "", tag: null, sort: "new" },
  view: localStorage.getItem("ediary_view") === "timeline" ? "timeline" : "cards",
  autoLockTimer: null,
  gate: {
    stage: 0,
    lastValue: "",
    wrongCount: 0,
    wrongResetTimer: null,
    autoTimer: null,
    busy: false
  }
};

const IDLE_LOCK_MS = 10 * 60 * 1000;
const CHECK_TEXT = "ediary-check-v1";

function deriveRepoFromLocation() {
  const host = location.hostname;
  if (!host.endsWith(".github.io")) return null;
  const owner = host.split(".")[0];
  const seg = location.pathname.split("/").filter(Boolean)[0];
  if (!seg) return { owner, repo: owner, ready: true };
  return { owner, repo: seg, ready: true };
}

function el(id) {
  return document.getElementById(id);
}

const escapeHtml = s => Util.escapeHtml(s);

function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtShort(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function fmtClock(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function wordsOf(text) {
  const clean = String(text || "").replace(/!\[[^\]]*\]\(image:[^)]+\)/g, " ").trim();
  return clean ? clean.split(/\s+/).length : 0;
}

const TAG_PALETTE = ["#e8a87c", "#7fd4c1", "#a8b8f0", "#e79fd0", "#c9b26a", "#9ad48a", "#e0908f", "#8bc4e8"];

function tagColor(t) {
  let h = 0;
  for (const c of String(t)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

function uid() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${Math.random().toString(36).slice(2, 7)}`;
}

const slugify = s => Util.slugify(s);

/* ── quick-jump palette (Ctrl/Cmd+K) ───────────── */

const PALETTE = { sel: 0, items: [] };

function paletteScore(e, q) {
  const title = (e.meta.title || "").toLowerCase();
  const tags = (e.meta.tags || []).join(" ").toLowerCase();
  const text = (e.text || "").toLowerCase();
  if (title.startsWith(q)) return 0;
  if (title.includes(q)) return 1;
  if (tags.includes(q)) return 2;
  const at = text.indexOf(q);
  return at === -1 ? 999 : 3 + Math.min(1, at / 2000);
}

function renderPalette() {
  const q = el("paletteInput").value.trim().toLowerCase();
  const list = visibleEntries();
  PALETTE.items = q
    ? list.map(e => [paletteScore(e, q), e]).filter(x => x[0] < 900).sort((a, b) => a[0] - b[0]).map(x => x[1]).slice(0, 8)
    : list.slice(0, 8);
  PALETTE.sel = Math.min(PALETTE.sel, Math.max(0, PALETTE.items.length - 1));
  el("paletteList").innerHTML = PALETTE.items.map((e, i) => {
    const clean = (e.text || "").replace(/!\[[^\]]*\]\(image:[^)]+\)/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    return `<button type="button" class="palette-item${i === PALETTE.sel ? " sel" : ""}" data-i="${i}">
      <span class="pi-title">${MOOD_EMOJI[e.meta.mood] || ""} ${escapeHtml(e.meta.title || "Untitled")}</span>
      <span class="pi-snippet">${escapeHtml(clean)}</span>
    </button>`;
  }).join("") || `<div class="slash-empty">no match</div>`;
  el("paletteList").querySelectorAll(".palette-item").forEach(b => {
    b.onclick = () => palettePick(+b.dataset.i);
    b.onmouseenter = () => { PALETTE.sel = +b.dataset.i; renderPalette(); };
  });
}

function palettePick(i) {
  const e = PALETTE.items[i];
  modalClose("paletteModal");
  if (e) openEditor(e.id);
}

function openPalette() {
  PALETTE.sel = 0;
  el("paletteInput").value = "";
  modalOpen("paletteModal");
  renderPalette();
}

/* ── year in review ─────────────────────────────── */

function reviewYears() {
  const set = new Set(APP.entries.map(e => new Date(e.meta.created || e.meta.updated || Date.now()).getFullYear()));
  return [...set].sort((a, b) => b - a).filter(Number.isFinite);
}

function openReview(year) {
  const years = reviewYears();
  if (!years.length) { toast("No pages yet — write first!", "err"); return; }
  const y = years.includes(year) ? year : years[0];
  const inYear = APP.entries.filter(e => new Date(e.meta.created || e.meta.updated).getFullYear() === y);
  const words = inYear.reduce((n, e) => n + wordsOf(e.text || ""), 0);
  const photos = inYear.reduce((n, e) => n + (e.meta.images || []).length, 0);
  const moodCounts = {};
  for (const e of inYear) if (e.meta.mood && MOOD_EMOJI[e.meta.mood]) moodCounts[e.meta.mood] = (moodCounts[e.meta.mood] || 0) + 1;
  const tagCounts = {};
  for (const e of inYear) for (const t of e.meta.tags || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const longest = inYear.slice().sort((a, b) => wordsOf(b.text || "") - wordsOf(a.text || ""))[0];
  const monthBuckets = Array(12).fill(0);
  for (const e of inYear) monthBuckets[new Date(e.meta.created || e.meta.updated).getMonth()]++;
  const maxM = Math.max(1, ...monthBuckets);
  el("reviewTitle").textContent = y + " in review";
  el("reviewYearRow").innerHTML = years.map(yy =>
    `<button type="button" class="chip sm${yy === y ? " sel" : ""}" data-y="${yy}">${yy}</button>`).join("");
  el("reviewYearRow").querySelectorAll("button[data-y]").forEach(b => {
    b.onclick = () => openReview(+b.dataset.y);
  });
  el("reviewBody").innerHTML = `
    <div class="rv-stats">
      <div class="rv-stat"><span class="rv-num">${inYear.length}</span><span class="rv-lbl">${inYear.length === 1 ? "page" : "pages"}</span></div>
      <div class="rv-stat"><span class="rv-num">${words.toLocaleString()}</span><span class="rv-lbl">words</span></div>
      <div class="rv-stat"><span class="rv-num">${photos}</span><span class="rv-lbl">${photos === 1 ? "photo" : "photos"}</span></div>
    </div>
    <div class="rv-months">${monthBuckets.map((n, m) =>
      `<span class="rv-month" title="${new Date(y, m, 1).toLocaleDateString(undefined, { month: "short" })}: ${n}"><i style="height:${Math.round(n / maxM * 100)}%; ${n ? "" : "opacity:.25"}"></i><em>${n || ""}</em></span>`).join("")}</div>
    ${Object.keys(moodCounts).length ? `<div class="rv-moods">${Object.entries(moodCounts).sort((a, b) => b[1] - a[1]).map(([m, n]) =>
      `<span class="rv-mood">${MOOD_EMOJI[m]}<em>${n}</em></span>`).join("")}</div>` : ""}
    ${topTags.length ? `<div class="rv-tags">${topTags.map(([t, n]) => `<span class="chip sm"><span class="dot" style="--dot:${tagColor(t)}"></span>${escapeHtml(t)} <em>${n}</em></span>`).join("")}</div>` : ""}
    ${longest ? `<div class="rv-longest">longest entry: <b>${escapeHtml(longest.meta.title || "Untitled")}</b> (${wordsOf(longest.text || "").toLocaleString()} words)</div>` : ""}
    <div class="hint rv-note">that's ${words ? Math.round(words / inYear.length) : 0} words per page, on average. nice.</div>`;
  modalOpen("reviewModal");
}

function wirePalette() {
  el("paletteInput").addEventListener("input", () => { PALETTE.sel = 0; renderPalette(); });
  el("paletteInput").addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); PALETTE.sel = (PALETTE.sel + 1) % Math.max(1, PALETTE.items.length); renderPalette(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); PALETTE.sel = (PALETTE.sel - 1 + PALETTE.items.length) % Math.max(1, PALETTE.items.length); renderPalette(); }
    else if (e.key === "Enter") { e.preventDefault(); if (PALETTE.items.length) palettePick(PALETTE.sel); }
    else if (e.key === "Escape") { e.preventDefault(); modalClose("paletteModal"); }
  });
  el("paletteModal").addEventListener("click", e => { if (e.target === el("paletteModal")) modalClose("paletteModal"); });
}

function toast(msg, kind) {
  const wrap = el("toasts");
  const t = document.createElement("div");
  t.className = "toast" + (kind ? " toast-" + kind : "");
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 400); }, 3200);
}

function modalOpen(id) {
  const m = el(id);
  m.classList.add("open");
  m.setAttribute("aria-hidden", "false");
  modalOpen.lastFocus = document.activeElement;
  if (!m.dataset.trap) {
    m.dataset.trap = "1";
    m.addEventListener("keydown", e => {
      if (e.key !== "Tab") return;
      const items = m.querySelectorAll("button, input, textarea, select, a[href], [tabindex]:not([tabindex='-1'])");
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }
  const f = m.querySelector("input:not([hidden]), button, [tabindex]");
  if (f) setTimeout(() => f.focus(), 40);
}

function modalClose(id) {
  const m = el(id);
  if (!m.classList.contains("open")) return;
  m.classList.remove("open");
  m.setAttribute("aria-hidden", "true");
  if (modalOpen.lastFocus && document.contains(modalOpen.lastFocus)) {
    try { modalOpen.lastFocus.focus(); } catch (e) {}
  }
}

/* ── sync pill (iCloud-style status) ───────────── */

const SYNC = { state: "idle", failed: [] };

function setSyncPill(state, note) {
  SYNC.state = SYNC.state === "error" && state === "ok" ? "error" : state;
  if (state === "error") SYNC.failed.push(note);
  if (state === "ok" && !SYNC.failed.length) SYNC.state = "idle";
  const pill = el("syncPill");
  if (SYNC.state === "idle") { pill.hidden = true; return; }
  pill.hidden = false;
  pill.className = "sync-pill " + SYNC.state;
  pill.textContent = SYNC.state === "syncing" ? "↻ syncing…" : SYNC.state === "ok" ? "synced ✓" : "sync error — click to retry";
}

async function retrySync() {
  if (SYNC.state !== "error") return;
  const jobs = SYNC.failed.splice(0);
  setSyncPill("syncing");
  for (const job of jobs) {
    try { await job(); } catch (err) {
      SYNC.failed.push(job);
      setSyncPill("error", job);
      toast("Retry failed: " + err.message, "err");
      return;
    }
  }
  setSyncPill("ok");
}

function showScreen(name) {
  el("setupScreen").hidden = name !== "setup";
  el("lockScreen").hidden = name !== "gate";
  el("appScreen").hidden = name !== "app";
}

function gateTokens() {
  return Vault.normalizeWaifu(el("gatePass").value).split("-").filter(Boolean);
}

const GATE_STAGE_MOODS = ["idle", "curious", "shy", "love"];

function updateGateReactions() {
  const tokens = gateTokens();
  const stage = Math.min(3, tokens.length);
  if (stage !== APP.gate.stage) {
    APP.gate.stage = stage;
    Moods.setMood(GATE_STAGE_MOODS[stage]);
  }
}

function gateWrong(msgMood) {
  APP.gate.wrongCount++;
  clearTimeout(APP.gate.wrongResetTimer);
  APP.gate.wrongResetTimer = setTimeout(() => { APP.gate.wrongCount = 0; }, 5 * 60 * 1000);
  const wrongs = ["pout", "tease", "silent"];
  const mood = wrongs[Math.min(2, APP.gate.wrongCount - 1)];
  Moods.setMood(mood);
  el("lockMsg").textContent = msgMood || "";
  const host = el("avatarHost");
  host.classList.remove("shake");
  void host.offsetWidth;
  host.classList.add("shake");
}

async function unlockAttempt() {
  if (APP.gate.busy) return;
  const pass = APP.unlocked ? "" : Vault.normalizeWaifu(el("gatePass").value);
  if (!pass) { gateWrong(""); return; }
  APP.gate.busy = true;
  el("lockMsg").textContent = "";
  el("lockMsg").classList.add("lock-thinking");
  el("lockMsg").textContent = "thinking";
  const unthink = () => { el("lockMsg").classList.remove("lock-thinking"); if (el("lockMsg").textContent === "thinking…") el("lockMsg").textContent = ""; };
  try {
    const hint = deriveRepoFromLocation();
    if (hint) {
      const metaRaw = await ghGetFilePublic(hint.owner, hint.repo, VAULT_PATHS.meta);
      const meta = metaRaw ? JSON.parse(metaRaw) : null;
      if (!meta) {
        if (getGithubConfig() && getGithubConfig().token) {
          const r = await Vault.unlock(pass);
          APP.gate.stage = 3;
          Moods.setMood("gloat");
          setTimeout(() => afterUnlock(r.key, r.meta), 550);
          return;
        }
        Moods.setMood("curious");
        showScreen("setup");
        el("setupMsg").className = "hint";
        el("setupMsg").textContent = "No vault yet. Paste the token once, claim her sentence below, then she will always be on this screen.";
        el("setupWaifu").focus();
        return;
      }
      const { key } = await Vault.unlockWithMeta(pass, meta);
      APP.gate.stage = 3;
      Moods.setMood("gloat");
      el("avatarHost").classList.add("celebrate");
      setTimeout(() => el("avatarHost").classList.remove("celebrate"), 800);
      setTimeout(() => afterUnlock(key, meta, hint), 550);
      return;
    }
    const cfg = getGithubConfig();
    if (cfg && cfg.token) {
      const { key, meta } = await Vault.unlock(pass);
      APP.gate.stage = 3;
      Moods.setMood("gloat");
      el("avatarHost").classList.add("celebrate");
      setTimeout(() => el("avatarHost").classList.remove("celebrate"), 800);
      setTimeout(() => afterUnlock(key, meta), 550);
    } else {
      el("lockMsg").textContent = "Vault unreachable from this address.";
      Moods.setMood("curious");
    }
  } catch (err) {
    if (err.message && err.message.includes("No vault found")) {
      Moods.setMood("curious");
      showScreen("setup");
      el("setupMsg").className = "hint";
      el("setupMsg").textContent = "No vault yet. Paste the token once, claim her sentence below, then she will always be on this screen.";
      el("setupWaifu").focus();
    } else if (err.status === 404 || (err.message && err.message.includes("not found"))) {
      gateWrong("Repo not found — config problem.");
    } else {
      gateWrong(err.message === "Wrong password" ? "" : err.message);
    }
  } finally {
    unthink();
    APP.gate.busy = false;
  }
}

async function recoverTokenIfNeeded(key, hint) {
  const cfg = getGithubConfig();
  if (cfg && cfg.token) return;
  const owner = hint ? hint.owner : (cfg ? cfg.owner : null);
  const repo = hint ? hint.repo : (cfg ? cfg.repo : null);
  if (!owner || !repo) return;
  try {
    const enc = await Vault.readTokenEnc(owner, repo);
    if (!enc) return;
    const plain = await decryptToString(key, enc);
    const saved = JSON.parse(plain);
    if (saved && saved.token && saved.owner && saved.repo) {
      setGithubConfig(saved);
      Vault.invalidateCache();
      toast("Token recovered — no pasting needed", "ok");
    }
  } catch (err) {
    toast("Auto-recovery failed — open Settings to paste a token after unlocking", "err");
  }
}

function resetGate() {
  el("gatePass").value = "";
  el("lockMsg").textContent = "";
  APP.gate.stage = 0;
  APP.gate.wrongCount = 0;
  APP.gate.busy = false;
  clearTimeout(APP.gate.autoTimer);
  Moods.setMood("idle", true);
}

function mountMiniAvatars() {
  const src = el("avatarHost");
  if (!src || !src.innerHTML) return;
  const svgHtml = src.innerHTML;
  document.querySelectorAll("[data-mini-avatar]").forEach(h => {
    h.innerHTML = svgHtml;
    h.querySelectorAll("g.face").forEach(g => g.classList.toggle("active", g.dataset.face === "love"));
  });
}

async function afterUnlock(key, meta, hint) {
  APP.key = key;
  APP.meta = meta;
  APP.unlocked = true;
  APP.loadedOK = false;
  showScreen("app");
  document.body.classList.add("unlocked");
  closeEditor();
  el("loadingMsg").textContent = "Decrypting entries...";
  el("loadingMsg").classList.remove("err", "clickable");
  el("loadingMsg").onclick = null;
  const cfg = getGithubConfig();
  if (!cfg || !cfg.token) {
    await recoverTokenIfNeeded(key, hint);
  }
  await tryLoadEntries();
}

async function tryLoadEntries() {
  el("loadingMsg").textContent = APP.loadedOK ? "Refreshing entries..." : "Decrypting entries...";
  try {
    APP.entries = await Vault.listEntries();
    APP.loadedOK = true;
    renderAll();
    el("loadingMsg").textContent = "";
    el("loadingMsg").classList.remove("err", "clickable");
    el("loadingMsg").onclick = null;
    resetIdleTimer();
  } catch (err) {
    APP.loadedOK = false;
    Log.push({ msg: "entries load failed: " + err.message });
    el("loadingMsg").textContent = "⚠ Vault didn't load — click here to retry";
    el("loadingMsg").classList.add("err", "clickable");
    el("loadingMsg").onclick = () => { tryLoadEntries(); };
    toast("Failed to load entries: " + err.message, "err");
    if (!getGithubConfig() || !getGithubConfig().token) {
      el("loadingMsg").textContent = "Token expired or missing — opens Settings inside the app.";
    }
  }
}

function requireLoaded(op) {
  if (APP.loadedOK) return true;
  toast("Vault not loaded yet — use the retry note in the sidebar", "err");
  Log.push({ msg: "blocked " + op + ": vault not loaded" });
  return false;
}

async function lockVault() {
  APP.key = null;
  APP.unlocked = false;
  APP.entries = [];
  APP.meta = null;
  for (const url of IMG_CACHE.values()) URL.revokeObjectURL(url);
  IMG_CACHE.clear();
  document.body.classList.remove("unlocked");
  showScreen("gate");
  resetGate();
}

function resetIdleTimer() {
  clearTimeout(APP.autoLockTimer);
  if (APP.unlocked) {
    APP.autoLockTimer = setTimeout(lockVault, IDLE_LOCK_MS);
  }
}

/* ── sidebar / tabs / list ─────────────────────── */

function renderAll() {
  renderList();
  renderTags();
  renderTabs();
}

function renderTags() {
  const counts = {};
  for (const e of APP.entries) for (const t of e.meta.tags || []) counts[t] = (counts[t] || 0) + 1;
  const tags = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  el("navAllCount").textContent = APP.entries.length;
  el("navAll").classList.toggle("active", !APP.filter.tag);
  el("tagList").innerHTML = tags.length
    ? tags.map(t => `<div class="tag-item${APP.filter.tag === t ? " active" : ""}" data-tag="${escapeHtml(t)}">
        <span class="dot" style="--dot:${tagColor(t)}"></span>${escapeHtml(t)}
        <span class="count">${counts[t]}</span>
      </div>`).join("")
    : `<div class="side-empty">no tags yet</div>`;
  el("tagList").querySelectorAll(".tag-item").forEach(d => {
    d.onclick = () => {
      APP.filter.tag = d.dataset.tag;
      renderAll();
    };
  });
}

function renderTabs() {
  const tag = APP.filter.tag;
  el("tabsRow").innerHTML =
    `<button class="tab${!tag ? " active" : ""}" data-tab="">All</button>` +
    (tag ? `<button class="tab active" data-tab="${escapeHtml(tag)}">${escapeHtml(tag)} <span class="tab-x">×</span></button>` : "");
  el("tabsRow").querySelectorAll(".tab").forEach(b => {
    b.onclick = ev => {
      if (ev.target.classList.contains("tab-x") || !b.dataset.tab) {
        APP.filter.tag = null;
        renderAll();
      }
    };
  });
}

function visibleEntries() {
  const f = APP.filter;
  const q = f.search.trim().toLowerCase();
  const list = APP.entries.filter(e => {
    if (f.tag && !(e.meta.tags || []).includes(f.tag)) return false;
    if (!q) return true;
    return (
      (e.meta.title || "").toLowerCase().includes(q) ||
      (e.text || "").toLowerCase().includes(q) ||
      (e.meta.tags || []).some(t => t.toLowerCase().includes(q))
    );
  });
  return list.sort((a, b) => {
    const av = a.meta.updated || a.meta.created || "";
    const bv = b.meta.updated || b.meta.created || "";
    return f.sort === "old" ? av.localeCompare(bv) : bv.localeCompare(av);
  });
}

function noteCardHtml(e, cur, i) {
  const title = e.meta.title || "Untitled";
  const clean = (e.text || "").replace(/!\[[^\]]*\]\(image:[^)]+\)/g, " [image] ").replace(/\s+/g, " ").trim();
  const w = wordsOf(e.text || "");
  const tags = e.meta.tags || [];
  const tagChip = tags.length
    ? `<span class="chip sm"><span class="dot" style="--dot:${tagColor(tags[0])}"></span>${escapeHtml(tags[0])}${tags.length > 1 ? ` +${tags.length - 1}` : ""}</span>`
    : "";
  const upd = e.meta.updated || e.meta.created;
  return `<div class="note-card${e.id === cur ? " selected" : ""}" data-id="${escapeHtml(e.id)}" style="--i:${i}">
    <div class="nc-title">${MOOD_EMOJI[e.meta.mood] ? `<span class="nc-mood">${MOOD_EMOJI[e.meta.mood]}</span> ` : ""}${escapeHtml(title)}</div>
    <div class="nc-snippet${clean ? "" : " empty"}">${escapeHtml(clean.slice(0, 96) || "empty page")}</div>
    <div class="nc-meta">
      <span class="nc-w">${w === 1 ? "1 word" : w + " words"}</span>
      ${tagChip}
      <span class="nc-time">${escapeHtml(fmtClock(upd))}</span>
    </div>
    <button class="nc-del icon-btn" data-act="del" title="Delete" aria-label="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6"/></svg></button>
  </div>`;
}

function monthLabel(d) {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function renderList() {
  const list = visibleEntries();
  const q = (APP.filter.query || "").trim();
  const fTag = APP.filter.tag;
  el("listCount").textContent = list.length === 1 ? "1 note" : list.length + " notes";
  el("emptyState").hidden = !!list.length;
  if (!list.length) {
    if (APP.entries.length && (q || fTag)) {
      el("emptyTitle").textContent = "No match here.";
      el("emptyHint").textContent = "try another word — or clear the filter above.";
    } else {
      el("emptyTitle").textContent = "Nothing written yet.";
      el("emptyHint").textContent = "“New page” starts your first entry — she's waiting.";
    }
  }
  el("viewToggle").textContent = APP.view === "timeline" ? "Cards" : "Timeline";
  const cur = el("editor").dataset.id;
  if (APP.view === "timeline") {
    const groups = new Map();
    for (const e of list) {
      const d = new Date(e.meta.created || e.meta.updated || Date.now());
      const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    let i = 0;
    el("grid").classList.add("timeline");
    el("grid").innerHTML = [...groups.entries()].map(([key, items]) => {
      const label = monthLabel(new Date(+key.slice(0, 4), +key.slice(5) - 1, 1));
      return `<div class="tl-month"><div class="tl-head" style="--i:${i++}">${escapeHtml(label)} <span class="muted">${items.length}</span></div>` +
        items.map(e => noteCardHtml(e, cur, i++)).join("") + `</div>`;
    }).join("");
  } else {
    el("grid").classList.remove("timeline");
    el("grid").innerHTML = list.map((e, i) => noteCardHtml(e, cur, i)).join("");
  }
  el("grid").querySelectorAll(".note-card").forEach(c => {
    c.onclick = ev => {
      if (ev.target.closest("[data-act=del]")) return;
      openEditor(c.dataset.id);
    };
  });
  el("grid").querySelectorAll('[data-act="del"]').forEach(b => {
    b.onclick = ev => {
      ev.stopPropagation();
      deleteEntry(b.closest(".note-card").dataset.id);
    };
  });
  updateDelights();
}

async function deleteEntry(id) {
  if (!requireLoaded("delete")) return;
  const e = APP.entries.find(x => x.id === id);
  if (!e) return;
  if (!confirm(`Delete "${e.meta.title || "Untitled"}"? This removes it from GitHub too.`)) return;
  try {
    await Vault.removeFile(Vault.entryPath(e), "vault update");
    APP.entries = APP.entries.filter(x => x.id !== id);
    for (const img of e.meta.images || []) {
      try { await Vault.removeFile(Vault.imagePath(img.id), "vault update"); } catch (err) { Log.push({ msg: "image delete failed " + img.id + ": " + err.message }); }
    }
    clearDraft(id);
    if (el("editor").dataset.id === id) closeEditor();
    renderAll();
    toast("Entry deleted", "ok");
  } catch (err) {
    Log.push({ msg: "delete failed: " + err.message });
    toast("Delete failed: " + err.message, "err");
  }
}

/* ── editor ────────────────────────────────────── */

let ED_TAGS = [];

const ENTRY_MOODS = [
  { k: "fire", e: "🔥" },
  { k: "sparkle", e: "✨" },
  { k: "soft", e: "🫶" },
  { k: "calm", e: "🧘" },
  { k: "sleepy", e: "😴" },
  { k: "sad", e: "🥲" },
  { k: "storm", e: "⛈️" }
];
const MOOD_EMOJI = Object.fromEntries(ENTRY_MOODS.map(m => [m.k, m.e]));
let ED_MOOD = "";

function renderEdMoods() {
  el("edMoodRow").innerHTML = ENTRY_MOODS.map(m =>
    `<button type="button" class="mood-btn${ED_MOOD === m.k ? " on" : ""}" data-mood="${m.k}" aria-label="mood ${m.k}">${m.e}</button>`
  ).join("") + `<button type="button" class="mood-btn none${ED_MOOD ? "" : " on"}" data-mood="" aria-label="no mood">·</button>`;
  el("edMoodRow").querySelectorAll(".mood-btn").forEach(b => {
    b.onclick = () => {
      ED_MOOD = b.dataset.mood;
      renderEdMoods();
      saveDraftSoon();
    };
  });
}

function dayKey(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function computeStreak() {
  const days = new Set(APP.entries.map(e => dayKey(new Date(e.meta.created || e.meta.updated || Date.now()))));
  if (!days.size) return { count: 0, todayDone: false };
  const now = new Date();
  const todayDone = days.has(dayKey(now));
  const start = new Date(now);
  if (!todayDone) start.setDate(start.getDate() - 1);
  let count = 0;
  while (days.has(dayKey(start))) {
    count++;
    start.setDate(start.getDate() - 1);
  }
  return { count, todayDone };
}

function updateDelights() {
  const streak = computeStreak();
  const card = el("streakCard");
  if (!APP.entries.length) {
    card.hidden = true;
  } else {
    card.hidden = false;
    card.textContent = streak.count > 0
      ? (streak.todayDone ? `🔥 ${streak.count}-day streak` : `🔥 ${streak.count}-day streak — write today to keep it`)
      : "🌱 write today to start a streak";
  }

  const otd = el("onThisDay");
  const now = new Date();
  const matches = APP.entries.filter(e => {
    const d = new Date(e.meta.created || e.meta.updated || Date.now());
    return d.getFullYear() < now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  });
  if (matches.length) {
    otd.hidden = false;
    otd.innerHTML = `<div class="otd-title">🕰 on this day</div>` + matches.map(e =>
      `<button type="button" class="otd-row" data-id="${escapeHtml(e.id)}">${escapeHtml(e.meta.title || "Untitled")} <span class="muted">${new Date(e.meta.created).getFullYear()}</span></button>`
    ).join("");
    otd.querySelectorAll(".otd-row").forEach(b => { b.onclick = () => openEditor(b.dataset.id); });
  } else {
    otd.hidden = true;
    otd.innerHTML = "";
  }

  const recent = [...APP.entries]
    .sort((a, b) => new Date(b.meta.created || 0) - new Date(a.meta.created || 0))
    .slice(0, 14)
    .filter(e => e.meta.mood);
  el("moodStrip").innerHTML = recent.map(e =>
    `<span class="mood-dot" data-id="${escapeHtml(e.id)}" title="${escapeHtml(e.meta.title || "Untitled")}">${MOOD_EMOJI[e.meta.mood] || ""}</span>`
  ).join("");
  el("moodStrip").querySelectorAll(".mood-dot").forEach(d => { d.onclick = () => openEditor(d.dataset.id); });
}

function renderEdTags() {
  el("edTagChips").innerHTML = ED_TAGS.map((t, i) =>
    `<span class="chip chip-tag"><span class="dot" style="--dot:${tagColor(t)}"></span>${escapeHtml(t)}<button class="chip-x" data-i="${i}" aria-label="remove tag">×</button></span>`
  ).join("");
  el("edTagChips").querySelectorAll(".chip-x").forEach(b => {
    b.onclick = () => {
      ED_TAGS.splice(+b.dataset.i, 1);
      renderEdTags();
    };
  });
}

function commitTagInput() {
  const raw = el("edTags").value;
  const parts = raw.split(",").map(s => s.trim()).filter(Boolean);
  for (const p of parts) if (!ED_TAGS.includes(p)) ED_TAGS.push(p);
  el("edTags").value = "";
  if (parts.length) renderEdTags();
  saveDraftSoon();
}

function openEditor(id) {
  const e = id ? APP.entries.find(x => x.id === id) : null;
  el("editor").dataset.id = e ? e.id : "";
  el("editor").classList.add("open");
  el("edTitle").value = e ? e.meta.title || "" : "";
  ED_TAGS = e ? [...(e.meta.tags || [])] : [];
  renderEdTags();
  ED_MOOD = e ? e.meta.mood || "" : "";
  renderEdMoods();
  el("edTags").value = "";
  el("edText").value = e ? e.text || "" : "";
  el("edDate").textContent = fmtShort(e ? (e.meta.created || e.meta.updated) : new Date().toISOString());
  el("edEdited").textContent = e ? "edited " + fmtDateTime(e.meta.updated || e.meta.created) : "unsaved";
  restoreDraftIfAny(id, e);
  hideSlashMenu();
  updateCount();
  if (isSplit()) {
    el("previewPane").hidden = false;
    renderPreviewLive();
  } else {
    el("previewPane").hidden = true;
  }
  renderList();
  const sc = document.querySelector(".ed-page");
  if (sc) sc.scrollTop = 0;
  el("edTitle").focus();
}

function restoreDraftIfAny(id, e) {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch (err) { d = null; }
  if (!d) return;
  const mine = el("edText").value;
  if (d.id !== el("editor").dataset.id) return;
  if (d.id === "" && !e && !d.text.trim() && !d.title) return;
  if (e && d.text === mine) { localStorage.removeItem(DRAFT_KEY); return; }
  if (confirm(`Unsaved draft from ${new Date(d.at).toLocaleString()} found for this page. Restore it?`)) {
    el("edTitle").value = d.title || el("edTitle").value;
    ED_TAGS = [...(d.tags || ED_TAGS)];
    renderEdTags();
    ED_MOOD = d.mood || ED_MOOD;
    renderEdMoods();
    el("edText").value = d.text;
    el("edEdited").textContent = "restored draft " + new Date(d.at).toLocaleTimeString();
  } else {
    localStorage.removeItem(DRAFT_KEY);
  }
}

function closeEditor() {
  el("editor").classList.remove("open");
  renderList();
}

async function saveEntry() {
  if (!APP.key) { toast("Vault is locked", "err"); return; }
  if (!requireLoaded("save")) return;
  const id = el("editor").dataset.id || uid();
  const existing = APP.entries.find(x => x.id === id);
  const title = el("edTitle").value.trim();
  commitTagInput();
  const tags = [...ED_TAGS];
  const now = new Date().toISOString();
  const entry = {
    id,
    meta: {
      title: title || "Untitled",
      tags,
      mood: ED_MOOD || undefined,
      created: existing ? existing.meta.created : now,
      updated: now,
      images: existing ? existing.meta.images || [] : []
    },
    text: el("edText").value
  };
  const i = APP.entries.findIndex(x => x.id === id);
  if (i >= 0) APP.entries[i] = entry; else APP.entries.push(entry);
  clearDraft(id);
  closeEditor();
  renderAll();
  toast(i >= 0 ? "Saved" : "Page created", "ok");
  const prev = saveInflight.get(id) || Promise.resolve();
  const job = prev.catch(() => {}).then(() => persistEntry(entry, existing));
  saveInflight.set(id, job);
  job.finally(() => { if (saveInflight.get(id) === job) saveInflight.delete(id); });
}

const saveInflight = new Map();

async function persistEntry(entry, existing, isRetry) {
  setSyncPill("syncing");
  try {
    const newPath = Vault.entryPath(entry);
    await Vault.saveEncryptedPath(newPath, entry);
    if (existing && Vault.entryPath(existing) !== newPath) {
      await Vault.removeFile(Vault.entryPath(existing), "vault update");
    }
    setSyncPill("ok");
  } catch (err) {
    Log.push({ msg: "save failed" + (err.status ? " (" + err.status + ")" : "") + ": " + err.message });
    if (err.status === 409) {
      stashDraft(entry.id);
      const theirs = APP.entries.find(x => x.id === entry.id);
      const mine = readStash(entry.id);
      el("conflictInfo").textContent =
        "yours: " + new Date(mine.at).toLocaleString() + " (" + (mine.text || "").length + " chars)" +
        "\ntheirs: " + new Date((theirs && theirs.meta.updated) || "").toLocaleString() + " (" + ((theirs && theirs.text) || "").length + " chars)";
      APP.entries = await safeRetryEntries();
      renderAll();
      setSyncPill("error", () => persistEntry(entry, existing, true));
      openConflictModal(entry.id);
    } else {
      setSyncPill("error", () => persistEntry(entry, existing, true));
      toast("Save failed — kept locally. Click the sync pill to retry: " + err.message, "err");
    }
  }
}

function stashDraft(id) {
  try {
    localStorage.setItem("ediary_conflict_" + id, JSON.stringify({
      title: el("edTitle").value.trim(),
      tags: [...ED_TAGS],
      mood: ED_MOOD || "",
      text: el("edText").value,
      at: new Date().toISOString()
    }));
  } catch (e) {}
}

function readStash(id) {
  try { return JSON.parse(localStorage.getItem("ediary_conflict_" + id)); } catch (e) { return null; }
}

function dropStash(id) {
  localStorage.removeItem("ediary_conflict_" + id);
}

async function handleSaveConflict(err) {
  const id = el("editor").dataset.id;
  if (!id) {
    APP.entries = await safeRetryEntries();
    toast("Conflict on a new page — changes kept in the editor", "err");
    return;
  }
  stashDraft(id);
  const mine = readStash(id);
  const theirs = APP.entries.find(x => x.id === id);
  el("conflictInfo").textContent =
    "yours: " + new Date(mine.at).toLocaleString() + " (" + (mine.text || "").length + " chars)" +
    "\ntheirs: " + new Date((theirs && theirs.meta.updated) || "").toLocaleString() + " (" + ((theirs && theirs.text) || "").length + " chars)";
  APP.entries = await safeRetryEntries();
  renderAll();
  openConflictModal(id);
}

async function safeRetryEntries() {
  try {
    const fresh = await Vault.listEntries();
    APP.loadedOK = true;
    el("loadingMsg").textContent = "";
    el("loadingMsg").classList.remove("err", "clickable");
    return fresh;
  } catch (err) {
    Log.push({ msg: "reload after conflict failed: " + err.message });
    toast("Reload after conflict failed: " + err.message, "err");
    return APP.entries;
  }
}

function openConflictModal(id) {
  modalOpen("conflictModal");
  el("conflictRestoreBtn").onclick = () => {
    const stash = readStash(id);
    modalClose("conflictModal");
    dropStash(id);
    if (stash) {
      openEditor(id);
      el("edTitle").value = stash.title;
      ED_TAGS = [...(stash.tags || [])];
      renderEdTags();
      el("edText").value = stash.text;
      el("edEdited").textContent = "restored conflicted draft " + new Date(stash.at).toLocaleTimeString();
      afterEdit();
      toast("My version restored in the editor — save again to sync", "ok");
    }
  };
  el("conflictDiscardBtn").onclick = () => {
    modalClose("conflictModal");
    dropStash(id);
    toast("Their version is in the list — my edit discarded", "ok");
  };
  el("conflictCloseBtn").onclick = () => {
    modalClose("conflictModal");
    toast("Draft kept in the sidebar list — restore later via conflict notice", "ok");
  };
}

function togglePreview() {
  const pane = el("previewPane");
  const ta = el("edText");
  if (pane.hidden) {
    pane.innerHTML = MD.render(ta.value);
    ta.hidden = true;
    pane.hidden = false;
    resolveImages(pane);
  } else {
    pane.hidden = true;
    ta.hidden = false;
    ta.focus();
  }
}

function updateCount() {
  const v = el("edText").value;
  const words = v.trim() ? v.trim().split(/\s+/).length : 0;
  el("edCount").textContent = words === 1 ? "1 word" : words + " words";
}

function afterEdit() {
  updateCount();
  if (!el("previewPane").hidden) renderPreviewLive();
}

function tbWrap(mark) {
  const ta = el("edText");
  const s = ta.selectionStart, e2 = ta.selectionEnd, v = ta.value;
  const chosen = v.slice(s, e2) || "text";
  const ins = mark + chosen + mark;
  ta.value = v.slice(0, s) + ins + v.slice(e2);
  ta.focus();
  ta.setSelectionRange(s + mark.length, s + mark.length + chosen.length);
  afterEdit();
}

function tbPrefix(prefix) {
  const ta = el("edText");
  const v = ta.value;
  const pos = ta.selectionStart;
  const ls = v.lastIndexOf("\n", pos - 1) + 1;
  const le = v.indexOf("\n", pos);
  const lineEnd = le === -1 ? v.length : le;
  const line = v.slice(ls, lineEnd);
  const had = line.startsWith(prefix);
  const newLine = had ? line.slice(prefix.length) : prefix + line;
  const delta = had ? -prefix.length : prefix.length;
  ta.value = v.slice(0, ls) + newLine + v.slice(lineEnd);
  const np = Math.max(ls, pos + delta);
  ta.focus();
  ta.setSelectionRange(np, np);
  afterEdit();
}

function tbInsert(text) {
  const ta = el("edText");
  const s = ta.selectionStart, e2 = ta.selectionEnd, v = ta.value;
  const ins = (s > 0 && v[s - 1] !== "\n" ? "\n" : "") + text + "\n";
  ta.value = v.slice(0, s) + ins + v.slice(e2);
  const np = s + ins.length;
  ta.focus();
  ta.setSelectionRange(np, np);
  afterEdit();
}

const DRAFT_KEY = "ediary_draft";

function clearDraft(id) {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (d && d.id === id) localStorage.removeItem(DRAFT_KEY);
  } catch (e) {}
}

function saveDraftSoon() {
  clearTimeout(saveDraftSoon.timer);
  saveDraftSoon.timer = setTimeout(() => {
    if (!el("editor").classList.contains("open") || !APP.key) return;
    const text = el("edText").value;
    const title = el("edTitle").value.trim();
    if (!text.trim() && !title) { clearDraft(el("editor").dataset.id); return; }
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        id: el("editor").dataset.id,
        title,
        tags: [...ED_TAGS],
        mood: ED_MOOD || "",
        text,
        at: new Date().toISOString()
      }));
    } catch (e) {}
  }, 4000);
}

const TABLE_TPL = "| column A | column B |\n| --- | --- |\n| | |";

function tbAction(act) {
  switch (act) {
    case "h1": tbPrefix("# "); break;
    case "h2": tbPrefix("## "); break;
    case "h3": tbPrefix("### "); break;
    case "quote": tbPrefix("> "); break;
    case "bullet": tbPrefix("- "); break;
    case "todo": tbPrefix("- [ ] "); break;
    case "num": tbPrefix("1. "); break;
    case "divider": tbInsert("---"); break;
    case "bold": tbWrap("**"); break;
    case "italic": tbWrap("*"); break;
    case "strike": tbWrap("~~"); break;
    case "underline": tbWrap("++"); break;
    case "hl": tbWrap("=="); break;
    case "code": tbWrap("`"); break;
    case "codeblock": tbCodeBlock(); break;
    case "lnk": tbLink(); break;
    case "table": tbInsert(TABLE_TPL); break;
    case "toc": tbInsert("[[toc]]"); break;
    case "img": el("imageInput").click(); break;
    case "import": el("importInput").click(); break;
    case "export": exportEntryMd(); break;
    case "print": printEntry(); break;
  }
}

function printEntry() {
  document.body.classList.add("print-editor");
  window.print();
  setTimeout(() => document.body.classList.remove("print-editor"), 500);
}

function tbCodeBlock() {
  const ta = el("edText");
  const s = ta.selectionStart, e2 = ta.selectionEnd, v = ta.value;
  const chosen = v.slice(s, e2) || "code";
  const pre = s > 0 && v[s - 1] !== "\n" ? "\n" : "";
  const ins = pre + "```\n" + chosen + "\n```\n";
  ta.value = v.slice(0, s) + ins + v.slice(e2);
  ta.focus();
  const ss = s + pre.length + 4;
  ta.setSelectionRange(ss, ss + chosen.length);
  afterEdit();
}

function tbLink() {
  const ta = el("edText");
  const s = ta.selectionStart, e2 = ta.selectionEnd, v = ta.value;
  const chosen = v.slice(s, e2) || "text";
  const ins = "[" + chosen + "](url)";
  ta.value = v.slice(0, s) + ins + v.slice(e2);
  ta.focus();
  if (chosen === "text") ta.setSelectionRange(s + 1, s + 5);
  else ta.setSelectionRange(s + chosen.length + 3, s + chosen.length + 6);
  afterEdit();
}

function autoTodo() {
  const ta = el("edText");
  const pos = ta.selectionStart;
  const v = ta.value;
  const ls = v.lastIndexOf("\n", pos - 1) + 1;
  const seg = v.slice(ls, pos);
  const m = seg.match(/^(\[\]|\[ \]|\[x\]|\[X\]) $/);
  if (!m) return;
  const mark = m[1].toLowerCase() === "[x]" ? "- [x] " : "- [ ] ";
  ta.value = v.slice(0, ls) + mark + v.slice(pos);
  ta.setSelectionRange(ls + mark.length, ls + mark.length);
}

function exportEntryMd() {
  const id = el("editor").dataset.id;
  const e = id ? APP.entries.find(x => x.id === id) : null;
  const title = el("edTitle").value.trim() || (e ? e.meta.title : "") || "untitled";
  const text = el("edText").value;
  const blob = new Blob(["# " + title + "\n\n" + text + "\n"], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = slugify(title) + ".md";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(".md exported", "ok");
}

async function importMdFile(file) {
  try {
    const text = await file.text();
    let title = file.name.replace(/\.(md|markdown|txt)$/i, "").trim();
    let body = String(text);
    const h = body.match(/^#\s+(.+)/);
    if (h) {
      title = h[1].trim();
      body = body.slice(h[0].length);
    }
    openEditor(null);
    el("edTitle").value = title;
    el("edText").value = body.replace(/\s+$/, "\n");
    el("edEdited").textContent = "imported " + file.name;
    afterEdit();
    toast("Markdown imported into a new page", "ok");
  } catch (err) {
    toast("Import failed: " + err.message, "err");
  }
}

function sniffMime(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return "image/jpeg";
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b.length > 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return "image/png";
}

const IMG_CACHE = new Map();

async function resolveImages(pane) {
  const slots = pane.querySelectorAll(".img-slot");
  for (const s of slots) {
    const id = s.dataset.imageId;
    try {
      let url = IMG_CACHE.get(id);
      if (!url) {
        const buf = await Vault.readEntryImage(id, APP.key);
        const mime = sniffMime(new Uint8Array(buf));
        url = URL.createObjectURL(new Blob([buf], { type: mime }));
        IMG_CACHE.set(id, url);
      }
      const img = document.createElement("img");
      img.className = "entry-img";
      img.src = url;
      img.alt = s.dataset.name || "encrypted image";
      s.replaceWith(img);
    } catch (err) {
      s.textContent = "image unavailable" + (err && err.message ? ": " + err.message : "");
      s.classList.add("err");
      Log.push({ msg: "image render failed " + (id || "") + ": " + (err && err.message) });
    }
  }
}

let previewTimer = null;

function isSplit() {
  return window.matchMedia("(min-width: 1050px)").matches;
}

function renderPreviewLive() {
  const pane = el("previewPane");
  if (pane.hidden) return;
  pane.innerHTML = MD.render(el("edText").value);
  resolveImages(pane);
}

const IMG_MAX_DIM = 2048;

async function maybeDownscale(file) {
  try {
    const bmp = await createImageBitmap(file);
    const w = bmp.width, h = bmp.height;
    if (Math.max(w, h) <= IMG_MAX_DIM && file.size < 2.5 * 1024 * 1024) {
      bmp.close();
      return { buf: null };
    }
    const scale = Math.min(1, IMG_MAX_DIM / Math.max(w, h));
    const tw = Math.round(w * scale), th = Math.round(h * scale);
    const c = document.createElement("canvas");
    c.width = tw; c.height = th;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, tw, th);
    ctx.drawImage(bmp, 0, 0, tw, th);
    bmp.close();
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.9));
    const buf = await blob.arrayBuffer();
    return { buf, note: `${w}×${h}→${tw}×${th}, ${(100 * buf.byteLength / file.size).toFixed(0)}% of original` };
  } catch (e) {
    return { buf: null };
  }
}

async function handleImages(files) {
  if (!requireLoaded("image upload")) return;
  const list = files.filter(f => f.type.startsWith("image/"));
  if (!list.length) return;
  let n = 0;
  for (const f of list) {
    n++;
    toast(`Encrypting image ${n}/${list.length} (${(f.size / 1024).toFixed(0)} KB)…`, "ok");
    try {
      const down = await maybeDownscale(f);
      const buf = down.buf || await f.arrayBuffer();
      const encPayload = await encryptBytes(APP.key, buf);
      const name = /^image\.\w+$/i.test(f.name || "") ? "pasted image" : (f.name || "image");
      const imageId = uid();
      await Vault.putImage(imageId, encPayload);
      el("edText").value += `\n![${name}](image:${imageId})\n`;
      toast(`Image ${n}/${list.length} uploaded${down.buf ? " (resized " + down.note + ")" : ""}: ${name}`, "ok");
      saveDraftSoon();
    } catch (err) {
      Log.push({ msg: "image upload failed (" + f.name + "): " + err.message });
      toast("Image upload failed: " + err.message, "err");
    }
  }
  afterEdit();
}

async function doCreateVault() {
  const p1 = Vault.normalizeWaifu(el("setupWaifu").value);
  const p2 = Vault.normalizeWaifu(el("setupWaifu2").value);
  const hint = deriveRepoFromLocation();
  const owner = (el("setupOwner").value.trim() || (hint ? hint.owner : "")).toLowerCase();
  const repo = (el("setupRepo").value.trim() || (hint ? hint.repo : "")).toLowerCase();
  const token = el("setupToken").value.trim();
  const msg = el("setupMsg");
  if (!p1 || p1.length < 8) { msg.textContent = "Give her at least 8 characters."; return; }
  if (p1 !== p2) { msg.textContent = "The two answers do not match."; return; }
  if (!owner || !repo || !token) { msg.textContent = "Fill GitHub fields too."; return; }
  msg.textContent = "Verifying repo access...";
  setGithubConfig({ owner, repo, branch: "main", token });
  try {
    await ghVerifyToken({ owner, repo, token });
  } catch (err) {
    msg.textContent = err.message;
    return;
  }
  Vault.invalidateCache();
  msg.textContent = "Creating encrypted vault...";
  try {
    const { key, meta } = await Vault.init(p1);
    try {
      await Vault.putToken(JSON.stringify({ owner, repo, branch: "main", token }), key);
    } catch (err) {
      console.warn("token wrap skipped", err);
    }
    toast("Vault created", "ok");
    await afterUnlock(key, meta);
  } catch (err) {
    msg.textContent = "Failed: " + err.message;
  }
}

function refreshSettingsInputs() {
  const cfg = getGithubConfig() || {};
  el("setOwner").value = cfg.owner || "";
  el("setRepo").value = cfg.repo || "";
  el("setToken").value = cfg.token || "";
  el("setBranch").value = cfg.branch || "main";
  el("diagBox").value = Log.format();
  const argOk = typeof argon2Ready === "function" && argon2Ready();
  const m = APP.meta;
  if (!m) {
    el("kdfStatus").textContent = "no vault open";
    el("kdfUpgradeBtn").hidden = true;
    return;
  }
  if (m.kdf === "argon2id") {
    el("kdfStatus").textContent = "argon2id — strongest available, nothing to do";
    el("kdfUpgradeBtn").hidden = true;
  } else if (!argOk) {
    el("kdfStatus").textContent = "pbkdf2-" + (m.iters || 310000) + " — argon2 unavailable on this device (old browser?)";
    el("kdfUpgradeBtn").hidden = true;
  } else {
    el("kdfStatus").textContent = "pbkdf2-" + (m.iters || 310000) + " — argon2id is 5-10× more brute-force resistant";
    el("kdfUpgradeBtn").hidden = false;
  }
}

async function runKdfUpgrade() {
  const btn = el("kdfStartBtn");
  const pass = Vault.normalizeWaifu(el("kdfPass").value);
  if (!pass) { el("kdfProgress").hidden = false; el("kdfProgress").textContent = "empty answer"; return; }
  btn.disabled = true;
  el("kdfCancelBtn").hidden = true;
  el("kdfModalCloseBtn").hidden = true;
  el("kdfPass").disabled = true;
  el("kdfProgress").hidden = false;
  el("kdfProgress").textContent = "deriving keys...";
  try {
    const r = await Vault.upgradeKdf(pass, msg => { el("kdfProgress").textContent = msg; });
    APP.key = r.key;
    APP.meta = r.meta;
    Vault.invalidateCache();
    el("kdfProgress").textContent = `done — pages re-enc: ${r.ok}, already ok: ${r.skipped}, unreadable skipped: ${r.failed}`;
    Log.push({ msg: "kdf upgrade to argon2id ok:" + r.ok + " skipped:" + r.skipped + " failed:" + r.failed });
    toast("Encryption upgraded to Argon2id", "ok");
    setTimeout(() => {
      modalClose("kdfModal");
      modalClose("settingsModal");
      refreshSettingsInputs();
    }, 1400);
  } catch (err) {
    Log.push({ msg: "kdf upgrade failed: " + err.message });
    el("kdfProgress").textContent = "failed — nothing was broken: " + err.message;
    toast("Upgrade failed: " + err.message, "err");
  } finally {
    btn.disabled = false;
    el("kdfCancelBtn").hidden = false;
    el("kdfModalCloseBtn").hidden = false;
    el("kdfPass").disabled = false;
    el("kdfPass").value = "";
  }
}

function wireDiagnostics() {
  el("kdfUpgradeBtn").onclick = () => {
    el("kdfPass").value = "";
    el("kdfProgress").hidden = true;
    el("kdfProgress").textContent = "";
    modalClose("settingsModal");
    modalOpen("kdfModal");
    el("kdfPass").focus();
  };
  el("kdfStartBtn").onclick = runKdfUpgrade;
  el("kdfCancelBtn").onclick = () => modalClose("kdfModal");
  el("kdfModalCloseBtn").onclick = () => modalClose("kdfModal");
  el("kdfPass").addEventListener("keydown", e => { if (e.key === "Enter" && !el("kdfStartBtn").disabled) runKdfUpgrade(); });
  el("diagCopyBtn").onclick = async () => {
    const text = Log.format();
    if (!text) { toast("Log is empty", "ok"); return; }
    try {
      await navigator.clipboard.writeText(text);
      toast("Diagnostics copied", "ok");
    } catch (err) {
      el("diagBox").value = text;
      el("diagBox").focus();
      el("diagBox").select();
      toast("Select & copy manually (clipboard blocked)", "err");
    }
  };
  el("diagClearBtn").onclick = () => {
    Log.clear();
    el("diagBox").value = "";
    el("diagBox").placeholder = "no errors logged";
    toast("Log cleared", "ok");
  };
}

async function saveSettings() {
  const cfg = {
    owner: el("setOwner").value.trim(),
    repo: el("setRepo").value.trim(),
    token: el("setToken").value.trim(),
    branch: el("setBranch").value.trim() || "main"
  };
  if (!cfg.owner || !cfg.repo || !cfg.token) { toast("Fill all fields", "err"); return; }
  try {
    await ghVerifyToken(cfg);
  } catch (err) {
    toast(err.message, "err");
    return;
  }
  setGithubConfig(cfg);
  Vault.invalidateCache();
  if (APP.key) {
    try {
      await Vault.putToken(JSON.stringify(cfg), APP.key);
    } catch (err) {
      toast("Saved on this device, but vault copy failed: " + err.message, "err");
      return;
    }
  }
  toast("Settings saved", "ok");
  modalClose("settingsModal");
}

const SLASH_ITEMS = [
  { id: "h1", ic: "H1", label: "Heading 1", hint: "#", ins: "# " },
  { id: "h2", ic: "H2", label: "Heading 2", hint: "##", ins: "## " },
  { id: "h3", ic: "H3", label: "Heading 3", hint: "###", ins: "### " },
  { id: "bullet", ic: "•", label: "Bullet list", hint: "-", ins: "- " },
  { id: "todo", ic: "[]", label: "To-do", hint: "- [ ]", ins: "- [ ] " },
  { id: "quote", ic: ">", label: "Callout", hint: ">", ins: "> " },
  { id: "num", ic: "1.", label: "Numbered list", hint: "1.", ins: "1. " },
  { id: "hl", ic: "==", label: "Highlight", hint: "==", ins: "==highlight==", sel: [2, 11] },
  { id: "u", ic: "U", label: "Underline", hint: "++", ins: "++underline++", sel: [2, 11] },
  { id: "lnk", ic: "A", label: "Link", hint: "Ctrl+K", ins: "[text](url)", sel: [1, 5] },
  { id: "table", ic: "TBL", label: "Table", hint: "rows", ins: TABLE_TPL },
  { id: "toc", ic: "TOC", label: "Table of contents", hint: "auto", ins: "[[toc]]\n" },
  { id: "div", ic: "—", label: "Divider", hint: "---", ins: "---\n" },
  { id: "code", ic: "</>", label: "Code block", hint: "```", ins: "```\n\n```", caret: 4 },
  { id: "img", ic: "img", label: "Image", hint: "file", ins: null }
];

const SLASH = { open: false, items: [], sel: 0, slashIdx: -1 };

function caretCoordinates(ta, pos) {
  const div = document.createElement("div");
  const cs = getComputedStyle(ta);
  const props = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "textTransform", "textIndent", "lineHeight", "paddingTop", "paddingLeft", "paddingRight", "paddingBottom", "borderTopWidth", "borderLeftWidth", "boxSizing", "wordWrap", "overflowWrap"];
  for (const p of props) div.style[p] = cs[p];
  div.style.position = "fixed";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.overflow = "hidden";
  div.style.width = ta.clientWidth + "px";
  const r = ta.getBoundingClientRect();
  div.style.top = r.top + "px";
  div.style.left = r.left + "px";
  div.textContent = ta.value.slice(0, pos);
  const span = document.createElement("span");
  span.textContent = ta.value.slice(pos, pos + 1) || ".";
  div.appendChild(span);
  document.body.appendChild(div);
  const top = r.top + span.offsetTop - ta.scrollTop;
  const left = r.left + span.offsetLeft;
  const lineHeight = parseFloat(cs.lineHeight) || 22;
  div.remove();
  return { left, top, lineHeight };
}

function slashDetection() {
  const ta = el("edText");
  if (document.activeElement !== ta || ta.hidden) { hideSlashMenu(); return; }
  const pos = ta.selectionStart;
  const upto = ta.value.slice(0, pos);
  const m = upto.match(/(^|\n)\/([^\/\n]{0,18})$/);
  if (!m) { hideSlashMenu(); return; }
  const q = m[2].toLowerCase();
  const items = SLASH_ITEMS.filter(it => it.label.toLowerCase().includes(q));
  if (!items.length) { hideSlashMenu(); return; }
  SLASH.open = true;
  SLASH.items = items;
  SLASH.sel = 0;
  SLASH.slashIdx = pos - m[2].length - 1;
  renderSlashMenu();
  positionSlashMenu();
}

function renderSlashMenu() {
  const menu = el("slashMenu");
  menu.innerHTML = SLASH.items.map((it, i) =>
    `<div class="slash-item${i === SLASH.sel ? " selected" : ""}" data-i="${i}">
      <span class="si-ic">${escapeHtml(it.ic)}</span><span>${escapeHtml(it.label)}</span><span class="si-hint">${escapeHtml(it.hint)}</span>
    </div>`).join("");
  menu.querySelectorAll(".slash-item").forEach(d => {
    d.addEventListener("mousedown", ev => { ev.preventDefault(); pickSlashItem(+d.dataset.i); });
  });
}

function positionSlashMenu() {
  const menu = el("slashMenu");
  const ta = el("edText");
  const maxH = Math.min(SLASH.items.length * 47 + 12, 360);
  let left, top;
  try {
    const c = caretCoordinates(ta, SLASH.slashIdx);
    left = c.left;
    top = c.top + c.lineHeight + 4;
  } catch (err) {
    const r = ta.getBoundingClientRect();
    left = r.left + 12;
    top = r.top + r.height - 20;
  }
  if (left + 276 > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 284);
  if (top + maxH > window.innerHeight - 10) {
    top = Math.max(10, top - maxH - 30);
  }
  menu.style.left = Math.round(left) + "px";
  menu.style.top = Math.round(top) + "px";
  menu.hidden = false;
}

function hideSlashMenu() {
  SLASH.open = false;
  SLASH.slashIdx = -1;
  el("slashMenu").hidden = true;
}

function pickSlashItem(i) {
  const it = SLASH.items[i];
  if (!it) return;
  const ta = el("edText");
  const slashIdx = SLASH.slashIdx;
  const end = ta.selectionStart;
  hideSlashMenu();
  const v = ta.value;
  if (it.id === "img") {
    ta.value = v.slice(0, slashIdx) + v.slice(end);
    ta.selectionStart = ta.selectionEnd = slashIdx;
    afterEdit();
    el("imageInput").click();
    return;
  }
  ta.value = v.slice(0, slashIdx) + it.ins + v.slice(end);
  const caret = slashIdx + (it.caret !== undefined ? it.caret : it.ins.length);
  ta.selectionStart = ta.selectionEnd = caret;
  if (it.sel) ta.setSelectionRange(slashIdx + it.sel[0], slashIdx + it.sel[1]);
  ta.focus();
  afterEdit();
}

function wire() {
  wireDiagnostics();
  Moods.mount(el("avatarHost"));
  mountMiniAvatars();
  const hint = deriveRepoFromLocation();
  if (hint) {
    if (!el("setupOwner").value) el("setupOwner").value = hint.owner;
    if (!el("setupRepo").value) el("setupRepo").value = hint.repo;
  }

  el("gatePass").addEventListener("input", updateGateReactions);
  el("gatePass").addEventListener("keydown", e => { if (e.key === "Enter") unlockAttempt(); });
  el("goLock").onclick = e => { e.preventDefault(); showScreen("gate"); resetGate(); };
  el("createBtn").onclick = doCreateVault;
  el("setupWaifu2").addEventListener("keydown", e => { if (e.key === "Enter") doCreateVault(); });

  const newPage = () => {
    APP.filter.tag = null;
    APP.filter.search = "";
    el("searchBox").value = "";
    openEditor(null);
    renderAll();
  };
  el("newEntryBtn").onclick = newPage;
  el("listNewBtn").onclick = newPage;
  el("edEmptyNew").onclick = newPage;
  el("saveEntryBtn").onclick = saveEntry;
  el("previewBtn").onclick = togglePreview;
  el("closeEditorBtn").onclick = closeEditor;
  el("lockNowBtn").onclick = lockVault;
  el("settingsBtn").onclick = () => { refreshSettingsInputs(); modalOpen("settingsModal"); };
  el("saveSettingsBtn").onclick = saveSettings;
  el("closeSettingsBtn").onclick = () => modalClose("settingsModal");
  el("searchBox").addEventListener("input", e => { APP.filter.search = e.target.value; renderList(); });
  el("railNotes").onclick = () => {
    APP.filter.tag = null;
    renderAll();
    el("grid").scrollTop = 0;
  };
  el("railSearch").onclick = () => el("searchBox").focus();
  el("navAll").onclick = () => {
    APP.filter.tag = null;
    renderAll();
  };
  el("sortBtn").onclick = () => {
    APP.filter.sort = APP.filter.sort === "new" ? "old" : "new";
    el("sortBtn").textContent = APP.filter.sort === "new" ? "Newest first" : "Oldest first";
    renderList();
  };
  el("edToolbar").addEventListener("mousedown", ev => {
    const b = ev.target.closest(".tb-btn");
    if (!b) return;
    ev.preventDefault();
    tbAction(b.dataset.act);
  });
  el("edTags").addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commitTagInput(); }
    else if (e.key === "Backspace" && !el("edTags").value && ED_TAGS.length) {
      ED_TAGS.pop();
      renderEdTags();
    }
  });
  el("edTags").addEventListener("blur", commitTagInput);
  el("edText").addEventListener("input", () => {
    autoTodo();
    updateCount();
    slashDetection();
    saveDraftSoon();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { if (!el("previewPane").hidden) renderPreviewLive(); }, 140);
  });
  el("edTitle").addEventListener("input", saveDraftSoon);
  el("edText").addEventListener("click", slashDetection);
  el("edText").addEventListener("keydown", e => {
    if (SLASH.open && !e.ctrlKey && !e.metaKey) {
      if (e.key === "ArrowDown") { e.preventDefault(); SLASH.sel = (SLASH.sel + 1) % SLASH.items.length; renderSlashMenu(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); SLASH.sel = (SLASH.sel - 1 + SLASH.items.length) % SLASH.items.length; renderSlashMenu(); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickSlashItem(SLASH.sel); return; }
      if (e.key === "Escape") { e.preventDefault(); hideSlashMenu(); return; }
    }
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (e.altKey) {
      switch (e.code) {
        case "Digit1": e.preventDefault(); tbPrefix("# "); return;
        case "Digit2": e.preventDefault(); tbPrefix("## "); return;
        case "Digit3": e.preventDefault(); tbPrefix("### "); return;
        case "KeyC": e.preventDefault(); tbCodeBlock(); return;
        case "KeyE": e.preventDefault(); tbWrap("`"); return;
        case "KeyT": e.preventDefault(); tbPrefix("- [ ] "); return;
        case "KeyL": e.preventDefault(); tbInsert(TABLE_TPL); return;
      }
      return;
    }
    if (e.shiftKey) {
      if (k === "x") { e.preventDefault(); tbWrap("~~"); return; }
      if (k === "h") { e.preventDefault(); tbWrap("=="); return; }
      switch (e.code) {
        case "Digit8": e.preventDefault(); tbPrefix("- "); return;
        case "Digit7": e.preventDefault(); tbPrefix("1. "); return;
        case "Digit9": e.preventDefault(); tbPrefix("> "); return;
        case "Minus": case "NumpadSubtract": e.preventDefault(); tbInsert("---"); return;
      }
    }
    if (k === "b") { e.preventDefault(); tbWrap("**"); return; }
    if (k === "i") { e.preventDefault(); tbWrap("*"); return; }
    if (k === "u") { e.preventDefault(); tbWrap("++"); return; }
    if (k === "k") { e.preventDefault(); tbLink(); return; }
  });
  document.addEventListener("keydown", e => {
    const k = e.key.toLowerCase();
    const editorOpen = el("editor").classList.contains("open");
    if ((e.ctrlKey || e.metaKey) && k === "k") {
      if (e.defaultPrevented) return;
      e.preventDefault();
      if (el("paletteModal").classList.contains("open")) { modalClose("paletteModal"); return; }
      if (editorOpen && document.activeElement === el("edText") && !e.shiftKey) { tbLink(); return; }
      openPalette();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (k === "s" || k === "enter")) {
      if (editorOpen && APP.unlocked && !SLASH.open) { e.preventDefault(); saveEntry(); }
      return;
    }
    if (e.key === "Escape" && editorOpen && !SLASH.open) {
      if (el("settingsModal").classList.contains("open")) return;
      closeEditor();
    }
  });
  el("imageInput").addEventListener("change", e => {
    if (APP.key) handleImages([...e.target.files]);
    e.target.value = "";
  });
  el("importInput").addEventListener("change", e => {
    const f = e.target.files && e.target.files[0];
    if (f && APP.key) importMdFile(f);
    e.target.value = "";
  });
  document.addEventListener("paste", e => {
    if (!APP.key || !el("editor").classList.contains("open")) return;
    const items = e.clipboardData ? Array.from(e.clipboardData.items) : [];
    const files = items.filter(it => it.kind === "file" && it.type.startsWith("image/")).map(it => it.getAsFile()).filter(Boolean);
    if (!files.length) return;
    e.preventDefault();
    handleImages(files);
  });
  wirePalette();
  el("syncPill").onclick = retrySync;
  el("viewToggle").onclick = () => {
    APP.view = APP.view === "timeline" ? "cards" : "timeline";
    localStorage.setItem("ediary_view", APP.view);
    renderList();
  };
  el("reviewBtn").onclick = () => openReview();
  el("reviewCloseBtn").onclick = () => modalClose("reviewModal");
  el("reviewModal").addEventListener("click", e => { if (e.target === el("reviewModal")) modalClose("reviewModal"); });
  window.addEventListener("resize", () => {
    if (!el("editor").classList.contains("open")) return;
    const pane = el("previewPane");
    if (isSplit() && pane.hidden) {
      pane.hidden = false;
      renderPreviewLive();
    }
  });
  window.addEventListener("error", ev => {
    try { toast("Something broke: " + (ev.message || "unknown error"), "err"); } catch (e) {}
  });
  window.addEventListener("unhandledrejection", ev => {
    const msg = ev.reason && ev.reason.message ? ev.reason.message : "sync error";
    try { toast("Error: " + msg, "err"); } catch (e) {}
  });
  el("themeToggle").onclick = () => {
    document.body.classList.toggle("dark");
    localStorage.setItem("ediary_theme", document.body.classList.contains("dark") ? "dark" : "light");
  };

  ["click", "keydown"].forEach(ev => document.addEventListener(ev, resetIdleTimer));

  const theme = localStorage.getItem("ediary_theme");
  if (theme === "dark") document.body.classList.add("dark");
  else if (theme === "light") document.body.classList.remove("dark");

  showScreen("gate");
  resetGate();
}

document.addEventListener("DOMContentLoaded", wire);
