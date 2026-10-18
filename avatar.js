const Moods = (() => {
  const MOODS = {
    idle:    { bubble: "\u2026",                 cls: "m-idle" },
    curious: { bubble: "Hmm\u2026?",             cls: "m-curious" },
    shy:     { bubble: "yesss\u2026?",           cls: "m-shy" },
    love:    { bubble: "good boy \u2661",        cls: "m-love" },
    pout:    { bubble: "wrong girl\u2026",       cls: "m-pout" },
    tease:   { bubble: "get to know her better\u2026", cls: "m-pout" },
    silent:  { bubble: "\u2026\u2026\u2026",              cls: "m-pout" },
    gloat:   { bubble: "\u2661 my diary \u2661", cls: "m-love" }
  };

  let host = null;
  let current = "idle";

  function svg() {
    return `
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="av-bg" cx="50%" cy="42%" r="65%">
      <stop offset="0%" stop-color="#2b2334"/>
      <stop offset="100%" stop-color="#141018"/>
    </radialGradient>
    <linearGradient id="av-top" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2e4a72"/>
      <stop offset="100%" stop-color="#1c2f4a"/>
    </linearGradient>
  </defs>
  <circle cx="100" cy="100" r="96" fill="url(#av-bg)"/>

  <path class="hairback" d="M100 34 C64 36 52 62 52 92 C52 118 48 150 42 178 C58 168 66 170 84 172 L84 120 L116 120 L116 172 C134 170 142 168 158 178 C152 150 148 118 148 92 C148 62 136 36 100 34 Z" fill="#151117"/>
  <path d="M60 96 C58 118 56 140 50 164 M140 96 C142 118 144 140 150 164" stroke="#2c2331" stroke-width="3" fill="none" opacity="0.7" stroke-linecap="round"/>

  <path d="M84 120 L82 176 L98 184 L94 128 Z" fill="#ffd6c4" opacity="0"/>
  <path d="M70 148 C60 168 56 182 58 188 L86 182 L88 142 Z" fill="#191420"/>
  <path d="M130 148 C140 168 144 182 142 188 L114 182 L112 142 Z" fill="#191420"/>

  <path d="M78 168 L100 178 L122 168 L124 188 L76 188 Z" fill="url(#av-top)"/>
  <path d="M78 168 C70 172 62 176 54 184 L76 188 Z" fill="#ffd6c4"/>
  <path d="M122 168 C130 172 138 176 146 184 L124 188 Z" fill="#ffd6c4"/>
  <path d="M88 162 L100 170 L112 162 L112 174 Q100 180 88 174 Z" fill="#ffd6c4"/>

  <path d="M69 88 C69 60 82 44 100 44 C118 44 131 60 131 88 C131 108 120 126 100 126 C80 126 69 108 69 88 Z" fill="#ffd9c8"/>

  <path d="M72 66 C78 42 122 42 128 66 C126 56 118 50 100 50 C82 50 74 56 72 66 Z" fill="#1a1620" opacity="0.9"/>
  <path d="M70 60 C74 44 88 38 100 40 C112 38 126 44 130 60 C122 50 112 48 100 48 C88 48 78 50 70 60 Z" fill="#100d14"/>
  <path d="M69 88 C67 72 72 58 84 52 C74 62 74 78 77 96 Z" fill="#20182a"/>
  <path d="M131 88 C133 72 128 58 116 52 C126 62 126 78 123 96 Z" fill="#20182a"/>
  <path class="side-l" d="M69 92 C64 108 62 128 64 148 C60 132 62 108 66 92 Z" fill="#151117"/>
  <path class="side-r" d="M131 92 C136 108 138 128 136 148 C140 132 138 108 134 92 Z" fill="#151117"/>

  <g class="goggles" transform="rotate(-8 100 52)">
    <rect x="66" y="42" width="68" height="10" rx="5" fill="#232028"/>
    <circle cx="80" cy="46" r="10" fill="#e56b19"/>
    <circle cx="120" cy="46" r="10" fill="#e56b19"/>
    <circle cx="80" cy="46" r="10" fill="none" stroke="#171319" stroke-width="2"/>
    <circle cx="120" cy="46" r="10" fill="none" stroke="#171319" stroke-width="2"/>
    <circle cx="77" cy="43" r="2.6" fill="#ffd9a0" opacity="0.9"/>
    <circle cx="117" cy="43" r="2.6" fill="#ffd9a0" opacity="0.9"/>
  </g>

  <g class="face f-idle" data-face="idle">
    <path d="M78 92 C82 88 92 88 95 93" stroke="#241a20" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M105 93 C108 88 118 88 122 92" stroke="#241a20" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <ellipse cx="87" cy="97" rx="4.4" ry="5.6" fill="#2f6ea5"/>
    <ellipse cx="113" cy="97" rx="4.4" ry="5.6" fill="#2f6ea5"/>
    <circle cx="88.4" cy="95" r="1.4" fill="#dff0ff"/>
    <circle cx="114.4" cy="95" r="1.4" fill="#dff0ff"/>
    <path d="M96 110 C98 112.5 102 112.5 104 110" stroke="#b05a54" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  </g>

  <g class="face f-curious" data-face="curious">
    <path d="M78 90 C82 86 92 86 95 91" stroke="#241a20" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M105 88 C109 83 119 84 122 89" stroke="#241a20" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <ellipse cx="87" cy="98" rx="4.4" ry="5.6" fill="#2f6ea5"/>
    <ellipse cx="113" cy="96" rx="4.4" ry="5.6" fill="#2f6ea5"/>
    <circle cx="88.4" cy="96" r="1.4" fill="#dff0ff"/>
    <circle cx="114.4" cy="94" r="1.4" fill="#dff0ff"/>
    <ellipse cx="101" cy="112" rx="2.6" ry="3.4" fill="none" stroke="#b05a54" stroke-width="2.2"/>
  </g>

  <g class="face f-shy" data-face="shy">
    <path d="M80 97 C84 92 90 92 94 97" stroke="#241a20" stroke-width="3" fill="none" stroke-linecap="round" transform="rotate(180 87 95)"/>
    <path d="M106 97 C110 92 116 92 120 97" stroke="#241a20" stroke-width="3" fill="none" stroke-linecap="round" transform="rotate(180 113 95)"/>
    <ellipse cx="83" cy="104" rx="5.5" ry="3" fill="#ff9db1" opacity="0.75"/>
    <ellipse cx="117" cy="104" rx="5.5" ry="3" fill="#ff9db1" opacity="0.75"/>
    <path d="M95 110 C97 113 103 113 105 110" stroke="#b05a54" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  </g>

  <g class="face f-love" data-face="love">
    <path d="M87 92.5 C84 88 78 89.5 78 93.5 C78 97 83 99.5 87 101 C91 99.5 96 97 96 93.5 C96 89.5 90 88 87 92.5 Z" fill="#ff5f8f"/>
    <path d="M113 92.5 C110 88 104 89.5 104 93.5 C104 97 109 99.5 113 101 C117 99.5 122 97 122 93.5 C122 89.5 116 88 113 92.5 Z" fill="#ff5f8f"/>
    <ellipse cx="82" cy="106" rx="6" ry="3.2" fill="#ff9db1" opacity="0.9"/>
    <ellipse cx="118" cy="106" rx="6" ry="3.2" fill="#ff9db1" opacity="0.9"/>
    <path d="M94 108 C97 114 103 114 106 108 C103 110 97 110 94 108 Z" fill="#c2504d"/>
    <path d="M70 82 L71.5 84.5 L74 86 L71.5 87.5 L70 90 L68.5 87.5 L66 86 L68.5 84.5 Z" fill="#ffe9a8" opacity="0.9"/>
    <path d="M128 82 L129.5 84.5 L132 86 L129.5 87.5 L128 90 L126.5 87.5 L124 86 L126.5 84.5 Z" fill="#ffe9a8" opacity="0.9"/>
  </g>

  <g class="face f-pout" data-face="pout">
    <path d="M79 87 C83 90 91 90 95 88" stroke="#241a20" stroke-width="2.8" fill="none" stroke-linecap="round" transform="rotate(10 87 88)"/>
    <path d="M105 88 C109 90 117 90 121 87" stroke="#241a20" stroke-width="2.8" fill="none" stroke-linecap="round" transform="rotate(-10 113 88)"/>
    <path d="M81 99 C84 96 90 96 93 99 L93 100.5 C90 98.5 84 98.5 81 100.5 Z" fill="#241a20"/>
    <path d="M107 99 C110 96 116 96 119 99 L119 100.5 C116 98.5 110 98.5 107 100.5 Z" fill="#241a20"/>
    <path d="M95 111 C98 109 102 109 105 111" stroke="#b05a54" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M128 74 C130 70 134 70 134 74 C134 77 131 82 131 82 C131 82 128 77 128 74 Z" fill="#7ecdf0" opacity="0.9"/>
    <ellipse cx="82" cy="105" rx="5" ry="2.6" fill="#ff9db1" opacity="0.5"/>
    <ellipse cx="118" cy="105" rx="5" ry="2.6" fill="#ff9db1" opacity="0.5"/>
  </g>
</svg>`;
  }

  function mount(el) {
    host = el;
    el.innerHTML = svg();
    setMood(current, true);
  }

  function setMood(name, force) {
    if (!host || (!force && name === current)) return;
    if (!MOODS[name]) name = "idle";
    current = name;
    host.dataset.mood = name;
    host.querySelectorAll("g.face").forEach(g => {
      g.classList.toggle("active", g.dataset.face === nameToFace(name));
    });
    const b = document.getElementById("waifuBubble");
    if (b) b.textContent = MOODS[name].bubble;
  }

  function nameToFace(name) {
    if (name === "tease" || name === "silent" || name === "pout") return "pout";
    if (name === "gloat" || name === "love") return "love";
    return name;
  }

  function get() {
    return current;
  }

  return { mount, setMood, get, MOODS };
})();
