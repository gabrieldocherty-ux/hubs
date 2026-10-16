// Admin core: the overview counts, the user list and user roles. Moderation, brands, studio and
// revenue live in their packages' route modules; the owner's panel (dashboard, user detail and
// actions, contractors, system, audit) is routes/adminPanel.mjs.

import { HttpError } from '../http/respond.mjs';
import { audit } from '../lib/audit.mjs';

/** Roles Admin > Users may set. 'admin' is granted and taken away only with server/scripts/make-admin.mjs. */
const ROLES = ['customer', 'studio'];

/** @param {any} ctx */
export default function routes(ctx) {
  const { db } = ctx;

  const counts = (sql) => Object.fromEntries(db.prepare(sql).all().map((r) => [r.k, r.n]));
  const live = (r) => !!r.sub_plan && (r.sub_status === 'active' || r.sub_status === 'past_due') && !(r.sub_provider === 'comp' && r.sub_end && r.sub_end <= ctx.now());
  const userWire = (r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    createdAt: r.created_at,
    projects: r.projects ?? 0,
    // The list's extra columns (GET /api/admin/users): a quick read of the plan, not planOf().
    ...(r.sub_plan !== undefined ? { plan: live(r) ? r.sub_plan : 'free', planProvider: live(r) ? r.sub_provider : null, disabled: !!r.disabled, lastSeenAt: r.last_seen ?? null } : {}),
  });

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
      rateLimit: { name: 'admin-users', max: 1200, windowMs: 3_600_000, by: 'user' },
      handler: (rc) => {
        const q = (rc.query.get('q') || '').trim().slice(0, 100).toLowerCase();
        const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
        const rows = db
          .prepare(
            `SELECT u.id, u.email, u.name, u.role, u.created_at,
                    (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS projects,
                    s.plan AS sub_plan, s.status AS sub_status, s.provider AS sub_provider, s.current_period_end AS sub_end,
                    EXISTS (SELECT 1 FROM account_status d WHERE d.user_id = u.id) AS disabled,
                    (SELECT MAX(COALESCE(x.last_seen_at, x.created_at)) FROM sessions x WHERE x.user_id = u.id) AS last_seen
               FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id
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
      rateLimit: { name: 'admin-role', max: 120, windowMs: 3_600_000, by: 'user' },
      handler: (rc) => {
        const role = rc.body.role;
        if (!ROLES.includes(role)) throw new HttpError(400, 'Choose a role: customer or studio. Admins are made only on the server (node server/scripts/make-admin.mjs).');
        if (rc.params.id === rc.user.id) throw new HttpError(400, 'You can’t change your own role.');
        const row = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(rc.params.id);
        if (!row) throw new HttpError(404, 'That user does not exist.');
        if (row.role === 'admin') throw new HttpError(409, 'That account is an admin. Admins are changed only on the server with node server/scripts/make-admin.mjs.', { code: 'target_admin' });
        if (row.role !== role) {
          ctx.tx(() => {
            db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, row.id);
            audit(db, { admin: rc.user, action: 'role_change', targetUserId: row.id, targetEmail: row.email, detail: { from: row.role, to: role }, at: ctx.now() });
          });
        }
        const u = db.prepare('SELECT u.*, (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS projects FROM users u WHERE u.id = ?').get(rc.params.id);
        return { user: userWire(u) };
      },
    },
  ];
}
