import { registerHandler, toDelegatedEventType, unregisterHandler } from './events';
import {
  isComponentVNode,
  isEventProp,
  isTextVNode,
  isVNode,
  type VNode,
  type VNodeProps,
} from './types';

/** Props that are engine metadata, not DOM attributes. */
const RESERVED_PROPS = new Set(['children', 'key']);

/** Props that would bypass text-node escaping — never allowed. */
const FORBIDDEN_PROPS = new Set(['innerHTML', 'outerHTML', 'dangerouslySetInnerHTML']);

/** JSX-style prop names that differ from their HTML attribute names. */
const ATTRIBUTE_ALIASES: Readonly<Record<string, string>> = { className: 'class', htmlFor: 'for' };

/**
 * Props whose *live* DOM property can drift from the attribute once the user interacts
 * (typing, ticking, choosing). They are written as properties after children exist.
 */
const LIVE_PROPS = new Set(['value', 'checked', 'selected']);

type PropEntry = VNodeProps[string];

function setProp(element: HTMLElement, name: string, value: PropEntry): void {
  if (FORBIDDEN_PROPS.has(name)) {
    throw new TypeError(`renderToDOM: "${name}" is forbidden (XSS); pass text as children instead`);
  }

  if (isEventProp(name, value)) {
    // No listener on the element itself: the root delegation hub dispatches to this handler.
    registerHandler(element, toDelegatedEventType(name), value);
    return;
  }

  if (/^on/i.test(name)) {
    // Blocks inline handlers such as { onclick: 'alert(1)' }.
    throw new TypeError(`renderToDOM: event prop "${name}" must be a camelCase function, e.g. onClick`);
  }

  if (typeof value === 'function' || Array.isArray(value)) {
    throw new TypeError(`renderToDOM: unsupported value for prop "${name}"`);
  }

  const attribute = ATTRIBUTE_ALIASES[name] ?? name;
  if (value === null || value === undefined || value === false) {
    element.removeAttribute(attribute);
  } else {
    element.setAttribute(attribute, value === true ? '' : String(value));
  }
}

function removeProp(element: HTMLElement, name: string, previous: PropEntry): void {
  if (isEventProp(name, previous)) {
    unregisterHandler(element, toDelegatedEventType(name));
    return;
  }
  element.removeAttribute(ATTRIBUTE_ALIASES[name] ?? name);
}

/** Applies `next` props to `element`, removing those that disappeared since `previous`. */
export function patchProps(element: HTMLElement, previous: VNodeProps | null, next: VNodeProps): void {
  if (previous !== null) {
    for (const [name, value] of Object.entries(previous)) {
      if (!RESERVED_PROPS.has(name) && !(name in next)) removeProp(element, name, value);
    }
  }
  for (const [name, value] of Object.entries(next)) {
    if (RESERVED_PROPS.has(name)) continue;
    if (previous === null || previous[name] !== value) setProp(element, name, value);
  }
}

/** Forces live properties to match the VNode (controlled inputs). Call after children exist. */
export function syncLiveProps(element: HTMLElement, props: VNodeProps): void {
  for (const name of LIVE_PROPS) {
    if (!(name in props)) continue;
    const value = props[name];
    if (name === 'checked' && element instanceof HTMLInputElement) element.checked = value === true;
    if (name === 'selected' && element instanceof HTMLOptionElement) element.selected = value === true;
    if (
      name === 'value' &&
      (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)
    ) {
      const text = value === null || value === undefined || value === false ? '' : String(value);
      if (element.value !== text) element.value = text; // keeps the caret when unchanged
    }
  }
}

/** Recursively converts a VNode tree into real DOM nodes (not yet attached). */
export function renderToDOM(vnode: VNode): Node {
  if (isTextVNode(vnode)) {
    // createTextNode never parses markup: '<script>' stays literal text.
    return document.createTextNode(vnode.props.nodeValue);
  }

  if (isComponentVNode(vnode)) {
    const rendered: unknown = vnode.type(vnode.props);
    if (!isVNode(rendered)) {
      throw new TypeError(`renderToDOM: component ${vnode.type.name || 'anonymous'} did not return a VNode`);
    }
    return renderToDOM(rendered);
  }

  const element = document.createElement(vnode.type);
  patchProps(element, null, vnode.props);
  for (const child of vnode.props.children) {
    element.appendChild(renderToDOM(child));
  }
  syncLiveProps(element, vnode.props);
  return element;
}

/** Renders `vnode` and replaces everything inside `container` with it. */
export function mount(vnode: VNode, container: Element): Node {
  const dom = renderToDOM(vnode);
  container.replaceChildren(dom);
  return dom;
}
