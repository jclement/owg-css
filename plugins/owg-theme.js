/*! owg-theme.js | owg-css | MIT. Load in <head> (no defer) so the saved choice lands before paint.
  owgTheme.set('auto'|'light'|'dark'), owgTheme.variant('slate'|null), owgTheme.get().
  Wires [data-theme-set], [data-variant-set], select[data-variant-select]; Esc / click-outside close the sidebar drawer. */
(function (w, d) {
  var root = d.documentElement, T = "owg-theme", V = "owg-variant";
  function load(k) { try { return w.localStorage.getItem(k); } catch (e) { return null; } }
  function save(k, v) { try { w.localStorage.setItem(k, v); } catch (e) {} }
  function attr(n, v) { if (v) root.setAttribute(n, v); else root.removeAttribute(n); }
  function get() { return { theme: root.getAttribute("data-theme") || "auto", variant: root.getAttribute("data-variant") || "" }; }
  function sync() {
    var s = get(), i, el, q = d.querySelectorAll("[data-theme-set],[data-variant-set],select[data-variant-select]");
    for (i = 0; i < q.length; i++) {
      el = q[i];
      if (el.tagName === "SELECT") el.value = s.variant;
      else if (el.hasAttribute("data-theme-set")) el.setAttribute("aria-pressed", el.getAttribute("data-theme-set") === s.theme);
      else el.setAttribute("aria-pressed", el.getAttribute("data-variant-set") === s.variant);
    }
    d.dispatchEvent(new CustomEvent("owg:theme", { detail: s }));
  }
  function set(t) { t = t === "light" || t === "dark" ? t : "auto"; attr("data-theme", t === "auto" ? "" : t); save(T, t); sync(); }
  function variant(v) { v = v && v !== "default" ? v : ""; attr("data-variant", v); save(V, v || "default"); sync(); }

  // Before paint: only a saved choice overrides what the HTML ships with.
  var t = load(T), v = load(V);
  if (t) attr("data-theme", t === "auto" ? "" : t);
  if (v) attr("data-variant", v === "default" ? "" : v);

  function drawer() { var a = d.querySelector("body > aside"); return a && a.matches(":target") ? a : null; }
  function close() { var y = w.scrollY; w.location.replace("#_"); history.replaceState(null, "", location.pathname + location.search); w.scrollTo(0, y); }

  d.addEventListener("click", function (e) {
    var el = e.target.closest && e.target.closest("[data-theme-set],[data-variant-set],.sidebar-close,.sidebar-toggle");
    if (el && el.hasAttribute("data-theme-set")) set(el.getAttribute("data-theme-set"));
    else if (el && el.hasAttribute("data-variant-set")) variant(el.getAttribute("data-variant-set"));
    else if (el && el.classList.contains("sidebar-close")) { e.preventDefault(); close(); }
    else if (!el && drawer() && !e.target.closest("body > aside")) close();
  });
  d.addEventListener("change", function (e) { if (e.target.matches("select[data-variant-select]")) variant(e.target.value); });
  d.addEventListener("keydown", function (e) { if (e.key === "Escape" && drawer()) close(); });
  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", sync); else sync();

  w.owgTheme = { set: set, variant: variant, get: get };
})(window, document);
