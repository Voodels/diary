const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..");

global.localStorage = { _s: {}, setItem(k, v) { this._s[k] = String(v); }, getItem(k) { return this._s[k] || null; } };
global.atob = s => Buffer.from(s, "base64").toString("binary");
global.btoa = s => Buffer.from(s, "binary").toString("base64");
global.TextEncoder = require("util").TextEncoder;
global.TextDecoder = require("util").TextDecoder;

const captured = [];
global.fetch = async (url) => {
  captured.push(url);
  return { ok: true, status: 200, json: async () => ([]), text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
};

const loadSrc = name => fs.readFileSync(path.join(dir, name), "utf8");
const utilFn = new Function(loadSrc("util.js") + "; return Util;");
global.Util = utilFn.call(global);

const ghSrc = loadSrc("github.js");
const vaultSrc = loadSrc("vault.js");

const ghFn = new Function("return (function(){ " + ghSrc + "; return { ghGetFileBG, ghListVaultFiles, ghPutFileBG, ghPutBinary, ghDeleteFile, ghGetFilePublic, setGithubConfig, getGithubConfig }; })()");
const gh = ghFn.call(global);

global.ghGetFileBG = gh.ghGetFileBG;
global.ghListVaultFiles = gh.ghListVaultFiles;
global.ghPutFileBG = gh.ghPutFileBG;
global.ghPutBinary = gh.ghPutBinary;
global.ghDeleteFile = gh.ghDeleteFile;
global.ghGetFilePublic = gh.ghGetFilePublic;
global.setGithubConfig = gh.setGithubConfig;
global.getGithubConfig = gh.getGithubConfig;
global.APP = { meta: { dataRepo: "diary-vault" }, key: null };
global.encryptString = async () => "enc-v1:stub";
global.decryptToString = async () => "{}";
global.decryptToBytes = async () => new ArrayBuffer(0);

const vaultFn = new Function("return (function(){ " + ghSrc + "\n" + vaultSrc + "; return Vault; })()");
const Vault = vaultFn.call(global);
global.Vault = Vault;

(async () => {
  let fails = 0;
  const check = (name, cond) => { console.log((cond ? "PASS" : "FAIL") + " " + name); if (!cond) fails++; };

  gh.setGithubConfig({ owner: "Voodels", repo: "diary", branch: "main", token: "T" });

  captured.length = 0;
  await Vault.listEntries();
  check("entries list hits private repo", captured.some(u => u.includes("/repos/Voodels/diary-vault/contents/vault/entries")));

  captured.length = 0;
  await gh.ghGetFileBG("vault/meta.json", undefined);
  check("meta stays in main repo", captured.some(u => u.includes("/repos/Voodels/diary/contents/vault/meta.json")));

  captured.length = 0;
  await Vault.saveEncryptedPath("vault/entries/abc.json", { id: "abc" });
  check("save routes to private repo", captured.some(u => u.includes("diary-vault")));

  captured.length = 0;
  await Vault.removeFile("vault/entries/abc.json");
  check("delete routes to private repo", captured.some(u => u.includes("diary-vault")));

  check("entryPath is opaque", Vault.entryPath({ id: "20261018-1234-abcde", meta: { title: "secret title" } }) === "vault/entries/20261018-1234-abcde.json");

  global.APP = { meta: {}, key: null };
  captured.length = 0;
  await Vault.listEntries();
  check("no dataRepo falls back to main repo (legacy)", captured.some(u => u.includes("/repos/Voodels/diary/contents/vault/entries")));

  console.log(fails ? "\n" + fails + " FAILURES" : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
