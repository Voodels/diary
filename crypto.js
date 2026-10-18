const PBKDF2_ITERATIONS = 310000;

const b64encode = Util.b64encode;
const b64decode = Util.b64decode;

function getRandomBytes(n) {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return arr;
}

async function deriveKey(password, salt, iterations) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptString(key, text) {
  const enc = new TextEncoder();
  const iv = getRandomBytes(12);
  const data = enc.encode(text);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return "enc-v1:" + b64encode(out);
}

async function decryptToString(key, payload) {
  if (!payload.startsWith("enc-v1:")) throw new Error("not an encrypted payload");
  const raw = b64decode(payload.slice(7));
  const iv = raw.slice(0, 12);
  const ct = raw.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

async function encryptBytes(key, buf) {
  const iv = getRandomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, buf);
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return "enc-v1:" + b64encode(out);
}

async function decryptToBytes(key, payload) {
  if (!payload.startsWith("enc-v1:")) throw new Error("not an encrypted payload");
  const raw = b64decode(payload.slice(7));
  const iv = raw.slice(0, 12);
  const ct = raw.slice(12);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
}

async function verifyPassword(key, checkPayload) {
  if (!checkPayload) return false;
  try {
    await decryptToString(key, checkPayload);
    return true;
  } catch (e) {
    return false;
  }
}
