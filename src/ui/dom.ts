/** Small DOM helpers. No framework: the app is three screens of static HTML. */

/** Escape text for interpolation into markup. */
export function esc(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** Get an element by id, or throw. A missing id is a bug, not a runtime case. */
export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`No element with id "${id}".`);
  return found as T;
}

/** Query within a root, or throw. */
export function qs<T extends Element = Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`No element matching "${selector}".`);
  return found;
}

export function qsa<T extends Element = Element>(root: ParentNode, selector: string): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

/** Whether the viewer has asked for reduced motion. */
export const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Fetch and parse JSON from a path relative to the app's base URL. */
export async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(new URL(path, document.baseURI).href);
  if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
  return (await response.json()) as T;
}

/** A check or alert icon, for rules checks and care findings. */
export function icon(kind: 'pass' | 'fail' | 'info'): string {
  if (kind === 'pass') {
    return '<svg class="ic ok" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  }
  if (kind === 'fail') {
    return '<svg class="ic no" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/></svg>';
  }
  return '<svg class="ic info" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>';
}
