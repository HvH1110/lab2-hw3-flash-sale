import { commitRender, inspectStateStore, resetCursor, resetStateStore, setRenderer } from '../src/state-store';
import type { StateSetter } from '../src/types';
import { useRef, type Ref } from '../src/use-ref';
import { useState } from '../src/use-state';

beforeEach(resetStateStore);

describe('useRef', () => {
  it('returns the same box on every render and keeps mutations', () => {
    const boxes: Ref<number>[] = [];
    let setTick!: StateSetter<number>;
    const render = (): void => {
      resetCursor();
      const ref = useRef(0);
      const [, set] = useState(0);
      setTick = set;
      boxes.push(ref);
      commitRender();
    };
    setRenderer(render);
    render();

    const first = boxes[0];
    if (first === undefined) throw new Error('no render');
    first.current = 7;
    setTick(1);
    expect(boxes).toHaveLength(2);
    expect(boxes[1]).toBe(first);
    expect(boxes[1]?.current).toBe(7);
  });

  it('does not trigger a render when current changes', () => {
    const renderer = vi.fn();
    resetCursor();
    const ref = useRef<string | null>(null);
    commitRender();
    setRenderer(renderer);
    ref.current = 'changed';
    expect(renderer).not.toHaveBeenCalled();
  });

  it('occupies exactly one hook slot', () => {
    resetCursor();
    useRef('a');
    useRef('b');
    commitRender();
    expect(inspectStateStore().states).toEqual([{ current: 'a' }, { current: 'b' }]);
  });
});
