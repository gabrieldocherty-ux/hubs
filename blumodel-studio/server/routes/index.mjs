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
import orders from './orders.mjs';
import generate from './generate.mjs';
import share from './share.mjs';
import webhooks from './webhooks.mjs';
import billing from './billing.mjs';
import contractors from './contractors.mjs';

export const ROUTE_MODULES = [auth, projects, config, catalog, files, events, admin, webhooks, viewer, brands, orders, generate, share, billing, contractors];
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
  'orders',
  'generate',
  'share',
  'billing',
  'contractors',
];
