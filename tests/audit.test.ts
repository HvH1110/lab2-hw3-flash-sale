import { auditMount, auditTree } from '../src/audit';
import { createElement } from '../src/create-element';
import { mount, renderToDOM } from '../src/render-to-dom';
import type { VNode, VNodeProps } from '../src/types';

const tree = (): VNode =>
  createElement('main', { id: 'root-view' },
    createElement('header', null, createElement('h1', null, 'Mini React Engine')),
    createElement('section', null, createElement('p', null, 'Body'), createElement('button', null, 'Click')),
  );

describe('auditTree', () => {
  it('passes for a freshly rendered tree and counts every node', () => {
    const vnode = tree();
    const report = auditTree(vnode, renderToDOM(vnode));
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
    // main, header, h1, #text, section, p, #text, button, #text
    expect(report.vnodeCount).toBe(9);
    expect(report.domNodeCount).toBe(9);
  });

  it('detects an orphan node appended outside the engine', () => {
    const vnode = tree();
    const dom = renderToDOM(vnode);
    (dom as Element).querySelector('section')?.append(document.createElement('aside'));
    const report = auditTree(vnode, dom);
    expect(report.ok).toBe(false);
    expect(report.issues[0]?.path).toBe('main > section[1]');
    expect(report.issues[0]?.message).toMatch(/orphan/);
  });

  it('detects text and tag mismatches', () => {
    const vnode = tree();
    const dom = renderToDOM(vnode) as Element;
    const h1 = dom.querySelector('h1');
    if (h1?.firstChild instanceof Text) h1.firstChild.data = 'tampered';
    dom.querySelector('button')?.replaceWith(document.createElement('a'));
    const messages = auditTree(vnode, dom).issues.map((i) => i.message);
    expect(messages).toEqual([
      expect.stringMatching(/text mismatch/),
      expect.stringMatching(/expected <button>, found a/),
    ]);
  });

  it('flags div-soup', () => {
    const vnode = createElement('div', null, createElement('span', null, 'x'));
    const report = auditTree(vnode, renderToDOM(vnode));
    expect(report.issues.map((i) => i.path)).toEqual(['div', 'div > span[0]']);
  });

  it('resolves function components before comparing', () => {
    const Card = (props: VNodeProps): VNode => createElement('article', null, ...props.children);
    const vnode = createElement('main', null, createElement(Card, null, 'inside'));
    expect(auditTree(vnode, renderToDOM(vnode)).ok).toBe(true);
  });
});

describe('auditMount', () => {
  it('passes for a mounted tree', () => {
    const container = document.createElement('section');
    const vnode = tree();
    mount(vnode, container);
    expect(auditMount(vnode, container).ok).toBe(true);
  });

  it('flags extra nodes next to the root', () => {
    const container = document.createElement('section');
    const vnode = tree();
    mount(vnode, container);
    container.append('orphan');
    expect(auditMount(vnode, container).issues[0]?.message).toMatch(/exactly 1 root node, found 2/);
  });
});
