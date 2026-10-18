/* argon2-browser 1.18.0 loader shim (MIT — antelle/argon2-browser, see LICENSE.txt).
   Wires the vendored wasm + glue into lib/argon2.js's browser hooks so no data:-URL
   fetch or dynamic import is needed (keeps CSP strict). */
window.argon2WasmPath = "argon2/dist/argon2.wasm";

window.loadArgon2WasmBinary = function () {
  return fetch(window.argon2WasmPath)
    .then(r => { if (!r.ok) throw new Error("argon2.wasm fetch failed " + r.status); return r.arrayBuffer(); })
    .then(b => new Uint8Array(b));
};

window.loadArgon2WasmModule = async function () {
  const binary = await window.loadArgon2WasmBinary();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("argon2 wasm init timeout")), 20000);
    window.Module = {
      wasmBinary: binary,
      onRuntimeInitialized: function () {
        clearTimeout(timer);
        resolve(window.Module);
      }
    };
    const s = document.createElement("script");
    s.src = "argon2/dist/argon2.js";
    s.async = false;
    s.onerror = () => { clearTimeout(timer); reject(new Error("argon2 glue failed to load")); };
    document.head.appendChild(s);
  });
};

window.argon2Ready = function () {
  return typeof argon2 !== "undefined" && !!(argon2.hash && argon2.ArgonType);
};
