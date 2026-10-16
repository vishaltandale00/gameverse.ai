export async function digest(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
export function progressKey(identity) {
  return ['progress', identity.profileId, identity.gameId, identity.cartridgeSha256,
    identity.wasmSha256, identity.loaderSha256, identity.adapter, identity.snapshotFormat].join(':');
}
export function validateCheckpoint(checkpoint, identity) {
  if (!checkpoint || progressKey(checkpoint.identity) !== progressKey(identity)) throw Error('Snapshot belongs to a different profile, game, cartridge or runtime.');
  if (!(checkpoint.state instanceof Uint8Array) || checkpoint.state.length === 0) throw Error('Snapshot is empty or invalid.');
}
export function validateCartridge(bytes, expectedCode) {
  if (bytes.length < 192 || bytes.length > 32 * 1024 * 1024) throw Error('Invalid GBA cartridge size.');
  const code = new TextDecoder().decode(bytes.subarray(0xac, 0xb0));
  if (code !== expectedCode) throw Error(`Expected ${expectedCode}; cartridge reports ${code}.`);
  let checksum = 0;
  for (let i = 0xa0; i <= 0xbc; i++) checksum -= bytes[i];
  if (((checksum - 0x19) & 255) !== bytes[0xbd] || bytes[0xb2] !== 0x96) throw Error('Invalid GBA cartridge header checksum.');
}
export const KEY_BITS = { KeyX: 1, KeyZ: 2, ShiftRight: 4, Enter: 8, ArrowRight: 16, ArrowLeft: 32, ArrowUp: 64, ArrowDown: 128, KeyS: 256, KeyA: 512 };
export function padMask(pad) {
  if (!pad?.connected || pad.mapping !== 'standard') return 0;
  const pressed = i => Boolean(pad.buttons[i]?.pressed);
  const axis = i => pad.axes[i] || 0;
  return (pressed(0) ? 1 : 0) | (pressed(1) ? 2 : 0) | (pressed(8) ? 4 : 0) | (pressed(9) ? 8 : 0)
    | (pressed(15) || axis(0) > .45 ? 16 : 0) | (pressed(14) || axis(0) < -.45 ? 32 : 0)
    | (pressed(12) || axis(1) < -.45 ? 64 : 0) | (pressed(13) || axis(1) > .45 ? 128 : 0)
    | (pressed(5) ? 256 : 0) | (pressed(4) ? 512 : 0);
}
