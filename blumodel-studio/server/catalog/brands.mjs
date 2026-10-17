// Brand lookups and wire shapes (ctx.services.brands). Brand workflows (create, members,
// moderation) belong to package B; this is what everyone else needs to read a brand.

export function slugify(name) {
  return (
    String(name ?? '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '') || 'brand'
  );
}

/**
 * `hideDemo` (production): brands flagged is_demo (the seed's "… (Demo)" partners and pages) are
 * left out of every public list and the catalog, even if a demo seed was forced into the database.
 */
export function createBrandService({ db, files, hideDemo = false }) {
  const toRow = (r) =>
    r && {
      id: r.id,
      slug: r.slug,
      name: r.name,
      tagline: r.tagline,
      description: r.description,
      website: r.website,
      logoFileId: r.logo_file_id ?? null,
      status: r.status,
      statusNote: r.status_note,
      verifiedAt: r.verified_at ?? null,
      isDemo: !!r.is_demo,
      /** `contractor`: a Contractor account's brand page. `partner`: a BluModel-curated brand. */
      kind: r.kind === 'contractor' ? 'contractor' : 'partner',
      createdBy: r.created_by ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };

  const svc = {
    hideDemo: !!hideDemo,
    /** True when a brand's products and page may be shown: active, and not a demo brand in production. */
    isListed(row) {
      return !!row && row.status === 'active' && !(hideDemo && row.isDemo);
    },
    /** BrandRow (camelCase) or null. */
    get(id) {
      if (typeof id !== 'string' || !id) return null;
      return toRow(db.prepare('SELECT * FROM brands WHERE id = ?').get(id)) || null;
    },
    bySlug(slug) {
      if (typeof slug !== 'string' || !slug) return null;
      return toRow(db.prepare('SELECT * FROM brands WHERE slug = ?').get(slug)) || null;
    },
    /** Active brands, by name. */
    listActive() {
      return db
        .prepare(`SELECT * FROM brands WHERE status = 'active'${hideDemo ? ' AND is_demo = 0' : ''} ORDER BY name COLLATE NOCASE`)
        .all()
        .map(toRow);
    },
    /** A slug derived from `name` that no other brand uses (`-2`, `-3`… appended). */
    uniqueSlug(name) {
      const base = slugify(name);
      let slug = base;
      for (let i = 2; db.prepare('SELECT 1 FROM brands WHERE slug = ?').get(slug); i++) slug = `${base}-${i}`;
      return slug;
    },
    /** BrandSummary: `{ id, slug, name, tagline, logoUrl, website, verified, isDemo }`. */
    toWire(row) {
      if (!row) return null;
      const logo = row.logoFileId ? files.get(row.logoFileId) : null;
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        tagline: row.tagline,
        logoUrl: logo ? files.url(logo) : null,
        website: row.website,
        verified: row.verifiedAt != null,
        isDemo: !!row.isDemo,
      };
    },
    /** Brand (the full profile a member or admin sees): the summary plus status and timestamps. */
    toFull(row) {
      if (!row) return null;
      return {
        ...svc.toWire(row),
        description: row.description,
        status: row.status,
        statusNote: row.statusNote,
        logoFileId: row.logoFileId,
        verifiedAt: row.verifiedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },
  };
  return svc;
}
