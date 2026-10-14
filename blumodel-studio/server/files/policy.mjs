// Who may read a file (BUILD_PLAN §3.2, "File read rule"). Public files: anyone.
// Private files: the owner, members of its brand, users with a grant, studio and
// admin, or anyone a registered read policy accepts (e.g. a valid share token).

export function createReadPolicy({ db, auth }) {
  /** @type {((user: any, file: any, rc: any) => boolean)[]} */
  const policies = [];
  const granted = (fileId, userId) => !!db.prepare('SELECT 1 FROM file_grants WHERE file_id = ? AND user_id = ?').get(fileId, userId);

  return {
    addReadPolicy(fn) {
      if (typeof fn !== 'function') throw new Error('addReadPolicy(fn): fn must be a function.');
      policies.push(fn);
    },
    canRead(user, file, rc) {
      if (!file) return false;
      if (file.visibility === 'public') return true;
      if (user) {
        if (file.ownerUserId && file.ownerUserId === user.id) return true;
        if (user.role === 'studio' || user.role === 'admin') return true;
        if (file.brandId && auth.isBrandMember(user.id, file.brandId)) return true;
        if (granted(file.id, user.id)) return true;
      }
      for (const policy of policies) {
        try {
          if (policy(user ?? null, file, rc) === true) return true;
        } catch {
          /* a failing policy never grants access */
        }
      }
      return false;
    },
  };
}
