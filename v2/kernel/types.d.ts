// Types for the v2 kernel contract (KERNEL_API.md). Declarations only: nothing here runs, and nothing
// imports it at runtime. JavaScript files use these through JSDoc, e.g.
//   /** @typedef {import('./types.js').Card} Card */
// `npm run typecheck` checks v2/kernel/** and v2/planner/compose-check.js strictly against them.
//
// Every shape here is derived from KERNEL_API.md; where the doc and the code disagree, the code is the
// truth and the doc should be fixed. Open-ended JSON (instance configs, state sections) is typed as
// `any`-valued records on purpose: primitives own those shapes, the kernel only carries them.

// Runtime globals (performance, structuredClone) come from @types/node (tsconfig types: ["node"]).

// ---------- §1 primitive cards ----------

export type ParamType = 'number' | 'integer' | 'boolean' | 'string' | 'ref' | 'list' | 'object' | 'predicate' | 'effects' | 'json';

/** One param schema in card.params. */
export interface ParamSchema {
  type: ParamType;
  default?: unknown;
  min?: number;
  max?: number;
  unit?: string;
  options?: readonly string[];
  /** Values a string param may never take (ids the primitive itself uses). */
  reserved?: readonly string[];
  maxLength?: number;
  /** `ref`: the reference kind (base REF_KINDS or a card.defines kind). */
  to?: string;
  /** `list`: the element schema. */
  of?: ParamSchema;
  /** `object`: field schemas; `open` allows unknown keys. */
  fields?: Params;
  open?: boolean;
  required?: boolean;
  /** What the param does, for the planner model (also the hint on param_missing). */
  effect?: string;
  /** A declared example value (or list entries) the planner may take structure from (planner/presets.js repairLoop). */
  example?: unknown;
  [extra: string]: unknown;
}
/** card.params: param name -> schema. */
export type Params = Record<string, ParamSchema>;

/** A new reference kind: `at` indexes a document path, `in` a list inside each instance's `with`. */
export interface Define { kind: string; at?: string; in?: string }

export interface Provides {
  capabilities?: string[];
  /** Space-specific capability interfaces: capability -> method names. */
  capabilityMethods?: Record<string, string[]>;
  events?: string[];
  vars?: string[];
  services?: string[];
  actions?: string[];
  /** Generators: the kinds of world content they produce (terrain, rooms, course...). Composition checker field. */
  content?: string[];
}
export interface Requires {
  capabilities?: string[];
  primitives?: string[];
  services?: string[];
}

/** Player/actor engagement contract (see v2/planner/engage.js). */
export interface EngageSide {
  components?: Record<string, unknown>;
  spawn?: { role: string; archetype: { id?: string; components?: Record<string, unknown>; [k: string]: unknown }; components?: Record<string, unknown> };
  enter?: Effect[];
}
export interface Engage {
  player?: EngageSide;
  actors?: EngageSide;
  participants?: { param: string };
  /** param -> value; '$first:<path>' / '$ids:<path>' are filled from the document (or 'with.<param>'). */
  config?: Record<string, unknown>;
  join?: { param: string; field: string; where?: Record<string, unknown> };
}

/**
 * An adapter projects a concept a space does not have natively onto it (a 2D side-scroller on a mesh3d
 * plane, a race course from a tilemap's zones, turn-based battles in a modal sub-space of a real-time
 * space). The composition checker treats what it provides as provided on the space it is bound to,
 * when that space matches `from`.
 */
export interface Adapts {
  provides: { capabilities?: string[]; content?: string[]; services?: string[] };
  from: { spaces?: string[]; capabilities?: string[] };
  projection: string;
  /** The mashup relation the adapter realises (play spec): union (two concepts in one world), nested, skin. */
  relation?: 'union' | 'nested' | 'skin';
  /**
   * Sub-space adapters: an instance with an `id` defines a space of that id, of the space kind named by the
   * instance's `with[kind]` configured by `with[config]`. Its capabilities are that kind's (they are not added to
   * the host); `content` lists the world content the region takes from its host (cells, course).
   */
  subspace?: { kind: string; config?: string; content?: string[] };
}
/** What an adapter's adapt() hook receives: the host space, what it lacks, and the cards that need it. */
export interface AdaptRequest {
  space: { id: string; use: string; with: Record<string, any>; caps: string[] };
  missing: { capabilities: string[]; content: string[]; services: string[] };
  neededBy: Array<{ use: string; card: Card }>;
  registry: RegistryLike;
}
/** An adapter instance an adapt() hook proposes: its region id (sub-space adapters) and configuration. */
export interface AdaptProposal { id?: string; with: Record<string, any> }

