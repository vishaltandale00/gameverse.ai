// The stylesheet shared by every UI primitive: design tokens per theme,
// typography, panels, focus, and the motion vocabulary (enter, exit, pop,
// shake, drain, pulse). Themes are data-theme values; a primitive's `style`
// param sets data-theme on its own root, so tokens cascade per widget.
// No external fonts or images: system font stacks and CSS only.

export const THEMES = ['clean', 'pixel', 'ink', 'parchment', 'book', 'terminal', 'comic', 'neon'];

/** 'auto' picks a theme from the document's look; anything else is kept if known. */
export function resolveTheme(doc, style = 'auto') {
  if (THEMES.includes(style)) return style;
  if (style && style !== 'auto') return 'clean';
  const g = (doc?.graphics || []).map(x => x.use);
  if (g.some(u => /sprite\.pixel|tileset\.pixel/.test(u))) return 'pixel';
  if ((doc?.spaces || []).every(s => /space\.(graph|none)/.test(s.use || '')) && !g.some(u => /render\./.test(u))) return 'book';
  return 'clean';
}

const SANS = `'Inter', 'SF Pro Text', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
const DISPLAY = `'SF Pro Display', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
const SERIF = `'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, 'Times New Roman', serif`;
const MONO = `ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, 'Liberation Mono', monospace`;
const COMIC = `'Comic Neue', 'Chalkboard SE', 'Comic Sans MS', 'Marker Felt', 'Trebuchet MS', sans-serif`;

