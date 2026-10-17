import { navigate } from '../../lib/router';

/**
 * Opening one account from another tab (Overview's recent sign-ups, Contractors, Audit): the id is
 * handed to Admin > Users, which opens it once and forgets it.
 */
let pending: string | null = null;

export function openUser(id: string) {
  pending = id;
  navigate({ name: 'admin', tab: 'users' });
}

export function takePendingUser(): string | null {
  const id = pending;
  pending = null;
  return id;
}

/** The same for one company: Overview hands its id to Admin > Companies. */
let pendingCompany: string | null = null;

export function openCompany(id: string) {
  pendingCompany = id;
  navigate({ name: 'admin', tab: 'companies' });
}

export function takePendingCompany(): string | null {
  const id = pendingCompany;
  pendingCompany = null;
  return id;
}
