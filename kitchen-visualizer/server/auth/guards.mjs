// Access checks shared by every route module (exposed as ctx.services.auth).

import { HttpError } from '../http/respond.mjs';

export function createAuthService({ db }) {
  const svc = {
    /** The signed-in user, or a 401. */
    requireUser(rc) {
      if (!rc.user) throw new HttpError(401, 'Please sign in.');
      return rc.user;
    },

    /** The signed-in user if their role is one of `roles`, else 401 / 403. */
    requireRole(rc, ...roles) {
      const user = svc.requireUser(rc);
      if (!roles.flat().includes(user.role)) throw new HttpError(403, 'You don’t have access to that.');
      return user;
    },

    isBrandMember(userId, brandId, roles = ['owner', 'editor']) {
      if (!userId || !brandId) return false;
      const row = db.prepare('SELECT member_role FROM brand_members WHERE brand_id = ? AND user_id = ?').get(brandId, userId);
      return !!row && roles.includes(row.member_role);
    },

    /** The caller's membership role in the brand, or a 404 (never reveals that the brand exists). */
    requireBrandMember(rc, brandId, roles = ['owner', 'editor']) {
      const user = svc.requireUser(rc);
      if (!svc.isBrandMember(user.id, brandId, roles)) throw new HttpError(404, 'Not found.');
      return db.prepare('SELECT member_role FROM brand_members WHERE brand_id = ? AND user_id = ?').get(brandId, user.id).member_role;
    },

    /** `[{ id, slug, name, status, memberRole }]` for every brand the user belongs to. */
    membershipsOf(userId) {
      if (!userId) return [];
      return db
        .prepare(
          `SELECT b.id, b.slug, b.name, b.status, m.member_role AS memberRole
             FROM brand_members m JOIN brands b ON b.id = m.brand_id
            WHERE m.user_id = ? ORDER BY b.name COLLATE NOCASE`,
        )
        .all(userId)
        .map((r) => ({ id: r.id, slug: r.slug, name: r.name, status: r.status, memberRole: r.memberRole }));
    },
  };
  return svc;
}
