import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemTopology, getSystemRoleContext } from '../src/game-system-topology.js';

const roles = (...ids) => ids.map(id => ({ id, label: id }));

test('branch and fan-in contracts form directed layers without adding edges', () => {
  const plan = { roles: roles('root', 'left', 'right', 'join'), dependencies: [
    { from: 'root', to: 'left', contract: 'Root → left exactly.' },
    { source: 'root', target: 'right' },
    { sourceRole: 'left', targetRole: 'join' },
    { from: 'right', to: 'join' },
  ] };
  const result = buildSystemTopology(plan);
  assert.equal(result.nodes.length, 4);
  assert.equal(result.edges.length, 4);
  assert.equal(result.edges[0].contract, plan.dependencies[0].contract);
  const p = result.positions;
  assert.ok(p.root.y < p.left.y);
  assert.equal(p.left.y, p.right.y);
  assert.ok(p.left.y < p.join.y);
  assert.ok(Math.abs(p.left.x - p.right.x) >= 260);
  assert.equal(p.root.x, p.join.x);
  assert.deepEqual(buildSystemTopology(plan), result);
});

test('cycles and self-links survive condensation with finite non-overlapping positions', () => {
  const plan = { roles: roles('a', 'b', 'c'), dependencies: [
    { from: 'a', to: 'b' }, { from: 'b', to: 'a' },
    { from: 'a', to: 'a' }, { from: 'b', to: 'c' },
  ] };
  const graph = buildSystemTopology(plan);
  assert.equal(graph.edges.length, 4);
  assert.equal(graph.positions.a.y, graph.positions.b.y);
  assert.notDeepEqual(graph.positions.a, graph.positions.b);
  assert.ok(graph.positions.c.y > graph.positions.a.y);
  assert.ok(Object.values(graph.positions).every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('empty and disconnected plans have no inferred relationships', () => {
  const empty = buildSystemTopology();
  assert.equal(empty.width, 0);
  assert.equal(empty.height, 0);
  const graph = buildSystemTopology({ roles: roles('a', 'b', 'c'), sharedState: [{ id: 'actor', owner: 'a' }] });
  assert.equal(graph.edges.length, 0);
  assert.equal(new Set(Object.values(graph.positions).map(p => `${p.x},${p.y}`)).size, 3);
});

test('dangling dependencies are excluded and duplicate contracts retain stable unique identity', () => {
  const plan = { roles: roles('a', 'b'), dependencies: [
    { id: 'exact', from: 'a', to: 'b', contract: 'Keep  spacing\nintact' },
    { id: 'exact', from: 'a', to: 'b' },
    { id: 'exact-2', from: 'b', to: 'a' },
    { from: 'missing', to: 'b' }, { from: 'a', to: 'missing' },
  ] };
  const graph = buildSystemTopology(plan);
  assert.equal(graph.edgeCount, 3);
  assert.equal(graph.edges[0].id, 'exact');
  assert.equal(graph.edges[2].id, 'exact-2');
  assert.equal(new Set(graph.edges.map(edge => edge.id)).size, 3);
  assert.equal(graph.edges[0].contract, 'Keep  spacing\nintact');
});

test('focus keeps immediate incoming and outgoing neighbors and reports whole-plan counts', () => {
  const plan = { roles: roles('a', 'b', 'c', 'd', 'isolated'), dependencies: [
    { from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' },
  ] };
  const graph = buildSystemTopology(plan, { activeRoleId: 'b', focused: true });
  assert.deepEqual(graph.visibleRoleIds, ['a', 'b', 'c']);
  assert.deepEqual(graph.relatedRoleIds, ['a', 'b', 'c']);
  assert.equal(graph.edges.length, 2);
  assert.equal(graph.edgeCount, 3);
  assert.equal(graph.roleCount, 5);
  assert.deepEqual(buildSystemTopology(plan, { activeRoleId: 'isolated', focused: true }).visibleRoleIds, ['isolated']);
  assert.equal(buildSystemTopology(plan, { activeRoleId: 'unknown', focused: true }).nodes.length, 5);
});

test('role context uses explicit state ownership and exact selected module identity', () => {
  const plan = { roles: [
    { id: 'a', candidates: [{ id: 'same-name', moduleId: 'bundle.1', sourceGame: 'game' }] },
    { id: 'b', candidates: [{ id: 'same-name', moduleId: 'bundle.1', sourceGame: 'game' }] },
    { id: 'c', candidates: [{ id: 'same-name', moduleId: 'bundle.2', sourceGame: 'game' }] },
    { id: 'd', candidates: [{ id: 'same-name', sourceGame: 'game' }] },
  ], dependencies: [{ from: 'a', to: 'c' }], sharedState: [
    { id: 'actor', owner: 'a', fields: ['position'] }, { id: 'enemy', owner: 'c' },
  ] };
  const choices = Object.fromEntries(plan.roles.map(role => [role.id, { candidateId: 'same-name' }]));
  const context = getSystemRoleContext(plan, 'a', choices);
  assert.deepEqual(context.sharedBundleRoles.map(role => role.id), ['b']);
  assert.deepEqual(context.ownedState.map(state => state.id), ['actor']);
  assert.equal(context.incoming.length, 0);
  assert.equal(context.outgoing.length, 1);
  assert.equal(getSystemRoleContext(plan, 'd', choices).sharedBundleRoles.length, 0);
  assert.equal(getSystemRoleContext(plan, 'c', choices).ownedState.length, 1);
  assert.equal(buildSystemTopology(plan).nodes.length, 4);
  assert.equal(plan.sharedState.length, 2);
});
