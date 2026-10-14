// The dynamic catalog: published brand products and the caller's private custom ones.
// Built-in products stay compiled into the client and are not served from here.

import { HttpError } from '../http/respond.mjs';

/** @param {any} ctx */
export default function routes(ctx) {
  const { products, brands, auth } = ctx.services;

  return [
    {
      method: 'GET',
      path: '/api/catalog',
      auth: 'optional',
      handler: (rc) => {
        const list = products.listCatalog(rc.user);
        const brandList = brands.listActive().map(brands.toWire);
        return { products: list, brands: brandList, version: products.catalogVersion(list, brandList) };
      },
    },
    {
      method: 'GET',
      path: '/api/catalog/brands',
      auth: 'none',
      handler: () => ({ brands: brands.listActive().map(brands.toWire) }),
    },
    {
      method: 'GET',
      path: '/api/catalog/products/:id',
      auth: 'optional',
      handler: (rc) => {
        const row = products.get(rc.params.id);
        const notFound = () => new HttpError(404, 'That product does not exist.');
        if (!row) throw notFound();
        const user = rc.user;
        // The working copy: brand members, the owner of a custom product, studio and admin.
        if (rc.query.get('working') === '1' && user) {
          const entitled =
            user.role === 'admin' || user.role === 'studio' || (row.ownerUserId && row.ownerUserId === user.id) || (row.brandId && auth.isBrandMember(user.id, row.brandId));
          if (entitled) return { product: products.toWire(row, { which: 'working', viewer: user }) };
        }
        if (!products.inCatalog(row, user)) throw notFound();
        return { product: products.toWire(row, { which: 'live', viewer: user }) };
      },
    },
  ];
}
