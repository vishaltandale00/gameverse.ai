// worker_threads entry for checkExperiment: loads the kit and runs the in-process check.
import { parentPort, workerData } from 'node:worker_threads';
import { loadKit } from '../kits/registry.js';
import { runCheck } from './check.js';

const { experiment, kitId, content, seed, frames, mods, budget } = workerData;
const kit = await loadKit(kitId);
parentPort.postMessage(runCheck(experiment, { kit, content, seed, frames, mods, budget }));
