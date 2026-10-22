// The catalogue conformance a promoted primitive must pass with the candidate in the catalogue (ARCHITECTURE.md §6.2:
// properties over the whole catalogue, so a new block is held to them like every registered one). Each entry is a test
// file (and, for a file that also holds per-mode playthroughs, the name pattern of its catalogue-wide test) that builds
// its catalogue with liveCatalogue() or scans v2/primitives, so the candidate in v2/primitives/promoted/ is included.
// check-primitive.mjs --conformance runs this list in the job's worktree; add an entry here when a new catalogue-wide
// conformance test is written (and make it read the live catalogue).
export const CATALOGUE_CONFORMANCE = Object.freeze([
  Object.freeze({ file: 'tests/v2-p-navigation-conformance.test.js' }), // scans v2/primitives (promoted included)
  Object.freeze({ file: 'tests/v2-p-loop-owners.test.js' }),
  Object.freeze({ file: 'tests/v2-p-modes-bots.test.js', name: '^modes: every card\\.mode is well formed' }),
  Object.freeze({ file: 'tests/v2-template-contract.test.js' }), // every template still passes its contract with the candidate
  Object.freeze({ file: 'tests/v2-choice-providers.test.js', name: '^choice declarations' }), // choice verbs declare provider and emits
  Object.freeze({ file: 'tests/v2-events-declared.test.js', name: '^declared events' }), // every event a primitive emits is declared
  Object.freeze({ file: 'tests/v2-events-declared.test.js', name: '^denials: every event' }), // refusals are declared events
]);

/** The `node` argv of one entry. @param {{ file: string, name?: string }} entry */
export const conformanceArgv = entry => ['--test', ...(entry.name ? ['--test-name-pattern', entry.name] : []), entry.file];
