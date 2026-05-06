import type { ApiResponse } from "@/types/api";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

// Token accessors — set by auth store on the client
let _accessToken: string | null = null;
let _refreshToken: string | null = null;
let _refreshing: Promise<string | null> | null = null;

export function setAccessToken(token: string | null) {
  _accessToken = token;
}

export function setRefreshToken(token: string | null) {
  _refreshToken = token;
}

async function refreshAccessToken(): Promise<string | null> {
  try {
    if (!_refreshToken) return null;

    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: _refreshToken }),
      credentials: "include",
    });
    if (!res.ok) return null;
    const body: ApiResponse<{ access_token: string; refresh_token: string }> = await res.json();
    if (body.success && body.data) {
      _accessToken = body.data.access_token;
      _refreshToken = body.data.refresh_token;
      return body.data.access_token;
    }
    return null;
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  retry = true
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (_accessToken) headers["Authorization"] = `Bearer ${_accessToken}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  // Silently refresh on 401 and retry once
  if (res.status === 401 && retry) {
    if (!_refreshing) _refreshing = refreshAccessToken().finally(() => (_refreshing = null));
    const newToken = await _refreshing;
    if (newToken) return request<T>(path, init, false);
    // Refresh failed — clear auth and let caller handle it
    _accessToken = null;
  }

  return res.json() as Promise<ApiResponse<T>>;
}

// ── Convenience methods ────────────────────────────────────────────

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),

  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// ── Domain helpers ─────────────────────────────────────────────────

export const authApi = {
  login:   (email: string, password: string) =>
    api.post<import("@/types/api").AuthData>("/auth/login", { email, password }),
  register: (name: string, email: string, password: string) =>
    api.post<import("@/types/api").AuthData>("/auth/register", { name, email, password }),
  logout:  () => api.post("/auth/logout", { refresh_token: _refreshToken }),
  refresh: () => refreshAccessToken(),
};

export const userApi = {
  me: () => api.get<import("@/types/api").User>("/users/me"),
  update: (name?: string, password?: string) =>
    api.patch<import("@/types/api").User>("/users/me", { name, password }),
  deactivate: () => api.delete("/users/me"),
};

export const jobsApi = {
  list: (page = 1, limit = 10, status?: string) =>
    api.get<import("@/types/api").PaginatedResponse<import("@/types/api").JobListItem>>(
      `/jobs/?page=${page}&limit=${limit}${status ? `&status=${status}` : ""}`
    ),
  get:    (id: string) => api.get<import("@/types/api").Job>(`/jobs/${id}`),
  create: (body: import("@/types/api").CreateJobRequest) =>
    api.post<import("@/types/api").Job>("/jobs/", body),
  cancel: (id: string) => api.delete<import("@/types/api").Job>(`/jobs/${id}`),
  events: (id: string) =>
    api.get<import("@/types/api").JobEvent[]>(`/jobs/${id}/events`),
  download: async (id: string, filename: string) => {
    const headers: Record<string, string> = {
      ...(typeof _accessToken === 'string' ? { "Authorization": `Bearer ${_accessToken}` } : {}),
    };
    const res = await fetch(`${BASE_URL}/jobs/${id}/output`, {
      headers,
      credentials: "include",
    });
    if (!res.ok) throw new Error("Download failed");
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },
};

export const creditsApi = {
  balance:      () => api.get<import("@/types/api").CreditBalance>("/credits/balance"),
  transactions: () =>
    api.get<import("@/types/api").CreditTransaction[]>("/credits/transactions"),
};

export const adminApi = {
  listSettings:  () =>
    api.get<import("@/types/api").CreditSetting[]>("/admin/credit-settings"),
  updateSetting: (key: string, value: string) =>
    api.patch<import("@/types/api").CreditSetting>(`/admin/credit-settings/${key}`, { value }),
};
