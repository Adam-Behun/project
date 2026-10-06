/**
 * The shell: the product header, the Employer / Employee toggle, and the
 * `?view=` parameter that makes each view linkable.
 *
 * One page, one entry point. The toggle swaps a view module in place and
 * pushes a history entry, so a link to ?view=employee opens the employee view
 * and the back button behaves.
 */

import { el, qsa } from '../../ui/dom.js';

export type ViewName = 'employer' | 'employee';

/** Employer first: the employer sets the allowance that the employee spends. */
export const DEFAULT_VIEW: ViewName = 'employer';

const VIEWS: readonly ViewName[] = ['employer', 'employee'];

const COPY: Record<ViewName, { title: string; lede: string; privacy?: string }> = {
  employer: {
    title: 'Which employee classes should move to an ICHRA, and at what allowance?',
    lede: 'Employers moving to an individual coverage HRA have to pick which classes of employee '
      + 'to move and how large an allowance to fund, and the two choices decide whether anyone '
      + 'actually comes out ahead. This models both against a synthetic 500-employee company.',
    privacy: 'Summary data only. No individual health information, and counts under 11 are hidden.',
  },
  employee: {
    title: 'Find the plan that costs you least next year.',
    lede: 'Most people pick the plan with the lowest premium and end up paying more. Crosswalk '
      + 'reads a person’s own health records, plays out their next year on every plan, and '
      + 'shows what they would really pay — without breaking the care they already have.',
  },
};

/** The view a URL asks for, falling back to the default. */
export function viewFromUrl(search: string = window.location.search): ViewName {
  const requested = new URLSearchParams(search).get('view');
  return VIEWS.includes(requested as ViewName) ? (requested as ViewName) : DEFAULT_VIEW;
}

/** The URL for a view, preserving the rest of the query string. */
export function urlForView(view: ViewName): string {
  const params = new URLSearchParams(window.location.search);
  params.set('view', view);
  return `${window.location.pathname}?${params.toString()}`;
}

export interface ShellOptions {
  /** Render a view into the container. Called once per view, then cached. */
  readonly render: (view: ViewName, container: HTMLElement) => void | Promise<void>;
}

/** Wire up the shell and show the view the URL asks for. */
export function startShell(options: ShellOptions): void {
  const container = el('view');
  // Replace the static loading placeholder from index.html.
  container.replaceChildren();
  const rendered = new Set<ViewName>();
  const panels = new Map<ViewName, HTMLElement>();
  let current: ViewName | null = null;

  async function show(view: ViewName, pushHistory: boolean): Promise<void> {
    if (current === view) return;
    current = view;

    document.documentElement.dataset.view = view;
    const copy = COPY[view];
    el('shellTitle').textContent = copy.title;
    el('shellLede').textContent = copy.lede;
    const privacy = el('shellPrivacy');
    if (copy.privacy) {
      privacy.innerHTML = `${lockIcon()}<span>${copy.privacy}</span>`;
      privacy.hidden = false;
    } else {
      privacy.hidden = true;
    }

    for (const [name, panel] of panels) panel.hidden = name !== view;

    for (const button of qsa<HTMLButtonElement>(el('viewToggle'), 'button')) {
      // aria-current is present on the active item and absent elsewhere.
      // aria-current="false" would announce every tab as current.
      if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }

    if (pushHistory) window.history.pushState({ view }, '', urlForView(view));

    if (!rendered.has(view)) {
      rendered.add(view);
      const panel = document.createElement('div');
      panel.dataset.panel = view;
      container.append(panel);
      panels.set(view, panel);
      for (const [name, other] of panels) other.hidden = name !== view;
      try {
        await options.render(view, panel);
      } catch (error) {
        rendered.delete(view);
        panel.innerHTML = `<div class="panel"><h2>Something went wrong</h2>`
          + `<p class="fine" style="margin-top:8px">${String(error instanceof Error ? error.message : error)}</p></div>`;
      }
    }
  }

  qsa<HTMLButtonElement>(el('viewToggle'), 'button').forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.dataset.view as ViewName | undefined;
      if (view) void show(view, true);
    });
  });

  window.addEventListener('popstate', () => {
    // Back and forward restore the view without pushing another entry.
    void show(viewFromUrl(), false);
  });

  // Normalise the URL so the current view is always explicit and shareable.
  const initial = viewFromUrl();
  window.history.replaceState({ view: initial }, '', urlForView(initial));
  void show(initial, false);
}

function lockIcon(): string {
  return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">'
    + '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
}
