const GH_API = "https://api.github.com";

const VAULT_PATHS = {
  meta: "vault/meta.json",
  entries: "vault/entries/",
  data: "vault/data/",
  images: "vault/images/",
  token: "vault/token.enc"
};

async function ghGetFilePublic(owner, repo, path) {
  const res = await fetch(GH_API + "/repos/" + owner + "/" + repo + "/contents/" + path, {
    headers: { "Accept": "application/vnd.github+json" }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("GitHub fetch failed " + res.status);
  const j = await res.json();
  return new TextDecoder().decode(Util.b64decode(j.content.replace(/\n/g, "")));
}

let ghCfg = null;

function setGithubConfig(cfg) {
  ghCfg = cfg;
  localStorage.setItem("ediary_gh", JSON.stringify(cfg));
}

function getGithubConfig() {
  if (ghCfg) return ghCfg;
  try {
    ghCfg = JSON.parse(localStorage.getItem("ediary_gh") || "null");
  } catch (e) {
    ghCfg = null;
  }
  return ghCfg;
}

function repoFor(repoName) {
  const cfg = getGithubConfig();
  return repoName || (cfg && cfg.repo);
}

async function ghRequest(method, path, body, raw, repoName, attempt) {
  attempt = attempt || 0;
  const cfg = getGithubConfig();
  if (!cfg) throw new Error("GitHub not configured");
  const url = path.startsWith("http") ? path : GH_API + "/repos/" + cfg.owner + "/" + repoFor(repoName) + "/contents/" + path;
  const headers = {
    "Accept": "application/vnd.github+json",
    "Authorization": "Bearer " + cfg.token
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if ((res.status === 403 || res.status === 429) && attempt === 0) {
    let msg = "";
    try { msg = (await res.json()).message || ""; } catch (e) {}
    const low = msg.toLowerCase();
    if (low.includes("rate limit") || low.includes("secondary rate")) {
      const wait = Math.min(parseFloat(res.headers.get("Retry-After")) || 20, 120);
      console.warn("rate limited — waiting " + wait + "s before a single retry");
      await new Promise(r => setTimeout(r, wait * 1000));
      return ghRequest(method, path, body, raw, repoName, 1);
    }
  }
  if (res.status === 409) {
    const err = new Error("conflict");
    err.status = 409;
    throw err;
  }
  if (!res.ok && !(raw && res.status === 404)) {
    let msg = res.status + " " + res.statusText;
    try {
      const j = await res.json();
      if (j.message) msg = j.message;
    } catch (e) {}
    const err = new Error("GitHub API error: " + msg);
    err.status = res.status;
    throw err;
  }
  if (res.status === 404) return null;
  return res.json();
}

function ghPathFor(entryPath) {
  return entryPath;
}

async function ghGetFileBG(path, repoName) {
  const j = await ghRequest("GET", path, undefined, false, repoName);
  if (!j || !j.content) return null;
  if (j.encoding !== "base64") {
    const raw = await ghFetchBlob(j.git_url);
    return new TextDecoder().decode(new Uint8Array(raw));
  }
  return new TextDecoder().decode(Util.b64decode(j.content.replace(/\n/g, "")));
}

async function ghFetchBlob(blobUrl) {
  const cfg = getGithubConfig();
  const res = await fetch(blobUrl, {
    headers: {
      "Accept": "application/vnd.github.raw",
      "Authorization": "Bearer " + cfg.token
    }
  });
  if (!res.ok) throw new Error("GitHub blob error " + res.status);
  return res.arrayBuffer();
}

async function ghGetFileBinary(path, repoName) {
  const meta = await ghRequest("GET", path, undefined, false, repoName);
  if (!meta) return null;
  return ghFetchBlob(meta.git_url);
}

async function ghPutFileBG(path, contentStr, message, repoName) {
  const existing = await ghRequest("GET", path, undefined, true, repoName);
  const body = {
    message: message || "vault update",
    content: btoa(contentStr)
  };
  if (existing && existing.sha) body.sha = existing.sha;
  return ghRequest("PUT", path, body, false, repoName);
}

async function ghDeleteFile(path, message, repoName) {
  const existing = await ghRequest("GET", path, undefined, true, repoName);
  if (!existing) return;
  const cfg = getGithubConfig();
  const url = GH_API + "/repos/" + cfg.owner + "/" + repoFor(repoName) + "/contents/" + path;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + cfg.token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: message || "vault delete",
      sha: existing.sha,
      branch: cfg.branch
    })
  });
  if (!res.ok && res.status !== 404) throw new Error("GitHub delete failed " + res.status);
}

async function ghPutBinary(path, arrayBuffer, message, contentType, repoName) {
  const cfg = getGithubConfig();
  const url = GH_API + "/repos/" + cfg.owner + "/" + repoFor(repoName) + "/contents/" + path;
  const b64 = Util.b64encode(arrayBuffer);
  const existing = await ghRequest("GET", path, undefined, true, repoName);
  const body = { message: message || "vault update", content: b64 };
  if (existing && existing.sha) body.sha = existing.sha;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + cfg.token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    let msg = res.status;
    try { msg = (await res.json()).message || msg; } catch (e) {}
    throw new Error("GitHub upload failed: " + msg);
  }
  return res.json();
}

async function ghListDir(path, repoName) {
  const cfg = getGithubConfig();
  const url = GH_API + "/repos/" + cfg.owner + "/" + repoFor(repoName) + "/contents/" + path;
  const res = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + cfg.token
    }
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error("GitHub list error " + res.status);
  return res.json();
}

async function ghListVaultFiles(dirPath, repoName) {
  const items = await ghListDir(dirPath, repoName);
  const files = [];
  for (const it of items) {
    if (it.type === "file") files.push(it.name);
  }
  return files;
}

async function ghVerifyToken(cfg) {
  const res = await fetch(GH_API + "/repos/" + cfg.owner + "/" + cfg.repo, {
    headers: { "Authorization": "Bearer " + cfg.token, "Accept": "application/vnd.github+json" }
  });
  if (res.status === 401) throw new Error("Token invalid/expired");
  if (res.status === 404) throw new Error("Repo not found or token lacks access");
  if (!res.ok) throw new Error("Repo check failed: " + res.status);
  const j = await res.json();
  if (!j.permissions || !j.permissions.push) throw new Error("Token cannot push to this repo");
  return j.full_name;
}
