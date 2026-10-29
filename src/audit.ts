import { isComponentVNode, isTextVNode, isVNode, type VNode } from './types';

export interface AuditIssue {
  readonly path: string;
  readonly message: string;
}

export interface AuditReport {
  readonly ok: boolean;
  readonly vnodeCount: number;
  readonly domNodeCount: number;
  readonly issues: readonly AuditIssue[];
}

export interface AuditOptions {
  /** Tags treated as div-soup. Defaults to div and span. */
  readonly bannedTags?: readonly string[];
}

interface AuditContext {
  vnodeCount: number;
  readonly issues: AuditIssue[];
  readonly bannedTags: ReadonlySet<string>;
}

function countDomNodes(node: Node): number {
  let count = 1;
  for (const child of node.childNodes) count += countDomNodes(child);
  return count;
}

function walk(vnode: VNode, dom: Node, path: string, ctx: AuditContext): void {
  if (isComponentVNode(vnode)) {
    const rendered: unknown = vnode.type(vnode.props);
    if (!isVNode(rendered)) {
      ctx.issues.push({ path, message: 'component did not return a VNode' });
      return;
    }
    walk(rendered, dom, path, ctx);
    return;
  }

  ctx.vnodeCount++;

  if (isTextVNode(vnode)) {
    if (!(dom instanceof Text)) {
      ctx.issues.push({ path, message: `expected text node, found <${dom.nodeName.toLowerCase()}>` });
    } else if (dom.data !== vnode.props.nodeValue) {
      ctx.issues.push({ path, message: `text mismatch: "${dom.data}" !== "${vnode.props.nodeValue}"` });
    }
    return;
  }

  if (!(dom instanceof Element) || dom.localName !== vnode.type) {
    ctx.issues.push({ path, message: `expected <${vnode.type}>, found ${dom.nodeName.toLowerCase()}` });
    return;
  }

  if (ctx.bannedTags.has(vnode.type)) {
    ctx.issues.push({ path, message: `div-soup: <${vnode.type}> is banned, use a semantic tag` });
  }

  const vChildren = vnode.props.children;
  const domChildren = dom.childNodes;
  if (vChildren.length !== domChildren.length) {
    ctx.issues.push({
      path,
      message: `child count mismatch: ${vChildren.length} VNode(s) vs ${domChildren.length} DOM node(s) (orphan or missing nodes)`,
    });
  }

  const shared = Math.min(vChildren.length, domChildren.length);
  for (let i = 0; i < shared; i++) {
    const vChild = vChildren[i];
    const domChild = domChildren[i];
    if (vChild === undefined || domChild === undefined) continue;
    const label = isTextVNode(vChild) ? '#text' : isComponentVNode(vChild) ? vChild.type.name || 'Component' : vChild.type;
    walk(vChild, domChild, `${path} > ${label}[${i}]`, ctx);
  }
}

/** Verifies that `dom` is an exact 1:1 mirror of `vnode` (tags, text, child counts). */
export function auditTree(vnode: VNode, dom: Node, options: AuditOptions = {}): AuditReport {
  const ctx: AuditContext = {
    vnodeCount: 0,
    issues: [],
    bannedTags: new Set(options.bannedTags ?? ['div', 'span']),
  };
  const rootLabel = isTextVNode(vnode) ? '#text' : isComponentVNode(vnode) ? vnode.type.name || 'Component' : vnode.type;
  walk(vnode, dom, rootLabel, ctx);

  const domNodeCount = countDomNodes(dom);
  if (ctx.issues.length === 0 && domNodeCount !== ctx.vnodeCount) {
    ctx.issues.push({ path: rootLabel, message: `node count mismatch: ${ctx.vnodeCount} VNodes vs ${domNodeCount} DOM nodes` });
  }

  return { ok: ctx.issues.length === 0, vnodeCount: ctx.vnodeCount, domNodeCount, issues: ctx.issues };
}

/** Audits a mount container: it must hold exactly one root node that mirrors `vnode`. */
export function auditMount(vnode: VNode, container: Element, options: AuditOptions = {}): AuditReport {
  const root = container.firstChild;
  if (container.childNodes.length !== 1 || root === null) {
    return {
      ok: false,
      vnodeCount: 0,
      domNodeCount: container.childNodes.length,
      issues: [{ path: 'container', message: `expected exactly 1 root node, found ${container.childNodes.length}` }],
    };
  }
  return auditTree(vnode, root, options);
}
