// Which pages need what. Macro data is public; user data (Track Record, Portfolio, Baskets,
// the single-asset tools) needs a login; /admin needs users.is_admin. The backend enforces
// the same split (backend/main.py) — this only decides what the UI shows and where it redirects.

export function isPublicPath(pathname) {
  return pathname === "/" || pathname === "/macro" || pathname.startsWith("/macro/");
}

export function isAdminPath(pathname) {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}
