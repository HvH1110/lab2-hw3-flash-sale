import { auditTree } from '../src/audit';
import { createElement } from '../src/create-element';
import { setupEventDelegation } from '../src/events';
import { patch, resolveTree, type HostVNode } from '../src/reconcile';
import { renderToDOM } from '../src/render-to-dom';
import type { VNode, VNodeProps } from '../src/types';

/** Renders `first`, patches to `second`, and returns both DOM roots plus the container. */
function rerender(first: VNode, second: VNode) {
  const container = document.createElement('section');
  document.body.replaceChildren(container);
  const a = resolveTree(first);
  const b = resolveTree(second);
  const before = renderToDOM(a);
  container.append(before);
  const after = patch(before, a, b);
  return { before, after, container, tree: b };
}

const list = (ids: readonly string[], keyed = true): VNode =>
  createElement('ul', null, ids.map((id) => createElement('li', keyed ? { key: id, id } : { id }, id)));

describe('resolveTree', () => {
  it('expands function components', () => {
    const Badge = (props: VNodeProps): VNode => createElement('strong', null, ...props.children);
    const tree = resolveTree(createElement('p', null, createElement(Badge, null, 'Lead')));
    expect(tree.type).toBe('p');
    expect(tree.props.children[0]?.type).toBe('strong');
  });

  it('keeps the identity of subtrees without components (structural sharing)', () => {
    const vnode = createElement('main', null, createElement('h1', null, 'Static'));
    expect(resolveTree(vnode)).toBe(vnode);
  });
});

describe('patch: node identity', () => {
  it('reuses the element when the type is unchanged', () => {
    const { before, after } = rerender(createElement('p', { id: 'a' }, 'x'), createElement('p', { id: 'b' }, 'y'));
    expect(after).toBe(before);
    expect((after as Element).id).toBe('b');
    expect(after.textContent).toBe('y');
  });

  it('updates text nodes in place', () => {
    const { before, after } = rerender(createElement('p', null, 'old'), createElement('p', null, 'new'));
    expect(after.firstChild).toBe(before.firstChild);
    expect(after.firstChild?.textContent).toBe('new');
  });

  it('replaces the subtree when the type changes', () => {
    const { before, after, container } = rerender(createElement('p', null, 'x'), createElement('h2', null, 'x'));
    expect(after).not.toBe(before);
    expect(container.firstChild).toBe(after);
    expect((after as Element).tagName).toBe('H2');
  });

  it('skips identical subtrees', () => {
    const shared = createElement('footer', null, 'same');
    const { before, after } = rerender(createElement('main', null, shared, 'a'), createElement('main', null, shared, 'b'));
    expect(after.firstChild).toBe(before.firstChild);
  });
});

describe('patch: props', () => {
  it('adds, changes and removes attributes', () => {
    const { after } = rerender(
      createElement('button', { className: 'a', title: 't', disabled: true, 'aria-pressed': 'false' }),
      createElement('button', { className: 'b', 'aria-pressed': 'true', disabled: false }),
    );
    const el = after as Element;
    expect(el.getAttribute('class')).toBe('b');
    expect(el.hasAttribute('title')).toBe(false);
    expect(el.hasAttribute('disabled')).toBe(false);
    expect(el.getAttribute('aria-pressed')).toBe('true');
  });

  it('swaps event handlers and removes dropped ones', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { after, container } = rerender(createElement('button', { onClick: first }), createElement('button', { onClick: second }));
    const teardown = setupEventDelegation(container);
    (after as HTMLElement).click();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    const tree = resolveTree(createElement('button', { onClick: second }));
    patch(after, tree, resolveTree(createElement('button', null)));
    (after as HTMLElement).click();
    expect(second).toHaveBeenCalledTimes(1);
    teardown();
  });

  it('syncs live input properties the user may have changed', () => {
    const { before, after } = rerender(createElement('input', { value: 'a' }), createElement('input', { value: 'b' }));
    expect((after as HTMLInputElement).value).toBe('b');

    const input = before as HTMLInputElement;
    input.value = 'typed by user';
    const prev = resolveTree(createElement('input', { value: 'b' }));
    patch(input, prev, resolveTree(createElement('input', { value: '' })));
    expect(input.value).toBe('');
  });

  it('keeps checkboxes controlled', () => {
    const { before } = rerender(createElement('input', { type: 'checkbox', checked: false }), createElement('input', { type: 'checkbox', checked: false }));
    const box = before as HTMLInputElement;
    box.checked = true; // user click whose state change was rejected
    const tree = resolveTree(createElement('input', { type: 'checkbox', checked: false }));
    patch(box, tree, resolveTree(createElement('input', { type: 'checkbox', checked: false, id: 'x' })));
    expect(box.checked).toBe(false);
  });

  it('applies a select value after its options exist', () => {
    const select = (value: string): VNode =>
      createElement('select', { value }, ['10', '25', '50'].map((v) => createElement('option', { key: v, value: v }, v)));
    const fresh = renderToDOM(resolveTree(select('25'))) as HTMLSelectElement;
    expect(fresh.value).toBe('25');
    const { after } = rerender(select('25'), select('50'));
    expect((after as HTMLSelectElement).value).toBe('50');
  });
});