/** A card as a primitive file writes it: params/provides/requires may be omitted (the Registry fills them). */
export interface CardInput {
  intent: string;
  views?: string[];
  params?: Params;
  provides?: Provides;
  requires?: Requires;
  conflicts?: string[];
  /** Document sections consumed (preflight warns on unread data). */
  reads?: string[];
  defines?: Define[];
  /** Pure vocabulary providers / test stand-ins: exempt from vocabulary_owner_missing. */
  ambient?: boolean;
  engage?: Engage;
  /** Continuous verbs for playtesters. */
  actionSpace?: Record<string, { type: 'number' | 'vector' | 'enum'; min?: number; max?: number; options?: unknown[] }>;
  /** Optional capabilities/services the primitive uses when present. */
  optional?: { capabilities?: string[]; services?: string[] };
  envelope?: unknown;
  // Composition-checker fields (v2/planner/compose-check.js):
  /** Spaces: the world content the space needs before it is playable. */
  /** content: the kinds the space needs; alternatives: other complete sets that also make it playable (world.js needSets). */
  needs?: { content?: string[]; alternatives?: string[][] };
  /** Component field schemas this primitive owns (component name -> field schema), read by repair. */
  components?: Record<string, ParamSchema>;
  /** Generators: the space primitive ids they can fill. */
  spaces?: string[];
  /** Adapters: see Adapts. */
  adapts?: Adapts;
  /** A mechanic's mode: how it is played (compose-check `mode` check). */
  mode?: CardMode;
  /** It acts for AI-controlled entities (planner/loop-check.js): see Drives. */
  drives?: Drives;
  /** Input primitives: the interactions they support ('realtime', 'turn', 'pointer', 'menu'...). */
  interactions?: string[];
  /** Shapes of document sections this card owns: section path -> schema or description. */
  data?: Record<string, unknown>;
  dataShapes?: Record<string, unknown>;
  [extra: string]: unknown;
}
/**
 * card.drives: the primitive acts for AI-controlled entities (opponents, rivals, AI sides). `components`: it drives
 * every entity carrying one of them; `loops`: the AI participants of these loop primitives (ids or prefixes);
 * `targets`: the AI participants of every loop that declares a target service (card.loop.targets / card.mode.targets,
 * see TargetService), steered toward the target it gives each; none of these: the AI-controlled participants of its
 * own loop. What the driven entities do, in the vocabulary of a loop end's
 * reads.by: player-style `actions` they take, `effects` they run, `events` they emit, `movement` (their bodies move,
 * touch and pass). Checked against the loops' losses (planner/loop-check.js loop_lose_unaffected_by_opponent).
 */
export interface Drives {
  control: 'ai';
  components?: string[];
  loops?: string[];
  targets?: boolean;
  actions?: string[];
  effects?: string[];
  events?: string[];
  movement?: boolean;
}
/** A card as the Registry stores it: params, provides and requires always present. */
/** card.mode (v2-card-modes): checked statically by v2/planner/compose-check.js. */
export interface CardMode {
  loop?: string;
  /** Matched against an input primitive's card.interactions. */
  interaction?: string;
  opponent?: string;
  /** Space primitive id(s) the mode is designed for; another space needs an adapter for what it lacks. */
  space?: string | string[];
  /** content: document sections ('content.cards') or world content kinds ('course'); participants: { param, min } or a count. */
  needs?: { content?: string[]; participants?: number | { param?: string; min?: number } };
  win?: { param: string };
  lose?: { param: string };
  /** A registered verify strategy id (v2/verify/strategies). */
  bot?: string;
  /** The service (TargetService) its install provides: where each of its AI-controlled participants goes next. */
  targets?: string;
}
/**
 * A loop's target service (card.loop.targets / card.mode.targets names it; the loop provides it at install): its
 * AI-controlled participants (entity ids; never the player) and, for each, where it should go now: a position, a zone
 * or an entity, or null while it has nowhere to go (a countdown, a kickoff, finished).
 */
