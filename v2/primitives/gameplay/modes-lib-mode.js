// Game modes declared on cards (card.mode): what a retired kit was (it owned
// the loop, the win and lose, its world needs, its content and a bot that
// proves the game), re-expressed as a declaration on a loop-owning primitive.
//
// card.mode = {
//   loop:        short mode id ('tactics', 'race', 'falling-blocks'...);
//   interaction: the interaction the loop is played in, or the list of every one its code serves:
//                'avatar-realtime' | 'avatar-grid' | 'pieces-turns' | 'cursor-board' | 'menu'
//                ('any' only for wrapper modes, which take the interaction of the mode they wrap);
//                kernel/loop.js cardLoop reads it as a set (loop.interactions), loopServes tests it;
//   opponent:    'none' | 'ai-rival' | 'ai-side' | 'hazards' | 'clock';
//   space:       preferred spaces, in order: space primitive ids, or capability lists any space providing them satisfies;
//   needs: {
//     content:      document sections that must be non-empty (dotted paths; 'spaces.zones' = some space has zones);
//     participants: the param naming who takes part (engaged as in card.engage), or null;
//   };
//   win:  { param?, end?, when?, ending? }  param = effects param fired on victory; end = boolean param that ends
//         the game itself; when = predicate template for a plot ending when the primitive has no victory of its own
//         ('$target' is a number the content picks);
//         ending = a plot ending ('plot.endings') wins (story);
//   lose: { param?, end?, when? }       the same for defeat (param null: defeat comes from health/death rules);
//   bot:  strategy id in v2/verify/strategies that must win a minimal document of the mode;
//   via?:   primitive id whose params win/lose/participants name (the loop runs on that primitive);
//   wraps?: true for a mode that sequences another mode (its bot plays the wrapped mode);
//   applies?: { param, field?, is } the mode exists only when the instance config matches
//             (a list param matches when any entry's field equals `is`); { param, given: true } when the
//             instance sets the param at all (a value, a non-empty list).
// }
export const INTERACTIONS = ['avatar-realtime', 'avatar-grid', 'pieces-turns', 'cursor-board', 'menu'];
export const OPPONENTS = ['none', 'ai-rival', 'ai-side', 'hazards', 'clock'];

/** Does a mode apply to one instance's config (card defaults applied)? */
export function modeApplies(mode, config = {}) {
  const a = mode?.applies;
  if (!a) return Boolean(mode);
  const v = config?.[a.param];
  if (a.given === true) return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== '';
  if (Array.isArray(v)) return v.some(x => (a.field ? x?.[a.field] : x) === a.is);
  return (a.field ? v?.[a.field] : v) === a.is;
}

/** Instances in a document whose primitive declares a mode that applies: [{ use, path, mode, config }]. */
export function modesIn(doc, registry) {
  const out = [], visit = (inst, path) => {
    const p = inst?.use && registry.get(inst.use), mode = p?.card?.mode;
    if (mode && modeApplies(mode, inst.with || {})) out.push({ use: inst.use, path, mode, config: inst.with || {} });
  };
  (doc?.systems || []).forEach((s, i) => visit(s, `systems[${i}]`));
  (doc?.spaces || []).forEach((sp, i) => (sp.generators || []).forEach((g, j) => visit(g, `spaces[${i}].generators[${j}]`)));
  return out;
}

/** Shape errors of a card.mode (for catalogue tests): [message]. */
export function modeShapeErrors(id, mode, knownBots = null) {
  const e = [];
  if (!mode.loop || typeof mode.loop !== 'string') e.push(`${id}: mode.loop`);
  const played = Array.isArray(mode.interaction) ? mode.interaction : [mode.interaction];
  if (!(mode.wraps && mode.interaction === 'any') && (!played.length || new Set(played).size !== played.length || played.some(x => !INTERACTIONS.includes(x)))) e.push(`${id}: mode.interaction '${played.join(', ')}'`);
  if (!OPPONENTS.includes(mode.opponent)) e.push(`${id}: mode.opponent '${mode.opponent}'`);
  if (!Array.isArray(mode.space)) e.push(`${id}: mode.space must be a list`);
  if (!Array.isArray(mode.needs?.content) || !('participants' in (mode.needs || {}))) e.push(`${id}: mode.needs { content, participants }`);
  for (const k of ['win', 'lose']) if (!mode[k] || typeof mode[k] !== 'object') e.push(`${id}: mode.${k}`);
  if (!mode.win?.param && !mode.win?.end && !mode.win?.when && !mode.win?.ending) e.push(`${id}: mode.win needs param, end, when or ending`);
  if (!mode.bot || (knownBots && !knownBots.has(mode.bot))) e.push(`${id}: mode.bot '${mode.bot}' is not a registered strategy`);
  return e;
}
