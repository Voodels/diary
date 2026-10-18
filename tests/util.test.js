const path = require("path");
const fs = require("fs");
const dir = path.join(__dirname, "..");

const Util = new Function(fs.readFileSync(path.join(dir, "util.js"), "utf8") + "; return Util;")();

let fails = 0;
const check = (name, cond) => { console.log((cond ? "PASS" : "FAIL") + " " + name); if (!cond) fails++; };

check("escapeHtml escapes all five", Util.escapeHtml(`<img a="1" b='2'> &`) === "&lt;img a=&quot;1&quot; b=&#39;2&#39;&gt; &amp;");
check("slugify defaults to entry", Util.slugify("!?*") === "entry");
check("slugify truncates to 30", Util.slugify("x".repeat(50)).length === 30);
check("b64 roundtrip", Util.b64decode(Util.b64encode(new Uint8Array([0, 1, 127, 200, 255]))).join(",") === "0,1,127,200,255");
check("b64 chunked (large)", Util.b64decode(Util.b64encode(new Uint8Array(3 * 0x8000 + 7))).length === 3 * 0x8000 + 7);
check("b64 non-ascii bytes", Buffer.from(Util.b64decode(Util.b64encode(new Uint8Array([0xE2, 0x99, 0xA1])))).toString("utf8") === "♡");

console.log(fails ? fails + " FAILURES" : "ALL PASS");
process.exit(fails ? 1 : 0);
