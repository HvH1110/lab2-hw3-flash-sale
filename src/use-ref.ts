import { useState } from './use-state';

export interface Ref<T> {
  current: T;
}

/**
 * A mutable box that survives re-renders. Writing to `current` never triggers a render,
 * which makes it the place for non-visual bookkeeping (AbortControllers, request counters).
 */
export function useRef<T>(initialValue: T): Ref<T> {
  // The box is stored once in a hook slot and never replaced, so its setter is not needed.
  const [ref] = useState<Ref<T>>({ current: initialValue });
  return ref;
}
