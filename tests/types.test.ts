import {
  TEXT_ELEMENT,
  assertNever,
  isComponentVNode,
  isDelegatedEventType,
  isElementVNode,
  isEmptyChild,
  isEventProp,
  isTextChild,
  isTextVNode,
  isVNode,
  type VNode,
} from '../src/types';

const text: VNode = { type: TEXT_ELEMENT, props: { nodeValue: 'hi', children: [] } };
const element: VNode = { type: 'section', props: { children: [text] } };
const component: VNode = { type: () => element, props: { children: [] } };

describe('isVNode', () => {
  it('accepts well-formed VNodes', () => {
    expect(isVNode(text)).toBe(true);
    expect(isVNode(element)).toBe(true);
    expect(isVNode(component)).toBe(true);
  });

  it.each([null, undefined, 'main', 42, [], {}, { type: 'main' }, { type: 1, props: { children: [] } },
    { type: 'main', props: null }, { type: 'main', props: { children: 'x' } }])('rejects %o', (value) => {
    expect(isVNode(value)).toBe(false);
  });

  it('rejects real DOM nodes', () => {
    expect(isVNode(document.createElement('main'))).toBe(false);
  });
});

describe('VNode kind guards', () => {
  it('discriminates text, element and component nodes', () => {
    expect([isTextVNode(text), isElementVNode(text), isComponentVNode(text)]).toEqual([true, false, false]);
    expect([isTextVNode(element), isElementVNode(element), isComponentVNode(element)]).toEqual([false, true, false]);
    expect([isTextVNode(component), isElementVNode(component), isComponentVNode(component)]).toEqual([false, false, true]);
  });
});

describe('child guards', () => {
  it('classifies empty children', () => {
    expect([null, undefined, true, false].every(isEmptyChild)).toBe(true);
    expect([0, '', 'a'].some(isEmptyChild)).toBe(false);
  });

  it('classifies text children', () => {
    expect([0, 1.5, '', 'a'].every(isTextChild)).toBe(true);
    expect([null, true, {}, []].some(isTextChild)).toBe(false);
  });
});

describe('isEventProp', () => {
  it('requires on + Capital letter and a function value', () => {
    expect(isEventProp('onClick', () => {})).toBe(true);
    expect(isEventProp('onKeyDown', () => {})).toBe(true);
    expect(isEventProp('onClick', 'alert(1)')).toBe(false);
    expect(isEventProp('onclick', () => {})).toBe(false);
    expect(isEventProp('one', () => {})).toBe(false);
  });
});

describe('isDelegatedEventType', () => {
  it('accepts only the bubbling events handled by the root hub', () => {
    expect(['click', 'input', 'change', 'keydown', 'submit'].every(isDelegatedEventType)).toBe(true);
    expect(['focus', 'mouseenter', 'keypress', 'Click', ''].some(isDelegatedEventType)).toBe(false);
  });
});

describe('assertNever', () => {
  it('assertNever throws for unhandled values', () => {
    expect(() => assertNever('BOGUS' as never)).toThrow(/Unhandled case/);
  });
});
