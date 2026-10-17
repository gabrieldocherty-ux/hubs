// Every route module, in registration order. A duplicate method + path across modules
// throws at startup. Feature modules (viewer … share) are owned by their packages.

import auth from './auth.mjs';
import projects from './projects.mjs';
import config from './config.mjs';
import catalog from './catalog.mjs';
import files from './files.mjs';
import events from './events.mjs';
import admin from './admin.mjs';
import viewer from './viewer.mjs';
import brands from './brands.mjs';
import finder from './finder.mjs';
import orders from './orders.mjs';
import generate from './generate.mjs';
import share from './share.mjs';
import webhooks from './webhooks.mjs';
import billing from './billing.mjs';
import contractors from './contractors.mjs';
import account from './account.mjs';
import ops from './ops.mjs';
import adminPanel from './adminPanel.mjs';
import tenants from './tenants.mjs';
import tenantsAdmin from './tenantsAdmin.mjs';

export const ROUTE_MODULES = [auth, projects, config, catalog, files, events, admin, webhooks, viewer, brands, finder, orders, generate, share, billing, contractors, account, ops, adminPanel, tenants, tenantsAdmin];
export const ROUTE_MODULE_NAMES = [
  'auth',
  'projects',
  'config',
  'catalog',
  'files',
  'events',
  'admin',
  'webhooks',
  'viewer',
  'brands',
  'finder',
  'orders',
  'generate',
  'share',
  'billing',
  'contractors',
  'account',
  'ops',
  'admin-panel',
  'tenants',
  'tenants-admin',
];

/**
 * Modules whose routes may answer on a showroom's host (docs/handoff/tenancy.md "Isolation").
 * Every other module answers only on the sales site, so a module is safe until someone has scoped
 * its queries to rc.site.tenantId and added it here. A route can still say `hosts` itself.
 */
export const SHOWROOM_MODULES = new Set(['auth', 'projects', 'config', 'catalog', 'files', 'events', 'share', 'account', 'ops', 'tenants', 'tenants-admin']);

/** The default `hosts` for a module's routes: 'any' for SHOWROOM_MODULES, else 'sales'. */
export const moduleHosts = (name) => (SHOWROOM_MODULES.has(name) ? 'any' : 'sales');
