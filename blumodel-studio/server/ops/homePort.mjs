// The port a home's server was set up on, read back from what the install wrote, so that later
// commands (the update's deploy and its health check, a rollback, import-data / restore's "is the
// server stopped?") use the same port without being told it again:
//
//   Windows  <home>\run-server.cmd           set PORT=<n>          (deploy-local writes it)
//   Linux    /etc/systemd/system/blumodel-studio.service
//                                            Environment=PORT=<n>  (register-tasks writes it), used
//                                            only when its DB_PATH is this home's database
//
// Without this, an install made with --port / -Port (or on a machine where 8790 is taken) would be
// updated against 8790: on Windows the deploy refused or rewrote the supervisor to the wrong port; on
// Linux the health check asked the wrong port, rolled a good update back and failed that too.
//
// fs and path only (no child process), so the server's own import graph stays as it is. Reads two
// generated, non-secret files; never the settings file.

import fs from 'node:fs';
import path from 'node:path';

/** Where register-tasks writes the Linux server unit. */
export const SERVER_UNIT_FILE = '/etc/systemd/system/blumodel-studio.service';

const port = (s) => {
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
};

/**
 * The port `home`'s server is configured for, or null when nothing says (a new home, or another
 * home's unit).
 * @param {string} home
 * @param {{ platform?: string, readFile?: (file: string) => string, unitFile?: string }} [o]
 * @returns {number | null}
 */
export function homePort(home, { platform = process.platform, readFile = (f) => fs.readFileSync(f, 'utf8'), unitFile = SERVER_UNIT_FILE } = {}) {
  if (!home) return null;
  const read = (f) => {
    try {
      return String(readFile(f));
    } catch {
      return null;
    }
  };
  if (platform === 'win32') {
    const text = read(path.win32.join(path.win32.resolve(home), 'run-server.cmd'));
    return text ? port(/^set PORT=(\d{1,5})\s*$/im.exec(text)?.[1]) : null;
  }
  const text = read(unitFile);
  if (!text) return null;
  const db = /^Environment=DB_PATH=(.+)$/m.exec(text)?.[1]?.trim();
  if (db !== path.posix.join(path.posix.resolve(home), 'data', 'blumodel.db')) return null;
  return port(/^Environment=PORT=(\d{1,5})\s*$/m.exec(text)?.[1]);
}
