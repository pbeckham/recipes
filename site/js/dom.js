// Tiny DOM helpers. Text always goes in via textContent: recipe data is
// untrusted and must never be parsed as HTML.

/**
 * Create an element.
 * h('a', { href: '#/', class: 'link' }, 'Back')
 * Attribute values of null/undefined/false are skipped; true sets an empty attribute.
 * Children may be strings (inserted as text), nodes, or nested arrays; null/false are skipped.
 * @param {string} tag
 * @param {Record<string, unknown> | null} [attrs]
 * @param {...unknown} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), /** @type {EventListener} */ (value));
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

/** @param {Node} parent @param {unknown[]} children */
function append(parent, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
}

/**
 * App-owned inline SVG icon (static markup, never recipe data).
 * @param {keyof typeof ICONS} name
 */
export function icon(name) {
  const tpl = document.createElement('template');
  tpl.innerHTML = ICONS[name];
  const svg = /** @type {SVGElement} */ (tpl.content.firstElementChild);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  return svg;
}

const svg = (body) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  bowl: svg('<path d="M3 11h18a9 9 0 0 1-18 0Z"/><path d="M8 7c0-1.5 1-2 1-3.5M12 7c0-1.5 1-2 1-3.5M16 7c0-1.5 1-2 1-3.5"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>'),
};
