import { createContext, useContext } from 'react';
import type { MemberRole, StaffTenant } from './api';

export interface Workspace {
  tenant: StaffTenant;
  role: MemberRole;
  /** True for an owner: settings, the team and the card are theirs. */
  owner: boolean;
  /** Replaces the tenant after a save (the server's answer). */
  setTenant: (t: StaffTenant) => void;
  /** Re-reads the showroom. */
  refresh: () => Promise<void>;
  /** Re-reads the unread-leads badge. */
  refreshBadge: () => void;
}

export const WorkspaceContext = createContext<Workspace | null>(null);

/** The company workspace's showroom and role, for its tabs. */
export function useWorkspace(): Workspace {
  const w = useContext(WorkspaceContext);
  if (!w) throw new Error('useWorkspace outside the company workspace');
  return w;
}