export interface TargetService {
  participants(): string[];
  target(id: string): { at?: number[] | string; zone?: string; entity?: string } | null;
}
export interface Card extends CardInput {
  params: Params;
  provides: Provides;
  requires: Requires;
}

/** An instance as written in a document: spaces[], spaces[].generators[], systems[], graphics[]. */
export interface Instance {
  use: string;
  with?: Record<string, any>;
  id?: string;
  space?: string;
  [extra: string]: any;
}
/** What install(), validate() and extend() receive for an instance. */
export interface InstanceRef { key: string; use: string; with?: Record<string, any>; space?: string; id?: string; index?: number; [extra: string]: any }

export interface Problem { code: string; path: string; message: string; hint?: string; [extra: string]: unknown }

export interface ValidateContext {
  doc: Doc;
  registry: RegistryLike;
  indexes: Record<string, Set<string>>;
  warn(w: Problem): void;
  checkPredicate(p: any, path: string, errors: Problem[]): void;
  checkEffect(e: any, path: string, errors: Problem[]): void;
  /** id is document data (unknown until checked): a model may write anything where an id belongs. */
  noteRef(kind: string, id: unknown, path: string, mode: 'read' | 'write'): void;
  provides: { events: Set<string>; vars: Set<string>; services: Set<string> };
}

export interface Primitive {
  id: string;
  card: CardInput;
  logic?(logic: LogicLike): void;
  validate?(config: Record<string, any>, doc: Doc, ctx: ValidateContext, at: { path: string; id?: string; use: string; space?: string }): Problem[] | void;
  install?(rt: Runtime, config: Record<string, any>, instance: InstanceRef): void;
  /** instance is the document instance (no key). */
  extend?(rt: Runtime, config: Record<string, any>, added: Added, instance: Instance): void;
  /** Spaces whose capabilities depend on params. */
  capabilities?(config: Record<string, any>): string[];
  /** Adapters: the configuration projecting what a space lacks (planner/adapters.js), or null when it can't. */
  adapt?(request: AdaptRequest): AdaptProposal | null;
  /** Skin adapters: the document with this instance's content mapping applied (pure). */
  skin?(doc: Doc, config: Record<string, any>): Doc;
  [extra: string]: unknown;
}
/** A primitive as stored by the Registry: card params/provides/requires always present. */
export interface RegisteredPrimitive extends Primitive { family: string; card: Card }

export interface RegistryLike {
  get(id: string | undefined): RegisteredPrimitive | undefined;
  has(id: string | undefined): boolean;
  ids(family?: string): string[];
  cards(family?: string): Array<Card & { id: string }>;
}

// ---------- §5 logic ----------
export type Predicate = Record<string, any>;
export interface Effect { do: string; [field: string]: any }
export interface PredicateDef {
  check?(p: Predicate, path: string, errors: Problem[], ctx: any): void;
  refs?(p: Predicate): Array<[string, unknown]>;
  test(p: Predicate, rt: Runtime, context: Context): boolean;
}
export interface EffectDef {
  check?(e: Effect, path: string, errors: Problem[], ctx: any): void;
  refs?(e: Effect): Array<[string, unknown]>;
  run(e: Effect, rt: Runtime, context: Context): void;
}
export interface LogicLike {
  /** The primitive registering kinds during buildLogic (null after). */
  owner: string | null;
  ambient?: boolean;
  duplicates: Array<{ type: 'predicate' | 'effect'; kind: string; first: string; second: string }>;
  predicates: Map<string, PredicateDef>;
  effects: Map<string, EffectDef>;
  owners: { predicate: Map<string, string>; effect: Map<string, string> };
  predicate(kind: string, def: PredicateDef): void;
  effect(kind: string, def: EffectDef): void;
  kindOf(p: unknown): string | undefined;
  test(p: Predicate, rt: Runtime, context?: Context): boolean;
  run(effects: Effect[] | undefined, rt: Runtime, context?: Context): void;
  checkPredicate(p: unknown, path: string, errors: Problem[], ctx: any): void;
  checkEffect(e: unknown, path: string, errors: Problem[], ctx: any): void;
}
/**
 * context.self is the acting entity's id (rt.resolve('self') looks it up; KERNEL_API.md says "the acting entity");
 * defaultWho is the subject when a predicate/effect omits `who`.
 */
