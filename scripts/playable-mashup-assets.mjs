// Local-only research resources. Explicit paths; never an arbitrary local file host.
import { root } from './runtime.mjs';
export const playableAssets = new Map([
  ['/private-playable/relay-runner.wasm', new URL('local-data/playable-mashups/relay-runner.wasm', root)],
  ['/playable-assets/candidate-b.wasm', new URL('local/re/playable-mashups-20261016/candidate-b/mechanics.wasm', root)],
  ...['red.png','brendan.png','ripper.png','manifest.json'].map(name => [`/playable-assets/${name}`, new URL(`local/playable-mashups/assets/${name}`, root)]),
]);
