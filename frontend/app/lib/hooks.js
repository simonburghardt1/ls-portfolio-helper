"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Calls onOutside on a mousedown outside `ref` or on Escape, while `active`. */
export function useClickOutside(ref, active, onOutside) {
  const cb = useRef(onOutside);
  useEffect(() => { cb.current = onOutside; });
  useEffect(() => {
    if (!active) return;
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) cb.current(); };
    const key = (e) => { if (e.key === "Escape") cb.current(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [ref, active]);
}

/** [ref, width] — the element's content width, kept current with a ResizeObserver. */
export function useElementWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
