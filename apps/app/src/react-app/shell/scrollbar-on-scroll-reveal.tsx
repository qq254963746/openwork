/** @jsxImportSource react */
import { useEffect } from "react";

const SCROLLING_CLASS = "ow-scrollbar-scrolling";
const HIDE_AFTER_MS = 900;

/**
 * Marks whichever element is actively scrolling so global CSS can show a light
 * scrollbar thumb briefly (see index.css). Default state keeps thumbs hidden.
 */
export function ScrollbarOnScrollReveal() {
  useEffect(() => {
    const timers = new WeakMap<Element, number>();

    const pulse = (el: Element) => {
      el.classList.add(SCROLLING_CLASS);
      const prev = timers.get(el);
      if (prev !== undefined) window.clearTimeout(prev);
      const id = window.setTimeout(() => {
        el.classList.remove(SCROLLING_CLASS);
        timers.delete(el);
      }, HIDE_AFTER_MS);
      timers.set(el, id);
    };

    const onScroll = (event: Event) => {
      const t = event.target;
      if (t === document || t === document.documentElement) {
        pulse(document.documentElement);
        return;
      }
      if (t instanceof Element) pulse(t);
    };

    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, []);

  return null;
}
