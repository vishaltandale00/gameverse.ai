// Primitives registered by the puzzle workstream (KERNEL_API.md §7). Only that workstream edits this file.
import fallingPieces from './falling-pieces.js';
import match from './match.js';
import slideMerge from './slide-merge.js';
import paddle from './paddle.js';
import launcher from './launcher.js';
import destructible from './destructible.js';

export default [fallingPieces, match, slideMerge, paddle, launcher, destructible];
