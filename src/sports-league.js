// Original fictional leagues shared by the sports subgames: rosters, 0–99
// ratings, specialties, a seeded match RNG and the controller-driven team
// select. No real teams, athletes, likenesses or branding are represented.

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

// ---------------------------------------------------------------- ratings
// Linear rating response: 40 maps to `low`, 95+ maps to `high`.
export function scale(rating, low, high) { return low + (high - low) * clamp((rating - 40) / 55, 0, 1); }
export function has(player, specialty) { return !!player?.specialties?.includes(specialty); }

export const SOCCER_KEYS = ['pac', 'sho', 'pas', 'dri', 'def', 'phy', 'div', 'ref', 'han', 'pos', 'kic'];
export const FOOTBALL_KEYS = ['spd', 'str', 'agi', 'awr', 'thp', 'tha', 'cth', 'rte', 'car', 'btk', 'blk', 'rsh', 'cov', 'tak', 'kpw', 'kac'];
export const RATING_LABELS = {
  pac: 'PACE', sho: 'SHOOTING', pas: 'PASSING', dri: 'DRIBBLING', def: 'DEFENDING', phy: 'PHYSICAL',
  div: 'DIVING', ref: 'REFLEXES', han: 'HANDLING', pos: 'POSITIONING', kic: 'KICKING',
  spd: 'SPEED', str: 'STRENGTH', agi: 'AGILITY', awr: 'AWARENESS', thp: 'THROW POWER', tha: 'THROW ACCURACY',
  cth: 'CATCHING', rte: 'ROUTE RUNNING', car: 'CARRYING', btk: 'BREAK TACKLE', blk: 'BLOCKING', rsh: 'PASS RUSH',
  cov: 'COVERAGE', tak: 'TACKLE', kpw: 'KICK POWER', kac: 'KICK ACCURACY',
};
// Overall weights by role. Football athletes play both ways in this 7v7.
const WEIGHTS = {
  GK: { div: .24, ref: .26, han: .2, pos: .22, kic: .08 },
  DEF: { def: .36, phy: .2, pac: .16, pas: .16, dri: .08, sho: .04 },
  FWD: { sho: .3, dri: .22, pac: .2, pas: .16, phy: .08, def: .04 },
  'QB/S': { tha: .3, thp: .2, awr: .18, spd: .1, agi: .08, cov: .07, tak: .07 },
  'RB/LB': { spd: .16, btk: .14, car: .12, agi: .12, str: .1, tak: .14, awr: .08, cth: .06, cov: .08 },
  'WR/CB': { spd: .2, cth: .18, rte: .16, agi: .1, cov: .18, awr: .08, tak: .1 },
  'OL/DL': { blk: .3, rsh: .26, str: .24, awr: .1, tak: .1 },
};
export const ROLE_KEYS = {
  GK: ['div', 'ref', 'han', 'pos'], DEF: ['def', 'phy', 'pac', 'pas'], FWD: ['sho', 'dri', 'pac', 'pas'],
  'QB/S': ['tha', 'thp', 'awr', 'cov'], 'RB/LB': ['spd', 'btk', 'car', 'tak'], 'WR/CB': ['spd', 'cth', 'rte', 'cov'], 'OL/DL': ['blk', 'rsh', 'str', 'tak'],
};
export function overall(player) {
  const weights = WEIGHTS[player.role];
  return Math.round(Object.entries(weights).reduce((sum, [key, weight]) => sum + player.ratings[key] * weight, 0));
}

