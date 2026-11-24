"use client";

import { useState } from "react";
import StateMessage from "@/app/components/StateMessage";
import styles from "./DataTable.module.css";

/**
 * The one table component. Columns are configuration; cells get consistent typography
 * (numeric columns right-aligned in the mono face), hover, borders and sticky behaviour.
 *
 * columns: [{
 *   key:        unique column key (also the default field read from each row)
 *   label:      header text/node
 *   numeric:    true → right-aligned, mono face (and the default for sorting by value)
 *   align:      "left" | "right" | "center" (overrides numeric's right alignment)
 *   width:      CSS width for the column
 *   value(row): raw value (default row[key]) — used by format/color/cellStyle/sort
 *   format(v, row): display string (default: the value as is, "—" for null)
 *   color(v, row):  text colour (e.g. signColor)
 *   cellStyle(v, row): extra cell style (heatmaps: { background })
 *   render(row): full custom cell content (inputs, tags) — bypasses format/color
 *   sortable:   header click sorts by value (desc → asc → original order)
 *   title:      header tooltip
 *   divider:    vertical line before this column (e.g. a totals column)
 * }]
 * rows:          array of row objects
 * rowKey:        field name or (row) => key
 * footerRows:    rows rendered after the body in the footer style (totals, averages);
 *                set row.__strong = true for a bold total row
 * onRowClick:    (row) => void — makes rows clickable
 * isRowClickable: (row) => bool — limit which rows react to onRowClick (default all)
 * isRowSelected: (row) => bool — subtle highlight
 * dense:         compact matrix/heatmap density (no row borders)
 * stickyHeader / stickyFirstColumn: for long / wide tables (set maxHeight for the former)
 * maxHeight:     scroll container height
 * autoWidth:     table only as wide as its content (small tables)
 * inset:         16px padding on the outer columns — for a table in a `flush` Panel
 * empty:         message when rows is empty (default "No rows.")
 * defaultSort:   { key, dir: "asc" | "desc" }
 * groupBy:       (row) => group key — rows are shown in groups (in order of first appearance),
 *                each under a full-width header row; sorting applies within each group
 * groupHeader:   (key, rows) => node for a group's header row (default: the key)
 */
export default function DataTable({
  columns, rows, rowKey = "id", footerRows, onRowClick, isRowClickable, isRowSelected,
  inset = false, dense = false, stickyHeader = false, stickyFirstColumn = false, maxHeight, autoWidth = false,
  empty = "No rows.", defaultSort = null, groupBy, groupHeader,
}) {
  const [sort, setSort] = useState(defaultSort);

  const valueOf = (col, row) => (col.value ? col.value(row) : row[col.key]);
  const keyOf = (row, i) => (typeof rowKey === "function" ? rowKey(row) : row[rowKey] ?? i);

  let body = rows ?? [];
  if (sort) {
    const col = columns.find((c) => c.key === sort.key);
    if (col) {
      const dir = sort.dir === "asc" ? 1 : -1;
      body = [...body].sort((a, b) => {
        const va = valueOf(col, a), vb = valueOf(col, b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1; // nulls last either way
        if (vb == null) return -1;
        return (typeof va === "string" ? va.localeCompare(vb) : va - vb) * dir;
      });
    }
  }

  function clickHeader(col) {
    if (!col.sortable) return;
    setSort((s) => (s?.key !== col.key ? { key: col.key, dir: "desc" } : s.dir === "desc" ? { key: col.key, dir: "asc" } : null));
  }

  const alignClass = (col) =>
    col.align === "center" ? styles.center : col.align === "left" ? "" : col.align === "right" || col.numeric ? styles.right : "";

  function cell(col, row, i) {
    const v = valueOf(col, row);
    const style = { ...(col.cellStyle?.(v, row) ?? {}), ...(col.color ? { color: col.color(v, row) } : {}) };
    const cls = [styles.td, col.numeric && !col.render ? styles.num : "", alignClass(col), col.cellStyle ? styles.heat : "", col.divider ? styles.divider : ""].join(" ");
    let content;
    if (col.render) content = col.render(row);
    else if (col.format) content = col.format(v, row);
    else content = v == null || v === "" ? "—" : v;
    return <td key={col.key} className={cls} style={style}>{content}</td>;
  }

  function bodyRow(row, i) {
    const clickable = onRowClick && (!isRowClickable || isRowClickable(row));
    return (
      <tr
        key={keyOf(row, i)}
        onClick={clickable ? () => onRowClick(row) : undefined}
        className={[styles.row, clickable ? styles.clickable : "", isRowSelected?.(row) ? styles.selected : ""].join(" ")}
      >
        {columns.map((col) => cell(col, row, i))}
      </tr>
    );
  }

  const tableClass = [
    styles.table, autoWidth ? styles.auto : "", dense ? styles.dense : "",
    stickyHeader ? styles.stickyHead : "", stickyFirstColumn ? styles.stickyCol : "", inset ? styles.inset : "",
  ].join(" ");

  if (!body.length && !footerRows?.length) return <StateMessage>{empty}</StateMessage>;

  return (
    <div className={styles.wrap} style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
      <table className={tableClass}>
        <thead>
          <tr>
            {columns.map((col) => {
              const sorted = sort?.key === col.key;
              return (
                <th
                  key={col.key}
                  title={col.title}
                  onClick={() => clickHeader(col)}
                  className={[styles.th, alignClass(col), col.sortable ? styles.sortable : "", sorted ? styles.sorted : "", col.divider ? styles.divider : ""].join(" ")}
                  style={col.width ? { width: col.width } : undefined}
                  aria-sort={sorted ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                >
                  {col.label}
                  {sorted && <span style={{ marginLeft: 4 }}>{sort.dir === "asc" ? "▲" : "▼"}</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {groupBy
            ? groupsOf(rows ?? [], body, groupBy).flatMap(([key, groupRows]) => [
                <tr key={`group:${key}`} className={styles.groupHead}>
                  <td colSpan={columns.length}>{groupHeader ? groupHeader(key, groupRows) : key}</td>
                </tr>,
                ...groupRows.map(bodyRow),
              ])
            : body.map(bodyRow)}
        </tbody>
        {footerRows?.length > 0 && (
          <tfoot>
            {footerRows.map((row, i) => (
              <tr key={`f${i}`} className={[styles.foot, row.__strong ? styles.footStrong : ""].join(" ")}>
                {columns.map((col) => cell(col, row, i))}
              </tr>
            ))}
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** [[groupKey, rows]] in the order groups first appear in `original`, rows in `sorted` order. */
function groupsOf(original, sorted, groupBy) {
  const order = [];
  const seen = new Set();
  for (const row of original) {
    const k = groupBy(row);
    if (!seen.has(k)) { seen.add(k); order.push(k); }
  }
  return order.map((k) => [k, sorted.filter((row) => groupBy(row) === k)]);
}
