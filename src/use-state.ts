import {
  claimHookSlot,
  currentGeneration,
  hasSlot,
  isRendering,
  readSlot,
  triggerRender,
  writeSlot,
} from './state-store';
import type { SetStateAction, StateHook, StateSetter } from './types';

const isUpdater = <T>(action: SetStateAction<T>): action is (previous: T) => T => typeof action === 'function';

export function useState<T>(initialValue: T): StateHook<T> {
  // The setter closes over this slot, so it keeps writing to the right state on later renders.
  const slot = claimHookSlot();

  // Only initialise an empty slot: `states[slot] ?? initialValue` would wrongly reset a stored null/undefined.
  if (!hasSlot(slot)) writeSlot(slot, initialValue);

  const generation = currentGeneration();
  const setState: StateSetter<T> = (action) => {
    // The store was reset (app unmounted) since this setter was created, e.g. a late network response.
    if (generation !== currentGeneration()) return;
    if (isRendering()) {
      throw new Error('Cannot update state while rendering; move the update into an event handler.');
    }
    const previous = readSlot<T>(slot);
    const next = isUpdater(action) ? action(previous) : action;
    if (Object.is(previous, next)) return;
    writeSlot(slot, next);
    triggerRender();
  };

  return [readSlot<T>(slot), setState];
}