// -------------------------------------------------------------- specialties
// Each specialty has one measurable effect. The sport engines read these ids.
export const SPECIALTIES = {
  soccer: {
    finisher: { name: 'Finisher', text: 'Shots inside the box are 40% more accurate.' },
    cannon: { name: 'Cannon', text: 'Power shots leave the boot 20% faster.' },
    playmaker: { name: 'Playmaker', text: 'Through balls and driven passes are 40% more accurate.' },
    trickster: { name: 'Trickster', text: 'Skill moves cost half the stamina and recover 30% faster.' },
    speedster: { name: 'Speedster', text: 'Sprint bursts accelerate 20% harder.' },
    wall: { name: 'Wall', text: 'Shielding holds off challenges 40% better.' },
    interceptor: { name: 'Interceptor', text: 'Reads passing lanes with 25% more interception reach.' },
    ball_winner: { name: 'Ball Winner', text: 'Tackles connect 30% more often and foul half as often.' },
    aerial: { name: 'Aerial Threat', text: 'Headers and volleys are 40% stronger and more accurate.' },
    engine: { name: 'Engine', text: 'Stamina drains 35% slower.' },
    cat_reflexes: { name: 'Cat Reflexes', text: 'Reacts 40% faster to close-range shots.' },
    sweeper_keeper: { name: 'Sweeper Keeper', text: 'Rushes out to claim through balls and crosses.' },
  },
  football: {
    gunslinger: { name: 'Gunslinger', text: 'Bullets fly 12% faster; every throw reaches 8 yards farther.' },
    surgeon: { name: 'Surgeon', text: 'Short and medium throws are 40% more accurate.' },
    escape_artist: { name: 'Escape Artist', text: 'Escapes 60% more pocket sacks and buys a beat to throw.' },
    burner: { name: 'Burner', text: 'Finds an extra gear after 10 yards in the open.' },
    sure_hands: { name: 'Sure Hands', text: 'Never drops an open catch; wins 25% more contested ones.' },
    route_artist: { name: 'Route Artist', text: 'Creates an extra yard of separation on cuts.' },
    bulldozer: { name: 'Bulldozer', text: 'Breaks head-on tackles 35% more often.' },
    ankle_breaker: { name: 'Ankle Breaker', text: 'Jukes beat defenders 35% more often for less stamina.' },
    edge_rusher: { name: 'Edge Rusher', text: 'Sheds blocks 40% faster.' },
    brick_wall: { name: 'Brick Wall', text: 'Holds blocks 40% longer.' },
    ballhawk: { name: 'Ballhawk', text: 'Turns contested catches into interceptions twice as often.' },
    enforcer: { name: 'Enforcer', text: 'Big hits force fumbles twice as often.' },
    lockdown: { name: 'Lockdown', text: 'Mirrors routes 40% tighter and breaks on the ball sooner.' },
    big_leg: { name: 'Big Leg', text: 'Adds 10 yards of field-goal range and 12% kick distance.' },
  },
};

// ------------------------------------------------------------------ rosters
// Ratings are listed in SOCCER_KEYS / FOOTBALL_KEYS order.
const S = (name, number, role, ratings, specialties = []) => ({ name, number, role, ratings: Object.fromEntries(SOCCER_KEYS.map((key, i) => [key, ratings[i]])), specialties });
const F = (name, number, role, ratings, specialties = []) => ({ name, number, role, ratings: Object.fromEntries(FOOTBALL_KEYS.map((key, i) => [key, ratings[i]])), specialties });

