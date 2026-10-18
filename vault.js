const Vault = (() => {
  let metaCache = null;

  function normalizeWaifu(s) {
    return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function argon2Supported() {
    return typeof argon2Ready === "function" ? argon2Ready() : false;
  }

  function dataRepo() {    if (typeof APP !== "undefined" && APP && APP.meta && APP.meta.dataRepo) return APP.meta.dataRepo;
    const cfg = getGithubConfig();
    return cfg && cfg.vaultRepo ? cfg.vaultRepo : undefined;
  }

  function entryPath(e) {
    return VAULT_PATHS.entries + e.id + ".json";
  }

  function imagePath(imageId) {
    return VAULT_PATHS.images + imageId + ".bin";
  }

  function newMetaJson() {
    const salt = b64encode(getRandomBytes(16));
    if (argon2Supported()) {
      return { v: 2, kdf: "argon2id", cost: "m=65536,t=3,p=1", salt, check: null, created: new Date().toISOString() };
    }
    return { v: 1, salt, iters: PBKDF2_ITERATIONS, check: null, created: new Date().toISOString() };
  }

  function invalidateCache() {
    metaCache = null;
  }

  async function meta() {
    if (metaCache) return metaCache;
    const raw = await ghGetFileBG(VAULT_PATHS.meta);
    metaCache = raw ? JSON.parse(raw) : null;
    return metaCache;
  }

  async function init(password) {
    const existing = await meta();
    if (existing) throw new Error("Vault already exists here. Use Unlock instead.");
    const fresh = newMetaJson();
    const key = await deriveMetaKey(password, fresh);
    fresh.check = await encryptString(key, CHECK_TEXT);
    await ghPutFileBG(VAULT_PATHS.meta, JSON.stringify(fresh, null, 2), "initialize vault");
    metaCache = fresh;
    return { key, meta: fresh };
  }

  async function unlock(password) {
    const m = metaCache || await meta();
    if (!m) throw new Error("No vault found. Create one first.");
    const key = await deriveMetaKey(password, m);
    const ok = await verifyPassword(key, m.check);
    if (!ok) throw new Error("Wrong password");
    return { key, meta: m };
  }

  async function unlockWithMeta(password, m) {
    if (!m) throw new Error("No vault found. Create one first.");
    const key = await deriveMetaKey(password, m);
    const ok = await verifyPassword(key, m.check);
    if (!ok) throw new Error("Wrong password");
    return { key, meta: m };
  }

  async function upgradeKdf(password, onProgress) {
    const m = metaCache || await meta();
    if (!m) throw new Error("No vault to upgrade.");
    if (m.kdf === "argon2id") throw new Error("Vault is already argon2id.");
    if (!argon2Supported()) throw new Error("argon2 not available on this device");
    const oldKey = await deriveKey(password, b64decode(m.salt), m.iters);
    if (!(await verifyPassword(oldKey, m.check))) throw new Error("Wrong password");
    let salt2;
    try {
      const stashed = JSON.parse(localStorage.getItem("ediary_kdf_upgrade"));
      if (stashed && stashed.salt2 && typeof stashed.salt2 === "string") salt2 = stashed.salt2;
    } catch (e) {}
    if (!salt2) salt2 = b64encode(getRandomBytes(16));
    try { localStorage.setItem("ediary_kdf_upgrade", JSON.stringify({ salt2 })); } catch (e) {}
    const newKey = await deriveArgon2Key(password, salt2);

    let ok = 0, skipped = 0, failed = 0;
    const migrate = async (label, readFn, decFn, encFn, putFn) => {
      const items = await readFn();
      let n = 0;
      for (const name of items) {
        n++;
        if (onProgress) onProgress(label + " " + n + "/" + items.length);
        let plain, already = false;
        try {
          plain = await decFn(name, oldKey);
        } catch (e) {
          try { await decFn(name, newKey); already = true; } catch (e2) { failed++; console.warn("kdf migration skipped unreadable", name); continue; }
        }
        if (already) { skipped++; continue; }
        const enc2 = await encFn(name, newKey, plain);
        await putFn(name, enc2);
        ok++;
      }
    };

    await migrate(
      "page",
      () => ghListVaultFiles(VAULT_PATHS.entries, dataRepo()),
      async (name, key) => decryptToString(key, await ghGetFileBG(VAULT_PATHS.entries + name, dataRepo())),
      (name, key, plain) => encryptString(key, plain),
      async (name, enc2) => ghPutFileBG(VAULT_PATHS.entries + name, enc2, "kdf upgrade to argon2id", dataRepo())
    );

    await migrate(
      "image",
      () => ghListVaultFiles(VAULT_PATHS.images, dataRepo()),
      async (name, key) => {
        const buf = await ghGetFileBinary(VAULT_PATHS.images + name, dataRepo());
        if (!buf || !buf.byteLength) throw new Error("empty");
        return decryptToBytes(key, new TextDecoder().decode(new Uint8Array(buf)));
      },
      (name, key, bytes) => encryptBytes(key, bytes),
      async (name, enc2) => ghPutBinary(VAULT_PATHS.images + name, new TextEncoder().encode(enc2).buffer, "kdf upgrade to argon2id", undefined, dataRepo())
    );

    const tokRaw = await ghGetFileBG(VAULT_PATHS.token);
    if (tokRaw) {
      let tokPlain, already = false;
      try { tokPlain = await decryptToString(oldKey, tokRaw); }
      catch (e) { try { await decryptToString(newKey, tokRaw); already = true; } catch (e2) { tokPlain = null; } }
      if (!already && tokPlain) {
        await putToken(tokPlain, newKey);
      } else { skipped++; }
    }

    const fresh = {
      v: 2,
      kdf: "argon2id",
      cost: "m=65536,t=3,p=1",
      salt: salt2,
      check: null,
      created: m.created || null,
      upgraded: new Date().toISOString(),
      dataRepo: m.dataRepo
    };
    fresh.check = await encryptString(newKey, CHECK_TEXT);
    await ghPutFileBG(VAULT_PATHS.meta, JSON.stringify(fresh, null, 2), "upgrade vault kdf to argon2id");
    metaCache = fresh;
    try { localStorage.removeItem("ediary_kdf_upgrade"); } catch (e) {}
    return { key: newKey, meta: fresh, ok, skipped, failed };
  }

  async function putToken(configJson, key) {
    const encPayload = await encryptString(key, configJson);
    await ghPutFileBG(VAULT_PATHS.token, encPayload, "vault update");
  }

  async function readTokenEnc(owner, repo) {
    return ghGetFilePublic(owner, repo, VAULT_PATHS.token);
  }

  async function listEntries() {
    const files = await ghListVaultFiles(VAULT_PATHS.entries, dataRepo());
    const out = [];
    let idx = 0;
    async function worker() {
      while (idx < files.length) {
        const name = files[idx++];
        try {
          const raw = await ghGetFileBG(VAULT_PATHS.entries + name, dataRepo());
          const plain = await decryptToString(APP.key, raw);
          const obj = JSON.parse(plain);
          obj.id = name.replace(/\.json$/, "");
          out.push(obj);
        } catch (e) {
          console.warn("skipping unreadable entry", name, e);
        }
      }
    }
    const workers = [];
    const n = Math.min(6, files.length);
    for (let k = 0; k < n; k++) workers.push(worker());
    await Promise.all(n ? workers : [Promise.resolve()]);
    out.sort((a, b) => (b.meta.updated || "").localeCompare(a.meta.updated || ""));
    return out;
  }

  async function saveEncryptedPath(path, entry) {
    const encrypted = await encryptString(APP.key, JSON.stringify(entry));
    await ghPutFileBG(path, encrypted, "vault update", dataRepo());
  }

  async function removeFile(path, message) {
    await ghDeleteFile(path, message, dataRepo());
  }

  async function putImage(imageId, encPayload) {
    await ghPutBinary(imagePath(imageId), new TextEncoder().encode(encPayload), "vault update", undefined, dataRepo());
  }

  async function readEntryImage(imageId, key) {
    const buf = await ghGetFileBinary(imagePath(imageId), dataRepo());
    if (!buf || !buf.byteLength) throw new Error("image missing");
    return decryptToBytes(key, new TextDecoder().decode(new Uint8Array(buf)));
  }

  return {
    normalizeWaifu,
    entryPath,
    imagePath,
    invalidateCache,
    init,
    unlock,
    unlockWithMeta,
    upgradeKdf,
    putToken,
    readTokenEnc,
    listEntries,
    saveEncryptedPath,
    removeFile,
    putImage,
    readEntryImage
  };
})();
