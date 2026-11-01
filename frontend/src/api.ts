import type { AppSettings, Item } from './types'

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.detail ?? detail
    } catch {
      // keine JSON-Fehlermeldung - statusText reicht dann
    }
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export { ApiError }

export const auth = {
  login: (username: string, password: string) =>
    request<{ username: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ status: string }>('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ username: string }>('/api/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ status: string }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    }),
}

export interface ListItemsParams {
  status?: string
  search?: string
  tag?: string
  performer?: string
  source?: string
  restricted?: boolean
  include_hidden?: boolean
}

function toQuery(params: Record<string, unknown>): string {
  const usp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') usp.set(key, String(value))
  }
  const qs = usp.toString()
  return qs ? `?${qs}` : ''
}

export const items = {
  list: (params: ListItemsParams = {}) =>
    request<Item[]>(`/api/items${toQuery(params as Record<string, unknown>)}`),
  get: (id: number) => request<Item>(`/api/items/${id}`),
  addLink: (url: string) => request<Item>('/api/links', { method: 'POST', body: JSON.stringify({ url }) }),
  pause: (id: number) => request<Item>(`/api/items/${id}/pause`, { method: 'POST' }),
  resume: (id: number) => request<Item>(`/api/items/${id}/resume`, { method: 'POST' }),
  restart: (id: number) => request<Item>(`/api/items/${id}/restart`, { method: 'POST' }),
  start: (id: number) => request<Item>(`/api/items/${id}/start`, { method: 'POST' }),
  setTags: (id: number, tags: string[]) =>
    request<Item>(`/api/items/${id}/tags`, { method: 'PUT', body: JSON.stringify({ tags }) }),
  setPerformers: (id: number, performers: string[]) =>
    request<Item>(`/api/items/${id}/performers`, {
      method: 'PUT',
      body: JSON.stringify({ performers }),
    }),
  setRestrictedOverride: (id: number, override: boolean | null) =>
    request<Item>(`/api/items/${id}/restricted-override`, {
      method: 'PATCH',
      body: JSON.stringify({ override }),
    }),
}

export const catalog = {
  tags: () => request<string[]>('/api/tags'),
  performers: () => request<string[]>('/api/performers'),
}

export const downloads = {
  cleanup: () => request<{ removed: number }>('/api/downloads/cleanup', { method: 'POST' }),
}

export const settings = {
  get: () => request<AppSettings>('/api/settings'),
  patch: (body: Partial<AppSettings>) =>
    request<AppSettings>('/api/settings', { method: 'PATCH', body: JSON.stringify(body) }),
  getDownloadsRoot: () => request<{ subpath: string; resolved_path: string }>('/api/settings/downloads-root'),
  setDownloadsRoot: (subpath: string) =>
    request<{ subpath: string; resolved_path: string }>('/api/settings/downloads-root', {
      method: 'PUT',
      body: JSON.stringify({ subpath }),
    }),
  listRestrictedDomains: () => request<string[]>('/api/settings/restricted-domains'),
  addRestrictedDomain: (domain: string) =>
    request<string[]>('/api/settings/restricted-domains', {
      method: 'POST',
      body: JSON.stringify({ domain }),
    }),
  removeRestrictedDomain: (domain: string) =>
    request<string[]>(`/api/settings/restricted-domains/${encodeURIComponent(domain)}`, {
      method: 'DELETE',
    }),
  getRestrictedThreshold: () => request<{ threshold: number }>('/api/settings/restricted-threshold'),
  setRestrictedThreshold: (threshold: number) =>
    request<{ threshold: number }>('/api/settings/restricted-threshold', {
      method: 'PUT',
      body: JSON.stringify({ threshold }),
    }),
}

export interface ApiTokenInfo {
  id: number
  label: string
  created_at: string
}

export const apiTokens = {
  list: () => request<ApiTokenInfo[]>('/api/settings/api-tokens'),
  create: (label: string) =>
    request<ApiTokenInfo & { token: string }>('/api/settings/api-tokens', {
      method: 'POST',
      body: JSON.stringify({ label }),
    }),
  remove: (id: number) => request<{ status: string }>(`/api/settings/api-tokens/${id}`, { method: 'DELETE' }),
}
