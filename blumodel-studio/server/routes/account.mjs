// A person's own account (launch contract):
//
//   GET  /api/account/export            everything that is theirs, as a JSON download
//   POST /api/account/delete {password} delete the account (signed in, CSRF header, password again)
//
// What each includes, keeps and deletes: server/account/service.mjs.

import { HttpError } from '../http/respond.mjs';
import { MAX_PASSWORD, verifyPassword } from '../auth/passwords.mjs';
import { createAccountService } from '../account/service.mjs';
import { createBillingService } from '../billing/service.mjs';

/** @param {any} ctx */
export default function routes(ctx) {
  const { db, config, services, log } = ctx;
  const { sessions } = ctx.internal;
  const account = createAccountService({ db, config, now: ctx.now, tx: ctx.tx, files: services.files });
  const billing = createBillingService({ db, now: ctx.now, log });

  return [
    {
      method: 'GET',
      path: '/api/account/export',
      rateLimit: { name: 'account-export', max: 20, windowMs: 3_600_000, by: 'user' },
      handler: (rc) => {
        const data = account.exportFor(rc.user.id, { billing });
        if (!data) throw new HttpError(401, 'Please sign in.');
        const body = JSON.stringify(data, null, 2);
        const day = new Date(ctx.now()).toISOString().slice(0, 10);
        rc.sent = true;
        rc.res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="blumodel-account-${day}.json"`,
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store',
        });
        rc.res.end(body);
      },
    },
    {
      method: 'POST',
      path: '/api/account/delete',
      maxBytes: 4_096,
      rateLimit: [
        { name: 'account-delete', max: 10, windowMs: 3_600_000, by: 'user' },
        { name: 'account-delete-ip', max: 30, windowMs: 3_600_000, by: 'ip' },
      ],
      handler: async (rc) => {
        const password = typeof rc.body.password === 'string' ? rc.body.password : '';
        const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(rc.user.id);
        if (!row || !(await verifyPassword(password.slice(0, MAX_PASSWORD), row.password_hash))) {
          throw new HttpError(400, 'Your password is not right.', { code: 'wrong_password' });
        }
        if (account.activePaidPlan(rc.user.id)) {
          throw new HttpError(409, 'Cancel your plan first (Account > Billing). You can delete your account once it is set to end.', { code: 'active_subscription' });
        }
        const counts = account.deleteAccount(rc.user.id);
        log.info?.(`Account ${rc.user.id} deleted (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}).`);
        rc.res.setHeader('Set-Cookie', sessions.clearedCookie(rc.req));
        rc.send(204);
      },
    },
  ];
}
