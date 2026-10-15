// The real-retailer catalog (the 'retail' package): advertising groundwork. Steps reference only
// their own tables. Append steps; never edit or reorder an applied one. Ids are "retail-001-name".
//
//   retailers       one row per store the admin has configured (Admin > Retailers): the affiliate
//                   or tracking parameter added to that store's links, and whether it is sponsored
//                   (sponsored stores sort first under "Where to buy" and say so). A store with no
//                   row has neither. updated_by is the admin's user id; every change is also in
//                   admin_audit (action 'retailer_update').
//   retail_clicks   link-out counts per store, product and UTC day. Deliberately no user, session,
//                   IP or referrer: just how many times a "Where to buy" link was followed.

/** @type {{ id: string, up: (db: import('node:sqlite').DatabaseSync) => void }[]} */
export const steps = [
  {
    id: 'retail-001-retailers-clicks',
    up(db) {
      db.exec(`
        CREATE TABLE retailers (
          slug TEXT PRIMARY KEY,
          affiliate TEXT NOT NULL DEFAULT '',
          sponsored INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL,
          updated_by TEXT);

        CREATE TABLE retail_clicks (
          store TEXT NOT NULL,
          product_id TEXT NOT NULL,
          day TEXT NOT NULL,
          clicks INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (store, product_id, day));
        CREATE INDEX retail_clicks_day ON retail_clicks(day);
      `);
    },
  },
];
