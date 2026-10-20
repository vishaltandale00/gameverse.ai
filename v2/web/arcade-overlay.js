// Markup for the arcade screens: title, level intro banner, pause, game over
// and victory. Pure string builders (no DOM access), styled by arcade.css.
import { formatTime, objective } from '../engine/juice.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kbd = k => `<kbd>${esc(k)}</kbd>`;
const pad = k => `<kbd class="pad">${esc(k)}</kbd>`;

/** What the game needs from the controls card: view, shooting, extra jumps. */
export function controlsInfo(spec) {
  const mod = id => spec.modules?.find(m => m.use === id);
  return { side: spec.view !== 'topdown', shoot: !!mod('shooter'), airJumps: mod('platformer')?.with?.airJumps || 0 };
}

export function controlRows(device, { side = true, shoot = false, airJumps = 0 } = {}) {
  const gp = device === 'gamepad';
  const rows = [['Move', gp ? `${pad('✚')} or ${pad('L')}` : side ? `${kbd('←')}${kbd('→')} or ${kbd('A')}${kbd('D')}` : `${kbd('←')}${kbd('↑')}${kbd('↓')}${kbd('→')} or ${kbd('WASD')}`]];
  if (side) rows.push([airJumps ? (airJumps > 1 ? 'Jump (×3 in air)' : 'Jump (double)') : 'Jump', gp ? pad('A') : `${kbd('Space')} or ${kbd('Z')}`]);
  if (shoot) rows.push(['Fire', gp ? pad('X') : `${kbd('X')} or ${kbd('K')}`]);
  rows.push(['Pause', gp ? pad('Start') : kbd('Esc')]);
  if (!gp) rows.push(['Restart', kbd('R')]);
  return rows;
}
export const controlsCard = (device, info) => `<dl class="gv-keys">${controlRows(device, info).map(([label, keys]) => `<div><dt>${esc(label)}</dt><dd>${keys}</dd></div>`).join('')}</dl>`;
export const pressStart = device => device === 'gamepad' ? `Press ${pad('A')} or ${pad('Start')}` : `Press ${kbd('Enter')} to start`;
export function helpLine(device, info) {
  return controlRows(device, info).map(([label, keys]) => `<span>${esc(label.replace(/ \(.*\)/, ''))} ${keys}</span>`).join('');
}

/** Split "Name: Subtitle" titles into a large name and a smaller line. */
export function titleParts(title = '') {
  const m = String(title).match(/^(.{2,}?)\s*[:–—-]\s+(.+)$/);
  return m ? [m[1], m[2]] : [String(title), ''];
}

export function titleScreen({ spec, device, art }) {
  const [name, sub] = titleParts(spec.title);
  const info = controlsInfo(spec);
  return `<section class="gv-title" aria-label="${esc(spec.title)} title screen">
    ${art ? `<div class="gv-keyart"><img src="${esc(art)}" alt=""></div>` : ''}
    <div class="gv-title-main">
      <h2 class="gv-name"><span>${esc(name)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</h2>
      ${spec.pitch ? `<p class="gv-pitch">${esc(spec.pitch)}</p>` : ''}
      <button type="button" class="gv-start" data-action="start" data-hint="press">${pressStart(device)}</button>
    </div>
    <aside class="gv-card gv-controls" aria-label="Controls">
      <h3>How to play</h3>
      <p class="gv-goal">${esc(objective(spec))}</p>
      <div data-hint="controls">${controlsCard(device, info)}</div>
    </aside>
  </section>`;
}

export const introBanner = ({ spec, go = false }) => `<div class="gv-banner${go ? ' go' : ''}" role="status">
  <p>${esc(titleParts(spec.title)[0])}</p><strong>${go ? 'Go!' : 'Ready?'}</strong></div>`;

export function pauseScreen({ spec, device, muted, howto = false }) {
  return `<section class="gv-menu${howto ? ' gv-with-howto' : ''}" role="dialog" aria-modal="true" aria-label="Paused">
    <h2>Paused</h2>
    <div class="gv-menu-body">
    ${howto ? `<div class="gv-card gv-howto"><p class="gv-goal">${esc(objective(spec))}</p><div data-hint="controls">${controlsCard(device, controlsInfo(spec))}</div></div>` : ''}
    <div class="gv-buttons">
      <button type="button" data-action="resume">Resume</button>
      <button type="button" data-action="restart">Restart</button>
      <button type="button" data-action="sound" aria-pressed="${!muted}">Sound: ${muted ? 'Off' : 'On'}</button>
      <button type="button" data-action="howto" aria-expanded="${howto}">${howto ? 'Hide controls' : 'How to play'}</button>
      <button type="button" data-action="title">Quit to title</button>
    </div>
    </div>
  </section>`;
}

export function gameOverScreen({ reason, stats }) {
  return `<section class="gv-menu gv-over" role="dialog" aria-modal="true" aria-label="Game over">
    <h2>Game over</h2>
    <p class="gv-reason">${esc(reason)}</p>
    ${statsList(stats)}
    <div class="gv-buttons">
      <button type="button" data-action="restart">Retry</button>
      <button type="button" data-action="title">Title screen</button>
    </div>
  </section>`;
}

export function victoryScreen({ stats, best, isNew }) {
  return `<section class="gv-menu gv-win" role="dialog" aria-modal="true" aria-label="Level clear">
    <h2>Level clear!</h2>
    ${statsList(stats, { best, isNew })}
    <div class="gv-buttons">
      <button type="button" data-action="restart">Play again</button>
      <button type="button" data-action="title">Title screen</button>
    </div>
  </section>`;
}

function statsList(stats, { best = null, isNew = false } = {}) {
  const rows = [['Time', formatTime(stats.seconds)]];
  if (best != null) rows.push(['Best', `${formatTime(best)}${isNew ? ' <em class="gv-new">New best!</em>' : ''}`]);
  if (stats.pickupsTotal) rows.push(['Pickups', `${stats.pickups} / ${stats.pickupsTotal}`]);
  if (stats.enemiesTotal) rows.push(['Enemies', `${stats.enemies} / ${stats.enemiesTotal}`]);
  return `<dl class="gv-stats">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
}
