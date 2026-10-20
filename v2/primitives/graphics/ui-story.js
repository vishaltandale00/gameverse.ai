// Narrative presentation for any game: current scene, story log, inventory
// and the player's available options as buttons. The default renderer for
// graph spaces, and a fallback/overlay for others.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default {
  id: 'graphics.ui.story',
  card: {
    intent: 'Shows the current scene, a running story log of dialogue and events, the inventory, and the available choices as buttons; renders endings.',
    views: ['text', 'overlay'],
    params: {
      log: { type: 'integer', default: 40, min: 5, max: 400, unit: 'lines', effect: 'story lines kept on screen' },
      style: { type: 'string', default: 'book', options: ['book', 'terminal', 'comic'], effect: 'typography and framing' },
    },
    reads: ['plot.characters', 'plot.endings', 'content.items'],
  },
  install(rt, config) {
    const view = rt.view; if (!view?.container) return;
    const doc = () => rt.doc;
    const name = id => doc().plot?.characters?.find(c => c.id === id)?.name || id;
    const item = id => doc().content?.items?.find(i => i.id === id)?.name || id;
    const root = document.createElement('section');
    root.className = `gv-story gv-story-${config.style}`;
    root.innerHTML = `<header class="gv-scene"><p class="gv-kicker"></p><h2></h2><p class="gv-desc"></p></header>
      <ol class="gv-log" aria-live="polite"></ol><div class="gv-choices" role="group" aria-label="Choices"></div>
      <footer class="gv-bag"><span>Carrying</span><ul></ul></footer><div class="gv-ending" hidden></div>`;
    view.container.append(root);
    const q = s => root.querySelector(s), lines = [];
    const push = (kind, html) => { lines.push(`<li class="gv-${kind}">${html}</li>`); if (lines.length > config.log) lines.shift(); q('.gv-log').innerHTML = lines.join(''); q('.gv-log').scrollTop = 1e9; };
    rt.on('say', e => push('say', `<b>${esc(name(e.character))}</b> ${esc(e.text)}`));
    rt.on('item_gained', e => e.who === 'player' && push('note', `You take the <b>${esc(item(e.item))}</b>.`));
    rt.on('blocked', () => push('note', 'That way is closed to you, for now.'));
    rt.on('beat', e => { const b = doc().plot?.storyboard?.acts?.flatMap(a => a.beats || []).find(x => x.id === e.beat); if (b?.title) push('beat', esc(b.title)); });
    rt.on('act_start', e => { const a = doc().plot?.storyboard?.acts?.find(x => x.id === e.act); push('act', esc(a?.title || e.act)); });
    rt.on('content_added', e => push('note', `The world grows: ${e.zones} new places, ${e.beats} new story beats.`));
    let last = '';
    view.onFrame(() => {
      const p = rt.player(), space = p?.space ? rt.space(p.space) : null;
      const zone = space?.zones?.get?.(p.at);
      const options = rt.state.status === 'playing' ? rt.availableOptions() : [];
      const bag = Object.entries(rt.state.prim['gameplay.inventory']?.player || {});
      const key = JSON.stringify([p?.at, options.map(o => o.label), bag, rt.state.status]);
      if (key === last) return; last = key;
      q('.gv-kicker').textContent = doc().title || '';
      q('h2').textContent = zone?.name || p?.at || '';
      q('.gv-desc').textContent = zone?.description || '';
      const label = o => { const to = o.actions?.go; const z = to && space?.zones?.get?.(to); return z ? `Go to ${z.name}` : o.label; };
      q('.gv-choices').innerHTML = options.map((o, i) => `<button data-i="${i}">${esc(label(o))}</button>`).join('');
      q('.gv-choices').onclick = e => { const b = e.target.closest('button'); if (b) view.act(options[Number(b.dataset.i)].actions); };
      q('.gv-bag ul').innerHTML = bag.map(([id, n]) => `<li>${esc(item(id))}${n > 1 ? ` ×${n}` : ''}</li>`).join('') || '<li class="gv-empty">nothing</li>';
      if (rt.state.status !== 'playing') {
        const ending = doc().plot?.endings?.find(x => x.id === rt.state.ending);
        q('.gv-ending').hidden = false;
        q('.gv-ending').innerHTML = `<h3>${esc(ending?.title || (rt.state.status === 'won' ? 'The end' : 'Game over'))}</h3><p>${esc(ending?.text || '')}</p>`;
      }
    });
  },
};