//                                   pac sho pas dri def phy div ref han pos kic
const SOCCER_TEAMS = [
  { id: 'alder', name: 'ALDER FC', short: 'ALDER', primary: '#22d8c5', secondary: '#123f51', style: 'BALANCED',
    tactics: { press: .55, width: .6, directness: .5, tempo: .55 }, players: [
      S('Ines Varga', 1, 'GK', [55, 30, 62, 40, 35, 72, 80, 83, 78, 80, 74], ['cat_reflexes']),
      S('Tomas Brennick', 4, 'DEF', [74, 45, 70, 64, 82, 80, 20, 20, 20, 20, 30], ['ball_winner']),
      S('Kwame Asante-Lowe', 5, 'DEF', [79, 42, 72, 66, 80, 76, 20, 20, 20, 20, 30], ['interceptor']),
      S('Leah Okafor-Reyes', 10, 'FWD', [82, 76, 85, 86, 42, 62, 20, 20, 20, 20, 30], ['playmaker', 'trickster']),
      S('Mateo Quill', 9, 'FWD', [86, 85, 70, 80, 36, 74, 20, 20, 20, 20, 30], ['finisher']),
    ] },
  { id: 'ember', name: 'EMBER UNITED', short: 'EMBER', primary: '#ff7654', secondary: '#472b42', style: 'HIGH PRESS',
    tactics: { press: .85, width: .5, directness: .65, tempo: .7 }, players: [
      S('Bram Holloway', 1, 'GK', [52, 28, 58, 38, 34, 76, 79, 77, 80, 78, 70], ['sweeper_keeper']),
      S('Dario Fenwick', 3, 'DEF', [76, 48, 66, 60, 81, 84, 20, 20, 20, 20, 30], ['wall']),
      S('Yusuf Calloway', 6, 'DEF', [82, 50, 70, 68, 78, 74, 20, 20, 20, 20, 30], ['engine']),
      S('Nia Castellan', 7, 'FWD', [90, 74, 72, 83, 40, 64, 20, 20, 20, 20, 30], ['speedster']),
      S('Rook Adair', 11, 'FWD', [78, 82, 68, 74, 44, 82, 20, 20, 20, 20, 30], ['aerial', 'cannon']),
    ] },
  { id: 'northgate', name: 'NORTHGATE ROVERS', short: 'NORTHGATE', primary: '#4a7dff', secondary: '#1b2a5c', style: 'POSSESSION',
    tactics: { press: .65, width: .75, directness: .3, tempo: .5 }, players: [
      S('Arne Solberg-Vik', 1, 'GK', [58, 32, 70, 45, 36, 74, 87, 88, 85, 86, 82], ['cat_reflexes', 'sweeper_keeper']),
      S('Emeka Thorne', 2, 'DEF', [85, 52, 83, 77, 91, 88, 20, 20, 20, 20, 30], ['ball_winner', 'wall']),
      S('Luca Venn', 5, 'DEF', [87, 54, 87, 81, 88, 82, 20, 20, 20, 20, 30], ['interceptor']),
      S('Sol Iwasaki', 8, 'FWD', [88, 84, 94, 93, 50, 68, 20, 20, 20, 20, 30], ['playmaker', 'trickster']),
      S('Amara Delacroix-Byrne', 9, 'FWD', [92, 92, 80, 88, 40, 82, 20, 20, 20, 20, 30], ['finisher', 'speedster']),
    ] },
  { id: 'saltflats', name: 'SALT FLATS FC', short: 'SALT FLATS', primary: '#e2c275', secondary: '#5b4a2a', style: 'DIRECT',
    tactics: { press: .4, width: .45, directness: .85, tempo: .45 }, players: [
      S('Gus Pruitt', 1, 'GK', [45, 25, 52, 35, 30, 70, 63, 65, 62, 63, 68], []),
      S('Hollis Crane', 4, 'DEF', [60, 38, 56, 50, 68, 78, 20, 20, 20, 20, 30], ['wall']),
      S('Ray Duarte', 5, 'DEF', [64, 36, 58, 52, 66, 72, 20, 20, 20, 20, 30], []),
      S('Wes Kimbrough', 10, 'FWD', [68, 64, 64, 66, 36, 66, 20, 20, 20, 20, 30], ['engine']),
      S('Odell Faraday', 9, 'FWD', [66, 70, 54, 60, 34, 80, 20, 20, 20, 20, 30], ['aerial']),
    ] },
];