export interface Context { self?: string | null; defaultWho?: string; player?: Entity | null; [k: string]: any }

// ---------- document (gameverse.v2.game/0.2) ----------
export interface SpaceInstance extends Instance {
  id: string;
  zones?: Array<{ id: string; [k: string]: any }>;
  generators?: Instance[];
}
export interface Doc {
  schema: 'gameverse.v2.game/0.2';
  id: string;
  title: string;
  logline?: string;
  seed?: number | string;
  /** Either a list of views or { primary, alternates } (what outline.js and the hosts write). */
  views?: string[] | { primary?: string; alternates?: string[]; [k: string]: unknown };
  spaces: SpaceInstance[];
  systems?: Instance[];
  graphics?: Instance[];
  plot?: { storyboard?: { acts?: Array<{ id: string; beats?: Array<{ id: string; [k: string]: any }>; [k: string]: any }>; [k: string]: any }; [section: string]: any };
  content?: Record<string, any>;
  player?: { archetype: string; space?: string; at?: any; zone?: string; [k: string]: any };
  [extra: string]: any;
}
/** preflight's result: `doc` is the normalized, validated document exactly when `ok`. */
export type PreflightResult = {
  errors: Problem[];
  warnings: Problem[];
  /** Capabilities per space id (absent when the input was not a document). */
  capabilities?: Record<string, string[]>;
  ms?: number;
} & ({ ok: true; doc: Doc } | { ok: false; doc: null });

export interface Added { spaces: string[]; zones: Array<{ space: string; zone: string }>; systems: number[]; graphics: number[]; beats: string[]; acts: string[]; keys: string[] }

// ---------- §2 runtime ----------
export interface Body { size?: number[]; vel?: number[]; facing?: number | number[]; grounded?: boolean; layer?: string | number; solid?: boolean; oneWay?: boolean; [k: string]: any }
export interface Entity {
  id: string;
  archetype?: string;
  space?: string;
  at?: any;
  zone?: string | null;
  components: Record<string, any> & { body?: Body };
  [k: string]: any;
}
export interface State {
  schema: string; docId: string; frame: number; time: number; status: string; ending: string | null;
  rng: number; modal: any; vars: Record<string, any>; flags: Record<string, any>; counts: Record<string, number>;
  events: Array<{ name: string; [k: string]: any }>; entities: Record<string, Entity>; nextId: number;
  spaces: Record<string, any>; prim: Record<string, any>;
  /** Systems held by rt.hold: holder -> owners whose systems are skipped (absent when nothing is held). */
  held?: Record<string, string[]>;
}
export interface Input { actions?: Record<string, any>; axes?: Record<string, number[]>; held?: Record<string, boolean>; [k: string]: any }
export interface Option { label: string; actions?: Record<string, any>; steps?: number; apply?(rt: Runtime): void; [k: string]: any }
export type Phase = 'input' | 'ai' | 'movement' | 'physics' | 'interaction' | 'rules' | 'plot' | 'late';
export interface View { container: unknown; THREE?: unknown; act(actions: Record<string, any>): void; onFrame(fn: (alpha: number) => void): void; input?(): Input }

