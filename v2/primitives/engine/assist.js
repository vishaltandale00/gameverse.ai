// Difficulty and accessibility as data. Every option is a var assist.<name>
// (numbers or booleans) that the primitives which own the mechanic read:
// combat multiplies damage by assist.damage_taken, movement scales speed by
// assist.game_speed, resources skip costs while assist.infinite_stamina...
// A difficulty preset sets many options at once; adaptive rules adjust
// options from play (after three deaths in a row, offer or apply help); the
// `assist` action lets a menu change options the document leaves unlocked.
const ID = 'engine.assist';
/** A rule example: a document whose systems are this one instance (a fragment replacing the host's systems). */
const only = with_ => ({ doc: { systems: [{ use: ID, with: with_ }] } });

const DEFAULT_OPTIONS = { invincible: false, damage_taken: 1, damage_dealt: 1, game_speed: 1, infinite_stamina: false, aim_assist: 0, skip_combat: false, hints: true, timing_window: 1 };
const DEFAULT_PRESETS = {
  story: { damage_taken: 0.25, damage_dealt: 2, aim_assist: 0.6, timing_window: 1.6 },
  easy: { damage_taken: 0.6, damage_dealt: 1.3, aim_assist: 0.3, timing_window: 1.3 },
  normal: {},
  hard: { damage_taken: 1.5, damage_dealt: 0.85, hints: false, timing_window: 0.8 },
};
// The built-in presets only touch the options a document declares.
const presetsOf = config => (JSON.stringify(config.presets) === JSON.stringify(DEFAULT_PRESETS)
  ? Object.fromEntries(Object.entries(DEFAULT_PRESETS).map(([p, set]) => [p, Object.fromEntries(Object.entries(set).filter(([k]) => k in config.options))]))
  : config.presets);

