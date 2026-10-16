export const IR_REQUEST_SCHEMA = 'gameverse.ir.generation-request/0.1';
export const IR_SUBMISSION_SCHEMA = 'gameverse.ir.ui-submission/0.1';

export function packagesForSelections(catalog, selections) {
  const ids = [...new Set(Object.entries(selections).flatMap(([role, id]) =>
    catalog.roles[role]?.find(option => option.id === id)?.packages || []))];
  return ids.map(id => catalog.components.find(component => component.id === id)).filter(Boolean);
}

export function sourceGamesForSelections(catalog, selections) {
  return [...new Set(packagesForSelections(catalog, selections).map(component => component.source_game))];
}

export function selectionBlockers(catalog, selections, parents) {
  const blockers = [];
  for (const [role, options] of Object.entries(catalog.roles)) {
    const option = options.find(item => item.id === selections[role]);
    if (!option || option.status !== 'available') { blockers.push(`${role}: a qualified adapter is still needed.`); continue; }
    for (const id of option.packages) {
      const component = catalog.components.find(item => item.id === id);
      if (!component?.installed) blockers.push(`${id}: its exact private package must be available locally.`);
      else if (component.qualification?.status !== 'pass') blockers.push(`${id}: original/native qualification is incomplete.`);
    }
  }
  const used = sourceGamesForSelections(catalog, selections);
  for (const id of parents) if (!used.includes(id)) blockers.push(`${id}: no selected executable component contributes this game.`);
  for (const id of used) if (!parents.includes(id)) blockers.push(`${id}: add this source game to the mix.`);
  return blockers;
}

export function createIrSubmission(catalog, selections, parents, title, intent, requestId) {
  if (!/^[A-Za-z0-9 _-]{1,12}$/.test(title)) throw Error('Use 1–12 letters, numbers, spaces, hyphens or underscores for the cartridge title.');
  const blockers = selectionBlockers(catalog, selections, parents);
  if (blockers.length) throw Error(blockers[0]);
  return { schema: IR_SUBMISSION_SCHEMA, request: { schema: IR_REQUEST_SCHEMA, request_id: requestId,
    title, selections: { ...selections }, qualification: { run: true } },
  context: { parent_game_ids: [...parents], intent: intent.slice(0, 4000) } };
}