export interface Runtime {
  doc: Doc;
  registry: RegistryLike;
  logic: LogicLike;
  headless: boolean;
  view: View | null;
  dt: number;
  input: Input;
  caches: Record<string, any>;
  readonly state: State;
  random(): number;
  emit(name: string, data?: Record<string, any>): void;
  emitTyped(name: string, subject: unknown, data?: Record<string, any>): void;
  on(name: string, fn: (data: any, rt: Runtime) => void): void;
  system(phase: Phase | string, fn: (rt: Runtime) => void, owner?: string): void;
  action(name: string, fn: (value: any, rt: Runtime) => void, opts?: { ifAbsent?: boolean }): boolean;
  options(fn: (rt: Runtime) => Option[]): void;
  provide(name: string, api: any): void;
  service(name: string): any;
  defineSpace(id: string, api: SpaceApi): void;
  space(id: string): SpaceApi;
  spaces(): string[];
  store(key: string): Record<string, any>;
  spawn(archetype: string, opts?: { space?: string; at?: any; zone?: string; components?: Record<string, any>; id?: string }): Entity;
  despawn(id: string): void;
  entity(id: string): Entity | undefined;
  player(): Entity | undefined;
  query(...components: string[]): Entity[];
  resolve(who: unknown, context?: Context): Entity | undefined | null;
  moveToSpace(entity: Entity, spaceId: string, at?: any, zone?: string): void;
  test(pred: Predicate, context?: Context): boolean;
  run(effects: Effect[] | undefined, context?: Context): void;
  canRun(kind: string): boolean;
  canTest(kind: string): boolean;
  has(primitiveId: string): boolean;
  onRestore(fn: (rt: Runtime) => void): void;
  step(input?: Input): void;
  snapshot(): State;
  restore(snapshot: State): void;
  extend(doc: Doc, added: Added): void;
  availableOptions(): Option[];
  /** Options from every provider except `skip`. */
  optionsExcept(skip: (rt: Runtime) => Option[]): Option[];
  /** Registered player verbs. */
  actions(): string[];
  /** Run fn(rt) at the end of the current step, after every system. */
  defer(fn: (rt: Runtime) => void): void;
  openModal(owner: string, opts?: { actions?: string[]; kind?: string }): void;
  closeModal(owner?: string): void;
  /** Hold: skip the systems registered by `owners` until release(by) (nested loops hold the outer loop). State: state.held. */
  hold(by: string, owners: string[]): void;
  release(by: string): void;
  readonly modal: { owner: string; kind: string; actions: string[] } | null;
  hasService(name: string): boolean;
  archetype(id: string): { id: string; components?: Record<string, any>; [k: string]: any } | undefined;
  /** Capabilities a space instance reports (same as preflight's). */
  capabilities(spaceId?: string): string[];
  [extra: string]: any;
}

// ---------- §3 space API and capability interfaces ----------
export type Anchor = 'center' | 'cell' | 'slot' | 'min';
export interface ReachOpts { abilities?: unknown; envelope?: unknown; who?: unknown }

