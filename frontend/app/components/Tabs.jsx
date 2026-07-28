/**
 * Shared tab bar.
 *
 * Visual language matches the sidebar's active-nav treatment (see DESIGN.md
 * Design Notes): the selected tab gets a rounded (`--radius-nav-active`),
 * `--nav-active-surface`-filled background behind its label; unselected tabs
 * stay flat/transparent. No colored underline — this replaces the old
 * per-page underline+color pattern that had drifted inconsistently.
 *
 * Props:
 *   tabs:   [{ key, label }]
 *   active: the currently selected tab's key
 *   onChange: (key) => void
 */
export default function Tabs({ tabs = [], active, onChange }) {
    return (
        <div
            style={{
                display: "flex",
                gap: "var(--space-1)",
                marginBottom: "var(--space-5)",
                borderBottom: "1px solid var(--border)",
                paddingBottom: "var(--space-1)",
            }}
        >
            {tabs.map((t) => {
                const isActive = t.key === active;
                return (
                    <button
                        key={t.key}
                        type="button"
                        onClick={() => onChange?.(t.key)}
                        style={{
                            background: isActive ? "var(--nav-active-surface)" : "transparent",
                            border: "none",
                            borderRadius: "var(--radius-nav-active)",
                            cursor: "pointer",
                            padding: "8px 16px",
                            fontFamily: "var(--font-family-sans)",
                            fontSize: "var(--font-base)",
                            fontWeight: isActive ? 600 : 400,
                            color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                            transition: "background 0.1s ease, color 0.1s ease",
                        }}
                    >
                        {t.label}
                    </button>
                );
            })}
        </div>
    );
}
