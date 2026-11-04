/*! owg-css mermaid plugin | MIT
    Renders Mermaid diagrams in the live owg theme and re-renders them when the theme changes.

    Classic script (mermaid loaded from jsDelivr on first use, or reuses window.mermaid):
      <script src="plugins/owg-mermaid.js" defer></script>
      <pre class="mermaid">graph LR; A-->B</pre>

    ES module, with your own mermaid:
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs";
      import "./plugins/owg-mermaid.js";
      owgMermaid.init(mermaid);

    Add data-manual to the <script> tag to stop the automatic start and call owgMermaid.init()
    yourself. owgMermaid.render() re-renders everything (e.g. after adding diagrams).
    Diagrams are pre.mermaid / .mermaid blocks; each block's source is kept in data-owg-src.
    Re-renders on <html data-theme>, <html data-variant> and OS colour-scheme changes. */
(function () {
  "use strict";
  if (window.owgMermaid) return;

  var CDN = "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs";
  var SELECTOR = "pre.mermaid, .mermaid";
  var FONT_SIZE = 13; // px, every diagram type
  var script = document.currentScript;
  var mermaid = null;
  var queue = Promise.resolve();
  var ctx = null;

  // Resolve any CSS colour (including color-mix() and color(srgb ...)) to #rrggbb,
  // because mermaid's colour maths only understands plain hex/rgb.
  function hex(value) {
    if (!ctx) {
      var c = document.createElement("canvas");
      c.width = c.height = 1;
      ctx = c.getContext("2d", { willReadFrequently: true });
    }
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    var d = ctx.getImageData(0, 0, 1, 1).data;
    return "#" + [d[0], d[1], d[2]].map(function (n) { return n.toString(16).padStart(2, "0"); }).join("");
  }

  function tokens() {
    var probe = document.createElement("span");
    probe.style.display = "none";
    document.body.appendChild(probe);
    var read = function (name) {
      probe.style.color = "var(--owg-" + name + ")";
      return hex(getComputedStyle(probe).color);
    };
    var t = {};
    ["bg", "surface", "surface-2", "surface-3", "text", "text-strong", "muted", "border",
     "border-strong", "accent", "accent-soft", "accent-ink", "blue", "green", "amber", "red",
     "purple", "pink", "cyan", "amber-soft"].forEach(function (n) { t[n] = read(n); });
    probe.remove();
    var font = getComputedStyle(document.documentElement).getPropertyValue("--owg-font-mono").trim();
    t.font = font || "Roboto Mono, ui-monospace, monospace";
    return t;
  }

  function luminance(h) {
    var n = parseInt(h.slice(1), 16);
    return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  }

  function themeVariables() {
    var t = tokens();
    return {
      darkMode: luminance(t.bg) < 0.5,
      fontFamily: t.font,
      fontSize: FONT_SIZE + "px",
      background: t.surface,
      textColor: t.text,
      titleColor: t["text-strong"],
      lineColor: t.muted,
      primaryColor: t["accent-soft"],
      primaryTextColor: t["text-strong"],
      primaryBorderColor: t.accent,
      secondaryColor: t["surface-2"],
      secondaryTextColor: t.text,
      secondaryBorderColor: t["border-strong"],
      tertiaryColor: t.surface,
      tertiaryTextColor: t.text,
      tertiaryBorderColor: t.border,
      mainBkg: t["accent-soft"],
      nodeBorder: t.accent,
      nodeTextColor: t["text-strong"],
      clusterBkg: t["surface-2"],
      clusterBorder: t["border-strong"],
      edgeLabelBackground: t.surface,
      noteBkgColor: t["amber-soft"],
      noteTextColor: t.text,
      noteBorderColor: t.amber,
      actorBkg: t["accent-soft"],
      actorBorder: t.accent,
      actorTextColor: t["text-strong"],
      actorLineColor: t["border-strong"],
      signalColor: t.text,
      signalTextColor: t.text,
      labelBoxBkgColor: t["surface-2"],
      labelBoxBorderColor: t["border-strong"],
      labelTextColor: t.text,
      loopTextColor: t.text,
      activationBkgColor: t["surface-3"],
      activationBorderColor: t.accent,
      sequenceNumberColor: t["accent-ink"],
      pie1: t.accent, pie2: t.green, pie3: t.amber, pie4: t.purple, pie5: t.red,
      pie6: t.cyan, pie7: t.pink, pie8: t.blue,
      pieStrokeColor: t.surface,
      pieOuterStrokeColor: t["border-strong"],
      pieTitleTextColor: t["text-strong"],
      pieSectionTextColor: t.surface,
      pieLegendTextColor: t.text,
      git0: t.accent, git1: t.green, git2: t.amber, git3: t.purple,
      git4: t.red, git5: t.cyan, git6: t.pink, git7: t.blue
    };
  }

  function load(m) {
    if (m) return Promise.resolve(m);
    if (mermaid) return Promise.resolve(mermaid);
    // Only a real mermaid: an element with id="mermaid" is also window.mermaid.
    var w = window.mermaid;
    if (w && typeof w.initialize === "function" && typeof w.run === "function") return Promise.resolve(w);
    return import(CDN).then(function (mod) { return mod.default || mod; });
  }

  function doRender() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll(SELECTOR))
      // Mermaid puts class="mermaid" on nothing it generates, but skip nested matches anyway.
      .filter(function (el) { return !el.parentElement || !el.parentElement.closest(SELECTOR); });
    if (!nodes.length) return Promise.resolve();
    nodes.forEach(function (el) {
      if (!el.hasAttribute("data-owg-src")) el.setAttribute("data-owg-src", el.textContent);
      el.textContent = el.getAttribute("data-owg-src");
      el.removeAttribute("data-processed");
    });
    var vars = themeVariables();
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      securityLevel: "strict",
      fontFamily: vars.fontFamily,
      // Top-level fontSize is what sequence diagrams read (themeVariables.fontSize is not).
      fontSize: FONT_SIZE,
      themeVariables: vars
    });
    // Mermaid styles elements and measures them in the same tick. Any active transition
    // (e.g. a reduced-motion reset setting transition-duration: 0.01ms on *, which with the
    // default transition-property: all transitions everything) makes it measure stale sizes
    // and lay out a huge, mostly empty canvas. Switch transitions off while rendering.
    var guard = document.createElement("style");
    guard.textContent = "*,::before,::after{transition:none!important}";
    document.head.appendChild(guard);
    var done = function () { guard.remove(); };
    return mermaid.run({ nodes: nodes, suppressErrors: true }).then(done, function (e) { done(); throw e; });
  }

  // Serialise renders: a theme flip during a render queues one more, never two at once.
  function render() {
    queue = queue.then(function () { return mermaid && doRender(); }).catch(function (e) {
      console.error("owg-mermaid:", e);
    });
    return queue;
  }

  var watching = false;
  function watch() {
    if (watching) return;
    watching = true;
    new MutationObserver(render).observe(document.documentElement, {
      attributes: true, attributeFilter: ["data-theme", "data-variant"]
    });
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq.addEventListener) mq.addEventListener("change", render);
  }

  var started = false;
  function init(m) {
    started = true;
    return load(m).then(function (mm) {
      mermaid = mm;
      watch();
      return render();
    });
  }

  window.owgMermaid = { init: init, render: render, themeVariables: themeVariables };

  if (!(script && script.hasAttribute("data-manual"))) {
    // Deferred a tick so a module that imports this file and calls init(mermaid) wins.
    var start = function () {
      setTimeout(function () {
        if (!started && document.querySelector(SELECTOR)) init().catch(function (e) { console.error("owg-mermaid:", e); });
      }, 0);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  }
})();
