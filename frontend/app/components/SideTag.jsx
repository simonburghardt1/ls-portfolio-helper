"use client";

import Badge from "@/app/components/Badge";

/** LONG / SHORT tag; clickable (flips the side) when onToggle is given. */
export default function SideTag({ side, onToggle }) {
  const long = side === "long";
  return (
    <Badge variant={long ? "positive" : "negative"} interactive={Boolean(onToggle)} onClick={onToggle} style={{ whiteSpace: "nowrap" }}>
      {long ? "LONG" : "SHORT"}
    </Badge>
  );
}
