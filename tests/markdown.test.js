const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..");

function loadFn(name, retName, param, arg) {
  const src = fs.readFileSync(path.join(dir, name), "utf8");
  return new Function(param || "", src + "\nreturn " + retName + ";")(arg);
}

const Util = loadFn("util.js", "Util");
const MD = loadFn("markdown.js", "MD", "Util", Util);

let pass = 0, fail = 0;
function check(name, out, cond) {
  if (cond) { pass++; console.log("PASS " + name); }
  else { fail++; console.log("FAIL " + name + "  ->  " + JSON.stringify(String(out).slice(0, 300))); }
}

let out = MD.render("<script>alert(1)</script>");
check("script escaped", out, !out.includes("<script") && out.includes("&lt;script&gt;"));

out = MD.render('<img src=x onerror=alert(1)>');
check("img onerror escaped", out, out.includes("&lt;img") && !out.includes("<img"));

out = MD.render('[a](javascript:alert(1))');
check("javascript link blocked", out, !/href="javascript/.test(out));

out = MD.render('[a](https://example.com)');
check("https link ok", out, out.includes('href="https://example.com"'));

out = MD.render("**b** *i* ~~d~~ `c`");
check("base inline", out, ['<strong>b</strong>', '<em>i</em>', '<del>d</del>', '<code>c</code>'].every(s => out.includes(s)));

out = MD.render('==glow==');
check("highlight", out, out.includes('<mark class="hl">glow</mark>'));

out = MD.render('++under++');
check("underline", out, out.includes('<u>under</u>'));

out = MD.render("## hello there");
check("h2 id slug", out, out.includes('id="0-hello-there"'));

out = MD.render("### deep");
check("h3", out, out.includes("<h3") && out.includes(">deep</h3>"));

out = MD.render("| a | b |\n| --- | --- |\n| 1 | 2 |");
check("table basic", out, ['<table>', '<th>a</th>', '<th>b</th>', '<td>1</td>', '<td>2</td>'].every(s => out.includes(s)));

out = MD.render('| <b>x</b> | ok |\n| --- | --- |\n| <script> | y |');
check("table cells escaped", out, out.includes('&lt;b&gt;x&lt;/b&gt;') && out.includes('&lt;script&gt;'));

out = MD.render('| a | b |\n| --- | --- |\n| p\\|q | 2 |');
check("escaped pipe cell", out, out.includes('<td>p|q</td>'));

out = MD.render("[[toc]]\n# intro\n## middle\ntext");
check("toc built", out, out.includes('class="toc"') && out.includes('href="#0-intro"') && out.includes('class="lv2" href="#1-middle"'));

out = MD.render("[[toc]]\nno headings");
check("toc empty no marker leak", out, !out.includes("\u0000TOC") && !out.includes("<nav"));

out = MD.render("```\n[[toc]]\n<script>x</script>\n```");
check("fence toc+script inert", out, !out.includes('class="toc"') && !out.includes("<script"));

out = MD.render("- [x] done\n- [ ] todo");
check("todo states", out, out.includes('class="task done"') && out.includes('<li class="task">') && out.includes('<span>todo</span>'));

out = MD.render("> a callout line");
check("quote block", out, out.includes("<blockquote><p>a callout line</p>"));

out = MD.render("1. one\n2. two");
check("ordered list", out, out.includes("<ol>") && out.includes("<li>one</li>") && out.includes("</ol>"));

out = MD.render("![photo](image:abc123)");
check("image slot", out, out.includes('data-image-id="abc123"'));

out = MD.render("a\n\n---\n\nb");
check("dividers", out, out.includes("<hr>"));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
