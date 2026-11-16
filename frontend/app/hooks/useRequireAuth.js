"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/app/store/authStore";
import { isAdminPath, isPublicPath } from "@/app/lib/access";

/**
 * Route guard for the (app) layout. Public pages (macro) render without a login; every other
 * page redirects to /login when there is no token; /admin pages redirect non-admins to /.
 * `allowed` tells the layout whether to render the page at all.
 */
export function useRequireAuth() {
  const router = useRouter();
  const pathname = usePathname();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);

  const publicPage = isPublicPath(pathname);
  const adminPage = isAdminPath(pathname);
  const allowed = publicPage || (!!token && (!adminPage || !!user?.is_admin));
  // A session stored before is_admin existed has no flag yet — wait for the layout's /me
  // refresh instead of bouncing an actual admin off the page.
  const pending = adminPage && !!token && user?.is_admin === undefined;

  useEffect(() => {
    if (!hasHydrated || allowed || pending) return;
    router.replace(token ? "/" : `/login?next=${encodeURIComponent(pathname)}`);
  }, [hasHydrated, allowed, pending, token, pathname, router]);

  return { token, user, isAuthenticated: !!token, hasHydrated, allowed };
}
