// Adapter primitives (ARCHITECTURE.md §1.3, card.adapts): concepts that don't natively fit are combined by
// projecting one into another. Only the adapters workstream edits this file.
import projection from './adapt-projection.js';
import nested from './adapt-nested.js';
import skin from './adapt-skin.js';

export default [projection, nested, skin];
