// Admin core: the overview counts and user roles. Moderation, brands, studio and
// revenue live in their packages' route modules.

import { HttpError } from '../http/respond.mjs';

const ROLES = ['customer', 'studio', 'admin'];

/** @param {any} ctx */
export default function routes(ctx) {
  const { db } = ctx;

  const counts = (sql) => Object.fromEntries(db.prepare(sql).all().map((r) => [r.k, r.n]));
  const userWire = (r) => ({ id: r.id, email: r.email, name: r.name, role: r.role, createdAt: r.created_at, projects: r.projects ?? 0 });

  return [
    {
      method: 'GET',
      path: '/api/admin/overview',
      auth: 'admin',
      handler: () => {
        const byRole = counts('SELECT role AS k, COUNT(*) AS n FROM users GROUP BY role');
        return {
          users: { total: Object.values(byRole).reduce((a, b) => a + b, 0), byRole },
          projects: { total: db.prepare('SELECT COUNT(*) AS n FROM projects').get().n },
          brands: counts('SELECT status AS k, COUNT(*) AS n FROM brands GROUP BY status'),
          products: counts('SELECT status AS k, COUNT(*) AS n FROM products GROUP BY status'),
          latestUsers: db
            .prepare('SELECT u.*, (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS projects FROM users u ORDER BY u.created_at DESC LIMIT 10')
            .all()
            .map(userWire),
        };
      },
    },
    {
      method: 'GET',
      path: '/api/admin/users',
      auth: 'admin',
      handler: (rc) => {
        const q = (rc.query.get('q') || '').trim().slice(0, 100).toLowerCase();
        const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
        const rows = db
          .prepare(
            `SELECT u.*, (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS projects FROM users u
              WHERE ? = '' OR lower(u.email) LIKE ? ESCAPE '\\' OR lower(u.name) LIKE ? ESCAPE '\\'
              ORDER BY u.created_at DESC LIMIT 200`,
          )
          .all(q, like, like);
        return { users: rows.map(userWire) };
      },
    },
    {
      method: 'PATCH',
      path: '/api/admin/users/:id',
      auth: 'admin',
      handler: (rc) => {
        const role = rc.body.role;
        if (!ROLES.includes(role)) throw new HttpError(400, 'Choose a role: customer, studio or admin.');
        if (rc.params.id === rc.user.id) throw new HttpError(400, 'You can’t change your own role.');
        const row = db.prepare('SELECT id FROM users WHERE id = ?').get(rc.params.id);
        if (!row) throw new HttpError(404, 'That user does not exist.');
        db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, rc.params.id);
        const u = db.prepare('SELECT u.*, (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS projects FROM users u WHERE u.id = ?').get(rc.params.id);
        return { user: userWire(u) };
      },
    },
  ];
}