describe('patch: keyed children', () => {
  const ids = (el: Node): string[] => [...(el as Element).children].map((c) => c.id);
  const nodes = (el: Node): Element[] => [...(el as Element).children];

  it('moves keyed nodes instead of recreating them', () => {
    const a = resolveTree(list(['a', 'b', 'c']));
    const dom = renderToDOM(a);
    document.createElement('section').append(dom);
    const [na, nb, nc] = nodes(dom);
    patch(dom, a, resolveTree(list(['c', 'a', 'b'])));
    expect(ids(dom)).toEqual(['c', 'a', 'b']);
    expect(nodes(dom)).toEqual([nc, na, nb]);
    expect(nodes(dom)[0]).toBe(nc);
  });

  it('inserts and removes keyed nodes, keeping the survivors', () => {
    const container = document.createElement('section');
    const a = resolveTree(list(['a', 'b', 'c']));
    const dom = renderToDOM(a);
    container.append(dom);
    const [, b, c] = nodes(dom);
    patch(dom, a, resolveTree(list(['b', 'x', 'c'])));
    expect(ids(dom)).toEqual(['b', 'x', 'c']);
    expect(nodes(dom)[0]).toBe(b);
    expect(nodes(dom)[2]).toBe(c);
  });

  it('keeps per-row DOM state attached to the right item when an earlier item is deleted (key contract)', () => {
    const row = (id: string): VNode => createElement('li', { key: id }, createElement('input', { id: `in-${id}` }));
    const view = (rows: string[]): VNode => createElement('ul', null, rows.map(row));
    const container = document.createElement('section');
    const a = resolveTree(view(['A', 'B']));
    const dom = renderToDOM(a);
    container.append(dom);
    (dom as Element).querySelector<HTMLInputElement>('#in-B')!.value = 'Draft B';
    patch(dom, a, resolveTree(view(['B'])));
    expect((dom as Element).querySelector<HTMLInputElement>('#in-B')?.value).toBe('Draft B');
  });

  it('pairs unkeyed children by index', () => {
    const { before, after } = rerender(list(['a', 'b'], false), list(['x', 'y', 'z'], false));
    expect(ids(after)).toEqual(['x', 'y', 'z']);
    expect(nodes(after)[0]).toBe(nodes(before)[0]);
  });

  it('throws on duplicate sibling keys', () => {
    expect(() => rerender(list(['a']), list(['a', 'a']))).toThrow(/duplicate key "a"/);
  });

  it('fails loudly when the DOM was changed behind the engine', () => {
    const a = resolveTree(list(['a']));
    const dom = renderToDOM(a);
    (dom as Element).append(document.createElement('li'));
    expect(() => patch(dom, a, resolveTree(list(['a', 'b'])))).toThrow(/out of sync|DOM children/);
  });

  it('matches a fresh render for 200 random list mutations', () => {
    let seed = 42;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const pool = 'abcdefghijklmnop'.split('');
    const randomIds = (): string[] => pool.filter(() => random() < 0.5).sort(() => random() - 0.5);

    const container = document.createElement('section');
    let tree: HostVNode = resolveTree(list(randomIds()));
    let dom = renderToDOM(tree);
    container.append(dom);
    for (let i = 0; i < 200; i++) {
      const next = resolveTree(list(randomIds()));
      dom = patch(dom, tree, next);
      tree = next;
      expect((dom as Element).outerHTML).toBe((renderToDOM(next) as Element).outerHTML);
      expect(auditTree(tree, dom).ok).toBe(true);
    }
  });
});
