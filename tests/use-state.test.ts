import { commitRender, inspectStateStore, resetCursor, resetStateStore, setRenderer } from '../src/state-store';
import type { StateSetter } from '../src/types';
import { useState } from '../src/use-state';

/** Minimal render loop: re-runs `component` whenever state changes. */
function harness<R>(component: () => R) {
  const results: R[] = [];
  const render = (): void => {
    resetCursor();
    results.push(component());
    commitRender();
  };
  setRenderer(render);
  render();
  return { results, latest: (): R => results[results.length - 1] as R };
}

beforeEach(resetStateStore);

describe('useState', () => {
  it('returns the initial value on the first render', () => {
    const { latest } = harness(() => useState(['Review PR', 'Verify AST'])[0]);
    expect(latest()).toEqual(['Review PR', 'Verify AST']);
  });

  it('keeps independent slots per hook in call order', () => {
    const { latest } = harness(() => {
      const [tasks] = useState(['a']);
      const [filter] = useState('ALL');
      return { tasks, filter };
    });
    expect(latest()).toEqual({ tasks: ['a'], filter: 'ALL' });
    expect(inspectStateStore().states).toEqual([['a'], 'ALL']);
  });

  it('re-renders with the new value when the setter is called', () => {
    let setCount!: StateSetter<number>;
    const { results } = harness(() => {
      const [count, set] = useState(0);
      setCount = set;
      return count;
    });
    setCount(5);
    expect(results).toEqual([0, 5]);
  });

  it('supports updater functions based on the previous value', () => {
    let setCount!: StateSetter<number>;
    const { results } = harness(() => {
      const [count, set] = useState(0);
      setCount = set;
      return count;
    });
    setCount((c) => c + 1);
    setCount((c) => c + 1);
    expect(results).toEqual([0, 1, 2]);
  });

  it('setters from an old render still target their own slot (closure over cursor)', () => {
    const setters: StateSetter<string>[] = [];
    const { latest } = harness(() => {
      const [a, setA] = useState('a0');
      const [b, setB] = useState('b0');
      setters.splice(0, 2, setA, setB);
      return `${a}|${b}`;
    });
    const [, staleSetB] = setters;
    staleSetB?.('b1');
    setters[0]?.('a1');
    staleSetB?.('b2');
    expect(latest()).toBe('a1|b2');
  });

  it('skips the re-render when the value is unchanged (Object.is)', () => {
    const tasks = ['x'];
    let setTasks!: StateSetter<string[]>;
    const { results } = harness(() => {
      const [value, set] = useState(tasks);
      setTasks = set;
      return value;
    });
    setTasks(tasks);
    setTasks((prev) => prev);
    expect(results).toHaveLength(1);
  });

  it('treats NaN as unchanged and -0/+0 as changed (Object.is semantics)', () => {
    let setValue!: StateSetter<number>;
    const { results } = harness(() => {
      const [value, set] = useState(Number.NaN);
      setValue = set;
      return value;
    });
    setValue(Number.NaN);
    expect(results).toHaveLength(1);
    setValue(0);
    setValue(-0);
    expect(results).toHaveLength(3);
  });

  it('keeps a stored null instead of falling back to the initial value', () => {
    let setUser!: StateSetter<string | null>;
    const { latest } = harness(() => {
      const [user, set] = useState<string | null>('Khiem');
      setUser = set;
      return user;
    });
    setUser(null);
    expect(latest()).toBeNull();
  });

  it('throws when a setter is called during render', () => {
    expect(() =>
      harness(() => {
        const [count, setCount] = useState(0);
        setCount(count + 1);
        return count;
      }),
    ).toThrow(/Cannot update state while rendering/);
  });

  it('ignores a setter called after the store was reset (late async response after unmount)', () => {
    let setCount!: StateSetter<number>;
    const renderer = vi.fn();
    harness(() => {
      const [count, set] = useState(0);
      setCount = set;
      return count;
    });
    resetStateStore();
    setRenderer(renderer);

    setCount(42);
    expect(inspectStateStore().states).toEqual([]);
    expect(renderer).not.toHaveBeenCalled();
  });

  it('throws when called outside a render pass', () => {
    expect(() => useState(0)).toThrow(/Invalid hook call/);
  });

  it('detects a conditional hook (slide 19 failure mode)', () => {
    let setPremium!: StateSetter<boolean>;
    harness(() => {
      const [isPremium, set] = useState(true);
      setPremium = set;
      if (isPremium) useState('Platinum');
      useState(28);
      return null;
    });
    expect(() => setPremium(false)).toThrow(/Rules of Hooks violated/);
  });
});