export const THEME_CSS = `
.gv-view{position:relative;overflow:hidden}
.gv-overlay{
  --gv-font:${SANS};--gv-display:${DISPLAY};--gv-size:15px;
  --gv-ink:#f4f1ea;--gv-ink-dim:rgba(244,241,234,.66);--gv-ink-faint:rgba(244,241,234,.38);
  --gv-panel:rgba(14,16,24,.82);--gv-panel-2:rgba(255,255,255,.06);--gv-edge:rgba(255,255,255,.14);
  --gv-accent:#f2b84b;--gv-accent-ink:#1a1206;--gv-accent-2:#6fb7ff;
  --gv-good:#6fd08c;--gv-bad:#ff5d5d;--gv-warn:#ffc04d;--gv-mana:#5aa8ff;
  --gv-radius:12px;--gv-radius-sm:7px;--gv-bw:1px;--gv-shadow:0 10px 30px rgba(0,0,0,.45),0 2px 6px rgba(0,0,0,.35);
  --gv-text-shadow:0 1px 2px rgba(0,0,0,.65);--gv-blur:blur(10px) saturate(1.2);--gv-ease:cubic-bezier(.2,.8,.2,1);--gv-spring:cubic-bezier(.34,1.56,.64,1);
  --gv-hud-scale:1;--gv-upper:none;--gv-track:0;
  position:absolute;inset:0;pointer-events:none;z-index:5;overflow:hidden;
  font:500 var(--gv-size)/1.4 var(--gv-font);color:var(--gv-ink);letter-spacing:var(--gv-track);
  -webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums;user-select:none;-webkit-user-select:none}
.gv-overlay *,.gv-overlay *::before,.gv-overlay *::after{box-sizing:border-box}
[data-theme=pixel]{--gv-font:${MONO};--gv-display:${MONO};--gv-size:14px;--gv-panel:#141022;--gv-panel-2:#241d38;--gv-edge:#f4f1ea;
  --gv-radius:0px;--gv-radius-sm:0px;--gv-bw:3px;--gv-shadow:4px 4px 0 rgba(0,0,0,.55);--gv-text-shadow:2px 2px 0 #000;--gv-blur:none;--gv-upper:uppercase;--gv-track:.06em;--gv-ease:steps(4,end);--gv-accent:#ffd23f}
[data-theme=ink]{--gv-font:${SERIF};--gv-display:${SERIF};--gv-size:16px;--gv-panel:rgba(10,9,8,.86);--gv-panel-2:rgba(255,240,220,.06);--gv-edge:rgba(230,205,160,.28);
  --gv-accent:#d9a85b;--gv-ink:#efe6d6;--gv-radius:3px;--gv-radius-sm:2px;--gv-track:.01em}
[data-theme=parchment]{--gv-font:${SERIF};--gv-display:${SERIF};--gv-size:16px;--gv-ink:#2e2216;--gv-ink-dim:rgba(46,34,22,.7);--gv-ink-faint:rgba(46,34,22,.42);
  --gv-panel:linear-gradient(180deg,#f3e6c8,#e6d2a8);--gv-panel-2:rgba(90,60,20,.08);--gv-edge:#7a5a30;--gv-accent:#8a3a1c;--gv-accent-ink:#fff4e0;
  --gv-text-shadow:none;--gv-radius:4px;--gv-bw:2px;--gv-shadow:0 8px 26px rgba(30,16,4,.45);--gv-blur:none}
[data-theme=book]{--gv-font:${SERIF};--gv-display:${SERIF};--gv-size:17px;--gv-ink:#2a2420;--gv-ink-dim:rgba(42,36,32,.68);--gv-ink-faint:rgba(42,36,32,.4);
  --gv-panel:#f7f1e3;--gv-panel-2:rgba(60,40,20,.06);--gv-edge:rgba(60,40,20,.22);--gv-accent:#9c3d2a;--gv-accent-ink:#fff;--gv-text-shadow:none;--gv-shadow:0 6px 24px rgba(40,24,10,.25);--gv-blur:none;--gv-radius:6px}
[data-theme=terminal]{--gv-font:${MONO};--gv-display:${MONO};--gv-ink:#9dffb0;--gv-ink-dim:rgba(157,255,176,.66);--gv-ink-faint:rgba(157,255,176,.35);--gv-panel:rgba(2,10,4,.9);
  --gv-edge:rgba(157,255,176,.45);--gv-accent:#d8ff6a;--gv-accent-ink:#021004;--gv-radius:0;--gv-radius-sm:0;--gv-text-shadow:0 0 6px rgba(120,255,150,.55);--gv-blur:none}
[data-theme=comic]{--gv-font:${COMIC};--gv-display:${COMIC};--gv-size:16px;--gv-ink:#111;--gv-ink-dim:#333;--gv-ink-faint:#666;--gv-panel:#fffdf3;--gv-panel-2:#fff1b8;--gv-edge:#111;
  --gv-accent:#ff3b30;--gv-accent-ink:#fff;--gv-bw:3px;--gv-radius:14px;--gv-shadow:5px 5px 0 #111;--gv-text-shadow:none;--gv-blur:none;--gv-upper:uppercase}
[data-theme=neon]{--gv-panel:rgba(8,4,24,.8);--gv-edge:rgba(255,80,220,.55);--gv-accent:#ff4fd8;--gv-accent-2:#38f2ff;--gv-ink:#f6f0ff;
  --gv-text-shadow:0 0 8px rgba(255,79,216,.7);--gv-shadow:0 0 18px rgba(255,79,216,.35),0 0 2px rgba(56,242,255,.8)}

.gv-layer{position:absolute;inset:0;pointer-events:none}
.gv-hide{display:none!important}
.gv-panel{pointer-events:auto;background:var(--gv-panel);border:var(--gv-bw) solid var(--gv-edge);border-radius:var(--gv-radius);
  box-shadow:var(--gv-shadow);backdrop-filter:var(--gv-blur);-webkit-backdrop-filter:var(--gv-blur);color:var(--gv-ink)}
.gv-display{font-family:var(--gv-display);font-weight:800;letter-spacing:-.015em;text-transform:var(--gv-upper)}
[data-theme=pixel] .gv-display{letter-spacing:.04em}
.gv-dim{color:var(--gv-ink-dim)}.gv-faint{color:var(--gv-ink-faint)}
.gv-kbd{display:inline-grid;place-items:center;min-width:1.7em;height:1.7em;padding:0 .45em;border-radius:6px;font:700 .78em/1 var(--gv-font);
  background:var(--gv-ink);color:var(--gv-panel-solid,#14161f);box-shadow:0 2px 0 rgba(0,0,0,.45);text-transform:none;letter-spacing:0;vertical-align:middle}
[data-theme=parchment] .gv-kbd,[data-theme=book] .gv-kbd,[data-theme=comic] .gv-kbd{background:var(--gv-ink);color:#fff8e8}
.gv-btn{pointer-events:auto;appearance:none;display:flex;align-items:center;gap:.6em;width:100%;text-align:left;cursor:pointer;
  font:600 1em/1.25 var(--gv-font);color:var(--gv-ink);background:var(--gv-panel-2);border:var(--gv-bw) solid transparent;border-radius:var(--gv-radius-sm);
  padding:.62em .9em;text-transform:var(--gv-upper);letter-spacing:var(--gv-track);transition:background .16s var(--gv-ease),transform .16s var(--gv-ease),border-color .16s,color .16s}
.gv-btn:hover,.gv-btn.is-focus{background:var(--gv-accent);color:var(--gv-accent-ink);transform:translateX(4px)}
.gv-btn.is-focus{box-shadow:0 0 0 2px var(--gv-accent),0 0 18px color-mix(in srgb,var(--gv-accent) 45%,transparent)}
.gv-btn[disabled],.gv-btn.is-disabled{opacity:.42;cursor:default;transform:none}
.gv-btn[disabled].is-focus{background:var(--gv-panel-2);color:var(--gv-ink);box-shadow:0 0 0 2px var(--gv-ink-faint)}
.gv-btn:focus{outline:none}
.gv-hints{display:flex;gap:1.2em;flex-wrap:wrap;justify-content:flex-end;font-size:.8em;color:var(--gv-ink-dim)}
.gv-hints span{display:inline-flex;gap:.45em;align-items:center}
.gv-modal-open [data-layer=hud]{opacity:.25;filter:saturate(.5);transition:opacity .25s,filter .25s}
[data-layer=hud]{transition:opacity .25s,filter .25s}
.gv-icon{display:inline-block;width:1.25em;height:1.25em;vertical-align:-.25em;flex:none}
.gv-icon svg{width:100%;height:100%;display:block;overflow:visible}

@keyframes gv-in-up{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes gv-in-down{from{opacity:0;transform:translateY(-14px)}to{opacity:1;transform:none}}
@keyframes gv-in-scale{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}
@keyframes gv-in-left{from{opacity:0;transform:translateX(-28px)}to{opacity:1;transform:none}}
@keyframes gv-in-right{from{opacity:0;transform:translateX(28px)}to{opacity:1;transform:none}}
@keyframes gv-out{to{opacity:0;transform:translateY(8px) scale(.98)}}
@keyframes gv-fade-in{from{opacity:0}to{opacity:1}}
@keyframes gv-pop{0%{transform:scale(1)}35%{transform:scale(1.32)}100%{transform:scale(1)}}
@keyframes gv-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-5px)}40%{transform:translateX(5px)}60%{transform:translateX(-3px)}80%{transform:translateX(2px)}}
@keyframes gv-flash{0%{filter:brightness(2.4)}100%{filter:none}}
@keyframes gv-pulse{0%,100%{opacity:1}50%{opacity:.45}}
@keyframes gv-glow{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--gv-bad) 0%,transparent)}50%{box-shadow:0 0 14px 2px color-mix(in srgb,var(--gv-bad) 70%,transparent)}}
@keyframes gv-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes gv-blink{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes gv-rise{0%{opacity:0;transform:translate(-50%,6px) scale(.8)}15%{opacity:1;transform:translate(-50%,0) scale(1.08)}70%{opacity:1}100%{opacity:0;transform:translate(-50%,-34px) scale(.96)}}
@keyframes gv-break{0%{transform:scale(1)}40%{transform:scale(1.35) rotate(-8deg);filter:brightness(2)}100%{transform:scale(1);filter:none}}
@keyframes gv-banner{0%{opacity:0;letter-spacing:.5em}18%{opacity:1;letter-spacing:.14em}80%{opacity:1}100%{opacity:0;letter-spacing:.2em}}
@keyframes gv-line{0%{transform:scaleX(0)}20%,80%{transform:scaleX(1)}100%{transform:scaleX(0)}}
@keyframes gv-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
@keyframes gv-drift{from{transform:translate3d(0,0,0)}to{transform:translate3d(-50%,-12%,0)}}
@keyframes gv-hue{from{filter:hue-rotate(0)}to{filter:hue-rotate(360deg)}}
.is-pop{animation:gv-pop .32s var(--gv-spring)}
.is-shake{animation:gv-shake .34s linear}
.is-flash{animation:gv-flash .4s ease-out}
.gv-reduced *,.gv-reduced *::before,.gv-reduced *::after{animation-duration:.001s!important;animation-iteration-count:1!important;transition-duration:.001s!important}
@media (prefers-reduced-motion:reduce){.gv-overlay *{animation-duration:.001s!important;animation-iteration-count:1!important;transition-duration:.001s!important}}

/* ---------------------------------------------------------------- HUD */
.gv-hud{position:absolute;inset:0;padding:clamp(10px,2.2vmin,22px);font-size:calc(var(--gv-size) * var(--gv-hud-scale));text-shadow:var(--gv-text-shadow)}
.gv-anchor{position:absolute;display:flex;flex-direction:column;gap:8px;max-width:44%}
.gv-anchor[data-pos^=top]{top:clamp(10px,2.2vmin,22px)}.gv-anchor[data-pos^=bottom]{bottom:clamp(10px,2.2vmin,22px);flex-direction:column-reverse}
.gv-anchor[data-pos$=left]{left:clamp(10px,2.2vmin,22px);align-items:flex-start}.gv-anchor[data-pos$=right]{right:clamp(10px,2.2vmin,22px);align-items:flex-end}
.gv-anchor[data-pos$=center]{left:50%;transform:translateX(-50%);align-items:center}
.gv-anchor[data-pos=left]{left:clamp(10px,2.2vmin,22px);top:50%;transform:translateY(-50%)}.gv-anchor[data-pos=right]{right:clamp(10px,2.2vmin,22px);top:50%;transform:translateY(-50%);align-items:flex-end}
.gv-anchor[data-pos=center]{left:50%;top:50%;transform:translate(-50%,-50%);align-items:center}
.gv-meter{--fill:#6fd08c;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px;min-width:180px;width:min(280px,34vw);animation:gv-in-down .4s var(--gv-ease) both}
.gv-meter-label{font-size:.72em;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--gv-ink-dim)}
.gv-meter-track{position:relative;height:12px;border-radius:99px;background:rgba(0,0,0,.45);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),0 1px 2px rgba(0,0,0,.4);overflow:hidden}
[data-theme=pixel] .gv-meter-track{border-radius:0;height:14px;box-shadow:0 0 0 3px #000,inset 0 0 0 2px rgba(255,255,255,.2)}
.gv-meter-fill,.gv-meter-chip{position:absolute;inset:0 auto 0 0;width:100%;transform-origin:left;border-radius:inherit}
.gv-meter-chip{background:#fff;opacity:.55;transition:transform .5s ease-in .35s}
.gv-meter-fill{background:linear-gradient(180deg,color-mix(in srgb,var(--fill) 70%,#fff),var(--fill) 55%,color-mix(in srgb,var(--fill) 75%,#000));transition:transform .22s var(--gv-ease)}
.gv-meter-fill::after{content:'';position:absolute;inset:0 0 50% 0;background:linear-gradient(180deg,rgba(255,255,255,.35),transparent);border-radius:inherit}
.gv-meter.is-gain .gv-meter-chip{transition:none}
.gv-meter-value{font-size:.78em;font-weight:700;min-width:3.6em;text-align:right;color:var(--gv-ink-dim)}
.gv-meter.is-low .gv-meter-track{animation:gv-glow 1s ease-in-out infinite}
.gv-meter.is-empty .gv-meter-label{color:var(--gv-bad)}
.gv-meter.is-hit{animation:gv-shake .3s linear}
.gv-meter-pips{display:flex;gap:3px;height:12px}
.gv-pip{flex:1;border-radius:3px;background:rgba(0,0,0,.45);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);transition:background .2s}
.gv-pip.is-on{background:var(--fill)}
.gv-counter{display:inline-flex;align-items:center;gap:.45em;padding:.3em .7em .3em .45em;border-radius:99px;background:rgba(0,0,0,.38);font-weight:800;font-size:1.05em;animation:gv-in-down .4s var(--gv-ease) both}
[data-theme=pixel] .gv-counter{border-radius:0;background:rgba(0,0,0,.6)}
[data-theme=parchment] .gv-counter,[data-theme=book] .gv-counter{background:rgba(255,248,230,.75);text-shadow:none}
.gv-counter .gv-icon{width:1.4em;height:1.4em}
.gv-counter-value{display:inline-block;min-width:1.2em}
.gv-counter-delta{font-size:.72em;font-weight:800;color:var(--gv-good);opacity:0;transition:opacity .2s}
.gv-counter-delta.is-on{opacity:1}.gv-counter-delta.is-neg{color:var(--gv-bad)}
.gv-icons{display:flex;gap:3px;flex-wrap:wrap;max-width:320px;animation:gv-in-down .4s var(--gv-ease) both}
.gv-icons .gv-icon{width:1.6em;height:1.6em;transition:opacity .25s,filter .25s,transform .25s var(--gv-spring)}
.gv-icons .gv-icon.is-empty{opacity:.32;filter:grayscale(1) brightness(.6)}
.gv-icons .gv-icon.is-lost{animation:gv-break .45s ease-out}
.gv-icons .gv-icon.is-gained{animation:gv-pop .4s var(--gv-spring)}
.gv-pipicon{position:relative;display:inline-block;width:1.6em;height:1.6em;--f:1}
.gv-pipicon .gv-icon{position:absolute;inset:0;width:100%;height:100%}
.gv-pipicon .gv-icon:first-child{opacity:.3;filter:grayscale(1) brightness(.55)}
.gv-pipicon .gv-icon:last-child{clip-path:inset(0 calc((1 - var(--f)) * 100%) 0 0);transition:clip-path .25s var(--gv-ease)}
.gv-pipicon.is-lost{animation:gv-break .45s ease-out}.gv-pipicon.is-gained{animation:gv-pop .4s var(--gv-spring)}
.gv-icons.is-low .gv-pipicon{animation:gv-bob .8s ease-in-out infinite}
.gv-stars{display:flex;gap:2px}
.gv-stars .gv-icon{width:1.6em;height:1.6em;opacity:.25;filter:grayscale(1);transition:opacity .2s,filter .2s,transform .3s var(--gv-spring)}
.gv-stars .gv-icon.is-on{opacity:1;filter:none}
.gv-stars.is-flash .gv-icon.is-on{animation:gv-pulse .5s ease-in-out infinite}
.gv-score{display:flex;flex-direction:column;align-items:inherit;line-height:1}
.gv-score-label{font-size:.66em;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--gv-ink-dim)}
.gv-score-value{font:900 1.9em/1 var(--gv-display)}
.gv-prompt{position:absolute;left:50%;bottom:22%;transform:translateX(-50%);display:flex;align-items:center;gap:.6em;padding:.45em .9em .45em .5em;
  border-radius:99px;background:var(--gv-panel);border:var(--gv-bw) solid var(--gv-edge);box-shadow:var(--gv-shadow);font-weight:700;opacity:0;
  transition:opacity .18s var(--gv-ease),transform .18s var(--gv-ease);transform:translate(-50%,8px)}
.gv-prompt.is-on{opacity:1;transform:translate(-50%,0)}
.gv-prompt .gv-kbd{position:relative}
.gv-prompt-ring{position:absolute;inset:-4px;border-radius:9px;background:conic-gradient(var(--gv-accent) calc(var(--p,0) * 1turn),transparent 0);
  -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 0);mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 0)}
.gv-compass{position:relative;width:min(420px,60vw);height:28px;overflow:hidden;border-radius:6px;background:linear-gradient(90deg,transparent,rgba(0,0,0,.45) 18%,rgba(0,0,0,.45) 82%,transparent);
  -webkit-mask:linear-gradient(90deg,transparent,#000 15%,#000 85%,transparent);mask:linear-gradient(90deg,transparent,#000 15%,#000 85%,transparent)}
.gv-compass-strip{position:absolute;top:0;left:50%;height:100%;width:0}
.gv-compass-tick{position:absolute;top:4px;transform:translateX(-50%);font-size:.72em;font-weight:800;color:var(--gv-ink-dim)}
.gv-compass-tick.is-cardinal{color:var(--gv-ink);font-size:.86em;top:3px}
.gv-compass-tick.is-minor{top:9px;width:1px;height:8px;background:var(--gv-ink-faint)}
.gv-compass-marker{position:absolute;top:2px;transform:translateX(-50%);transition:left .12s linear}
.gv-compass::after{content:'';position:absolute;left:50%;bottom:0;width:2px;height:7px;transform:translateX(-50%);background:var(--gv-accent)}
.gv-clock{display:flex;align-items:center;gap:.5em;padding:.3em .7em;border-radius:99px;background:rgba(0,0,0,.38);font-weight:800}
.gv-clock .gv-icon{transition:transform .6s var(--gv-ease)}
.gv-clock-day{font-size:.72em;font-weight:700;color:var(--gv-ink-dim);text-transform:uppercase;letter-spacing:.08em}
.gv-status{display:flex;gap:6px}
.gv-status-icon{position:relative;width:2em;height:2em;display:grid;place-items:center;border-radius:8px;background:rgba(0,0,0,.5);animation:gv-in-scale .25s var(--gv-spring) both}
.gv-status-icon::before{content:'';position:absolute;inset:0;border-radius:inherit;background:conic-gradient(rgba(0,0,0,.6) calc((1 - var(--p,1)) * 1turn),transparent 0)}
.gv-status-icon .gv-icon{position:relative;width:1.3em;height:1.3em}
.gv-status-stacks{position:absolute;right:-4px;bottom:-4px;font-size:.66em;font-weight:900;background:var(--gv-ink);color:#111;border-radius:99px;padding:0 .35em;text-shadow:none}
.gv-status-icon.is-ending{animation:gv-pulse .4s ease-in-out infinite}
.gv-boss{position:absolute;left:50%;bottom:clamp(16px,6vh,60px);transform:translateX(-50%);width:min(720px,76vw);display:flex;flex-direction:column;gap:6px;opacity:0;transition:opacity .4s,transform .4s var(--gv-ease)}
.gv-boss.is-on{opacity:1}
.gv-boss-name{font:800 1.05em/1 var(--gv-display);letter-spacing:.12em;text-transform:uppercase;display:flex;justify-content:space-between;gap:1em}
.gv-boss-phase{font-size:.72em;color:var(--gv-ink-dim);letter-spacing:.1em}
.gv-boss .gv-meter-track{height:14px}
.gv-boss-notch{position:absolute;top:0;bottom:0;width:2px;background:rgba(0,0,0,.6)}
.gv-boss.is-intro{animation:gv-in-up .7s var(--gv-ease) both}
.gv-combo{position:absolute;right:clamp(16px,5vw,64px);top:32%;display:flex;flex-direction:column;align-items:flex-end;line-height:.9;opacity:0;transition:opacity .25s}
.gv-combo.is-on{opacity:1}
.gv-combo-count{font:900 3.2em/1 var(--gv-display);color:var(--gv-accent);-webkit-text-stroke:2px rgba(0,0,0,.6);paint-order:stroke fill}
.gv-combo-label{font-weight:900;letter-spacing:.2em;text-transform:uppercase;font-size:.9em}
.gv-combo-bar{width:100%;height:4px;margin-top:6px;border-radius:2px;background:var(--gv-accent);transform-origin:right}
.gv-crosshair{position:absolute;left:50%;top:50%;width:0;height:0}
.gv-crosshair i{position:absolute;background:var(--gv-ink);box-shadow:0 0 0 1px rgba(0,0,0,.5);transition:transform .12s var(--gv-ease)}
.gv-crosshair[data-kind=dot] i{width:5px;height:5px;border-radius:50%;left:-2.5px;top:-2.5px}
.gv-crosshair[data-kind=cross] i{width:2px;height:8px}
.gv-crosshair[data-kind=cross] i:nth-child(1){left:-1px;top:-14px}.gv-crosshair[data-kind=cross] i:nth-child(2){left:-1px;top:6px}
.gv-crosshair[data-kind=cross] i:nth-child(3){width:8px;height:2px;left:-14px;top:-1px}.gv-crosshair[data-kind=cross] i:nth-child(4){width:8px;height:2px;left:6px;top:-1px}
.gv-crosshair.is-fire[data-kind=cross] i:nth-child(1){transform:translateY(-4px)}.gv-crosshair.is-fire[data-kind=cross] i:nth-child(2){transform:translateY(4px)}
.gv-crosshair.is-fire[data-kind=cross] i:nth-child(3){transform:translateX(-4px)}.gv-crosshair.is-fire[data-kind=cross] i:nth-child(4){transform:translateX(4px)}
.gv-crosshair.is-fire[data-kind=dot] i{transform:scale(1.8)}
.gv-objective{max-width:300px;padding:.55em .8em;border-left:3px solid var(--gv-accent);background:linear-gradient(90deg,rgba(0,0,0,.45),transparent);border-radius:0 8px 8px 0}
.gv-objective-title{font-size:.72em;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--gv-accent)}
.gv-objective-text{font-weight:600}.gv-objective-progress{color:var(--gv-ink-dim);font-weight:700;margin-left:.3em}
.gv-objective.is-updated{animation:gv-flash .6s ease-out}
.gv-toasts{position:absolute;right:clamp(12px,2.4vmin,24px);top:30%;display:flex;flex-direction:column;align-items:flex-end;gap:8px;width:min(340px,70vw)}
.gv-toast{display:flex;align-items:center;gap:.65em;padding:.6em .9em;border-radius:var(--gv-radius-sm);animation:gv-in-right .35s var(--gv-ease) both;pointer-events:none;font-weight:600}
.gv-toast.is-out{animation:gv-out .4s ease-in both}
.gv-toast[data-kind=quest]{border-left:4px solid var(--gv-accent)}.gv-toast[data-kind=warn]{border-left:4px solid var(--gv-bad)}
.gv-toast[data-kind=item]{border-left:4px solid var(--gv-good)}.gv-toast[data-kind=level]{border-left:4px solid var(--gv-accent-2)}
.gv-toast-kicker{display:block;font-size:.68em;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--gv-ink-dim)}
.gv-toast-count{margin-left:auto;font-weight:900;color:var(--gv-accent)}
.gv-banner{position:absolute;left:0;right:0;top:24%;text-align:center;pointer-events:none}
.gv-banner-title{font:800 clamp(28px,5.5vw,64px)/1.05 var(--gv-display);letter-spacing:.14em;text-transform:uppercase;animation:gv-banner 3.4s var(--gv-ease) both}
.gv-banner-kicker{font-size:.82em;letter-spacing:.3em;text-transform:uppercase;color:var(--gv-accent);animation:gv-banner 3.4s var(--gv-ease) both}
.gv-banner-line{width:min(420px,60vw);height:2px;margin:10px auto;background:linear-gradient(90deg,transparent,var(--gv-ink),transparent);animation:gv-line 3.4s var(--gv-ease) both}
.gv-floaters{position:absolute;inset:0}
.gv-floater{position:absolute;font:900 1.2em/1 var(--gv-display);-webkit-text-stroke:2px rgba(0,0,0,.65);paint-order:stroke fill;animation:gv-rise .9s var(--gv-ease) forwards}
.gv-floater.is-heal{color:var(--gv-good)}.gv-floater.is-crit{font-size:1.6em;color:var(--gv-warn)}

/* ---------------------------------------------------------------- dialogue & subtitles */
.gv-dialogue{position:absolute;left:50%;bottom:clamp(14px,4vh,40px);width:min(860px,94vw);transform:translateX(-50%);display:grid;grid-template-columns:auto 1fr auto;gap:0 18px;align-items:end}
.gv-dialogue.is-in{animation:gv-in-up .32s var(--gv-ease) both}.gv-dialogue.is-out{animation:gv-out .25s ease-in both}
.gv-dlg-portrait{width:clamp(84px,14vw,148px);aspect-ratio:1;border-radius:var(--gv-radius);overflow:hidden;align-self:end;margin-bottom:6px;
  background:radial-gradient(circle at 50% 35%,color-mix(in srgb,var(--who,#6fb7ff) 55%,#000),#07080c 75%);box-shadow:var(--gv-shadow);border:var(--gv-bw) solid var(--gv-edge);
  transition:transform .3s var(--gv-ease),filter .3s,opacity .3s}
.gv-dlg-portrait svg{width:100%;height:100%;display:block}
.gv-dlg-portrait.is-idle{filter:saturate(.35) brightness(.55);transform:scale(.92)}
.gv-dlg-portrait.is-talking svg{animation:gv-bob .5s ease-in-out infinite}
.gv-dlg-portrait.is-empty{visibility:hidden}
.gv-dlg-box{position:relative;padding:22px 24px 20px;min-height:128px;display:flex;flex-direction:column;gap:12px}
.gv-dlg-name{position:absolute;top:-15px;left:18px;padding:.3em .9em;border-radius:var(--gv-radius-sm);background:var(--who,var(--gv-accent));color:#0c0d12;
  font:800 .82em/1.2 var(--gv-display);letter-spacing:.06em;text-transform:uppercase;box-shadow:0 3px 10px rgba(0,0,0,.35);animation:gv-in-left .3s var(--gv-ease) both}
.gv-dlg-text{font-size:1.08em;line-height:1.55;min-height:3.1em;text-wrap:pretty}
.gv-dlg-text .gv-ghost{opacity:0}
.gv-dlg-next{position:absolute;right:18px;bottom:12px;font-size:.9em;color:var(--gv-accent);animation:gv-bob .9s ease-in-out infinite;opacity:0;transition:opacity .2s}
.gv-dlg-next.is-on{opacity:1}
.gv-choices{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.gv-choice{animation:gv-in-up .28s var(--gv-ease) both}
.gv-choice .gv-num{display:inline-grid;place-items:center;width:1.6em;height:1.6em;border-radius:50%;font-size:.78em;font-weight:800;background:rgba(0,0,0,.35);flex:none}
.gv-choice.is-seen{color:var(--gv-ink-dim)}
.gv-subtitles{position:absolute;left:50%;bottom:clamp(70px,14vh,150px);transform:translateX(-50%);width:min(760px,90vw);display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center}
.gv-sub{padding:.35em .85em;border-radius:8px;background:rgba(0,0,0,.62);color:#fff;font-weight:600;text-shadow:0 1px 2px #000;animation:gv-in-up .25s var(--gv-ease) both;max-width:100%}
.gv-sub b{color:var(--who,var(--gv-accent));margin-right:.4em}
.gv-sub.is-out{animation:gv-out .35s ease-in both}
.gv-sub[data-channel=radio]{font-family:${MONO};background:rgba(10,24,16,.75)}
.gv-sub[data-channel=narrator]{font-style:italic;background:transparent;text-shadow:0 1px 3px #000,0 0 12px #000}

.gv-letterbox i{position:absolute;left:0;right:0;height:0;background:#000;transition:height .55s var(--gv-ease);z-index:1}
.gv-letterbox i:first-child{top:0}.gv-letterbox i:nth-child(2){bottom:0}
.gv-letterbox.is-on i{height:11vh}
.gv-skip{position:absolute;right:3%;bottom:3vh;z-index:2;font-size:.82em;color:rgba(255,255,255,.7);opacity:0;transition:opacity .4s .4s}
.gv-letterbox.is-on .gv-skip{opacity:1}

/* ---------------------------------------------------------------- sheets (journal, inventory, map) */
.gv-scrim{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(4,5,9,.55),rgba(4,5,9,.82));pointer-events:auto;animation:gv-fade-in .2s ease both}
[data-theme=parchment] .gv-scrim,[data-theme=book] .gv-scrim{background:rgba(20,12,4,.55)}
.gv-sheet{position:absolute;left:50%;top:50%;width:min(1040px,94vw);height:min(660px,88vh);transform:translate(-50%,-50%);display:grid;grid-template-rows:auto 1fr auto;overflow:hidden;animation:gv-in-scale .26s var(--gv-ease) both}
.gv-sheet.is-out{animation:gv-out .2s ease-in both}
.gv-sheet-head{display:flex;align-items:center;gap:16px;padding:16px 22px 0}
.gv-sheet-title{font-size:1.35em}
.gv-tabs{display:flex;gap:4px;margin-left:auto;flex-wrap:wrap}
.gv-tab{pointer-events:auto;cursor:pointer;appearance:none;border:0;background:transparent;color:var(--gv-ink-dim);font:700 .86em/1 var(--gv-font);letter-spacing:.06em;text-transform:uppercase;
  padding:.65em .9em;border-bottom:3px solid transparent;transition:color .15s,border-color .15s}
.gv-tab.is-active{color:var(--gv-ink);border-bottom-color:var(--gv-accent)}
.gv-tab .gv-badge{margin-left:.4em}
.gv-badge{display:inline-grid;place-items:center;min-width:1.5em;height:1.5em;padding:0 .4em;border-radius:99px;background:var(--gv-accent);color:var(--gv-accent-ink);font-size:.72em;font-weight:900}
.gv-sheet-body{display:grid;grid-template-columns:minmax(240px,38%) 1fr;gap:0;min-height:0;border-top:var(--gv-bw) solid var(--gv-edge);margin-top:12px}
.gv-list{overflow:auto;padding:12px;border-right:var(--gv-bw) solid var(--gv-edge);scrollbar-width:thin}
.gv-list-section{margin:10px 6px 6px;font-size:.72em;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--gv-ink-faint);display:flex;justify-content:space-between}
.gv-list .gv-btn{margin-bottom:3px}
.gv-list .gv-btn small{margin-left:auto;font-weight:600;opacity:.75}
.gv-btn.is-done{color:var(--gv-ink-dim)}.gv-btn.is-done .gv-row-title{text-decoration:line-through;text-decoration-thickness:1px}
.gv-btn.is-locked{color:var(--gv-ink-faint)}
.gv-detail{overflow:auto;padding:22px 26px;animation:gv-fade-in .2s ease both}
.gv-detail h3{margin:0 0 4px;font:800 1.5em/1.15 var(--gv-display)}
.gv-detail .gv-kicker{font-size:.74em;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--gv-accent)}
.gv-detail p{margin:.6em 0;line-height:1.6;color:var(--gv-ink);max-width:60ch}
.gv-objectives{list-style:none;padding:0;margin:14px 0;display:flex;flex-direction:column;gap:8px}
.gv-objectives li{display:flex;gap:.6em;align-items:baseline}
.gv-check{flex:none;width:1em;height:1em;border-radius:4px;border:2px solid var(--gv-ink-dim);transform:translateY(.12em);transition:background .2s}
.gv-objectives li.is-done{color:var(--gv-ink-dim)}.gv-objectives li.is-done .gv-check{background:var(--gv-good);border-color:var(--gv-good)}
.gv-objectives li.is-failed .gv-check{background:var(--gv-bad);border-color:var(--gv-bad)}
.gv-progress{height:5px;margin-top:5px;border-radius:3px;background:rgba(0,0,0,.35);overflow:hidden}.gv-progress i{display:block;height:100%;background:var(--gv-accent);transition:width .3s var(--gv-ease)}
.gv-sheet-foot{padding:10px 22px;border-top:var(--gv-bw) solid var(--gv-edge)}
.gv-empty{padding:24px;color:var(--gv-ink-faint);font-style:italic;text-align:center}
.gv-tag{display:inline-block;padding:.12em .55em;border-radius:99px;border:1px solid var(--gv-edge);font-size:.74em;font-weight:700;color:var(--gv-ink-dim);margin-right:4px}
.gv-tag.is-main{background:var(--gv-accent);color:var(--gv-accent-ink);border-color:transparent}
.gv-art{float:right;width:132px;aspect-ratio:1;margin:0 0 10px 16px;border-radius:var(--gv-radius);overflow:hidden;background:radial-gradient(circle at 50% 35%,color-mix(in srgb,var(--who,#6fb7ff) 50%,#000),#07080c 75%)}
.gv-art svg{width:100%;height:100%}
.gv-stats{display:grid;grid-template-columns:auto 1fr;gap:4px 18px;margin:12px 0}
.gv-stats dt{color:var(--gv-ink-dim);font-weight:600}.gv-stats dd{margin:0;font-weight:800}
.gv-stats dd.is-up{color:var(--gv-good)}.gv-stats dd.is-down{color:var(--gv-bad)}

/* inventory */
.gv-inv-body{display:grid;grid-template-columns:1fr minmax(260px,34%);min-height:0;border-top:var(--gv-bw) solid var(--gv-edge);margin-top:12px}
.gv-grid{display:grid;grid-template-columns:repeat(var(--cols,8),minmax(0,1fr));gap:8px;padding:16px;align-content:start;overflow:auto}
.gv-slot{pointer-events:auto;position:relative;aspect-ratio:1;border-radius:var(--gv-radius-sm);background:rgba(0,0,0,.32);border:var(--gv-bw) solid rgba(255,255,255,.08);
  display:grid;place-items:center;cursor:pointer;transition:transform .14s var(--gv-ease),border-color .14s,background .14s;--rar:transparent;box-shadow:inset 0 -3px 0 var(--rar)}
.gv-slot .gv-icon{width:62%;height:62%;filter:drop-shadow(0 2px 2px rgba(0,0,0,.5));transition:transform .18s var(--gv-spring)}
.gv-slot.is-focus,.gv-slot:hover{border-color:var(--gv-accent);background:color-mix(in srgb,var(--gv-accent) 18%,rgba(0,0,0,.4));transform:translateY(-2px)}
.gv-slot.is-focus .gv-icon{transform:scale(1.12)}
.gv-slot.is-empty{cursor:default;opacity:.5}.gv-slot.is-empty:hover{transform:none;border-color:rgba(255,255,255,.08);background:rgba(0,0,0,.32)}
.gv-slot-count{position:absolute;right:5px;bottom:3px;font-size:.8em;font-weight:900;text-shadow:0 1px 2px #000}
.gv-slot.is-equipped::after{content:'E';position:absolute;left:5px;top:3px;font-size:.66em;font-weight:900;color:var(--gv-accent)}
.gv-slot.is-new{animation:gv-pop .4s var(--gv-spring)}
.gv-slot-label{position:absolute;left:0;right:0;bottom:-1.35em;font-size:.66em;text-align:center;color:var(--gv-ink-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gv-doll{position:relative;margin:16px;min-height:340px;border-radius:var(--gv-radius);background:radial-gradient(ellipse at 50% 45%,var(--gv-panel-2),transparent 70%)}
.gv-doll-figure{position:absolute;left:50%;top:50%;width:46%;max-width:220px;aspect-ratio:1/1.5;transform:translate(-50%,-50%);opacity:.9}
.gv-doll .gv-slot{position:absolute;width:64px;transform:translate(-50%,-50%)}
.gv-doll .gv-slot.is-focus,.gv-doll .gv-slot:hover{transform:translate(-50%,calc(-50% - 2px))}
.gv-notches{display:flex;gap:6px;align-items:center;margin:12px 16px 0}
.gv-notch{width:16px;height:16px;border-radius:50%;border:2px solid var(--gv-ink-dim)}.gv-notch.is-used{background:var(--gv-accent);border-color:var(--gv-accent)}
.gv-notches.is-over .gv-notch.is-used{background:var(--gv-bad);border-color:var(--gv-bad)}
.gv-rows{display:flex;flex-direction:column;gap:4px;padding:12px;overflow:auto}
.gv-row-main{display:flex;flex-direction:column;gap:2px;min-width:0}
.gv-row-sub{font-size:.8em;color:var(--gv-ink-dim);font-weight:500}
.gv-btn:hover .gv-row-sub,.gv-btn.is-focus .gv-row-sub{color:inherit;opacity:.8}
.gv-price{margin-left:auto;font-weight:900;display:inline-flex;align-items:center;gap:.3em}
.gv-price.is-short{color:var(--gv-bad)}
.gv-btn.is-focus .gv-price.is-short{color:#7a0000}
.gv-need{font-weight:800}.gv-need.is-short{color:var(--gv-bad)}
.gv-actions{display:flex;flex-direction:column;gap:6px;margin-top:16px}
.gv-wallet{display:inline-flex;align-items:center;gap:.4em;font-weight:900;margin-left:12px}

/* map & minimap */
.gv-map-body{position:relative;min-height:0;border-top:var(--gv-bw) solid var(--gv-edge);margin-top:12px;display:grid;grid-template-columns:1fr minmax(240px,30%)}
.gv-map-canvas{position:relative;overflow:hidden;cursor:grab;pointer-events:auto;background:radial-gradient(ellipse at center,rgba(255,255,255,.04),transparent 70%)}
.gv-map-canvas canvas{position:absolute;inset:0;width:100%;height:100%}
.gv-map-info{padding:20px;border-left:var(--gv-bw) solid var(--gv-edge);overflow:auto}
.gv-legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:.8em;color:var(--gv-ink-dim);margin-top:12px}
.gv-legend span{display:inline-flex;align-items:center;gap:.4em}.gv-legend i{width:10px;height:10px;border-radius:50%}
.gv-minimap{position:relative;width:var(--size,168px);height:var(--size,168px);border:var(--gv-bw) solid var(--gv-edge);box-shadow:var(--gv-shadow);background:rgba(8,10,16,.72);overflow:hidden;animation:gv-in-scale .4s var(--gv-ease) both}
.gv-minimap[data-shape=circle]{border-radius:50%}.gv-minimap[data-shape=square]{border-radius:var(--gv-radius)}
.gv-minimap canvas{width:100%;height:100%;display:block}
.gv-minimap-label{margin-top:6px;font-size:.74em;font-weight:800;letter-spacing:.1em;text-transform:uppercase;text-align:center;color:var(--gv-ink)}
.gv-minimap-wrap{display:flex;flex-direction:column;align-items:center}

/* ---------------------------------------------------------------- screens (battle, cards) */
.gv-screen{position:absolute;inset:0;pointer-events:auto}
.gv-screen.is-in{animation:gv-fade-in .3s ease both}
.gv-battle{background:linear-gradient(180deg,color-mix(in srgb,var(--gv-accent-2) 22%,#0b0d16) 0%,#0b0d16 58%,color-mix(in srgb,var(--gv-accent) 14%,#0b0d16) 100%)}
.gv-battle-field{position:absolute;inset:0 0 34% 0}
.gv-bside{position:absolute;display:flex;gap:14px;align-items:flex-end}
.gv-bside.is-enemy{right:6%;top:9%;flex-direction:row-reverse}.gv-bside.is-player{left:6%;bottom:4%}
.gv-bunit{display:flex;flex-direction:column;align-items:center;gap:8px;transition:transform .3s var(--gv-ease),opacity .4s,filter .3s}
.gv-bunit.is-enemy-in{animation:gv-in-right .55s var(--gv-ease) both}.gv-bunit.is-player-in{animation:gv-in-left .55s var(--gv-ease) both}
.gv-bunit.is-active .gv-bsprite{filter:drop-shadow(0 0 12px color-mix(in srgb,var(--gv-accent) 70%,transparent))}
.gv-bunit.is-down{opacity:.25;filter:grayscale(1);transform:translateY(16px)}
.gv-bunit.is-hit .gv-bsprite{animation:gv-shake .35s linear,gv-flash .35s ease-out}
.gv-bunit.is-target .gv-bsprite{outline:3px solid var(--gv-accent);outline-offset:4px;border-radius:50%}
.gv-bsprite{width:clamp(90px,15vw,170px);aspect-ratio:1;position:relative}
.gv-bsprite svg{width:100%;height:100%}
.gv-bsprite::after{content:'';position:absolute;left:10%;right:10%;bottom:-6%;height:14%;border-radius:50%;background:radial-gradient(ellipse,rgba(0,0,0,.5),transparent 70%);z-index:-1}
.gv-bcard{min-width:220px;padding:10px 14px 12px}
.gv-bcard-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-weight:800}
.gv-bcard-lv{font-size:.8em;color:var(--gv-ink-dim)}
.gv-bcard .gv-meter{width:100%;min-width:0;margin-top:6px;animation:none}
.gv-bcard .gv-meter-track{height:9px}
.gv-bcard-status{display:flex;gap:4px;margin-top:5px}
.gv-bottom{position:absolute;left:0;right:0;bottom:0;height:34%;display:grid;grid-template-columns:1fr minmax(280px,40%);gap:12px;padding:0 3% 3%}
.gv-bmsg{padding:18px 22px;font-size:1.1em;line-height:1.5;position:relative}
.gv-bmenu{padding:10px;display:grid;grid-template-columns:1fr 1fr;gap:6px;align-content:start;overflow:auto}
.gv-bmenu .gv-btn{justify-content:space-between}
.gv-bmenu .gv-btn small{font-weight:700;opacity:.75}
.gv-type{display:inline-block;padding:.1em .5em;border-radius:4px;font-size:.72em;font-weight:900;text-transform:uppercase;letter-spacing:.06em;background:var(--t,#888);color:#111}
.gv-battle-panel{pointer-events:none;background:transparent}.gv-battle-panel .gv-bottom{height:auto;max-height:38%;top:auto}.gv-battle-panel .gv-panel{pointer-events:auto}
.gv-cards{background:radial-gradient(ellipse at 50% 120%,color-mix(in srgb,var(--gv-accent) 22%,transparent),transparent 60%),linear-gradient(180deg,#12101c,#0a0910)}
.gv-enemies{position:absolute;left:0;right:0;top:8%;display:flex;justify-content:center;gap:5%}
.gv-foe{display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:auto;cursor:pointer;transition:transform .2s var(--gv-ease)}
.gv-foe .gv-bsprite{width:clamp(80px,12vw,140px)}
.gv-foe.is-target{transform:translateY(-6px)}.gv-foe.is-target .gv-bsprite{filter:drop-shadow(0 0 14px var(--gv-bad))}
.gv-intent{display:inline-flex;align-items:center;gap:.35em;padding:.2em .6em;border-radius:99px;background:rgba(0,0,0,.55);font-weight:800;font-size:.86em;animation:gv-bob 1.6s ease-in-out infinite}
.gv-intent[data-kind=attack]{color:#ff8a7a}.gv-intent[data-kind=block],.gv-intent[data-kind=defend]{color:#8ac8ff}.gv-intent[data-kind=buff]{color:#ffd36a}
.gv-hand{position:absolute;left:50%;bottom:-2%;width:0;height:0}
.gv-card{--rot:0deg;--x:0px;--y:0px;position:absolute;left:0;bottom:0;width:clamp(116px,13vw,158px);aspect-ratio:5/7;margin-left:calc(clamp(116px,13vw,158px) / -2);
  transform:translate(var(--x),var(--y)) rotate(var(--rot));transform-origin:50% 120%;pointer-events:auto;cursor:pointer;
  border-radius:12px;background:linear-gradient(180deg,#f7f1e3,#e8dcc0);color:#1b1610;border:3px solid var(--ct,#7a6a50);box-shadow:0 8px 20px rgba(0,0,0,.5);
  display:flex;flex-direction:column;padding:8px;transition:transform .22s var(--gv-ease),box-shadow .2s,filter .2s;animation:gv-in-up .35s var(--gv-ease) both;text-shadow:none}
.gv-card.is-focus,.gv-card:hover{transform:translate(var(--x),calc(var(--y) - 46px)) rotate(0deg) scale(1.14);z-index:5;box-shadow:0 16px 34px rgba(0,0,0,.6)}
.gv-card.is-playable{box-shadow:0 8px 20px rgba(0,0,0,.5),0 0 0 3px color-mix(in srgb,var(--gv-good) 70%,transparent)}
.gv-card.is-unplayable{filter:saturate(.4) brightness(.8)}
.gv-card.is-played{animation:gv-out .3s ease-in both}
.gv-card-cost{position:absolute;left:-10px;top:-10px;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle at 35% 30%,#9fd4ff,#2b6fd6);color:#fff;font-weight:900;border:2px solid #0b2a5a;text-shadow:0 1px 2px #000}
.gv-card-name{font:800 .86em/1.15 var(--gv-display);text-align:center;margin:4px 6px 6px}
.gv-card-art{flex:none;height:40%;border-radius:6px;background:var(--art);box-shadow:inset 0 0 0 1px rgba(0,0,0,.25)}
.gv-card-type{font-size:.62em;font-weight:900;text-transform:uppercase;letter-spacing:.12em;text-align:center;margin:5px 0 3px;color:#6a5a40}
.gv-card-text{font-size:.72em;line-height:1.3;text-align:center;overflow:hidden}
.gv-pile{position:absolute;bottom:4%;display:flex;flex-direction:column;align-items:center;gap:4px;font-weight:800}
.gv-pile.is-draw{left:3%}.gv-pile.is-discard{right:3%}
.gv-pile-stack{width:56px;height:76px;border-radius:8px;background:repeating-linear-gradient(45deg,#3a3050 0 6px,#2a2240 6px 12px);border:2px solid #8a7ab0;box-shadow:3px 3px 0 #1a1428,6px 6px 0 #120e1c;display:grid;place-items:center;font-size:1.2em}
.gv-energy{position:absolute;left:4%;bottom:26%;width:72px;height:72px;border-radius:50%;display:grid;place-items:center;font:900 1.5em/1 var(--gv-display);
  background:radial-gradient(circle at 35% 30%,#ffe9a0,#f0a020 60%,#a05a00);color:#2a1600;box-shadow:0 0 24px rgba(240,160,32,.6);text-shadow:none}
.gv-energy.is-empty{filter:grayscale(.8) brightness(.6);box-shadow:none}
.gv-endturn{position:absolute;right:4%;bottom:26%;width:auto}

/* ---------------------------------------------------------------- menu screens */
.gv-menu{position:absolute;inset:0;pointer-events:auto;display:grid;place-items:center}
.gv-menu.is-in{animation:gv-fade-in .25s ease both}.gv-menu.is-out{animation:gv-out .25s ease-in both}
.gv-menu-card{width:min(420px,90vw);padding:22px;display:flex;flex-direction:column;gap:6px;animation:gv-in-scale .3s var(--gv-ease) both}
.gv-menu-card h2{margin:0 0 12px;font-size:1.8em;text-align:center}
.gv-menu-card .gv-btn{justify-content:center;text-align:center}
.gv-menu-card .gv-btn:hover,.gv-menu-card .gv-btn.is-focus{transform:scale(1.03)}
.gv-title-screen{background:#06070b;overflow:hidden}
.gv-title-bg{position:absolute;inset:-20%;background:radial-gradient(circle at 30% 30%,color-mix(in srgb,var(--gv-accent) 45%,transparent),transparent 45%),radial-gradient(circle at 75% 70%,color-mix(in srgb,var(--gv-accent-2) 40%,transparent),transparent 50%),#07080d;animation:gv-hue 40s linear infinite}
.gv-title-motes{position:absolute;inset:0 -50% -50% 0;background-image:radial-gradient(2px 2px at 20% 30%,rgba(255,255,255,.7),transparent),radial-gradient(1.5px 1.5px at 60% 70%,rgba(255,255,255,.5),transparent),radial-gradient(2px 2px at 80% 20%,rgba(255,255,255,.6),transparent),radial-gradient(1px 1px at 40% 85%,rgba(255,255,255,.6),transparent);background-size:240px 240px;animation:gv-drift 60s linear infinite;opacity:.7}
.gv-title-main{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;gap:14px;padding:0 6vw}
.gv-title-name{margin:0;font:900 clamp(40px,9vw,112px)/.95 var(--gv-display);letter-spacing:-.03em;text-transform:var(--gv-upper);
  background:linear-gradient(180deg,#fff 20%,color-mix(in srgb,var(--gv-accent) 70%,#fff));-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 6px 24px rgba(0,0,0,.6));animation:gv-in-up .9s var(--gv-ease) both}
[data-theme=pixel] .gv-title-name{letter-spacing:.02em;filter:drop-shadow(5px 5px 0 #000)}
.gv-title-sub{font:700 clamp(15px,2.2vw,24px)/1.2 var(--gv-display);letter-spacing:.24em;text-transform:uppercase;color:var(--gv-accent);animation:gv-in-up .9s .15s var(--gv-ease) both}
.gv-title-pitch{max-width:56ch;color:var(--gv-ink-dim);font-size:1.05em;line-height:1.55;animation:gv-in-up .9s .3s var(--gv-ease) both}
.gv-press{margin-top:22px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;animation:gv-pulse 1.6s ease-in-out infinite;pointer-events:auto;cursor:pointer;background:none;border:0;color:var(--gv-ink);font-family:var(--gv-font)}
.gv-controls{position:absolute;right:3%;bottom:4%;width:min(320px,80vw);padding:14px 16px;font-size:.86em;animation:gv-in-up .9s .45s var(--gv-ease) both}
.gv-controls h4{margin:0 0 8px;font-size:.8em;letter-spacing:.14em;text-transform:uppercase;color:var(--gv-ink-dim)}
.gv-controls dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:5px 14px;align-items:center}.gv-controls dt{color:var(--gv-ink-dim)}.gv-controls dd{margin:0;display:flex;gap:4px;flex-wrap:wrap}
.gv-slider{display:grid;grid-template-columns:1fr auto;align-items:center;gap:6px 12px}
.gv-slider-track{grid-column:1/-1;height:8px;border-radius:99px;background:rgba(0,0,0,.4);overflow:hidden}.gv-slider-track i{display:block;height:100%;background:var(--gv-accent);transition:width .15s}
.gv-btn.is-focus .gv-slider-track i{background:var(--gv-accent-ink)}
.gv-slots{display:flex;flex-direction:column;gap:6px}
.gv-slot-row{display:flex;flex-direction:column;align-items:flex-start!important}
.gv-select{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;background:radial-gradient(ellipse at 50% 30%,color-mix(in srgb,var(--gv-accent) 26%,#0b0c14),#05060a)}
.gv-select h2{margin:0;font-size:clamp(26px,4vw,44px);animation:gv-in-down .4s var(--gv-ease) both}
.gv-select-grid{display:grid;grid-template-columns:repeat(var(--cols,4),minmax(0,150px));gap:14px}
.gv-select-card{pointer-events:auto;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px;border-radius:var(--gv-radius);background:var(--gv-panel);
  border:var(--gv-bw) solid var(--gv-edge);transition:transform .2s var(--gv-spring),border-color .2s,box-shadow .2s;animation:gv-in-up .4s var(--gv-ease) both;color:var(--gv-ink);font:inherit}
.gv-select-card .gv-bsprite{width:100%}
.gv-select-card.is-focus,.gv-select-card:hover{transform:translateY(-6px) scale(1.04);border-color:var(--gv-accent);box-shadow:0 0 0 3px var(--gv-accent),0 14px 30px rgba(0,0,0,.5)}
.gv-select-card b{font-weight:800}.gv-select-card small{color:var(--gv-ink-dim)}
.gv-vs{position:absolute;inset:0;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;overflow:hidden;background:#05060a}
.gv-vs-side{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px}
.gv-vs-side.is-left{background:linear-gradient(110deg,color-mix(in srgb,var(--gv-accent-2) 60%,#000) 0 92%,transparent 92%);animation:gv-in-left .5s var(--gv-ease) both}
.gv-vs-side.is-right{background:linear-gradient(290deg,color-mix(in srgb,var(--gv-bad) 60%,#000) 0 92%,transparent 92%);animation:gv-in-right .5s var(--gv-ease) both}
.gv-vs-side .gv-bsprite{width:clamp(140px,26vw,300px)}
.gv-vs-side b{font:900 clamp(22px,3.4vw,40px)/1 var(--gv-display);text-transform:uppercase;letter-spacing:.06em}
.gv-vs-mark{font:900 clamp(60px,12vw,150px)/1 var(--gv-display);color:var(--gv-accent);-webkit-text-stroke:4px #000;paint-order:stroke fill;animation:gv-pop .6s .4s var(--gv-spring) both;transform:rotate(-6deg)}
.gv-results{width:min(560px,92vw);padding:26px 28px;display:flex;flex-direction:column;gap:12px;animation:gv-in-scale .4s var(--gv-ease) both}
.gv-results h2{margin:0;font-size:2.2em;text-align:center}
.gv-results.is-won h2{color:var(--gv-accent)}.gv-results.is-lost h2{color:var(--gv-bad)}
.gv-results .gv-epilogue{text-align:center;color:var(--gv-ink-dim);line-height:1.6;margin:0}
.gv-results .gv-stats{grid-template-columns:1fr auto;padding:10px 0;border-top:1px solid var(--gv-edge);border-bottom:1px solid var(--gv-edge)}
.gv-results .gv-stats dd{text-align:right}
.gv-results .gv-buttons{display:flex;gap:8px}.gv-results .gv-buttons .gv-btn{justify-content:center}
.gv-fade{position:absolute;inset:0;background:#000;opacity:0;transition:opacity .35s ease;pointer-events:none}.gv-fade.is-on{opacity:1}

/* ---------------------------------------------------------------- story (text games) */
.gv-story{position:absolute;inset:0;display:grid;grid-template-rows:auto 1fr auto auto;gap:14px;padding:clamp(16px,4vw,48px) clamp(16px,8vw,120px);pointer-events:auto;
  background:var(--gv-panel);color:var(--gv-ink);overflow:hidden}
[data-theme=book].gv-story,[data-theme=book] .gv-story{background:radial-gradient(ellipse at 50% 0,#fffaf0,#efe6d2)}
.gv-scene{animation:gv-in-down .4s var(--gv-ease) both}
.gv-scene .gv-kicker{font-size:.76em;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--gv-accent);margin:0}
.gv-scene h2{margin:.15em 0 .2em;font:800 clamp(26px,4vw,42px)/1.1 var(--gv-display)}
.gv-scene .gv-desc{margin:0;color:var(--gv-ink-dim);max-width:62ch;line-height:1.6}
.gv-scene.is-new h2{animation:gv-in-left .4s var(--gv-ease) both}
.gv-log{list-style:none;margin:0;padding:0 4px 0 0;overflow:auto;display:flex;flex-direction:column;gap:10px;scrollbar-width:thin;line-height:1.6;max-width:70ch}
.gv-log li{animation:gv-in-up .35s var(--gv-ease) both}
.gv-log .gv-say b{color:var(--who,var(--gv-accent));margin-right:.35em}
.gv-log .gv-note{color:var(--gv-ink-dim);font-style:italic}
.gv-log .gv-act{font:800 1.2em/1.2 var(--gv-display);margin-top:10px;letter-spacing:.04em}
.gv-log .gv-beat{font-weight:800;color:var(--gv-accent)}
.gv-story .gv-choices{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
.gv-bag{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;font-size:.9em;color:var(--gv-ink-dim);border-top:1px solid var(--gv-edge);padding-top:10px}
.gv-bag ul{display:flex;gap:6px;flex-wrap:wrap;list-style:none;margin:0;padding:0}
.gv-bag li{display:inline-flex;gap:.3em;align-items:center;padding:.15em .6em;border-radius:99px;border:1px solid var(--gv-edge);color:var(--gv-ink)}
.gv-bag li.is-new{animation:gv-pop .4s var(--gv-spring)}
.gv-story-ending{position:absolute;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.35)}
`;
