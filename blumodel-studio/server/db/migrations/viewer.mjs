// Package A (viewer) migrations: intentionally none. The viewer stores nothing of its own; the
// product, file and event tables it reads are the foundation's (platform-001).
// If it ever needs a table: append steps, never edit or reorder an applied one; ids are
// "viewer-001-name", and a step may reference only foundation tables and this module's own.

/** @type {{ id: string, up: (db: import('node:sqlite').DatabaseSync) => void }[]} */
export const steps = [];