//                                     spd str agi awr thp tha cth rte car btk blk rsh cov tak kpw kac
const FOOTBALL_TEAMS = [
  { id: 'alder', name: 'ALDER ARROWS', short: 'ALDER', primary: '#13d6c4', secondary: '#0c3f45', style: 'BALANCED', kicker: 5,
    tactics: { passRate: .55, aggression: .5, blitz: .3 }, players: [
      F('Cole Haverford', 7, 'QB/S', [72, 62, 70, 82, 84, 83, 50, 45, 60, 55, 30, 30, 70, 66, 40, 40], ['surgeon']),
      F('Dante Okoye', 22, 'RB/LB', [86, 74, 84, 74, 30, 30, 70, 62, 82, 80, 50, 50, 64, 76, 40, 40], ['ankle_breaker']),
      F('Reggie Lark', 1, 'WR/CB', [89, 58, 84, 74, 30, 30, 84, 82, 64, 58, 30, 30, 76, 62, 40, 40], ['burner']),
      F('Theo Banks-Wilder', 13, 'WR/CB', [84, 62, 80, 76, 30, 30, 82, 80, 66, 60, 30, 30, 80, 66, 40, 40], ['sure_hands']),
      F('Sam Ostrowski', 70, 'OL/DL', [58, 86, 60, 74, 30, 30, 40, 30, 50, 60, 82, 78, 30, 76, 40, 40], ['brick_wall']),
      F('Marcus Pell', 65, 'OL/DL', [60, 84, 62, 76, 30, 30, 40, 30, 50, 60, 80, 76, 30, 74, 84, 82], []),
      F('Ivan Drummond', 77, 'OL/DL', [64, 82, 66, 72, 30, 30, 40, 30, 50, 60, 76, 82, 30, 78, 40, 40], ['edge_rusher']),
    ] },
  { id: 'canyon', name: 'CANYON COYOTES', short: 'CANYON', primary: '#ff753f', secondary: '#4a1f12', style: 'GROUND & POUND', kicker: 6,
    tactics: { passRate: .38, aggression: .65, blitz: .5 }, players: [
      F('Hank Rivera-Stone', 12, 'QB/S', [78, 66, 74, 76, 80, 76, 50, 45, 64, 62, 30, 30, 72, 70, 40, 40], ['escape_artist']),
      F('Tyrell Booker', 28, 'RB/LB', [84, 86, 78, 72, 30, 30, 64, 58, 86, 88, 52, 54, 60, 82, 40, 40], ['bulldozer']),
      F('Kip Navarro', 11, 'WR/CB', [86, 60, 82, 70, 30, 30, 78, 76, 60, 56, 30, 30, 78, 64, 40, 40], ['lockdown']),
      F('Lonnie Fisk', 84, 'WR/CB', [82, 64, 78, 72, 30, 30, 80, 74, 62, 60, 30, 30, 74, 66, 40, 40], []),
      F('Moses Akande', 91, 'OL/DL', [66, 84, 66, 72, 30, 30, 40, 30, 50, 60, 72, 86, 30, 80, 40, 40], ['edge_rusher']),
      F('Bo Kettering', 66, 'OL/DL', [56, 88, 56, 74, 30, 30, 40, 30, 50, 60, 84, 74, 30, 74, 40, 40], []),
      F('Rusty Calhoun', 72, 'OL/DL', [58, 82, 58, 70, 30, 30, 40, 30, 50, 60, 76, 76, 30, 72, 86, 80], ['big_leg']),
    ] },
  { id: 'ironwood', name: 'IRONWOOD TITANS', short: 'IRONWOOD', primary: '#9a7bff', secondary: '#2a1f55', style: 'AIR RAID', kicker: 6,
    tactics: { passRate: .7, aggression: .55, blitz: .35 }, players: [
      F('Grayson Vale', 9, 'QB/S', [76, 68, 76, 90, 93, 91, 52, 46, 62, 58, 30, 30, 76, 70, 40, 40], ['gunslinger', 'surgeon']),
      F('Mekhi Sutter', 26, 'RB/LB', [90, 76, 88, 82, 30, 30, 80, 70, 86, 82, 52, 52, 72, 82, 40, 40], ['ankle_breaker']),
      F('Zion Ashby', 3, 'WR/CB', [95, 62, 90, 82, 30, 30, 88, 86, 66, 60, 30, 30, 84, 66, 40, 40], ['burner', 'route_artist']),
      F('Rafael Quint', 17, 'WR/CB', [90, 66, 86, 86, 30, 30, 90, 90, 68, 62, 30, 30, 88, 72, 40, 40], ['sure_hands', 'lockdown']),
      F('Torin Blackwood', 74, 'OL/DL', [64, 92, 64, 82, 30, 30, 40, 30, 50, 62, 92, 86, 30, 84, 40, 40], ['brick_wall']),
      F('Desmond Hale', 94, 'OL/DL', [70, 88, 70, 80, 30, 30, 40, 30, 50, 62, 82, 92, 30, 86, 40, 40], ['edge_rusher', 'enforcer']),
      F('Viktor Lund', 68, 'OL/DL', [62, 90, 62, 80, 30, 30, 40, 30, 50, 62, 88, 84, 30, 82, 92, 88], ['big_leg']),
    ] },
  { id: 'marsh', name: 'MARSH HOLLOW MUDCATS', short: 'MARSH HOLLOW', primary: '#6fbf4a', secondary: '#2e3a1c', style: 'GRIT', kicker: 5,
    tactics: { passRate: .45, aggression: .4, blitz: .4 }, players: [
      F('Earl Dobbs', 4, 'QB/S', [64, 60, 60, 62, 68, 62, 46, 40, 56, 52, 30, 30, 56, 56, 40, 40], ['escape_artist']),
      F('Jimmy Tackett', 33, 'RB/LB', [72, 72, 66, 60, 30, 30, 56, 50, 66, 68, 46, 50, 50, 70, 40, 40], ['enforcer']),
      F('Pete Moreau', 81, 'WR/CB', [74, 56, 68, 60, 30, 30, 72, 64, 58, 52, 30, 30, 60, 54, 40, 40], ['sure_hands']),
      F('Cal Whitby', 19, 'WR/CB', [76, 54, 70, 60, 30, 30, 64, 62, 56, 50, 30, 30, 62, 56, 40, 40], []),
      F('Ned Grubbs', 63, 'OL/DL', [50, 76, 50, 60, 30, 30, 40, 30, 50, 56, 66, 62, 30, 62, 40, 40], []),
      F('Otis Pruett', 75, 'OL/DL', [52, 78, 52, 62, 30, 30, 40, 30, 50, 56, 68, 62, 30, 64, 74, 72], []),
      F('Lyle Fenn', 79, 'OL/DL', [54, 74, 54, 60, 30, 30, 40, 30, 50, 56, 62, 68, 30, 62, 40, 40], []),
    ] },
];

