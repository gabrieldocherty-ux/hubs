// The off-site backup's worker thread (server/ops/offsite.mjs startOffsiteBackup): the tar, the
// encryption and the read-back run here so the server's own thread keeps answering requests.
import { parentPort, workerData } from 'node:worker_threads';
import { offsiteBackupNow } from './offsite.mjs';

const r = offsiteBackupNow({ config: workerData.config });
parentPort?.postMessage(r);
