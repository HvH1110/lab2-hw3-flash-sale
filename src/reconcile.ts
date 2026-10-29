import { patchProps, renderToDOM, syncLiveProps } from './render-to-dom';
import { isComponentVNode, isTextVNode, isVNode, type ElementVNode, type TextVNode, type VNode } from './types';

/** A tree with every function component expanded: only elements and text remain. */
export type HostVNode = TextVNode | ElementVNode;

/**
 * Expands function components so the tree can be diffed. Hooks inside components run here,
 * in deterministic depth-first order. Unchanged subtrees keep their identity (structural sharing),
 * which lets `patch` skip them entirely.
 */
export function resolveTree(vnode: VNode): HostVNode {
  if (isTextVNode(vnode)) return vnode;
  if (isComponentVNode(vnode)) {
    const rendered: unknown = vnode.type(vnode.props);
    if (!isVNode(rendered)) {
      throw new TypeError(`resolveTree: component ${vnode.type.name || 'anonymous'} did not return a VNode`);
    }
    return resolveTree(rendered);
  }

  const children = vnode.props.children;
  const resolved = children.map(resolveTree);
  if (resolved.every((child, i) => child === children[i])) return vnode;
  return Object.freeze({ type: vnode.type, props: Object.freeze({ ...vnode.props, children: Object.freeze(resolved) }) });
}

function keyOf(vnode: HostVNode, index: number): string {
  const key = isTextVNode(vnode) ? undefined : vnode.props['key'];
  // Unkeyed children fall back to their position (classic index pairing).
  return typeof key === 'string' || typeof key === 'number' ? `k:${key}` : `i:${index}`;
}

function sameType(a: HostVNode, b: HostVNode): boolean {
  return a.type === b.type;
}

/**
 * Updates `dom` (which currently mirrors `previous`) so it mirrors `next`.
 * Returns the DOM node now representing `next` (a new node only if the type changed).
 */
export function patch(dom: Node, previous: HostVNode, next: HostVNode): Node {
  if (previous === next) return dom;

  if (!sameType(previous, next)) {
    // Heuristic 1: a different type means a different subtree. Tear down and rebuild.
    const fresh = renderToDOM(next);
    dom.parentNode?.replaceChild(fresh, dom);
    return fresh;
  }

  if (isTextVNode(next)) {
    if (dom instanceof Text && dom.data !== next.props.nodeValue) dom.data = next.props.nodeValue;
    return dom;
  }

  if (isTextVNode(previous) || !(dom instanceof HTMLElement)) {
    throw new Error('patch: DOM is out of sync with the VNode tree');
  }
  patchProps(dom, previous.props, next.props);
  patchChildren(dom, previous.props.children as readonly HostVNode[], next.props.children as readonly HostVNode[]);
  syncLiveProps(dom, next.props);
  return dom;
}

/** Heuristic 2: children are matched by key (or index) in one pass: O(n). */
function patchChildren(parent: HTMLElement, previous: readonly HostVNode[], next: readonly HostVNode[]): void {
  const oldNodes = [...parent.childNodes];
  if (oldNodes.length !== previous.length) {
    throw new Error(`patch: <${parent.localName}> has ${oldNodes.length} DOM children but ${previous.length} VNodes`);
  }

  const oldByKey = new Map<string, { vnode: HostVNode; dom: Node }>();
  previous.forEach((vnode, i) => {
    const dom = oldNodes[i];
    if (dom !== undefined) oldByKey.set(keyOf(vnode, i), { vnode, dom });
  });

  const seen = new Set<string>();
  next.forEach((child, i) => {
    const key = keyOf(child, i);
    if (seen.has(key)) throw new Error(`patch: duplicate key "${key.slice(2)}" among children of <${parent.localName}>`);
    seen.add(key);

    const match = oldByKey.get(key);
    let dom: Node;
    if (match !== undefined && sameType(match.vnode, child)) {
      oldByKey.delete(key);
      dom = patch(match.dom, match.vnode, child);
    } else {
      dom = renderToDOM(child);
    }

    const current = parent.childNodes[i];
    if (current !== dom) parent.insertBefore(dom, current ?? null);
  });

  for (const { dom } of oldByKey.values()) {
    if (dom.parentNode === parent) parent.removeChild(dom);
  }
}
