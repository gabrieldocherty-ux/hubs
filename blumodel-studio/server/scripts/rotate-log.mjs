// Rotates a log file once it passes a size: file → file.1 → … → file.<keep>.
// Used by the home server's supervisors before each start (run-server.cmd: logs\console.log,
// run-tunnel.cmd: logs\tunnel.log). Exits 0 whether or not it rotated.
//
//   node rotate-log.mjs <file> [--max-mb 10] [--keep 5]

import { rotateLog } from '../ops/logs.mjs';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--max-mb' && argv[argv.indexOf(a) - 1] !== '--keep');
const num = (flag, def) => {
  const i = argv.indexOf(flag);
  const n = i >= 0 ? Number(argv[i + 1]) : def;
  return Number.isFinite(n) && n > 0 ? n : def;
};
if (!file) {
  console.error('Usage: node rotate-log.mjs <file> [--max-mb 10] [--keep 5]');
  process.exit(2);
}
rotateLog(file, { maxBytes: num('--max-mb', 10) * 1024 * 1024, keep: Math.floor(num('--keep', 5)) });
