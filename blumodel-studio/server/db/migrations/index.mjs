// Migration modules in the order they run. Each exports `steps = [{ id, up(db) }]`.
// Foundation tables come first; feature modules may reference only foundation tables
// and their own. See BUILD_PLAN §3.3.

import * as core from './core.mjs';
import * as platform from './platform.mjs';
import * as viewer from './viewer.mjs';
import * as brands from './brands.mjs';
import * as orders from './orders.mjs';
import * as generate from './generate.mjs';
import * as share from './share.mjs';
import * as billing from './billing.mjs';
import * as contractors from './contractors.mjs';

export const MIGRATION_MODULES = [core, platform, viewer, brands, orders, generate, share, billing, contractors];
export const MIGRATION_KEYS = ['core', 'platform', 'viewer', 'brands', 'orders', 'generate', 'share', 'billing', 'contractors'];
