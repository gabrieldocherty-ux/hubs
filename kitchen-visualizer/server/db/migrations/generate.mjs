// Package generate's migrations. Owned by package generate once the foundation lands.
// Append steps; never edit or reorder an applied one. Ids are "generate-001-name".
// A step may reference only foundation tables and this module's own tables.

/** @type {{ id: string, up: (db: import('node:sqlite').DatabaseSync) => void }[]} */
export const steps = [];
