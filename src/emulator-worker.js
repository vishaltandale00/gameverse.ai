// Frontend over the pinned package's C ABI; see its src/mgba.sdk.ts and scripts/shim.
// A dedicated worker allows the shell to terminate hung native frame execution.
let mod, canvas, context, audioPtr, timer, running = false, anchor = 0, frames = 0;
function allocate(bytes, action) {
  const pointer = mod._malloc(bytes.length);
  if (!pointer) throw Error('Emulator allocation failed.');
  try { mod.HEAPU8.set(bytes, pointer); return action(pointer); }
  finally { mod._free(pointer); }
}
function render() {
  const width = mod._mgbawasm_video_width(), height = mod._mgbawasm_video_height();
  if (width !== 240 || height !== 160) throw Error('Unexpected GBA video geometry.');
  const pointer = mod._mgbawasm_video_ptr();
  context.putImageData(new ImageData(new Uint8ClampedArray(mod.HEAPU8.slice(pointer, pointer + width * height * 4)), width, height), 0, 0);
}
function pause() { running = false; clearTimeout(timer); mod?._mgbawasm_set_keys(0); }
function tick() {
  if (!running) return;
  try {
    const rate = mod._mgbawasm_framerate_micro() / 1e6;
    const due = Math.min(3, Math.floor((performance.now() - anchor) * rate / 1000) - frames);
    for (let i = 0; i < due; i++) {
      mod._mgbawasm_run_frame(); frames++;
      const count = mod._mgbawasm_read_audio(audioPtr, 4096);
      if (count > 0) {
        const samples = mod.HEAP16.slice(audioPtr >> 1, (audioPtr >> 1) + count * 2);
        postMessage({ event: 'audio', samples, rate: mod._mgbawasm_sample_rate() }, [samples.buffer]);
      }
    }
    if (due > 0) render();
    // Skip accumulated wall-clock debt after browser throttling; do not run an unbounded catch-up.
    if ((performance.now() - anchor) * rate / 1000 - frames > 6) anchor = performance.now() - frames * 1000 / rate;
    timer = setTimeout(tick, 4);
  } catch (error) { pause(); postMessage({ event: 'failure', error: error.message }); }
}
async function initialize(data) {
  // Classic worker imports the package loader without evaluating third-party code in the shell.
  importScripts('/runtime/mgba.js');
  mod = await self.createMgbaModule({ locateFile: path => `/runtime/${path}`, print: () => {}, printErr: () => {} });
  mod._mgbawasm_init(); mod._mgbawasm_set_log_level(0);
  const ok = allocate(data.rom, pointer => mod._mgbawasm_load(pointer, data.rom.length, 0, 0, 0, 0, 1));
  if (!ok || mod._mgbawasm_platform() !== 0) throw Error('GBA cartridge load failed.');
  mod._mgbawasm_set_idle_optimization(1);
  if (data.battery) {
    const loaded = allocate(data.battery, pointer => mod._mgbawasm_sram_load(pointer, data.battery.length));
    if (!loaded) throw Error('Normal save import failed.');
    mod._mgbawasm_reset();
  }
  if (data.state) {
    if (data.state.length !== mod._mgbawasm_state_size()) throw Error('Snapshot format or size does not match this core.');
    if (!allocate(data.state, pointer => mod._mgbawasm_state_load(pointer))) throw Error('Snapshot restore failed.');
  }
  canvas = data.canvas; context = canvas.getContext('2d');
  if (!context) throw Error('OffscreenCanvas is unavailable.');
  audioPtr = mod._malloc(4096 * 4);
  render();
  return { frame: mod._mgbawasm_frame_counter() };
}
async function handle({ op, ...data }) {
  switch (op) {
    case 'load': return initialize(data);
    case 'resume': if (!running) { running = true; anchor = performance.now(); frames = 0; tick(); } return;
    case 'pause': pause(); return;
    case 'input': mod?._mgbawasm_set_keys(data.mask); return;
    case 'health': return { frame: mod._mgbawasm_frame_counter(), running };
    case 'checkpoint': {
      pause();
      const size = mod._mgbawasm_state_size();
      if (!size) throw Error('Snapshot capture unavailable.');
      const pointer = mod._malloc(size);
      let state;
      try {
        if (!mod._mgbawasm_state_save(pointer)) throw Error('Snapshot capture failed.');
        state = mod.HEAPU8.slice(pointer, pointer + size);
      } finally { mod._free(pointer); }
      const bytes = mod._mgbawasm_sram_save();
      const battery = bytes ? mod.HEAPU8.slice(mod._mgbawasm_sram_ptr(), mod._mgbawasm_sram_ptr() + bytes) : null;
      return { state, battery, frame: mod._mgbawasm_frame_counter() };
    }
    default: throw Error('Unsupported runtime operation.');
  }
}
self.onmessage = async ({ data }) => {
  try { postMessage({ id: data.id, result: await handle(data) }); }
  catch (error) { postMessage({ id: data.id, error: error.message }); }
};
