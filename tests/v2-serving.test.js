import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATIC } from '../v2/server/index.mjs';

const v2 = fileURLToPath(new URL('../v2/', import.meta.url));
const walk = dir => readdirSync(dir).flatMap(f => statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]);

test('every browser module under v2 is servable at its import path', () => {
  const browserDirs = ['kernel', 'primitives', 'web', 'verify', 'engine', 'modules'];
  const files = browserDirs.flatMap(d => walk(join(v2, d))).filter(f => /\.(js|css)$/.test(f));
  const refused = files.map(f => '/v2/' + relative(v2, f)).filter(path => !STATIC.test(path));
  assert.deepEqual(refused, []);
});
