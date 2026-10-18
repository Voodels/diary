const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const used = new Set();
for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".js"))) {
  const src = fs.readFileSync(path.join(dir, f), "utf8");
  for (const m of src.matchAll(/el\("([^"]+)"\)/g)) used.add(m[1] + "\t" + f);
  for (const m of src.matchAll(/getElementById\("([^"]+)"\)/g)) used.add(m[1] + "\t" + f);
}
let bad = 0;
for (const u of [...used].sort()) {
  const [id, f] = u.split("\t");
  if (!html.includes('id="' + id + '"')) { console.log("MISSING id:", id, "\tused in", f); bad++; }
}
console.log(bad ? bad + " MISSING" : `ALL IDS RESOLVE (${used.size} referenced)`);
process.exit(bad ? 1 : 0);
