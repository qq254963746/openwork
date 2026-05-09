/**
 * Shared HTML / SVG iframe srcDoc builder for workspace-style previews (session workspace panel + transcript file cards).
 */

/**
 * Injected into iframe srcDoc: matches app scrollbars (index.css + ScrollbarOnScrollReveal),
 * slightly narrower (6px) thumbs, hidden until scroll then fade like the shell.
 */
export const WEB_PREVIEW_SCROLLBAR_HEAD_INJECTION = `<meta charset="utf-8" />
<style>
  :root {
    --ow-scrollbar-thumb: rgba(140, 148, 158, 0.42);
    --ow-scrollbar-thumb-hover: rgba(120, 128, 138, 0.58);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ow-scrollbar-thumb: rgba(170, 178, 188, 0.38);
      --ow-scrollbar-thumb-hover: rgba(190, 198, 208, 0.52);
    }
  }
  * {
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
  }
  *.ow-scrollbar-scrolling {
    scrollbar-color: var(--ow-scrollbar-thumb) transparent;
  }
  *::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  *::-webkit-scrollbar-track {
    background: transparent;
  }
  *::-webkit-scrollbar-thumb {
    background-color: transparent;
    border-radius: 100px;
  }
  *.ow-scrollbar-scrolling::-webkit-scrollbar-thumb {
    background-color: var(--ow-scrollbar-thumb);
  }
  *.ow-scrollbar-scrolling::-webkit-scrollbar-thumb:hover {
    background-color: var(--ow-scrollbar-thumb-hover);
  }
</style>
<script>
(function () {
  var HIDE_MS = 900;
  var CLASS = "ow-scrollbar-scrolling";
  var timers = new WeakMap();
  function pulse(el) {
    if (!el || !el.classList) return;
    el.classList.add(CLASS);
    var p = timers.get(el);
    if (p !== undefined) clearTimeout(p);
    var id = setTimeout(function () {
      el.classList.remove(CLASS);
      timers.delete(el);
    }, HIDE_MS);
    timers.set(el, id);
  }
  function onScroll(e) {
    var t = e.target;
    if (t === document || t === document.documentElement) {
      pulse(document.documentElement);
      return;
    }
    if (t && t.classList) pulse(t);
  }
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
})();
</script>`;

export function buildWebPreviewSrcDoc(raw: string): string {
  const inject = WEB_PREVIEW_SCROLLBAR_HEAD_INJECTION;
  const t = raw.trim();
  if (!t) {
    return `<!DOCTYPE html><html><head>${inject}</head><body></body></html>`;
  }
  if (/^<\?xml/i.test(t) || /^<svg/i.test(t)) {
    return `<!DOCTYPE html><html><head>${inject}</head><body style="margin:0;min-height:100vh;overflow:auto">${t}</body></html>`;
  }
  if (/<head[\s>]/i.test(t)) {
    return t.replace(/<head([^>]*)>/i, `<head$1>${inject}`);
  }
  if (/<html[\s>]/i.test(t)) {
    return t.replace(/<html([^>]*)>/i, `<html$1><head>${inject}</head>`);
  }
  return `<!DOCTYPE html><html><head>${inject}</head><body style="margin:0;min-height:100vh;overflow:auto">${t}</body></html>`;
}
