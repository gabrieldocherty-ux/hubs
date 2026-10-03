import type { DesignDoc } from '../types';

export interface User {
  id: string;
  email: string;
  name: string;
}

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

async function call<T>(method: string, path: string, body?: unknown, opts: { keepalive?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      keepalive: opts.keepalive,
      headers: body !== undefined || method !== 'GET' ? { 'Content-Type': 'application/json', 'X-Mise': '1' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : method !== 'GET' ? '{}' : undefined,
    });
  } catch {
    throw new ApiError(0, 'Can’t reach the server. Check your connection.');
  }
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new ApiError(0, 'The account service isn’t running here.');
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data?.error || 'Something went wrong.', data);
  return data as T;
}

export const api = {
  me: () => call<{ user: User | null }>('GET', '/api/auth/me'),
  signup: (name: string, email: string, password: string) => call<{ user: User }>('POST', '/api/auth/signup', { name, email, password }),
  login: (email: string, password: string) => call<{ user: User }>('POST', '/api/auth/login', { email, password }),
  logout: () => call<{ ok: true }>('POST', '/api/auth/logout'),
  updateMe: (name: string) => call<{ user: User }>('PATCH', '/api/auth/me', { name }),
  changePassword: (current: string, next: string) => call<{ ok: true }>('POST', '/api/auth/password', { current, next }),
  listProjects: () => call<{ projects: Project[] }>('GET', '/api/projects'),
  getProject: (id: string) => call<{ project: Project }>('GET', `/api/projects/${id}`),
  createProject: (name: string, client: string, doc: DesignDoc) => call<{ project: Project }>('POST', '/api/projects', { name, client, doc }),
  saveProject: (id: string, patch: { doc?: DesignDoc; name?: string; client?: string; revision?: number; force?: boolean }, keepalive = false) =>
    call<{ project: Project }>('PUT', `/api/projects/${id}`, patch, { keepalive }),
  duplicateProject: (id: string) => call<{ project: Project }>('POST', `/api/projects/${id}/duplicate`),
  deleteProject: (id: string) => call<{ ok: true }>('DELETE', `/api/projects/${id}`),
};
