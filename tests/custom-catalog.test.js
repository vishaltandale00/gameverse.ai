import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gameCatalog, customArtifacts } from '../scripts/catalog.mjs';

const catalog = (await gameCatalog()).filter(game => game.kind === 'custom-sports');
const artifactHash = files => {
  const hash = createHash('sha256');
  for (const [name, bytes] of files) hash.update(name).update('\0').update(String(bytes.length)).update('\0').update(bytes);
  return hash.digest('hex');
};
const expectedShared = ['sports-runtime.js','sports-input.js','sports-feedback.js','gamepad.js','sports-physics.js','sports-certified.generated.js',
  'neighborhood-safety.js','neighborhood-certified.generated.js','three.module.js','three.core.js'];

test('custom identity hashes exact captured source bytes, filenames and complete selected module set', async () => {
  assert.deepEqual(catalog.map(game => game.id).sort(), ['football','soccer']);
  for (const game of catalog) {
    const files = customArtifacts.get(game.artifactSha256);
    assert.ok(files instanceof Map);
    assert.equal(game.entryUrl, `/custom/${game.artifactSha256}/sports-runtime.js`);
    assert.equal(artifactHash(files), game.artifactSha256);
    assert.deepEqual([...files.keys()].sort(), [...expectedShared, `${game.id}.js`].sort());
    for (const [name, bytes] of files) {
      const relative = name.startsWith('three.') ? `../node_modules/three/build/${name}` : `../src/${name}`;
      assert.deepEqual(bytes, await readFile(new URL(relative, import.meta.url)), `${name} must match the captured source`);
    }
    const modified = new Map(files);
    modified.set(`${game.id}.js`, Buffer.concat([files.get(`${game.id}.js`), Buffer.from('\n// changed in memory only')]));
    assert.notEqual(artifactHash(modified), game.artifactSha256, 'a changed simulation cannot retain its old identity');
  }
});

test('static imports and the selected dynamic sport resolve entirely within the immutable artifact', () => {
  for (const game of catalog) {
    const files = customArtifacts.get(game.artifactSha256), visited = new Set(), pending = ['sports-runtime.js'];
    while (pending.length) {
      const name = pending.pop();
      if (visited.has(name)) continue;
      visited.add(name);
      assert.ok(files.has(name), `missing ${name} in ${game.id}`);
      const source = files.get(name).toString();
      const imports = [...source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?['"]([^'"]+)['"]/g)].map(match => match[1]);
      for (const match of source.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g)) {
        // The shared loader contains both dispatch branches. Only the catalog's
        // fixed game ID is reachable; importing its other branch is not required.
        if (name === 'sports-runtime.js' && ['./soccer.js','./football.js'].includes(match[2]) && match[2] !== `./${game.id}.js`) continue;
        imports.push(match[2]);
      }
      for (const specifier of imports) {
        assert.match(specifier, /^\.\/[a-z.-]+\.js$/, `${name}: dependency must be a sibling immutable module`);
        const dependency = specifier.slice(2);
        assert.ok(files.has(dependency), `${name} needs missing ${dependency}`);
        pending.push(dependency);
      }
    }
    assert.deepEqual([...visited].sort(), [...files.keys()].sort(), 'all bundled dependencies must belong to the selected closure');
  }
});

test('catalog refresh preserves hashes, captured module maps and byte references for unchanged source', async () => {
  const before = catalog.map(game => ({ game, files: customArtifacts.get(game.artifactSha256), refs: [...customArtifacts.get(game.artifactSha256)] }));
  const refreshed = await gameCatalog();
  for (const { game, files, refs } of before) {
    const next = refreshed.find(item => item.id === game.id);
    assert.equal(next.artifactSha256, game.artifactSha256);
    assert.equal(next.entryUrl, game.entryUrl);
    assert.equal(customArtifacts.get(next.artifactSha256), files, 'refresh must not replace a previously served module snapshot');
    for (const [name, bytes] of refs) assert.equal(files.get(name), bytes, `${name} captured byte reference changed`);
    assert.equal(artifactHash(files), game.artifactSha256);
  }
});
