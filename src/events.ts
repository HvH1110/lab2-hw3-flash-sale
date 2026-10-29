import { DELEGATED_EVENTS, isDelegatedEventType, type DelegatedEventType, type EventHandler } from './types';

type HandlerMap = Partial<Record<DelegatedEventType, EventHandler>>;

/** Virtual handlers per rendered element. WeakMap: entries vanish with their DOM nodes. */
const handlerRegistry = new WeakMap<Element, HandlerMap>();

/** Roots that already have the hub attached, mapped to their teardown function. */
const delegatedRoots = new WeakMap<Element, () => void>();

/** `onClick` → `click`. Throws for event types the hub does not delegate. */
export function toDelegatedEventType(propName: string): DelegatedEventType {
  const type = propName.slice(2).toLowerCase();
  if (!isDelegatedEventType(type)) {
    throw new TypeError(`"${propName}" is not a delegated event; supported: ${DELEGATED_EVENTS.join(', ')}`);
  }
  return type;
}

export function registerHandler(element: Element, type: DelegatedEventType, handler: EventHandler): void {
  const handlers = handlerRegistry.get(element) ?? {};
  handlers[type] = handler;
  handlerRegistry.set(element, handlers);
}

export function unregisterHandler(element: Element, type: DelegatedEventType): void {
  const handlers = handlerRegistry.get(element);
  if (handlers !== undefined) delete handlers[type];
}

export function getHandler(element: Element, type: DelegatedEventType): EventHandler | undefined {
  return handlerRegistry.get(element)?.[type];
}

function startElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

/** Virtual bubbling: run handlers from the target up to the root, until stopPropagation(). */
function dispatch(root: Element, type: DelegatedEventType, event: Event): void {
  let element = startElement(event.target);
  while (element !== null) {
    getHandler(element, type)?.(event);
    if (event.cancelBubble || element === root) return;
    element = element.parentElement;
  }
}

/**
 * Attaches exactly one listener per delegated event type to `root`.
 * Idempotent: calling it again for the same root attaches nothing. Returns a teardown function.
 */
export function setupEventDelegation(root: Element): () => void {
  const existing = delegatedRoots.get(root);
  if (existing !== undefined) return existing;

  const listeners = DELEGATED_EVENTS.map((type) => {
    const listener = (event: Event): void => dispatch(root, type, event);
    root.addEventListener(type, listener);
    return { type, listener };
  });

  const teardown = (): void => {
    for (const { type, listener } of listeners) root.removeEventListener(type, listener);
    delegatedRoots.delete(root);
  };
  delegatedRoots.set(root, teardown);
  return teardown;
}
