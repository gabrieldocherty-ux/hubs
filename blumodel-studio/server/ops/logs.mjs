// Log files that don't grow forever.
//
//   rotateLog(file, { maxBytes, keep })   file → file.1 → … → file.<keep> once it passes maxBytes
//   installLogFile(file, …)               console.log/info/warn/error append to `file` (with a time
//                                         stamp and level), rotating it as it goes
//
// The home server's supervisor (run-server.cmd) sets BLUMODEL_LOG_FILE=logs\server.log, so the
// server writes its own log and can rotate it while running (each line opens and closes the file,
// so nothing holds it). Output that isn't a console call (a crash before startup finishes) still
// goes to the supervisor's redirect, logs\console.log, which run-server.cmd rotates at each start
// with server/scripts/rotate-log.mjs. The tunnel supervisor rotates logs\tunnel.log the same way.

import fs from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';

/**
 * Rotates `file` when it is at least `maxBytes`: file.<keep-1> → file.<keep>, …, file → file.1.
 * Returns true when it rotated. Never throws (a log that can't rotate keeps growing instead).
 */
export function rotateLog(file, { maxBytes = 10 * 1024 * 1024, keep = 5 } = {}) {
  try {
    const size = fs.statSync(file).size;
    if (size < maxBytes) return false;
  } catch {
    return false;
  }
  try {
    fs.rmSync(`${file}.${keep}`, { force: true });
    for (let i = keep - 1; i >= 1; i--) {
      if (fs.existsSync(`${file}.${i}`)) fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    }
    fs.renameSync(file, `${file}.1`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sends console output to `file` instead of stdout/stderr. Returns a function that restores the
 * console. `now` stamps lines (tests freeze it).
 */
export function installLogFile(file, { maxBytes = 10 * 1024 * 1024, keep = 5, now = Date.now, target = console } = {}) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const original = { log: target.log, info: target.info, warn: target.warn, error: target.error };
  let writes = 0;
  const write = (level, args) => {
    const line = `${new Date(now()).toISOString()} ${level} ${format(...args)}\n`;
    try {
      if (++writes % 50 === 0) rotateLog(file, { maxBytes, keep });
      fs.appendFileSync(file, line);
    } catch {
      original.error.call(target, line.trimEnd());
    }
  };
  rotateLog(file, { maxBytes, keep });
  target.log = (...a) => write('INFO ', a);
  target.info = (...a) => write('INFO ', a);
  target.warn = (...a) => write('WARN ', a);
  target.error = (...a) => write('ERROR', a);
  return () => Object.assign(target, original);
}
