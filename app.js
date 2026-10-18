const APP = {
  key: null,
  unlocked: false,
  entries: [],
  meta: null,
  filter: { search: "", tag: null },
  dirty: new Set(),
  deleted: [],
  autoLockTimer: null
};

const IDLE_LOCK_MS = 10 * 60 * 1000;
const CHECK_TEXT = "ediary-check-v1";

function el(id) {
  return document.getElementById(id);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
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
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "entry";
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

function entryPath(e) {
  return VAULT_PATHS.entries + e.id + "-" + slugify(e.title) + ".json";
}

function imagePath(imageId) {
  return VAULT_PATHS.images + imageId + ".bin";
}

function newMetaJson() {
  const salt = b64encode(getRandomBytes(16));
  return { v: 1, salt, iters: PBKDF2_ITERATIONS, check: null, created: new Date().toISOString() };
}

async function loadMeta() {
  const raw = await ghGetFileBG(VAULT_PATHS.meta);
  if (!raw) return null;
  return JSON.parse(raw);
}

async function createVault(password) {
  const meta = newMetaJson();
  const key = await deriveKey(password, b64decode(meta.salt), meta.iters);
  meta.check = await encryptString(key, CHECK_TEXT);
  await ghPutFileBG(VAULT_PATHS.meta, JSON.stringify(meta, null, 2), "initialize vault");
  return { key, meta };
}

async function unlockVault(password) {
  const meta = await loadMeta();
  if (!meta) throw new Error("No vault found. Create one first.");
  const key = await deriveKey(password, b64decode(meta.salt), meta.iters);
  const ok = await verifyPassword(key, meta.check);
  if (!ok) throw new Error("Wrong password");
  return { key, meta };
}

async function loadEntries() {
  const files = await ghListVaultFiles(VAULT_PATHS.entries);
  const entries = [];
  for (const name of files) {
    try {
      const raw = await ghGetFileBG(VAULT_PATHS.entries + name);
      const plain = await decryptToString(APP.key, raw);
      const obj = JSON.parse(plain);
      obj.id = name.replace(/\.json$/, "");
      entries.push(obj);
    } catch (e) {
      console.warn("skipping unreadable entry", name, e);
    }
  }
  entries.sort((a, b) => (b.meta.updated || "").localeCompare(a.meta.updated || ""));
  APP.entries = entries;
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
      <div class="card-actions"><button class="icon-btn" data-act="del" title="Delete">🗑</button></div>
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
      const id = b.closest(".card").dataset.id;
      deleteEntry(id);
    };
  });
}

