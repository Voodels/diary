const Log = (() => {
  const KEY = "ediary_log";
  const MAX = 50;

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]") || []; } catch (e) { return []; }
  }

  function write(items) {
    try { localStorage.setItem(KEY, JSON.stringify(items.slice(-MAX))); } catch (e) {}
  }

  function push(entry) {
    const items = read();
    items.push({ ts: new Date().toISOString(), msg: String((entry && entry.msg) || "unknown error").slice(0, 500), stack: entry && entry.stack ? String(entry.stack).slice(0, 1200) : undefined });
    write(items);
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  function format(items) {
    return (items || read())
      .map(x => "[" + x.ts + "] " + x.msg + (x.stack ? "\n    " + x.stack.split("\n").join("\n    ") : ""))
      .join("\n");
  }

  function wire() {
    window.addEventListener("error", ev => {
      push({ msg: ev.message || "script error", stack: ev.error && ev.error.stack });
    });
    window.addEventListener("unhandledrejection", ev => {
      const r = ev.reason;
      push({ msg: "async: " + (r && r.message ? r.message : String(r)) });
    });
  }

  return { read, push, clear, format, wire };
})();

Log.wire();
