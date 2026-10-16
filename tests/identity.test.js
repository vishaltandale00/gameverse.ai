import test from 'node:test';
import assert from 'node:assert/strict';
import { digest, progressKey, validateCheckpoint, validateCartridge, padMask } from '../src/identity.js';

const identity = { profileId: 'one', gameId: 'firered', cartridgeSha256: 'rom', wasmSha256: 'core', loaderSha256: 'loader', adapter: 'adapter-v1', snapshotFormat: 'format-v1' };
test('every compatibility field separates progress', () => {
  const key = progressKey(identity);
  for (const field of Object.keys(identity)) assert.notEqual(progressKey({ ...identity, [field]: 'different' }), key, field);
});
test('rejects cross-game, cross-profile and cross-core snapshots', () => {
  for (const field of Object.keys(identity)) assert.throws(() => validateCheckpoint({ identity: { ...identity, [field]: 'different' }, state: Uint8Array.of(1) }, identity));
  assert.doesNotThrow(() => validateCheckpoint({ identity, state: Uint8Array.of(1) }, identity));
});
test('rejects missing or empty snapshot payloads', () => {
  for (const state of [null, undefined, new Uint8Array(), [1]]) assert.throws(() => validateCheckpoint({ identity, state }, identity));
});
test('SHA-256 matches known bytes and detects tampering', async () => {
  assert.equal(await digest(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.notEqual(await digest(Uint8Array.of(1)), await digest(Uint8Array.of(2)));
});
function cartridge(code) {
  const bytes = new Uint8Array(192);
  bytes.set(new TextEncoder().encode(code), 0xac); bytes[0xb2] = 0x96;
  let checksum = -0x19;
  for (let i = 0xa0; i <= 0xbc; i++) checksum -= bytes[i];
  bytes[0xbd] = checksum & 255;
  return bytes;
}
test('accepts correct cartridge header and rejects wrong game or corrupted header', () => {
  const bytes = cartridge('BPRE');
  assert.doesNotThrow(() => validateCartridge(bytes, 'BPRE'));
  assert.throws(() => validateCartridge(bytes, 'AX4E'));
  bytes[0xa0] ^= 1;
  assert.throws(() => validateCartridge(bytes, 'BPRE'));
  assert.throws(() => validateCartridge(new Uint8Array(30), 'BPRE'));
});
test('standard controller mapping covers GBA keys and ignores unsupported/disconnected devices', () => {
  const pad = { connected: true, mapping: 'standard', buttons: Array.from({ length: 17 }, () => ({ pressed: false })), axes: [0, 0] };
  for (const [index, expected] of [[0, 1], [1, 2], [8, 4], [9, 8], [15, 16], [14, 32], [12, 64], [13, 128], [5, 256], [4, 512]]) {
    pad.buttons[index].pressed = true; assert.equal(padMask(pad), expected); pad.buttons[index].pressed = false;
  }
  pad.axes = [-.6, -.6]; assert.equal(padMask(pad), 32 | 64);
  pad.connected = false; assert.equal(padMask(pad), 0);
  pad.connected = true; pad.mapping = ''; assert.equal(padMask(pad), 0);
});


test('custom progress separates profile, sport, artifact and version without emulator identities', () => {
  const identity = { kind: 'custom-sports', profileId: 'a', gameId: 'soccer', version: '1.0.0', artifactSha256: 'abc', adapter: 'sports/1', snapshotFormat: 'json/1' };
  for (const field of ['profileId', 'gameId', 'version', 'artifactSha256', 'adapter', 'snapshotFormat']) {
    assert.notEqual(progressKey(identity), progressKey({ ...identity, [field]: 'changed' }));
    assert.throws(() => validateCheckpoint({ identity: { ...identity, [field]: 'changed' }, state: new Uint8Array([1]) }, identity));
  }
  validateCheckpoint({ identity, state: new Uint8Array([1]) }, identity);
});
