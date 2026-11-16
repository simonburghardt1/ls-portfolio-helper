"use client";

import { useState } from "react";
import { authFetch } from "@/app/lib/api";
import Badge from "@/app/components/Badge";

export const API = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

// ── Formatting ─────────────────────────────────────────────────────────────────

export function fmtUsd(v, { sign = false, dp = 0 } = {}) {
  if (v == null || Number.isNaN(v)) return "—";
  const s = sign && v > 0 ? "+" : v < 0 ? "−" : "";
  return `${s}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

export function fmtEur(v, { sign = false } = {}) {
  if (v == null || Number.isNaN(v)) return "—";
  const s = sign && v > 0 ? "+" : v < 0 ? "−" : "";
  return `${s}€${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** 12345 → "$12.3K", 1234567 → "$1.23M" */
export function fmtCompact(v, currency = "$", { sign = false } = {}) {
  if (v == null || Number.isNaN(v)) return "—";
  const a = Math.abs(v);
  const s = sign && v > 0 ? "+" : v < 0 ? "−" : "";
  const body = a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(0);
  return `${s}${currency}${body}`;
}

/** Plain percent value (already ×100, as the track-record API returns it) */
export function fmtPctPoints(v, dp = 2, { sign = true } = {}) {
  if (v == null || Number.isNaN(v)) return "—";
  return `${sign && v > 0 ? "+" : ""}${v.toFixed(dp)}%`;
}

export function fmtPrice(v) {
  if (v == null || v === "" || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 });
}

export function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export function tradingDays(start, end) {
  let n = 0;
  const d = new Date(start), e = new Date(end);
  while (d < e) { const w = d.getDay(); if (w && w < 6) n++; d.setDate(d.getDate() + 1); }
  return n;
}

// ── Small pieces ───────────────────────────────────────────────────────────────

export const MONO = { fontFamily: "var(--font-family-mono)" };

export function SideTag({ side, onToggle }) {
  const long = side === "long";
  return (
    <Badge variant={long ? "positive" : "negative"} interactive={Boolean(onToggle)} onClick={onToggle} style={{ whiteSpace: "nowrap" }}>
      {long ? "LONG" : "SHORT"}
    </Badge>
  );
}

/** Text/number/date input used inside table rows in edit mode. */
export function CellInput({ value, onChange, type = "text", width = 80, align = "left", mono = false, upper = false, autoFocus, onBlur, placeholder }) {
  return (
    <input
      type={type}
      value={value ?? ""}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(e) => onChange(upper ? e.target.value.toUpperCase() : e.target.value)}
      onBlur={onBlur}
      onClick={(e) => e.stopPropagation()}
      style={{
        width, padding: "4px 6px", fontSize: 12, textAlign: align,
        background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)",
        color: "var(--text-primary)", outline: "none", colorScheme: "dark",
        fontFamily: mono ? "var(--font-family-mono)" : "var(--font-family-sans)",
        fontVariantNumeric: "tabular-nums",
        textTransform: upper ? "uppercase" : "none",
      }}
    />
  );
}

export function IconButton({ children, onClick, title, tone = "default" }) {
  const color = tone === "danger" ? "var(--negative)" : tone === "ok" ? "var(--positive)" : "var(--text-secondary)";
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{ background: "transparent", border: "1px solid var(--border)", color, cursor: "pointer", fontSize: 12, lineHeight: 1, padding: "4px 7px" }}
    >
      {children}
    </button>
  );
}

/** Edit-mode action cell: save / cancel / delete */
export function EditActions({ onSave, onCancel, onDelete, saving }) {
  return (
    <span style={{ display: "inline-flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
      <IconButton title="Save (Enter)" tone="ok" onClick={onSave}>{saving ? "…" : "✓"}</IconButton>
      <IconButton title="Discard changes (Esc)" onClick={onCancel}>✕</IconButton>
      <IconButton title="Delete" tone="danger" onClick={onDelete}>Delete</IconButton>
    </span>
  );
}

// ── Row editing ────────────────────────────────────────────────────────────────

/**
 * One row at a time is editable. start(row) opens it (saving a pending edit of another row
 * first), set(field, value) edits the draft, save() persists via saveFn(draft), cancel()
 * discards. keyDown handles Enter / Esc on the table wrapper.
 */
export function useRowEditor(saveFn) {
  const [draft, setDraft] = useState(null);
  const [original, setOriginal] = useState(null);
  const [saving, setSaving] = useState(false);

  const dirty = draft && original && JSON.stringify(draft) !== JSON.stringify(original);

  async function save() {
    if (!draft) return;
    if (dirty) {
      setSaving(true);
      try { await saveFn(draft); } finally { setSaving(false); }
    }
    setDraft(null); setOriginal(null);
  }

  async function start(row) {
    if (draft?.id === row.id) return;
    if (dirty) await saveFn(draft);
    setDraft({ ...row }); setOriginal({ ...row });
  }

  function cancel() { setDraft(null); setOriginal(null); }
  function set(field, value) { setDraft((d) => ({ ...d, [field]: value })); }
  function keyDown(e) {
    if (!draft) return;
    if (e.key === "Enter") { e.preventDefault(); save(); }
    if (e.key === "Escape") cancel();
  }

  return { draft, editingId: draft?.id ?? null, saving, start, save, cancel, set, setDraft, keyDown };
}

/** Company name (and current price) for a ticker — used after the ticker is edited. */
export async function lookupTicker(ticker) {
  if (!ticker || ticker === "NEW") return null;
  try {
    const res = await authFetch(`${API}/api/track-record/ticker-info/${encodeURIComponent(ticker)}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
