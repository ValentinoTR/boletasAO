"use strict";
(() => {
  const key = "ao-suite-theme", valid = value => value === "light" || value === "dark";
  const root = document.documentElement;
  let theme = root.dataset.defaultTheme === "dark" ? "dark" : "light";
  try { const saved = localStorage.getItem(key); if (valid(saved)) theme = saved; } catch {}
  try { const requested = new URL(window.location.href).searchParams.get('theme'); if (valid(requested)) { theme = requested; localStorage.setItem(key, theme); } } catch {}
  try { if (window.parent !== window && window.parent.AOTheme) theme = window.parent.AOTheme.get(); } catch {}
  function apply(value) {
    if (!valid(value)) return;
    theme = value; root.setAttribute("data-theme", value); root.style.colorScheme = value;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", value === "dark" ? "#14111b" : "#f7f6fa");
    document.querySelectorAll("[data-theme-toggle]").forEach(button => {
      const label = value === "dark" ? "Modo claro" : "Modo oscuro";
      button.textContent = (value === "dark" ? "☀ " : "☾ ") + label;
      button.setAttribute("aria-label", "Cambiar a " + label.toLowerCase());
      button.setAttribute("aria-pressed", String(value === "dark"));
    });
    document.dispatchEvent(new CustomEvent("ao-theme-change", { detail: value }));
    document.querySelectorAll("iframe").forEach(frame => { try { frame.contentWindow?.AOTheme?.apply(value); } catch {} });
    document.querySelectorAll('[data-theme-link]').forEach(link => { try { const url = new URL(link.href); url.searchParams.set('theme',value); link.href = url.href; } catch {} });
  }
  function set(value) {
    if (!valid(value)) return;
    try { if (window.parent !== window && window.parent.AOTheme) { window.parent.AOTheme.set(value); return; } } catch {}
    try { localStorage.setItem(key, value); } catch {}
    apply(value);
  }
  window.AOTheme = { get: () => theme, apply, set };
  apply(theme);
  document.addEventListener("DOMContentLoaded", () => apply(theme));
  document.addEventListener("click", event => { if (event.target.closest?.("[data-theme-toggle]")) set(theme === "dark" ? "light" : "dark"); });
  document.addEventListener("load", event => { if (event.target.tagName === "IFRAME") { try { event.target.contentWindow?.AOTheme?.apply(theme); } catch {} } }, true);
  window.addEventListener("storage", event => { if (event.key === key && valid(event.newValue)) apply(event.newValue); });
})();