export default {
  id: ID,
  card: {
    intent: 'Difficulty presets and assist options (invincibility, damage multipliers, slower game speed, infinite stamina, aim assist, wider timing windows, hints) published as assist.* vars for the mechanics that own them, with adaptive rules and a menu action.',
    views: ['any'],
    params: {
      options: { type: 'object', open: true, default: DEFAULT_OPTIONS, effect: 'option -> starting value (number or boolean); each is var assist.<option>' },
      presets: { type: 'object', default: DEFAULT_PRESETS, values: { type: 'object', open: true, effect: 'option -> value (a number or boolean, as the option)' }, effect: 'difficulty -> {option: value} overrides' },
      difficulty: { type: 'string', default: 'normal', effect: 'starting preset' },
      locked: { type: 'list', of: { type: 'string' }, default: [], effect: 'options the player cannot change from menus' },
      ranges: { type: 'object', values: { type: 'list', of: { type: 'number' }, min: 2, max: 2, effect: '[min, max]' }, default: { damage_taken: [0, 4], damage_dealt: [0.25, 4], game_speed: [0.25, 1], aim_assist: [0, 1], timing_window: [0.5, 3] }, effect: 'option -> [min, max] for numeric options' },
      rules: { type: 'list', default: [], effect: 'adaptive difficulty, checked every second',
        of: { type: 'object', fields: { when: { type: 'predicate', required: true }, set: { type: 'object', open: true, default: {} }, preset: { type: 'string' }, once: { type: 'boolean', default: true }, offer: { type: 'boolean', default: false, effect: 'emit assist_offered instead of applying' } } } },
    },
    provides: { events: ['assist_changed', 'assist_changed:*', 'difficulty_changed', 'assist_offered'], vars: ['assist.*', 'assist.difficulty'], actions: ['assist'], services: ['assist'] },
    requires: {},
    rules: {
      assist_option_type: { fields: ['options', 'presets'], message: "every option's value is a number or a boolean, and a preset sets an option to a value of the option's type", example: only({ options: { hints: 'yes' } }) },
      assist_option_unknown: { fields: ['presets', 'locked', 'rules[].set'], message: 'presets, locked and rules[].set name options of options' },
      assist_preset_unknown: { fields: ['difficulty', 'rules[].preset'], message: 'difficulty and rules[].preset name a preset of presets (the built-in story, easy, normal, hard when presets is not set)' },
      assist_range_invalid: { fields: ['ranges'], message: 'a range is [min, max] with min ≤ max', example: only({ ranges: { damage_taken: [4, 0] } }) },
    },
  },
  logic(logic) {
    logic.effect('set_assist', { codes: [{ code: 'assist_effect_invalid', fields: ['option', 'value'], message: 'option is an option name and value a number or boolean', example: { do: 'set_assist', option: 'hints', value: 'yes' } }], check: (e, path, errors) => { if (typeof e.option !== 'string' || !['number', 'boolean'].includes(typeof e.value)) errors.push({ code: 'assist_effect_invalid', path, message: 'set_assist needs option and a number or boolean value' }); }, run: (e, rt) => rt.service('assist').set(e.option, e.value, { force: true }) });
    logic.effect('set_difficulty', { codes: [{ code: 'assist_effect_invalid', fields: ['difficulty'], message: 'difficulty is a preset name', example: { do: 'set_difficulty', difficulty: 2 } }], check: (e, path, errors) => { if (typeof e.difficulty !== 'string') errors.push({ code: 'assist_effect_invalid', path, message: 'set_difficulty needs a difficulty' }); }, run: (e, rt) => rt.service('assist').difficulty(e.difficulty) });
  },
  validate(config) {
    const errors = [], opts = config.options, presets = presetsOf(config);
    for (const [k, v] of Object.entries(opts)) if (!['number', 'boolean'].includes(typeof v)) errors.push({ code: 'assist_option_type', path: `options.${k}`, message: 'an option is a number or a boolean' });
    for (const [p, set] of Object.entries(presets)) for (const [k, v] of Object.entries(set || {})) {
      if (!(k in opts)) errors.push({ code: 'assist_option_unknown', path: `presets.${p}.${k}`, message: `unknown option '${k}'` });
      else if (typeof v !== typeof opts[k]) errors.push({ code: 'assist_option_type', path: `presets.${p}.${k}`, message: `'${k}' is a ${typeof opts[k]}` });
    }
    if (!(config.difficulty in presets)) errors.push({ code: 'assist_preset_unknown', path: 'difficulty', message: `unknown difficulty '${config.difficulty}'`, hint: `presets: ${Object.keys(config.presets).join(', ')}` });
    config.locked.forEach((k, i) => { if (!(k in opts)) errors.push({ code: 'assist_option_unknown', path: `locked[${i}]`, message: `unknown option '${k}'` }); });
    for (const [k, r] of Object.entries(config.ranges)) if (k in opts && Array.isArray(r) && r[0] > r[1]) errors.push({ code: 'assist_range_invalid', path: `ranges.${k}`, message: 'a range is [min, max]' });
    config.rules.forEach((r, i) => {
      if (r.preset && !(r.preset in presets)) errors.push({ code: 'assist_preset_unknown', path: `rules[${i}].preset`, message: `unknown difficulty '${r.preset}'` });
      for (const k of Object.keys(r.set)) if (!(k in opts)) errors.push({ code: 'assist_option_unknown', path: `rules[${i}].set.${k}`, message: `unknown option '${k}'` });
    });
    return errors;
  },
  install(rt, config) {
    const presets = presetsOf(config);
    const st = () => { const s = rt.store(ID); s.values ??= null; s.fired ??= {}; return s; };
    const clampTo = (k, v) => { const r = config.ranges[k]; return typeof v === 'number' && Array.isArray(r) ? Math.max(r[0], Math.min(r[1], v)) : v; };
    const publish = () => { const s = st(); for (const [k, v] of Object.entries(s.values)) rt.state.vars[`assist.${k}`] = v; rt.state.vars['assist.difficulty'] = s.difficulty; };
    const api = {
      get: k => st().values?.[k],
      all: () => ({ ...st().values }),
      /** Change an option; menus go through here (locked options refuse unless forced by an effect). */
      set(k, v, { force = false } = {}) {
        const s = st(); if (!(k in config.options) || typeof v !== typeof config.options[k]) return false;
        if (!force && config.locked.includes(k)) return false;
        const value = clampTo(k, v); if (s.values[k] === value) return true;
        s.values[k] = value; publish(); rt.emitTyped('assist_changed', k, { option: k, value });
        return true;
      },
      difficulty(name) {
        const s = st(), p = presets[name]; if (!p) return false;
        s.difficulty = name; s.values = { ...config.options, ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, clampTo(k, v)])) };
        publish(); rt.emit('difficulty_changed', { difficulty: name });
        return true;
      },
      options: () => Object.keys(config.options).map(k => ({ option: k, value: st().values?.[k], locked: config.locked.includes(k), range: config.ranges[k] ?? null })),
    };
    rt.provide('assist', api);
    rt.action('assist', value => { if (value && typeof value === 'object') { if (value.difficulty) api.difficulty(value.difficulty); else api.set(value.option, value.value); } });
    rt.system('input', rt => {
      const s = st();
      if (s.values === null) { s.difficulty = config.difficulty; api.difficulty(config.difficulty); }
      if (rt.state.frame % 60) return;
      config.rules.forEach((r, i) => {
        if ((r.once && s.fired[i]) || !rt.test(r.when)) return;
        s.fired[i] = (s.fired[i] || 0) + 1;
        if (r.offer) { rt.emit('assist_offered', { rule: i, preset: r.preset ?? null, set: r.set }); return; }
        if (r.preset) api.difficulty(r.preset);
        for (const [k, v] of Object.entries(r.set)) api.set(k, v, { force: true });
      });
    }, ID);
  },
};
