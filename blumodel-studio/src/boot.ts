// Imported first by main.tsx, so it runs before any store or screen reads browser storage
// (zustand's persist reads its key when the store module is evaluated).
import { migrateBrowserStorage } from './lib/legacyStorage';
import { pathToHashUrl } from './lib/router';

migrateBrowserStorage();

// `/terms` → `/#/terms` (and an unknown path → the 404) before the router reads the address.
const to = typeof location !== 'undefined' ? pathToHashUrl(location.pathname, location.search, location.hash) : null;
if (to) history.replaceState(null, '', to);
