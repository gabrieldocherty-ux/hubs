/** The company workspace's tabs (`#/studio/<tab>`), in order. */
export type WorkspaceTab = 'showroom' | 'products' | 'leads' | 'renders' | 'team' | 'plan';

export const TABS: [WorkspaceTab, string][] = [
  ['showroom', 'Showroom'],
  ['products', 'Products'],
  ['leads', 'Potential customers'],
  ['renders', 'Renders'],
  ['team', 'Team'],
  ['plan', 'Plan'],
];

/** `#/studio/<tab>/<rest>` → the tab ('' is the Showroom tab) and what follows it. */
export function tabOf(rest: string): { tab: WorkspaceTab | null; sub: string } {
  const [first = '', ...more] = rest.split('/');
  if (!first) return { tab: 'showroom', sub: '' };
  const tab = TABS.find(([k]) => k === first)?.[0] ?? null;
  return { tab, sub: more.join('/') };
}
