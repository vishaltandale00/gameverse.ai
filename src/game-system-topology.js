/** Presentation-only topology. Dependencies are declared contracts, not execution edges. */
const CARD_WIDTH = 220;
const CARD_HEIGHT = 132;
const COLUMN_GAP = 40;
const ROW_GAP = 40;

function normalizedEdges(plan, roleIds) {
  const used = new Set();
  const reserved = new Set((plan?.dependencies || []).map(edge => edge.id).filter(Boolean));
  return (plan?.dependencies || []).flatMap((edge, index) => {
    const source = edge.from || edge.source || edge.sourceRole;
    const target = edge.to || edge.target || edge.targetRole;
    if (!roleIds.has(source) || !roleIds.has(target)) return [];
    const base = edge.id || `dependency-${index}`;
    let id = base;
    let suffix = 2;
    while (used.has(id) || (!edge.id && reserved.has(id)) || (id !== base && reserved.has(id))) id = `${base}-${suffix++}`;
    used.add(id);
    return [{ ...edge, id, source, target, contract: edge.contract ?? '' }];
  });
}

/** Condense strongly connected components before assigning directed layers. */
function layeredPositions(nodes, edges) {
  const outgoing = new Map(nodes.map(node => [node.id, []]));
  for (const edge of edges) outgoing.get(edge.source).push(edge.target);
  let nextIndex = 0;
  const indices = new Map(), low = new Map(), stack = [], onStack = new Set(), components = [];
  function visit(id) {
    indices.set(id, nextIndex);
    low.set(id, nextIndex++);
    stack.push(id);
    onStack.add(id);
    for (const target of outgoing.get(id)) {
      if (!indices.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id), low.get(target)));
      } else if (onStack.has(target)) low.set(id, Math.min(low.get(id), indices.get(target)));
    }
    if (low.get(id) === indices.get(id)) {
      const component = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== id);
      components.push(component);
    }
  }
  for (const node of nodes) if (!indices.has(node.id)) visit(node.id);
  const componentFor = new Map();
  components.forEach((members, index) => members.forEach(id => componentFor.set(id, index)));
  const successors = components.map(() => new Set()), indegree = components.map(() => 0), depth = components.map(() => 0);
  for (const edge of edges) {
    const from = componentFor.get(edge.source), to = componentFor.get(edge.target);
    if (from !== to && !successors[from].has(to)) {
      successors[from].add(to);
      indegree[to]++;
    }
  }
  const queue = components.map((_, index) => index).filter(index => indegree[index] === 0);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const from = queue[cursor];
    for (const to of successors[from]) {
      depth[to] = Math.max(depth[to], depth[from] + 1);
      if (--indegree[to] === 0) queue.push(to);
    }
  }
  const rows = [];
  for (const node of nodes) (rows[depth[componentFor.get(node.id)]] ||= []).push(node);
  const columns = Math.max(0, ...rows.map(row => row.length));
  const width = columns ? columns * CARD_WIDTH + (columns - 1) * COLUMN_GAP : 0;
  const positions = Object.create(null);
  rows.forEach((row, layer) => {
    const rowWidth = row.length * CARD_WIDTH + (row.length - 1) * COLUMN_GAP;
    row.forEach((node, column) => {
      positions[node.id] = { x: (width - rowWidth) / 2 + column * (CARD_WIDTH + COLUMN_GAP), y: layer * (CARD_HEIGHT + ROW_GAP) };
    });
  });
  return { positions, width, height: rows.length ? rows.length * CARD_HEIGHT + (rows.length - 1) * ROW_GAP : 0 };
}

export function buildSystemTopology(plan, { activeRoleId, focused = false } = {}) {
  const roles = plan?.roles || [];
  const roleIds = new Set(roles.map(role => role.id));
  const allEdges = normalizedEdges(plan, roleIds);
  const related = new Set(roleIds.has(activeRoleId) ? [activeRoleId] : []);
  for (const edge of allEdges) {
    if (edge.source === activeRoleId) related.add(edge.target);
    if (edge.target === activeRoleId) related.add(edge.source);
  }
  const nodes = focused && related.size ? roles.filter(role => related.has(role.id)) : [...roles];
  const visibleRoleIds = nodes.map(role => role.id);
  const visible = new Set(visibleRoleIds);
  const edges = allEdges.filter(edge => visible.has(edge.source) && visible.has(edge.target));
  return {
    nodes, edges, ...layeredPositions(nodes, edges), visibleRoleIds,
    relatedRoleIds: roles.filter(role => related.has(role.id)).map(role => role.id),
    roleCount: roles.length, edgeCount: allEdges.length,
    cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT,
  };
}

export function getSystemRoleContext(plan, roleId, choices = {}) {
  const roles = plan?.roles || [];
  const role = roles.find(item => item.id === roleId);
  const edges = normalizedEdges(plan, new Set(roles.map(item => item.id)));
  const choice = choices[roleId];
  const candidate = role?.candidates?.find(item => item.id === choice?.candidateId);
  const moduleId = choice?.moduleId || candidate?.moduleId || null;
  const sharedBundleRoles = role && typeof moduleId === 'string' && moduleId.trim()
    ? roles.filter(other => {
      if (other.id === roleId) return false;
      const selected = choices[other.id];
      if (!selected) return false;
      const selectedCandidate = other.candidates?.find(item => item.id === selected.candidateId);
      return (selected.moduleId || selectedCandidate?.moduleId) === moduleId;
    }) : [];
  return {
    role, moduleId,
    incoming: edges.filter(edge => edge.target === roleId),
    outgoing: edges.filter(edge => edge.source === roleId),
    ownedState: role ? (plan?.sharedState || []).filter(state => state.owner === roleId) : [],
    sharedBundleRoles,
  };
}
