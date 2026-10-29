import { createElement } from '../src/create-element';
import { renderApp, type AppHandle } from '../src/reactive-engine';
import type { StateSetter, VNode } from '../src/types';
import { useEffect } from '../src/use-effect';
import { useState } from '../src/use-state';

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

describe('useEffect', () => {
  it('runs after the DOM is committed', () => {
    const seen: (string | null | undefined)[] = [];
    app = renderApp(() => {
      useEffect(() => {
        seen.push(root.querySelector('output')?.textContent);
      }, []);
      return createElement('output', null, 'committed');
    }, root);
    expect(seen).toEqual(['committed']);
  });

  it('with [] runs once; with deps runs when they change; without deps runs every commit', () => {
    const log: string[] = [];
    let setCount!: StateSetter<number>;
    let setOther!: StateSetter<number>;
    app = renderApp(() => {
      const [count, a] = useState(0);
      const [other, b] = useState(0);
      setCount = a;
      setOther = b;
      useEffect(() => void log.push('mount'), []);
      useEffect(() => void log.push(`count:${count}`), [count]);
      useEffect(() => void log.push('every'));
      return createElement('p', null, `${count}/${other}`);
    }, root);

    setOther(1);
    setCount(1);
    expect(log).toEqual(['mount', 'count:0', 'every', 'every', 'count:1', 'every']);
  });

  it('runs the previous cleanup before re-running, and all cleanups on unmount', () => {
    const log: string[] = [];
    let setCount!: StateSetter<number>;
    app = renderApp(() => {
      const [count, set] = useState(0);
      setCount = set;
      useEffect(() => {
        log.push(`start ${count}`);
        return () => log.push(`stop ${count}`);
      }, [count]);
      return createElement('p', null, count);
    }, root);

    setCount(1);
    app.unmount();
    app = null;
    expect(log).toEqual(['start 0', 'stop 0', 'start 1', 'stop 1']);
  });

  it('can set state, which triggers one more commit', () => {
    let renders = 0;
    app = renderApp(() => {
      renders++;
      const [ready, setReady] = useState(false);
      useEffect(() => setReady(true), []);
      return createElement('p', null, ready ? 'ready' : 'pending');
    }, root);
    expect(root.textContent).toBe('ready');
    expect(renders).toBe(2);
  });

  it('can move focus to an element created in the same commit', () => {
    app = renderApp(() => {
      useEffect(() => root.querySelector<HTMLElement>('#target')?.focus(), []);
      return createElement('main', null, createElement('button', { id: 'target', type: 'button' }, 'Focus me'));
    }, root);
    expect(document.activeElement?.id).toBe('target');
  });

  it('does not run effects of a render that threw', () => {
    const effect = vi.fn();
    let fail = false;
    let setTick!: StateSetter<number>;
    app = renderApp((): VNode => {
      const [tick, set] = useState(0);
      setTick = set;
      useEffect(effect, [tick]);
      if (fail) throw new Error('render failed');
      return createElement('p', null, tick);
    }, root);
    expect(effect).toHaveBeenCalledTimes(1);
    fail = true;
    expect(() => setTick(1)).toThrow('render failed');
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('counts as a hook: a conditional effect violates the Rules of Hooks', () => {
    let setOn!: StateSetter<boolean>;
    app = renderApp(() => {
      const [on, set] = useState(true);
      setOn = set;
      if (on) useEffect(() => {}, []);
      return createElement('p', null, String(on));
    }, root);
    expect(() => setOn(false)).toThrow(/Rules of Hooks violated/);
  });
});

describe('useEffect: unmount', () => {
  it('state updates fired by cleanups during unmount do not re-render (no effects on torn-down state)', () => {
    const render = vi.fn();
    const effect = vi.fn();
    let setTick!: StateSetter<number>;
    app = renderApp(() => {
      render();
      const [tick, set] = useState(0);
      setTick = set;
      useEffect(() => () => setTick(tick + 1), []); // cleanup that emits a state change
      useEffect(effect, [tick]);
      return createElement('p', null, tick);
    }, root);
    render.mockClear();
    effect.mockClear();
    app.unmount();
    app = null;
    expect(render).not.toHaveBeenCalled();
    expect(effect).not.toHaveBeenCalled();
  });
});

describe('useEffect: effects that set state', () => {
  it('an effect that sets a new value on mount runs exactly once (deps recorded before it runs)', () => {
    const effect = vi.fn();
    app = renderApp(() => {
      const [items, setItems] = useState<readonly number[]>([]);
      useEffect(() => {
        effect();
        setItems([1, 2, 3]); // a *new* array every time: would loop forever if the effect re-ran
      }, []);
      return createElement('p', null, items.length);
    }, root);
    expect(effect).toHaveBeenCalledTimes(1);
    expect(root.textContent).toBe('3');
  });
});
