import type { DesignDoc, Product } from '../types';
import type {
  AdminOverview,
  AdminUser,
  AppConfig,
  BrandSummary,
  CatalogWire,
  ProductEventType,
  Role,
  SessionUser,
} from '../types/platform';

/** The signed-in user, with role and brand memberships (`GET /api/auth/me`). */
export type User = SessionUser;

export interface Project {
  id: string;
  name: string;
  client: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  doc: DesignDoc;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

/** True when the request never reached a server (offline, or a static deploy with no API). */
export const isUnreachable = (e: unknown) => e instanceof ApiError && e.status === 0;

export interface CallOptions {
  keepalive?: boolean;
  signal?: AbortSignal;
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new ApiError(0, 'The account service isn’t running here.');
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data?.error || 'Something went wrong.', data);
  return data as T;
}

/**
 * JSON request to the Mise API. Every non-GET carries `X-Mise: 1` (the CSRF gate) and a JSON
 * body (`{}` when none is given). Errors become `ApiError` with the server's `error` message;
 * a network failure or a non-JSON answer is `status 0` (see `isUnreachable`).
 */
export async function call<T>(method: string, path: string, body?: unknown, opts: CallOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      keepalive: opts.keepalive,
      signal: opts.signal,
      headers: body !== undefined || method !== 'GET' ? { 'Content-Type': 'application/json', 'X-Mise': '1' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : method !== 'GET' ? '{}' : undefined,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'Can’t reach the server. Check your connection.');
  }
  return parse<T>(res);
}

/**
 * Raw upload (`PUT`, not multipart): the body is the file's bytes, the query names it.
 * e.g. `upload<{ file: FileWire }>('/api/files', blob, { kind: 'image', name: 'photo.jpg' })`.
 */
export async function upload<T>(path: string, file: Blob, query?: Record<string, string>): Promise<T> {
  const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : '';
  let res: Response;
  try {
    res = await fetch(path + qs, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'X-Mise': '1', 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
  } catch {
    throw new ApiError(0, 'Can’t reach the server. Check your connection.');
  }
  return parse<T>(res);
}

const enc = encodeURIComponent;

export const api = {
  // auth
  me: () => call<{ user: User | null }>('GET', '/api/auth/me'),
  signup: (name: string, email: string, password: string) => call<{ user: User }>('POST', '/api/auth/signup', { name, email, password }),
  login: (email: string, password: string) => call<{ user: User }>('POST', '/api/auth/login', { email, password }),
  logout: () => call<{ ok: true }>('POST', '/api/auth/logout'),
  updateMe: (name: string) => call<{ user: User }>('PATCH', '/api/auth/me', { name }),
  changePassword: (current: string, next: string) => call<{ ok: true }>('POST', '/api/auth/password', { current, next }),

  // projects
  listProjects: () => call<{ projects: Project[] }>('GET', '/api/projects'),
  getProject: (id: string) => call<{ project: Project }>('GET', `/api/projects/${enc(id)}`),
  createProject: (name: string, client: string, doc: DesignDoc) => call<{ project: Project }>('POST', '/api/projects', { name, client, doc }),
  saveProject: (id: string, patch: { doc?: DesignDoc; name?: string; client?: string; revision?: number; force?: boolean }, keepalive = false) =>
    call<{ project: Project }>('PUT', `/api/projects/${enc(id)}`, patch, { keepalive }),
  duplicateProject: (id: string) => call<{ project: Project }>('POST', `/api/projects/${enc(id)}/duplicate`),
  deleteProject: (id: string) => call<{ ok: true }>('DELETE', `/api/projects/${enc(id)}`),

  // config
  config: () => call<AppConfig>('GET', '/api/config'),

  // catalog
  catalog: (opts?: CallOptions) => call<CatalogWire>('GET', '/api/catalog', undefined, opts),
  catalogProduct: (id: string, working = false) =>
    call<{ product: Product }>('GET', `/api/catalog/products/${enc(id)}${working ? '?working=1' : ''}`),
  catalogBrands: () => call<{ brands: BrandSummary[] }>('GET', '/api/catalog/brands'),

  // events (first-party analytics; 204)
  event: (productId: string, type: ProductEventType, keepalive = false) =>
    call<void>('POST', '/api/events', { productId, type }, { keepalive }),

  // admin core
  adminOverview: () => call<AdminOverview>('GET', '/api/admin/overview'),
  adminUsers: (q = '') => call<{ users: AdminUser[] }>('GET', `/api/admin/users${q ? `?q=${enc(q)}` : ''}`),
  adminSetRole: (id: string, role: Role) => call<{ user: AdminUser }>('PATCH', `/api/admin/users/${enc(id)}`, { role }),
};
