const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

function getToken() {
  if (typeof window === "undefined") return null;
  // Token lives inside the zustand-persisted "auth" store (see app/store/authStore.js),
  // not a bare "token" key.
  try {
    return JSON.parse(localStorage.getItem("auth"))?.state?.token ?? null;
  } catch {
    return null;
  }
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Request failed" }));

    // A 401 here means the stored token is missing/expired/invalid — the global
    // route guard (useRequireAuth) only checks that a token is *present*, not that
    // the backend still accepts it, so a stale token otherwise surfaces as a raw
    // "Invalid token" with no way forward. Clear it and send the user to sign in
    // again instead of leaving every page to handle this individually.
    if (res.status === 401 && typeof window !== "undefined") {
      try { localStorage.removeItem("auth"); } catch {}
      window.location.href = "/login?expired=1";
    }

    // Some endpoints (e.g. ticker disambiguation, 409) return a structured `detail` object
    // rather than a string — preserve it (and the status) so callers can branch on it
    // instead of just showing `.message` as a plain error banner.
    const message = typeof error.detail === "string" ? error.detail : "Request failed";
    const err = new Error(message);
    err.status = res.status;
    err.detail = error.detail;
    throw err;
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: "DELETE" }),
};
