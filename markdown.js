const MD = (() => {
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function render(md) {
    const lines = String(md).split("\n");
    const out = [];
    let inList = false;
    for (const line of lines) {
      let m;
      if ((m = line.match(/^# (.*)$/))) { closeList(); out.push(`<h1>${inline(m[1])}</h1>`); }
      else if ((m = line.match(/^## (.*)$/))) { closeList(); out.push(`<h2>${inline(m[1])}</h2>`); }
      else if ((m = line.match(/^### (.*)$/))) { closeList(); out.push(`<h3>${inline(m[1])}</h3>`); }
      else if ((m = line.match(/^- (.*)$/))) {
        if (!inList) { out.push("<ul>"); inList = true; }
        out.push(`<li>${inline(m[1])}</li>`);
      }
      else if (line.trim() === "") { closeList(); }
      else { closeList(); out.push(`<p>${inline(line)}</p>`); }
    }
    closeList();
    return out.join("");

    function closeList() {
      if (inList) { out.push("</ul>"); inList = false; }
    }

    function inline(s) {
      return escapeHtml(s)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/`(.+?)`/g, "<code>$1</code>")
        .replace(/\[(.+?)\]\((https?:\/\/.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    }
  }

  return { render };
})();
