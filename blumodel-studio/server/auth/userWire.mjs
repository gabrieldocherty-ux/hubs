// The signed-in user as every auth and account response returns it:
// `{ id, email, name, role, brands, plan, contractor }` (src/types/platform.ts SessionUser).
// `plan` comes from services.billing (Free until package G registers); `contractor` is
// `{ company, active }` once the user has set up a contractor company.

/** @param {{ auth: any, billing: any, contractors: any }} services */
export function makeUserWire(services) {
  return (u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role || 'customer',
    brands: services.auth.membershipsOf(u.id),
    plan: services.billing.planOf(u.id),
    contractor: services.contractors.summaryFor(u.id),
  });
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
