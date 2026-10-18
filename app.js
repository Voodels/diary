const APP = {
  key: null,
  unlocked: false,
  entries: [],
  meta: null,
  filter: { search: "", tag: null },
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

function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function uid() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${Math.random().toString(36).slice(2, 7)}`;
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "entry";
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
  el(id).classList.add("open");
}

function modalClose(id) {
  el(id).classList.remove("open");
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
      setTimeout(() => afterUnlock(key, meta, hint), 550);
      return;
    }
    const cfg = getGithubConfig();
    if (cfg && cfg.token) {
      const { key, meta } = await Vault.unlock(pass);
      APP.gate.stage = 3;
      Moods.setMood("gloat");
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

async function afterUnlock(key, meta, hint) {
  APP.key = key;
  APP.meta = meta;
  APP.unlocked = true;
  showScreen("app");
  document.body.classList.add("unlocked");
  el("loadingMsg").textContent = "Decrypting entries...";
  const cfg = getGithubConfig();
  if (!cfg || !cfg.token) {
    await recoverTokenIfNeeded(key, hint);
  }
  try {
    APP.entries = await Vault.listEntries();
    renderGrid();
    renderTags();
    resetIdleTimer();
  } catch (err) {
    toast("Failed to load entries: " + err.message, "err");
    el("loadingMsg").textContent = "";
    if (!getGithubConfig() || !getGithubConfig().token) {
      el("loadingMsg").textContent = "Token expired or missing — opens Settings inside the app.";
    }
  }
}

async function lockVault() {
  APP.key = null;
  APP.unlocked = false;
  APP.entries = [];
  APP.meta = null;
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

function renderTags() {
  const counts = {};
  for (const e of APP.entries) for (const t of e.meta.tags || []) counts[t] = (counts[t] || 0) + 1;
  const tags = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  el("tagList").innerHTML =
    `<div class="tag-item${APP.filter.tag === null ? " active" : ""}" data-tag="">All entries</div>` +
    tags.map(t => `<div class="tag-item${APP.filter.tag === t ? " active" : ""}" data-tag="${escapeHtml(t)}">${escapeHtml(t)} <span class="count">${counts[t]}</span></div>`).join("");
  el("tagList").querySelectorAll(".tag-item").forEach(d => {
    d.onclick = () => {
      APP.filter.tag = d.dataset.tag || null;
      renderTags();
      renderGrid();
    };
  });
}

function visibleEntries() {
  const f = APP.filter;
  const q = f.search.trim().toLowerCase();
  return APP.entries.filter(e => {
    if (f.tag && !(e.meta.tags || []).includes(f.tag)) return false;
    if (!q) return true;
    return (
      (e.meta.title || "").toLowerCase().includes(q) ||
      (e.text || "").toLowerCase().includes(q) ||
      (e.meta.tags || []).some(t => t.toLowerCase().includes(q))
    );
  });
}

function renderGrid() {
  const grid = el("grid");
  const list = visibleEntries();
  el("emptyState").style.display = list.length ? "none" : "";
  grid.innerHTML = list.map(e => {
    const title = e.meta.title || "Untitled";
    const text = (e.text || "").slice(0, 140);
    const tags = (e.meta.tags || []).map(t => `<span class="chip">${escapeHtml(t)}</span>`).join("");
    return `<div class="card" data-id="${escapeHtml(e.id)}">
      <div class="card-title">${escapeHtml(title)}</div>
      <div class="card-date">${fmtDateTime(e.meta.updated || e.meta.created)}</div>
      <div class="card-excerpt">${escapeHtml(text)}</div>
      <div class="card-tags">${tags}</div>
      <div class="card-actions"><button class="icon-btn" data-act="del" title="Delete" aria-label="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6"/></svg></button></div>
    </div>`;
  }).join("");
  grid.querySelectorAll(".card").forEach(c => {
    c.onclick = ev => {
      const del = ev.target.closest("[data-act=del]");
      if (del) return;
      openEditor(c.dataset.id);
    };
  });
  grid.querySelectorAll('[data-act="del"]').forEach(b => {
    b.onclick = ev => {
      ev.stopPropagation();
      deleteEntry(b.closest(".card").dataset.id);
    };
  });
}

async function deleteEntry(id) {
  const e = APP.entries.find(x => x.id === id);
  if (!e) return;
  if (!confirm(`Delete "${e.meta.title || "Untitled"}"? This removes it from GitHub too.`)) return;
  try {
    await Vault.removeFile(Vault.entryPath(e), "vault update");
    APP.entries = APP.entries.filter(x => x.id !== id);
    for (const img of e.meta.images || []) {
      try { await Vault.removeFile(Vault.imagePath(img.id), "vault update"); } catch (err) {}
    }
    renderGrid();
    renderTags();
    toast("Entry deleted", "ok");
  } catch (err) {
    toast("Delete failed: " + err.message, "err");
  }
}

function openEditor(id) {
  const e = id ? APP.entries.find(x => x.id === id) : null;
  el("editor").dataset.id = e ? e.id : "";
  el("edTitle").value = e ? e.meta.title || "" : "";
  el("edTags").value = e ? (e.meta.tags || []).join(", ") : "";
  el("edText").value = e ? e.text || "" : "";
  el("edDate").textContent = e ? "Last edited " + fmtDateTime(e.meta.updated || e.meta.created) : "New entry";
  el("previewPane").hidden = true;
  el("edText").hidden = false;
  modalOpen("editor");
  el("edTitle").focus();
}

async function saveEntry() {
  if (!APP.key) { toast("Vault is locked", "err"); return; }
  const id = el("editor").dataset.id || uid();
  const existing = APP.entries.find(x => x.id === id);
  const title = el("edTitle").value.trim();
  const tags = el("edTags").value.split(",").map(s => s.trim()).filter(Boolean);
  const now = new Date().toISOString();
  const entry = {
    id,
    meta: {
      title: title || "Untitled",
      tags,
      created: existing ? existing.meta.created : now,
      updated: now,
      images: existing ? existing.meta.images || [] : []
    },
    text: el("edText").value
  };
  try {
    const newPath = Vault.entryPath(entry);
    await Vault.saveEncryptedPath(newPath, entry);
    if (existing && Vault.entryPath(existing) !== newPath) {
      await Vault.removeFile(Vault.entryPath(existing), "vault update");
    }
    const i = APP.entries.findIndex(x => x.id === id);
    if (i >= 0) APP.entries[i] = entry; else APP.entries.push(entry);
    APP.entries.sort((a, b) => (b.meta.updated || "").localeCompare(a.meta.updated || ""));
    modalClose("editor");
    renderGrid();
    renderTags();
    toast("Saved & synced to GitHub", "ok");
  } catch (err) {
    if (err.status === 409) {
      toast("Conflict: file changed remotely. Reloading entries...", "err");
      APP.entries = await Vault.listEntries();
      renderGrid();
    } else {
      toast("Save failed: " + err.message, "err");
    }
  }
}

function togglePreview() {
  const pane = el("previewPane");
  const ta = el("edText");
  if (pane.hidden) {
    pane.innerHTML = MD.render(ta.value);
    ta.hidden = true;
    pane.hidden = false;
  } else {
    pane.hidden = true;
    ta.hidden = false;
  }
}

async function handleImages(files) {
  for (const f of files) {
    if (!f.type.startsWith("image/")) continue;
    try {
      const buf = await f.arrayBuffer();
      const encPayload = await encryptBytes(APP.key, buf);
      const imageId = uid() + "-" + slugify(f.name.replace(/\.[^.]+$/, ""));
      await Vault.putImage(imageId, encPayload);
      el("edText").value += `\n![${f.name}](image:${imageId})\n`;
      toast("Image encrypted & uploaded: " + f.name, "ok");
    } catch (err) {
      toast("Image upload failed: " + err.message, "err");
    }
  }
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

function wire() {
  Moods.mount(el("avatarHost"));
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

  el("newEntryBtn").onclick = () => openEditor(null);
  el("saveEntryBtn").onclick = saveEntry;
  el("previewBtn").onclick = togglePreview;
  el("lockNowBtn").onclick = lockVault;
  el("settingsBtn").onclick = () => { refreshSettingsInputs(); modalOpen("settingsModal"); };
  el("saveSettingsBtn").onclick = saveSettings;
  el("closeSettingsBtn").onclick = () => modalClose("settingsModal");
  el("closeEditorBtn").onclick = () => modalClose("editor");
  el("searchBox").addEventListener("input", e => { APP.filter.search = e.target.value; renderGrid(); });
  el("imageInput").addEventListener("change", e => {
    if (APP.key) handleImages([...e.target.files]);
    e.target.value = "";
  });
  el("addImageBtn").onclick = () => el("imageInput").click();
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