async function deleteEntry(id) {
  const e = APP.entries.find(x => x.id === id);
  if (!e) return;
  if (!confirm(`Delete "${e.meta.title || "Untitled"}"? This removes it from GitHub too.`)) return;
  try {
    await ghDeleteFile(entryPath(e), "delete entry");
    APP.entries = APP.entries.filter(x => x.id !== id);
    if (e.meta.images) {
      for (const img of e.meta.images) {
        await ghDeleteFile(imagePath(img.id), "delete image");
      }
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
  const text = el("edText").value;
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
    text
  };
  const encrypted = await encryptString(APP.key, JSON.stringify(entry));
  const path = entryPath(entry);
  try {
    await ghPutFileBG(path, encrypted, "update entry");
    if (existing && entryPath(existing) !== path) {
      await ghDeleteFile(entryPath(existing), "rename entry");
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
      await loadEntries();
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
    pane.innerHTML = renderMarkdown(ta.value);
    ta.hidden = true;
    pane.hidden = false;
  } else {
    pane.hidden = true;
    ta.hidden = false;
  }
}

function renderMarkdown(md) {
  const lines = md.split("\n");
  const out = [];
  let inList = false;
  for (const line of lines) {
    let m;
    if ((m = line.match(/^# (.*)$/))) { closeList(); out.push(`<h1>${inline(m[1])}</h1>`); }
    else if ((m = line.match(/^## (.*)$/))) { closeList(); out.push(`<h2>${inline(m[1])}</h2>`); }
    else if ((m = line.match(/^### (.*)$/))) { closeList(); out.push(`<h3>${inline(m[1])}</h3>`); }
    else if ((m = line.match(/^- (.*)$/))) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inline(m[1])}</li>`); }
    else if (line.trim() === "") { closeList(); }
    else { closeList(); out.push(`<p>${inline(line)}</p>`); }
  }
  closeList();
  return out.join("");

  function closeList() { if (inList) { out.push("</ul>"); inList = false; } }

  function inline(s) {
    return escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/\[(.+?)\]\((https?:\/\/.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }
}

async function handleImages(files) {
  for (const f of files) {
    if (!f.type.startsWith("image/")) continue;
    const buf = await f.arrayBuffer();
    const encPayload = await encryptBytes(APP.key, buf);
    const imageId = uid() + "-" + slugify(f.name.replace(/\.[^.]+$/, ""));
    try {
      await ghPutBinary(imagePath(imageId), new TextEncoder().encode(encPayload), "add image");
      toast("Image encrypted & uploaded: " + f.name, "ok");
      const md = `\n![${f.name}](image:${imageId})\n`;
      const ta = el("edText");
      ta.value += md;
    } catch (err) {
      toast("Image upload failed: " + err.message, "err");
    }
  }
}

async function lockVault() {
  APP.key = null;
  APP.unlocked = false;
  APP.entries = [];
  APP.meta = null;
  showScreen("lock");
  el("lockPass").value = "";
  el("lockMsg").textContent = "";
  document.body.classList.remove("unlocked");
}

function resetIdleTimer() {
  clearTimeout(APP.autoLockTimer);
  if (APP.unlocked) {
    APP.autoLockTimer = setTimeout(lockVault, IDLE_LOCK_MS);
  }
}

function showScreen(name) {
  el("setupScreen").hidden = name !== "setup";
  el("lockScreen").hidden = name !== "lock";
  el("appScreen").hidden = name !== "app";
}

async function afterUnlock(key, meta) {
  APP.key = key;
  APP.meta = meta;
  APP.unlocked = true;
  showScreen("app");
  document.body.classList.add("unlocked");
  el("loadingMsg").textContent = "Decrypting entries...";
  try {
    await loadEntries();
    renderGrid();
    renderTags();
    resetIdleTimer();
  } catch (err) {
    toast("Failed to load entries: " + err.message, "err");
  }
}

async function tryUnlock() {
  const pass = el("lockPass").value;
  if (!pass) return;
  const btn = el("lockBtn");
  btn.disabled = true;
  btn.textContent = "Unlocking...";
  try {
    const { key } = await unlockVault(pass);
    await afterUnlock(key, APP.meta);
  } catch (err) {
    el("lockMsg").textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Unlock";
  }
}

async function doCreateVault() {
  const p1 = el("setupPass").value;
  const p2 = el("setupPass2").value;
  const owner = el("setupOwner").value.trim();
  const repo = el("setupRepo").value.trim();
  const token = el("setupToken").value.trim();
  const msg = el("setupMsg");
  if (!p1 || p1.length < 8) { msg.textContent = "Password must be at least 8 characters."; return; }
  if (p1 !== p2) { msg.textContent = "Passwords do not match."; return; }
  if (!owner || !repo || !token) { msg.textContent = "Fill in all fields."; return; }
  msg.textContent = "Verifying repo access...";
  setGithubConfig({ owner, repo, branch: "main", token });
  try {
    await ghVerifyToken({ owner, repo, token });
  } catch (err) {
    msg.textContent = err.message;
    return;
  }
  msg.textContent = "Creating encrypted vault...";
  try {
    const existing = await loadMeta();
    if (existing) {
      msg.textContent = "Vault already exists here. Use Unlock instead.";
      return;
    }
    const { key, meta } = await createVault(p1);
    toast("Vault created", "ok");
    await afterUnlock(key, meta);
  } catch (err) {
    msg.textContent = "Failed: " + err.message;
  }
}

async function doUnlock() {
  const owner = el("lockOwner").value.trim();
  const repo = el("lockRepo").value.trim();
  const token = el("lockToken").value.trim();
  const pass = el("lockPass").value;
  const msg = el("lockMsg");
  if (!owner || !repo || !token || !pass) { msg.textContent = "Fill in all fields."; return; }
  msg.textContent = "";
  setGithubConfig({ owner, repo, branch: "main", token });
  try {
    const { key, meta } = await unlockVault(pass);
    await afterUnlock(key, meta);
  } catch (err) {
    msg.textContent = err.message;
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
  toast("Settings saved", "ok");
  modalClose("settingsModal");
}

function wire() {
  el("lockBtn").onclick = doUnlock;
  el("goSetup").onclick = e => { e.preventDefault(); showScreen("setup"); };
  el("lockPass").addEventListener("keydown", e => { if (e.key === "Enter") doUnlock(); });
  el("createBtn").onclick = doCreateVault;
  el("setupPass2").addEventListener("keydown", e => { if (e.key === "Enter") doCreateVault(); });

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
  if (theme === "light") document.body.classList.remove("dark");

  showScreen("lock");
}

document.addEventListener("DOMContentLoaded", wire);
