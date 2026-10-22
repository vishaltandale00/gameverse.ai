// Experiment service for the server routes (v2/kits/EXTENDING.md, tier 3): generate, check and
// repair one experiment for a stored kit game. Routes and UI live with the integrator; this
// module only needs an OpenAI-style client ({ complete }) from v2/planner/openai.js.
import { loadKit } from '../kits/registry.js';
import { generateExperiment, experimentModel, experimentEffort } from './generate.js';

const KIT_GAME_SCHEMA = 'gameverse.v2.kit-game/0.1';

export function createExperimentService({ client, model = experimentModel(), effort = experimentEffort(model), repairs = 2, maxConcurrent = 2 } = {}) {
  if (!client?.complete) throw Error('the experiment service needs a model client');
  let running = 0;
  return {
    model,
    /** experiment({ record, kit?, request }) -> { experiment, check, report }. Throws { status } errors for bad input. */
    async experiment({ record, kit, request }) {
      const doc = record?.doc || record;
      if (doc?.schema !== KIT_GAME_SCHEMA) throw Object.assign(Error('Experiments need a kit game.'), { status: 400 });
      const text = String(request ?? '').trim().slice(0, 500);
      if (!text) throw Object.assign(Error('Say what the experiment should add.'), { status: 400 });
      if (running >= maxConcurrent) throw Object.assign(Error('Too many experiments are being made right now; try again in a moment.'), { status: 429 });
      const theKit = kit && typeof kit === 'object' ? kit : await loadKit(kit || doc.kit);
      running++;
      try {
        const { experiment, report } = await generateExperiment({ client, model, effort, kit: theKit, record: { ...record, doc }, request: text, repairs });
        return { experiment, check: experiment.check, report };
      } finally { running--; }
    },
  };
}
