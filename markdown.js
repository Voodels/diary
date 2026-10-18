const MD = (() => {
  const escapeHtml = s => Util.escapeHtml(s);

  const IMG_RE = /!\[(.*?)\]\(image:([^)\s]+)\)/g;
  const TOC_MARK = "\u0000TOC\u0000";

  function slot(id, name) {
    return `<figure class="img-slot" data-image-id="${escapeHtml(id)}" data-name="${escapeHtml(name || "image")}">decrypting image…</figure>`;
  }

  function inlineFmt(s) {
    return escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/~~(.+?)~~/g, "<del>$1</del>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/==(.+?)==/g, '<mark class="hl">$1</mark>')
      .replace(/\+\+(.+?)\+\+/g, "<u>$1</u>")
      .replace(/\[(.+?)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  function inline(s) {
    let out = "";
    let last = 0;
    IMG_RE.lastIndex = 0;
    let m;
    while ((m = IMG_RE.exec(s))) {
      out += inlineFmt(s.slice(last, m.index));
      out += slot(m[2], m[1]);
      last = m.index + m[0].length;
    }
    out += inlineFmt(s.slice(last));
    return out;
  }

  function slugId(text, idx) {
    const base = String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "part";
    return `${idx}-${base}`;
  }

  function splitRow(rowLine) {
    return rowLine.trim().replace(/^\|/, "").replace(/\|$/, "")
      .replace(/\\\|/g, "\u0001")
      .split("|")
      .map(c => c.replace(/\u0001/g, "|").trim());
  }

  const isSepRow = cells => cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c));

  function render(md) {
    const lines = String(md).split("\n");
    const out = [];
    const headings = [];
    let mode = null;
    let i = 0;
    let hIdx = 0;

    const close = () => {
      if (mode === "ul") out.push("</ul>");
      else if (mode === "ol") out.push("</ol>");
      else if (mode === "todo") out.push("</ul>");
      else if (mode === "quote") out.push("</blockquote>");
      mode = null;
    };

    while (i < lines.length) {
      const line = lines[i];
      let m;

      if ((m = line.match(/^```\s*([\w+-]*)\s*$/))) {
        close();
        const lang = m[1];
        const buf = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push(`<pre><code${lang ? ` class="lang-${escapeHtml(lang)}"` : ""}>${escapeHtml(buf.join("\n"))}</code></pre>`);
        continue;
      }

      if (line.trim().startsWith("|") && i + 1 < lines.length) {
        const headCells = splitRow(line);
        const sepCells = splitRow(lines[i + 1]);
        if (headCells.length > 1 && isSepRow(sepCells)) {
          close();
          const ths = headCells.map(c => `<th>${inline(c)}</th>`).join("");
          out.push(`<table><thead><tr>${ths}</tr></thead>`);
          i += 2;
          const rows = [];
          while (i < lines.length && /^\s*\|.*\|?\s*$/.test(lines[i]) && lines[i].trim().replace(/\|/g, "") !== "") {
            rows.push(splitRow(lines[i]));
            i++;
          }
          out.push(`<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
          continue;
        }
      }

      if (/---+$/.test(line.trim())) { close(); out.push("<hr>"); i++; continue; }

      if (/^\[\[toc\]\]$/i.test(line.trim())) { close(); out.push(TOC_MARK); i++; continue; }

      if ((m = line.match(/^# (.*)$/))) {
        close();
        const id = slugId(m[1], hIdx++);
        const html = inline(m[1]);
        headings.push({ level: 1, id, html });
        out.push(`<h1 id="${id}">${html}</h1>`);
        i++; continue;
      }
      if ((m = line.match(/^## (.*)$/))) {
        close();
        const id = slugId(m[1], hIdx++);
        const html = inline(m[1]);
        headings.push({ level: 2, id, html });
        out.push(`<h2 id="${id}">${html}</h2>`);
        i++; continue;
      }
      if ((m = line.match(/^### (.*)$/))) {
        close();
        const id = slugId(m[1], hIdx++);
        const html = inline(m[1]);
        headings.push({ level: 3, id, html });
        out.push(`<h3 id="${id}">${html}</h3>`);
        i++; continue;
      }

      if ((m = line.match(/^- \[( |x|X)\] (.*)$/))) {
        if (mode !== "todo") { close(); out.push('<ul class="todo">'); mode = "todo"; }
        const done = m[1].toLowerCase() === "x";
        out.push(`<li class="task${done ? " done" : ""}"><span class="task-box">${done ? "✓" : ""}</span><span>${inline(m[2])}</span></li>`);
        i++; continue;
      }

      if ((m = line.match(/^- (.*)$/))) {
        if (mode !== "ul") { close(); out.push("<ul>"); mode = "ul"; }
        out.push(`<li>${inline(m[1])}</li>`);
        i++; continue;
      }

      if ((m = line.match(/^\d+\. (.*)$/))) {
        if (mode !== "ol") { close(); out.push("<ol>"); mode = "ol"; }
        out.push(`<li>${inline(m[1])}</li>`);
        i++; continue;
      }

      if ((m = line.match(/^> ?(.*)$/))) {
        if (mode !== "quote") { close(); out.push("<blockquote>"); mode = "quote"; }
        out.push(`<p>${inline(m[1])}</p>`);
        i++; continue;
      }

      if (line.trim() === "") { close(); i++; continue; }

      close();
      out.push(`<p>${inline(line)}</p>`);
      i++;
    }
    close();

    if (out.indexOf(TOC_MARK) !== -1) {
      const tocHtml = headings.length
        ? `<nav class="toc"><div class="toc-title">table of contents</div>${headings.map(h => `<a class="lv${h.level}" href="#${h.id}">${h.html}</a>`).join("")}</nav>`
        : "";
      for (let k = 0; k < out.length; k++) if (out[k] === TOC_MARK) out[k] = tocHtml;
    }

    return out.join("");
  }

  return { render };
})();
