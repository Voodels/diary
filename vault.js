const Vault = (() => {
  let metaCache = null;

  function normalizeWaifu(s) {
    return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function dataRepo() {
    if (typeof APP !== "undefined" && APP && APP.meta && APP.meta.dataRepo) return APP.meta.dataRepo;
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
    const key = await deriveKey(password, b64decode(fresh.salt), fresh.iters);
    fresh.check = await encryptString(key, CHECK_TEXT);
    await ghPutFileBG(VAULT_PATHS.meta, JSON.stringify(fresh, null, 2), "initialize vault");
    metaCache = fresh;
    return { key, meta: fresh };
  }

  async function unlock(password) {
    const m = metaCache || await meta();
    if (!m) throw new Error("No vault found. Create one first.");
    const key = await deriveKey(password, b64decode(m.salt), m.iters);
    const ok = await verifyPassword(key, m.check);
    if (!ok) throw new Error("Wrong password");
    return { key, meta: m };
  }

  async function unlockWithMeta(password, m) {
    if (!m) throw new Error("No vault found. Create one first.");
    const key = await deriveKey(password, b64decode(m.salt), m.iters);
    const ok = await verifyPassword(key, m.check);
    if (!ok) throw new Error("Wrong password");
    return { key, meta: m };
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
    const entries = [];
    for (const name of files) {
      try {
        const raw = await ghGetFileBG(VAULT_PATHS.entries + name, dataRepo());
        const plain = await decryptToString(APP.key, raw);
        const obj = JSON.parse(plain);
        obj.id = name.replace(/\.json$/, "");
        entries.push(obj);
      } catch (e) {
        console.warn("skipping unreadable entry", name, e);
      }
    }
    entries.sort((a, b) => (b.meta.updated || "").localeCompare(a.meta.updated || ""));
    return entries;
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
    const raw = await ghGetFileBG(imagePath(imageId), dataRepo());
    if (!raw) throw new Error("image missing");
    return decryptToBytes(key, raw);
  }

  return {
    normalizeWaifu,
    entryPath,
    imagePath,
    invalidateCache,
    init,
    unlock,
    unlockWithMeta,
    putToken,
    readTokenEnc,
    listEntries,
    saveEncryptedPath,
    removeFile,
    putImage,
    readEntryImage
  };
})();
