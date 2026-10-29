import { setupEventDelegation } from './events';
import { patch, resolveTree, type HostVNode } from './reconcile';
import { mount } from './render-to-dom';
import { abortRender, commitRender, resetCursor, resetStateStore, setRenderer } from './state-store';
import type { RootComponent } from './types';
import { discardPendingEffects, disposeEffects, flushEffects } from './use-effect';

export interface RenderAppOptions {
  /** Called after every committed render, e.g. to run the DOM parity audit. */
  readonly onCommit?: (tree: HostVNode, container: Element) => void;
}

export interface AppHandle {
  readonly rerender: () => void;
  readonly unmount: () => void;
  /** VNode tree of the last committed render. */
  readonly getTree: () => HostVNode | null;
}

/** The state store is a single global, so only one app can be mounted at a time. */
let mounted = false;

function focusedIdWithin(container: Element): string {
  const active = container.ownerDocument.activeElement;
  return active !== null && active !== container && container.contains(active) ? active.id : '';
}

/** Every render re-mounts the whole tree, so focus is restored by element id. */
function restoreFocus(container: Element, id: string): void {
  if (id === '') return;
  const element = container.ownerDocument.getElementById(id);
  if (element instanceof HTMLElement && container.contains(element)) element.focus();
}

export function renderApp(Component: RootComponent, container: Element, options: RenderAppOptions = {}): AppHandle {
  if (mounted) throw new Error('renderApp: an app is already mounted; unmount it first');
  mounted = true;

  const teardownEvents = setupEventDelegation(container);
  let tree: HostVNode | null = null;

  const render = (): void => {
    const focusedId = focusedIdWithin(container);
    let next: HostVNode;
    resetCursor();
    try {
      // All components (and their hooks) run here, before any DOM work.
      next = resolveTree(Component());
      commitRender();
    } catch (error) {
      abortRender();
      discardPendingEffects();
      throw error;
    }

    const root = container.firstChild;
    try {
      if (tree === null || root === null || container.childNodes.length !== 1) {
        mount(next, container);
      } else {
        const patched = patch(root, tree, next);
        if (patched !== root) container.replaceChildren(patched);
      }
    } catch (error) {
      tree = null; // DOM may be half-patched: the next render re-mounts from scratch
      discardPendingEffects();
      throw error;
    }

    tree = next;
    // Patching keeps focused elements alive; this only matters when a node had to be replaced.
    if (!container.contains(container.ownerDocument.activeElement)) restoreFocus(container, focusedId);
    options.onCommit?.(next, container);
    // After the DOM is final: effects may read layout, move focus, or set state (re-render).
    flushEffects();
  };

  setRenderer(render);
  render();

  return {
    rerender: render,
    getTree: () => tree,
    unmount: () => {
      // Stop rendering first: cleanups (closing an AudioContext, cancelling a queue) may emit
      // events that call setState, and a render now would run effects against half-torn-down state.
      setRenderer(() => {});
      disposeEffects();
      teardownEvents();
      container.replaceChildren();
      resetStateStore();
      tree = null;
      mounted = false;
    },
  };
}
