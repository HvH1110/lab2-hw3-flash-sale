import {
  claimHookSlot,
  commitRender,
  hasSlot,
  inspectStateStore,
  isRendering,
  readSlot,
  resetCursor,
  resetStateStore,
  setRenderer,
  triggerRender,
  writeSlot,
} from '../src/state-store';

/** Simulates a render pass that calls `hooks` hooks. */
const renderPass = (hooks: number): void => {
  resetCursor();
  for (let i = 0; i < hooks; i++) claimHookSlot();
  commitRender();
};

beforeEach(resetStateStore);

describe('stateStore cursor', () => {
  it('hands out sequential slots within a render pass', () => {
    resetCursor();
    expect([claimHookSlot(), claimHookSlot(), claimHookSlot()]).toEqual([0, 1, 2]);
    expect(inspectStateStore().cursor).toBe(3);
  });

  it('resetCursor rewinds to slot 0 for the next pass', () => {
    renderPass(2);
    resetCursor();
    expect(claimHookSlot()).toBe(0);
  });

  it('tracks whether a render pass is in progress', () => {
    expect(isRendering()).toBe(false);
    resetCursor();
    expect(isRendering()).toBe(true);
    commitRender();
    expect(isRendering()).toBe(false);
  });

  it('rejects hook calls outside a render pass', () => {
    expect(() => claimHookSlot()).toThrow(/Invalid hook call/);
  });

  it('rejects commitRender without a render pass', () => {
    expect(() => commitRender()).toThrow(/no render pass/);
  });
});

describe('slot storage', () => {
  it('stores values by slot and survives render passes', () => {
    resetCursor();
    const slot = claimHookSlot();
    expect(hasSlot(slot)).toBe(false);
    writeSlot(slot, ['Review PR']);
    commitRender();

    resetCursor();
    expect(hasSlot(0)).toBe(true);
    expect(readSlot<string[]>(0)).toEqual(['Review PR']);
  });

  it('distinguishes an initialised undefined/null slot from an empty one', () => {
    writeSlot(0, undefined);
    writeSlot(1, null);
    expect([hasSlot(0), hasSlot(1), hasSlot(2)]).toEqual([true, true, false]);
  });

  it('inspectStateStore returns a copy', () => {
    writeSlot(0, 'a');
    const snapshot = inspectStateStore();
    writeSlot(0, 'b');
    expect(snapshot.states).toEqual(['a']);
  });
});

describe('Rules of Hooks invariant', () => {
  it('accepts the same hook count on every render', () => {
    renderPass(2);
    expect(() => renderPass(2)).not.toThrow();
  });

  it('throws when a render skips a hook (conditional hook)', () => {
    renderPass(3);
    expect(() => renderPass(2)).toThrow(/called 2 hook\(s\) but the previous render called 3/);
  });

  it('throws when a render adds a hook', () => {
    renderPass(1);
    expect(() => renderPass(2)).toThrow(/Rules of Hooks violated/);
  });
});

describe('renderer', () => {
  it('triggerRender calls the installed renderer', () => {
    const renderer = vi.fn();
    setRenderer(renderer);
    triggerRender();
    expect(renderer).toHaveBeenCalledTimes(1);
  });

  it('is a no-op before a renderer is installed', () => {
    expect(() => triggerRender()).not.toThrow();
  });
});
