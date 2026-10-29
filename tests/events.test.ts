import { createElement } from '../src/create-element';
import { setupEventDelegation, toDelegatedEventType } from '../src/events';
import { mount } from '../src/render-to-dom';
import { DELEGATED_EVENTS } from '../src/types';

const setup = (): HTMLElement => {
  const root = document.createElement('section');
  document.body.replaceChildren(root);
  return root;
};

describe('toDelegatedEventType', () => {
  it('maps camelCase props to event types', () => {
    expect(toDelegatedEventType('onClick')).toBe('click');
    expect(toDelegatedEventType('onKeyDown')).toBe('keydown');
    expect(toDelegatedEventType('onSubmit')).toBe('submit');
  });

  it('rejects non-bubbling or banned event types', () => {
    expect(() => toDelegatedEventType('onFocus')).toThrow(TypeError);
    expect(() => toDelegatedEventType('onKeyPress')).toThrow(TypeError);
  });
});

describe('setupEventDelegation', () => {
  it('attaches exactly one listener per delegated event type, only to the root', () => {
    const root = setup();
    const addListener = vi.spyOn(EventTarget.prototype, 'addEventListener');
    setupEventDelegation(root);
    mount(createElement('main', null, createElement('button', { onClick: () => {} }, 'A')), root);

    expect(addListener.mock.instances.every((target) => target === root)).toBe(true);
    expect(addListener.mock.calls.map(([type]) => type)).toEqual([...DELEGATED_EVENTS]);
    addListener.mockRestore();
  });

  it('is idempotent for the same root', () => {
    const root = setup();
    const addListener = vi.spyOn(root, 'addEventListener');
    const first = setupEventDelegation(root);
    const second = setupEventDelegation(root);
    expect(second).toBe(first);
    expect(addListener).toHaveBeenCalledTimes(DELEGATED_EVENTS.length);
    first();
  });

  it('dispatches a click on a child button to its virtual handler', () => {
    const root = setup();
    const onClick = vi.fn();
    const teardown = setupEventDelegation(root);
    mount(createElement('main', null, createElement('button', { onClick }, 'Ping')), root);

    root.querySelector('button')?.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0]?.[0]).toBeInstanceOf(MouseEvent);
    teardown();
  });

  it('bubbles from the target through every ancestor handler', () => {
    const root = setup();
    const calls: string[] = [];
    const teardown = setupEventDelegation(root);
    mount(
      createElement('main', { onClick: () => calls.push('main') },
        createElement('section', { onClick: () => calls.push('section') },
          createElement('button', { onClick: () => calls.push('button') }, createElement('strong', null, 'Go')))),
      root,
    );

    root.querySelector('strong')?.click();
    expect(calls).toEqual(['button', 'section', 'main']);
    teardown();
  });

  it('starts from the parent element when the target is a text node', () => {
    const root = setup();
    const onClick = vi.fn();
    const teardown = setupEventDelegation(root);
    mount(createElement('button', { onClick }, 'text'), root);

    root.querySelector('button')?.firstChild?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
    teardown();
  });

  it('honours stopPropagation()', () => {
    const root = setup();
    const outer = vi.fn();
    const teardown = setupEventDelegation(root);
    mount(
      createElement('section', { onClick: outer },
        createElement('button', { onClick: (event: Event) => event.stopPropagation() }, 'Stop')),
      root,
    );

    root.querySelector('button')?.click();
    expect(outer).not.toHaveBeenCalled();
    teardown();
  });

  it('routes keydown with e.key, input and submit events', () => {
    const root = setup();
    const keys: string[] = [];
    const onInput = vi.fn();
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    const teardown = setupEventDelegation(root);
    mount(
      createElement('form', { onSubmit },
        createElement('input', {
          onInput,
          onKeyDown: (event: Event) => {
            if (event instanceof KeyboardEvent) keys.push(event.key);
          },
        })),
      root,
    );

    const input = root.querySelector('input');
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input?.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(keys).toEqual(['Enter']);
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    teardown();
  });

  it('does not fire handlers for events outside the root', () => {
    const root = setup();
    const outside = document.createElement('button');
    document.body.append(outside);
    const onClick = vi.fn();
    const teardown = setupEventDelegation(root);
    mount(createElement('button', { onClick }, 'inside'), root);

    outside.click();
    expect(onClick).not.toHaveBeenCalled();
    teardown();
  });

  it('teardown removes the root listeners', () => {
    const root = setup();
    const onClick = vi.fn();
    const teardown = setupEventDelegation(root);
    mount(createElement('button', { onClick }, 'x'), root);
    teardown();

    root.querySelector('button')?.click();
    expect(onClick).not.toHaveBeenCalled();
  });
});