export const LEAGUES = { soccer: SOCCER_TEAMS, football: FOOTBALL_TEAMS };
export const DIFFICULTIES = ['AMATEUR', 'PRO', 'WORLD CLASS'];
export const MODES = ['PLAY VS CPU', 'WATCH CPU VS CPU'];

const shortName = name => { const parts = name.split(' '); return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : name; };
// A self-contained copy for match state, so saves and replays never depend on
// later roster edits. `ovr` is derived once from the role weights.
export function athleteProfile(player) {
  return { name: player.name, short: shortName(player.name), number: player.number, role: player.role, ratings: { ...player.ratings }, specialties: [...player.specialties], ovr: overall(player) };
}
export function teamProfile(sport, index) {
  const team = LEAGUES[sport][index];
  if (!team) throw new RangeError(`Unknown ${sport} team ${index}`);
  const players = team.players.map(athleteProfile);
  return { index, id: team.id, name: team.name, short: team.short, primary: team.primary, secondary: team.secondary, style: team.style,
    tactics: { ...team.tactics }, ...(team.kicker === undefined ? {} : { kicker: team.kicker }), ovr: Math.round(players.reduce((sum, p) => sum + p.ovr, 0) / players.length), players };
}
export function validateProfile(sport, team) {
  const keys = sport === 'soccer' ? SOCCER_KEYS : FOOTBALL_KEYS, size = sport === 'soccer' ? 5 : 7;
  if (!team || typeof team.name !== 'string' || !Number.isInteger(team.ovr) || !Array.isArray(team.players) || team.players.length !== size) return false;
  return team.players.every(p => typeof p?.name === 'string' && Number.isInteger(p.number) && WEIGHTS[p.role] && Number.isInteger(p.ovr)
    && keys.every(key => Number.isInteger(p.ratings?.[key]) && p.ratings[key] >= 0 && p.ratings[key] <= 99)
    && Array.isArray(p.specialties) && p.specialties.every(id => SPECIALTIES[sport][id]));
}
export function specialtyNames(sport, ids) { return ids.map(id => SPECIALTIES[sport][id]?.name).filter(Boolean); }
// HUD card for the selected athlete: identity plus the role's four key ratings
// (codes follow familiar sports-game abbreviations such as PAC or THA).
export function athleteCard(sport, profile) {
  if (!profile) return null;
  return { name: profile.short, number: profile.number, role: profile.role, ovr: profile.ovr, specialties: specialtyNames(sport, profile.specialties),
    ratings: ROLE_KEYS[profile.role].map(key => ({ code: key.toUpperCase(), label: RATING_LABELS[key], value: profile.ratings[key] })) };
}

