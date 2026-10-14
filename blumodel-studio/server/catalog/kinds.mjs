// The closed vocabulary of product kinds, categories and material kinds, shared with
// the client through src/data/kinds.json (deploy-local ships that file alongside server/).

import data from '../../src/data/kinds.json' with { type: 'json' };

export const KINDS = Object.freeze([...data.kinds]);
export const KIND_SET = new Set(KINDS);
export const CATEGORIES = Object.freeze(data.categories.map((c) => Object.freeze({ ...c })));
export const CATEGORY_SET = new Set(CATEGORIES.map((c) => c.id));
export const MATERIAL_KINDS = Object.freeze([...data.materialKinds]);
export const MATERIAL_SET = new Set(MATERIAL_KINDS);
export const KIND_CATEGORY = Object.freeze({ ...data.kindCategory });
export const VARIANTS = Object.freeze(Object.fromEntries(Object.entries(data.variants).map(([k, v]) => [k, Object.freeze([...v])])));
