import { auditMount } from '../src/audit';
import { createElement } from '../src/create-element';
import { renderApp, type AppHandle } from '../src/reactive-engine';
import { inspectStateStore } from '../src/state-store';
import type { VNode } from '../src/types';
import { useState } from '../src/use-state';

function Counter(): VNode {
  const [count, setCount] = useState(0);
  return createElement('main', null,
    createElement('output', { id: 'count' }, count),
    createElement('button', { id: 'inc', type: 'button', onClick: () => setCount((c) => c + 1) }, 'Increment'),
  );
}

let app: AppHandle | null = null;
let root: HTMLElement;

beforeEach(() => {
  root = document.createElement('section');
  document.body.replaceChildren(root);
});

afterEach(() => {
  app?.unmount();
  app = null;
});

const click = (selector: string): void => root.querySelector<HTMLElement>(selector)?.click();
const text = (selector: string): string | null | undefined => root.querySelector(selector)?.textContent;

describe('renderApp', () => {
  it('renders the component into the container', () => {
    app = renderApp(Counter, root);
    expect(text('#count')).toBe('0');
    expect(root.childNodes).toHaveLength(1);
  });

  it('re-renders when state changes through a delegated event', () => {
    app = renderApp(Counter, root);
    click('#inc');
    click('#inc');
    expect(text('#count')).toBe('2');
    expect(inspectStateStore().states).toEqual([2]);
  });

  it('never attaches listeners to children across re-renders', () => {
    const addListener = vi.spyOn(EventTarget.prototype, 'addEventListener');
    app = renderApp(Counter, root);
    for (let i = 0; i < 5; i++) click('#inc');
    expect(addListener.mock.instances.every((target) => target === root)).toBe(true);
    expect(addListener).toHaveBeenCalledTimes(5); // one per delegated event type, once
    addListener.mockRestore();
  });

  it('keeps the DOM in 1:1 parity with the VNode tree after every commit', () => {
    const reports: boolean[] = [];
    app = renderApp(Counter, root, { onCommit: (tree, container) => reports.push(auditMount(tree, container).ok) });
    click('#inc');
    click('#inc');
    expect(reports).toEqual([true, true, true]);
    expect(app.getTree()?.type).toBe('main');
  });

  it('restores focus to the element with the same id after re-mounting', () => {
    app = renderApp(Counter, root);
    root.querySelector<HTMLElement>('#inc')?.focus();
    click('#inc');
    expect(document.activeElement?.id).toBe('inc');
    expect(document.activeElement).toBe(root.querySelector('#inc'));
  });

  it('supports hooks in nested components', () => {
    function Toggle(): VNode {
      const [on, setOn] = useState(false);
      return createElement('button', { id: 'toggle', 'aria-pressed': String(on), onClick: () => setOn((v) => !v) }, 'T');
    }
    app = renderApp(() => createElement('main', null, createElement(Counter), createElement(Toggle)), root);
    click('#toggle');
    click('#inc');
    expect(root.querySelector('#toggle')?.getAttribute('aria-pressed')).toBe('true');
    expect(text('#count')).toBe('1');
  });

  it('allows only one mounted app at a time', () => {
    app = renderApp(Counter, root);
    expect(() => renderApp(Counter, document.createElement('section'))).toThrow(/already mounted/);
  });

  it('unmount clears the container, the listeners and the state store', () => {
    app = renderApp(Counter, root);
    click('#inc');
    app.unmount();
    app = null;
    expect(root.childNodes).toHaveLength(0);
    expect(inspectStateStore().states).toEqual([]);
    app = renderApp(Counter, root);
    expect(text('#count')).toBe('0');
  });

  it('recovers from a render error so later updates still work', () => {
    let shouldThrow = false;
    function Flaky(): VNode {
      const [count, setCount] = useState(0);
      if (shouldThrow) throw new Error('boom');
      return createElement('button', { id: 'inc', onClick: () => setCount((c) => c + 1) }, count);
    }
    app = renderApp(Flaky, root);
    shouldThrow = true;
    expect(() => app?.rerender()).toThrow('boom');
    shouldThrow = false;
    click('#inc');
    expect(text('#inc')).toBe('1');
  });
});

describe('renderApp with reconciliation', () => {
  it('patches in place: the same button element survives re-renders', () => {
    app = renderApp(Counter, root);
    const button = root.querySelector('#inc');
    click('#inc');
    click('#inc');
    expect(root.querySelector('#inc')).toBe(button);
    expect(text('#count')).toBe('2');
  });

  it('keeps focus without restoring it, because the focused node is never replaced', () => {
    app = renderApp(Counter, root);
    const button = root.querySelector<HTMLElement>('#inc');
    button?.focus();
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    click('#inc');
    expect(document.activeElement).toBe(button);
    expect(focus).not.toHaveBeenCalled();
    focus.mockRestore();
  });
});

describe('renderApp: failed first render', () => {
  it('does not leave the engine locked as "already mounted"', () => {
    expect(() => renderApp(() => { throw new Error('boom'); }, root)).toThrow('boom');
    app = renderApp(Counter, root);
    expect(root.querySelector('#count')?.textContent).toBe('0');
  });
});
