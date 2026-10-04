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

export function createBrandService({ db, files }) {
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
      createdBy: r.created_by ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };

  const svc = {
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
      return db.prepare("SELECT * FROM brands WHERE status = 'active' ORDER BY name COLLATE NOCASE").all().map(toRow);
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
