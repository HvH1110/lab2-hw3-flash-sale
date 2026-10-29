import { createElement, createTextElement } from '../src/create-element';
import { TEXT_ELEMENT, type Child, type VNodeProps } from '../src/types';

describe('createTextElement', () => {
  it('builds a TEXT_ELEMENT node with no children', () => {
    expect(createTextElement('Hello')).toEqual({
      type: TEXT_ELEMENT,
      props: { nodeValue: 'Hello', children: [] },
    });
  });

  it('coerces numbers to strings', () => {
    expect(createTextElement(0).props.nodeValue).toBe('0');
    expect(createTextElement(4.2).props.nodeValue).toBe('4.2');
  });

  it('keeps markup as raw text (never parsed)', () => {
    expect(createTextElement('<script>alert(1)</script>').props.nodeValue).toBe('<script>alert(1)</script>');
  });

  it('returns a deeply frozen object', () => {
    const node = createTextElement('x');
    expect(Object.isFrozen(node)).toBe(true);
    expect(Object.isFrozen(node.props)).toBe(true);
    expect(Object.isFrozen(node.props.children)).toBe(true);
  });
});

describe('createElement', () => {
  it('maps type, props and children like the JSX transform', () => {
    const vnode = createElement('section', { className: 'container', id: 'intro' }, 'Hello');
    expect(vnode).toEqual({
      type: 'section',
      props: {
        className: 'container',
        id: 'intro',
        children: [{ type: TEXT_ELEMENT, props: { nodeValue: 'Hello', children: [] } }],
      },
    });
  });

  it('falls back to an empty props object when props is null or omitted', () => {
    expect(createElement('main', null).props).toEqual({ children: [] });
    expect(createElement('main').props).toEqual({ children: [] });
  });

  it('flattens nested child arrays in order', () => {
    const items: Child[] = ['a', ['b', ['c', [createElement('li', null, 'd')]]]];
    const { children } = createElement('ul', null, ...items).props;
    expect(children.map((c) => c.type)).toEqual([TEXT_ELEMENT, TEXT_ELEMENT, TEXT_ELEMENT, 'li']);
    expect(children.slice(0, 3).map((c) => c.props['nodeValue'])).toEqual(['a', 'b', 'c']);
  });

  it('drops null, undefined and booleans but keeps 0 and empty string', () => {
    const { children } = createElement('p', null, null, undefined, true, false, 0, '').props;
    expect(children.map((c) => c.props['nodeValue'])).toEqual(['0', '']);
  });

  it('keeps VNode children by reference', () => {
    const child = createElement('h1', null, 'Title');
    expect(createElement('header', null, child).props.children[0]).toBe(child);
  });

  it('accepts function components as type', () => {
    const Badge = (props: VNodeProps) => createElement('strong', null, ...props.children);
    const vnode = createElement(Badge, { role: 'status' }, 'Lead');
    expect(vnode.type).toBe(Badge);
    expect(vnode.props['role']).toBe('status');
  });

  it('ignores a children key passed through props', () => {
    const props = { id: 'x', children: 'sneaky' } as unknown as Record<string, string>;
    expect(createElement('p', props, 'real').props.children.map((c) => c.props['nodeValue'])).toEqual(['real']);
  });

  it('does not mutate the props argument', () => {
    const props = Object.freeze({ id: 'root' });
    createElement('main', props, 'x');
    expect(props).toEqual({ id: 'root' });
  });

  it('returns frozen node, props and children', () => {
    const vnode = createElement('main', { id: 'a' }, 'x');
    expect(Object.isFrozen(vnode)).toBe(true);
    expect(Object.isFrozen(vnode.props)).toBe(true);
    expect(Object.isFrozen(vnode.props.children)).toBe(true);
    expect(() => {
      (vnode.props as unknown as { id: string }).id = 'b';
    }).toThrow(TypeError);
  });

  describe('strict typeguard verification', () => {
    it.each([
      ['plain object', { foo: 1 }],
      ['DOM node', document.createElement('script')],
      ['function', () => 'x'],
      ['symbol', Symbol('x')],
      ['bigint', 10n],
    ])('rejects a %s child', (_label, child) => {
      expect(() => createElement('main', null, child as unknown as Child)).toThrow(TypeError);
    });

    it.each(['', TEXT_ELEMENT, 42, null, {}])('rejects invalid element type %o', (type) => {
      expect(() => createElement(type as unknown as string)).toThrow(TypeError);
    });
  });
});