// Signatures follow the reference implementation (kernel/testing.js testSpace) and the kernel's calls.
// `at` is space-specific (a vector for continuous spaces, a cell for grids, a slot/zone for graphs): any.
export interface PositionCap {
  /** Called by rt.spawn / rt.moveToSpace once entity.space and entity.at are set. */
  place(entity: Entity, rt: Runtime): void;
  remove(entity: Entity, rt: Runtime): void;
  pos(entity: Entity): any;
  setPos(entity: Entity, at: any, rt: Runtime, opts?: Record<string, any>): void;
  /** Ids of the entities at a position. */
  entitiesAt(at: any, rt?: Runtime): string[];
  inZone(entity: Entity, zone: string, rt?: Runtime): boolean;
  zoneAt(at: any): string | null;
  teleport(entity: Entity, to: { zone?: string; at?: any }, rt: Runtime): void;
  /** Distance to the nearest zone / entity id / archetype named `target`; null when there is none. */
  nearest(entity: Entity, target: string, rt: Runtime): number | null;
}
export interface DistanceCap { distance(a: any, b: any, metric?: 'euclid' | 'manhattan' | 'path' | (string & {})): number }
export interface RayHit { hit: 'cell' | 'entity' | 'none' | (string & {}); at: any; normal: any; dist: number; cell?: any; [k: string]: any }
/** overlap returns the ids of entities whose bodies overlap a shape; contacts the solid contacts of a body. */
export interface OverlapCap {
  overlap(shape: { at: any; r?: number; size?: number[]; [k: string]: any }, filter?: (e: Entity) => boolean): string[];
  contacts(entity: Entity, rt?: Runtime): Array<{ normal: any; cell?: any; [k: string]: any }>;
}
export interface RaycastCap { raycast(from: any, dir: any, maxDist: number, opts?: Record<string, any>): RayHit }
export interface PathfindCap { path(from: any, to: any, opts?: Record<string, any>): any[] | null }
export interface ReachableCap { reachable(from: any, rt: Runtime, opts?: ReachOpts): Set<string>; canReach(a: any, b: any, rt: Runtime, opts?: ReachOpts): boolean }
export interface EditCellsCap {
  getCell(at: any, layer?: any): any;
  /** Returns whether the cell changed; logged with `by`. */
  setCell(at: any, block: any, rt: Runtime, by?: any): boolean;
  fill(box: any[], block: any, rt: Runtime): void;
  cellsIn(box: any[], layer?: any): Array<{ at: any; block: any; [k: string]: any }>;
  editLog(since?: number): any[];
}
export interface SlideResult { moved: boolean; blocked: Record<string, boolean>; grounded: boolean; [k: string]: any }
export interface GravityCap { gravityAt(at?: any): number[]; slide(entity: Entity, delta: number[], rt: Runtime): SlideResult; grounded(entity: Entity): boolean }
export interface NavigateCap { neighbors(at: any): any[]; canMove(entity: Entity, to: any, rt?: Runtime): boolean; move(entity: Entity, to: any, rt: Runtime, opts?: { force?: boolean; [k: string]: any }): boolean }
export interface SurfaceCap { groundAt(x: number, z: number): { y: number; normal: number[]; material: any }; slopeAt(...at: any[]): any; waterDepthAt(...at: any[]): number }
export interface OccupancyCap { occupant(at: any): string | null; cellsInRange(at: any, range: number, metric?: string): any[]; moveCost(...args: any[]): number; coverAt(...args: any[]): number }
export interface LosCap { los(a: any, b: any): { clear: boolean; cover: number; [k: string]: any }; visibleFrom(at: any, range: number): any[] }
export interface BoundsCap { bounds(): { min: number[]; max: number[] }; inBounds(at: any): boolean }

/** Capability name -> the interface a space must implement for it (catalog §1). */
export interface Capabilities {
  position: PositionCap; distance: DistanceCap; overlap: OverlapCap; raycast: RaycastCap; pathfind: PathfindCap;
  reachable: ReachableCap; editCells: EditCellsCap; gravity: GravityCap; navigate: NavigateCap; surface: SurfaceCap;
  occupancy: OccupancyCap; los: LosCap; bounds: BoundsCap;
}
export type CapabilityName = keyof Capabilities | 'wrap' | 'dynamics' | (string & {});

type OptionalCaps = Partial<DistanceCap & OverlapCap & RaycastCap & PathfindCap & ReachableCap & EditCellsCap & GravityCap & NavigateCap & SurfaceCap & OccupancyCap & LosCap & BoundsCap>;
/** Every capability interface: for conformance code that calls a method after checking the space reports it. */
export type FullSpaceApi = SpaceApi & DistanceCap & OverlapCap & RaycastCap & PathfindCap & ReachableCap & EditCellsCap & GravityCap & NavigateCap & SurfaceCap & OccupancyCap & LosCap & BoundsCap;
/**
 * What rt.defineSpace receives. Position is required: the kernel's spatial vocabulary (zone, near, teleport)
 * dispatches through the space an entity is in, and an entity is only in a space that placed it. Other
 * capability methods exist only when the card declares the capability; narrow with a cast after checking.
 */
export interface SpaceApi extends PositionCap, OptionalCaps {
  anchor?: Anchor;
  size?: number[];
  cellOf?(at: any): string;
  layers?: unknown[];
  [method: string]: any;
}
