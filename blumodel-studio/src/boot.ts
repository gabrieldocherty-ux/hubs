// Imported first by main.tsx, so it runs before any store or screen reads browser storage
// (zustand's persist reads its key when the store module is evaluated).
import { migrateBrowserStorage } from './lib/legacyStorage';

migrateBrowserStorage();
