// Worker thread entry: fuzzes one primitive's actions under a small heap so a runaway loop dies here, not in the test runner.
import { parentPort, workerData } from 'node:worker_threads';
import { fuzzPrimitive } from './v2-kernel-action-fuzz-lib.js';

const result = await fuzzPrimitive(workerData.id, progress => parentPort.postMessage({ progress }));
parentPort.postMessage({ result });
