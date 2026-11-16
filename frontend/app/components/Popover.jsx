"use client";

import { useRef, useState } from "react";
import { useClickOutside } from "@/app/lib/hooks";
import styles from "./Popover.module.css";

/**
 * Click-to-open floating panel anchored under its trigger. Closes on outside click / Escape.
 *
 *   <Popover trigger={(toggle) => <Button onClick={toggle}>⋯</Button>} align="right" width={180}>
 *     {(close) => <MenuItem onClick={() => { close(); doIt(); }}>Do it</MenuItem>}
 *   </Popover>
 *
 * Props:
 *   trigger(toggle, open): renders the anchor element
 *   children: node, or (close) => node
 *   align: "left" | "right" — which edge of the trigger the panel lines up with
 *   width, maxHeight: optional panel sizing
 *   padded: true → 12px inner padding (for non-menu content, e.g. a picker grid)
 */
export default function Popover({ trigger, children, align = "left", width, maxHeight, padded = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, open, () => setOpen(false));
  const close = () => setOpen(false);

  return (
    <div ref={ref} className={styles.anchor}>
      {trigger(() => setOpen((o) => !o), open)}
      {open && (
        <div
          className={`${styles.panel} ${align === "right" ? styles.right : styles.left}`}
          style={{ width, maxHeight, overflowY: maxHeight ? "auto" : undefined, padding: padded ? "var(--space-3)" : undefined }}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onClick, danger, disabled, children }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${styles.item} ${danger ? styles.danger : ""}`}>
      {children}
    </button>
  );
}

export function MenuDivider() {
  return <div className={styles.divider} />;
}

export function MenuGroupTitle({ children }) {
  return <div className={styles.groupTitle}>{children}</div>;
}
