// The look of a world the 2D renderers paint (sky, painted backdrop, roadside dressing), declared on the space it
// belongs to: one of the scenery themes v2/art/scenery.js paints, chosen for the idea's theme (a template tunes it, so
// the content form offers exactly these values), never a default and never guessed from words. `cosmetic`: the
// simulation never reads it (the template contract proves each value leaves play unchanged), so a value is proven by
// drawing it, not by playing it.
import { THEMES } from '../../art/scenery.js';

/** The scenery param a space card declares. */
export const SCENERY_PARAM = Object.freeze({ type: 'string', options: Object.freeze([...THEMES]), cosmetic: true, effect: 'the look of this world the renderers paint (sky, backdrop, roadside), chosen for the idea\'s theme; unset paints none' });
