// Keep a local DOM refresh from discarding the reader's place or editing cursor.
// Navigation owns scrolling separately; use this only around synchronous in-place renders.
export function preserveView(element, render) {
  const document = element.ownerDocument, window = document.defaultView;
  const escape = value => window.CSS.escape(value);
  function selector(node) {
    if (node.id) return `#${escape(node.id)}`;
    const data = [...node.attributes].filter(attribute => attribute.name.startsWith('data-'));
    if (data.length) {
      const token = node.localName + data.map(attribute => `[${attribute.name}="${escape(attribute.value)}"]`).join('') + (node.type === 'radio' ? `[value="${escape(node.value)}"]` : '');
      if (element.querySelectorAll(token).length === 1) return token;
    }
    if (node === element) return ':scope';
    const index = [...node.parentElement.children].indexOf(node) + 1;
    return `${selector(node.parentElement)} > ${node.localName}:nth-child(${index})`;
  }
  const active = document.activeElement;
  const focus = active && element.contains(active) ? { selector: selector(active), node: active,
    start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection } : null;
  const details = [...element.querySelectorAll('details')].map(node => [selector(node), node.open]);
  const scroll = [{node: window, x: window.scrollX, y: window.scrollY}];
  for (let node = active; node && node !== document.body; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth) scroll.push({node, x: node.scrollLeft, y: node.scrollTop, selector: element.contains(node) ? selector(node) : null});
  }
  try { return render(); }
  finally {
    for (const [path, open] of details) { const node = element.querySelector(path); if (node) node.open = open; }
    if (focus && !focus.node.isConnected) {
      const node = element.querySelector(focus.selector);
      if (node && !node.disabled) {
        node.focus({preventScroll: true});
        if (focus.start != null && typeof node.setSelectionRange === 'function') node.setSelectionRange(focus.start, focus.end, focus.direction);
      }
    }
    for (const state of scroll.reverse()) {
      const node = state.selector ? element.querySelector(state.selector) : state.node;
      if (!node) continue;
      const x = node === window ? window.scrollX : node.scrollLeft, y = node === window ? window.scrollY : node.scrollTop;
      if (x !== state.x || y !== state.y) node.scrollTo({left: state.x, top: state.y, behavior: 'instant'});
    }
  }
}
