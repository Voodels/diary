const MD = (() => {
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  const IMG_RE = /!\[(.*?)\]\(image:([^)\s]+)\)/g;

  function slot(id, name) {
    return `<figure class="img-slot" data-image-id="${escapeHtml(id)}" data-name="${escapeHtml(name || "image")}">decrypting image…</figure>`;
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

  function inlineFmt(s) {
    return escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/~~(.+?)~~/g, "<del>$1</del>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/\[(.+?)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  function render(md) {
    const lines = String(md).split("\n");
    const out = [];
    let mode = null;
    let i = 0;

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

      if (/^---+$/.test(line.trim())) { close(); out.push("<hr>"); i++; continue; }

      if ((m = line.match(/^# (.*)$/))) { close(); out.push(`<h1>${inline(m[1])}</h1>`); i++; continue; }
      if ((m = line.match(/^## (.*)$/))) { close(); out.push(`<h2>${inline(m[1])}</h2>`); i++; continue; }
      if ((m = line.match(/^### (.*)$/))) { close(); out.push(`<h3>${inline(m[1])}</h3>`); i++; continue; }

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
    return out.join("");
  }

  return { render };
})();
