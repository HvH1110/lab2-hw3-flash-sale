import {
  TEXT_ELEMENT,
  isEmptyChild,
  isTextChild,
  isVNode,
  type Child,
  type ComponentVNode,
  type ElementVNode,
  type FunctionComponent,
  type Props,
  type TextVNode,
  type VNode,
  type VNodeProps,
} from './types';

const NO_CHILDREN = Object.freeze([] as []);

/** Wraps a primitive in a TEXT_ELEMENT VNode so every leaf has the same shape. */
export function createTextElement(text: string | number): TextVNode {
  const node: TextVNode = {
    type: TEXT_ELEMENT,
    props: Object.freeze({ nodeValue: String(text), children: NO_CHILDREN }),
  };
  return Object.freeze(node);
}

function describe(value: unknown): string {
  if (typeof value === 'object' && value !== null) return value.constructor?.name ?? 'Object';
  return typeof value;
}

/** Flattens nested child arrays, drops empty children and wraps primitives. */
function normalizeChildren(children: readonly unknown[], out: VNode[] = []): VNode[] {
  for (const child of children) {
    if (Array.isArray(child)) {
      normalizeChildren(child, out);
    } else if (isEmptyChild(child)) {
      continue;
    } else if (isTextChild(child)) {
      out.push(createTextElement(child));
    } else if (isVNode(child)) {
      out.push(child);
    } else {
      throw new TypeError(`createElement: invalid child of type ${describe(child)}`);
    }
  }
  return out;
}

export function createElement(type: string, props?: Props | null, ...children: Child[]): ElementVNode;
export function createElement(type: FunctionComponent, props?: Props | null, ...children: Child[]): ComponentVNode;
export function createElement(
  type: string | FunctionComponent,
  props?: Props | null,
  ...children: Child[]
): VNode {
  if (typeof type === 'string') {
    if (type === '' || type === TEXT_ELEMENT) {
      throw new TypeError(`createElement: invalid element type "${type}"`);
    }
  } else if (typeof type !== 'function') {
    throw new TypeError(`createElement: invalid element type ${describe(type)}`);
  }

  // Variadic children are authoritative; a `children` key in props is ignored.
  const { children: _ignored, ...attributes } = props ?? {};
  const nodeProps: VNodeProps = Object.freeze({
    ...attributes,
    children: Object.freeze(normalizeChildren(children)),
  });

  return Object.freeze({ type, props: nodeProps } as VNode);
}