// ---------------------------------------------------------------- match RNG
// mulberry32 over a uint32 kept in match state: saves and replays continue the
// exact same sequence. Never use Math.random in a sport model.
export function random(s) {
  let t = (s.seed = (s.seed + 0x6D2B79F5) >>> 0);
  t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
export const validSeed = seed => Number.isInteger(seed) && seed >= 0 && seed <= 0xFFFFFFFF;

// --------------------------------------------------------------- team select
// Controller-driven pre-match menu kept in match state. Up/down chooses a row,
// left/right changes it and confirm starts. The two sides never share a team.
const ROWS = ['MODE', 'YOUR TEAM', 'OPPONENT', 'DIFFICULTY'];
export function createSetup({ teams = [0, 1], difficulty = 1, mode = 0 } = {}) { return { cursor: 0, mode, teams: [...teams], difficulty }; }
export function validateSetup(sport, setup) {
  const count = LEAGUES[sport].length;
  return !!setup && Number.isInteger(setup.cursor) && setup.cursor >= 0 && setup.cursor < ROWS.length && [0, 1].includes(setup.mode)
    && Array.isArray(setup.teams) && setup.teams.length === 2 && setup.teams.every(t => Number.isInteger(t) && t >= 0 && t < count) && setup.teams[0] !== setup.teams[1]
    && Number.isInteger(setup.difficulty) && setup.difficulty >= 0 && setup.difficulty < DIFFICULTIES.length;
}
// Returns true when the player confirms the setup.
export function stepSetup(sport, setup, pressed = {}) {
  const count = LEAGUES[sport].length;
  if (pressed.up) setup.cursor = (setup.cursor + ROWS.length - 1) % ROWS.length;
  if (pressed.down) setup.cursor = (setup.cursor + 1) % ROWS.length;
  const delta = (pressed.right ? 1 : 0) - (pressed.left ? 1 : 0);
  if (delta) {
    if (setup.cursor === 0) setup.mode = (setup.mode + 1) % MODES.length;
    else if (setup.cursor === 3) setup.difficulty = clamp(setup.difficulty + delta, 0, DIFFICULTIES.length - 1);
    else {
      const side = setup.cursor - 1, other = setup.teams[1 - side];
      let next = setup.teams[side];
      do next = (next + delta + count) % count; while (next === other);
      setup.teams[side] = next;
    }
  }
  return !!pressed.confirm;
}
export function setupHud(sport, setup) {
  const team = i => { const t = teamProfile(sport, i); return `${t.name} · ${t.ovr} OVR · ${t.style}`; };
  const watch = setup.mode === 1;
  return { title: sport === 'soccer' ? 'NIGHT LEAGUE · 5v5' : 'IRON LEAGUE · 7v7', cursor: setup.cursor, hint: 'D-pad / arrows: choose · A / Enter: kick off',
    rows: [
      { label: 'MODE', value: MODES[setup.mode] },
      { label: watch ? 'HOME CPU' : 'YOUR TEAM', value: team(setup.teams[0]), color: LEAGUES[sport][setup.teams[0]].primary },
      { label: watch ? 'AWAY CPU' : 'OPPONENT', value: team(setup.teams[1]), color: LEAGUES[sport][setup.teams[1]].primary },
      { label: 'DIFFICULTY', value: DIFFICULTIES[setup.difficulty] },
    ] };
}
