import { createElement, createTextElement } from '../src/create-element';
import { getHandler } from '../src/events';
import { mount, renderToDOM } from '../src/render-to-dom';
import type { Props, VNode, VNodeProps } from '../src/types';

const asElement = (node: Node): HTMLElement => {
  if (!(node instanceof HTMLElement)) throw new Error('expected an HTMLElement');
  return node;
};

describe('renderToDOM', () => {
  it('creates text nodes for TEXT_ELEMENT', () => {
    const node = renderToDOM(createTextElement('Hello'));
    expect(node.nodeType).toBe(Node.TEXT_NODE);
    expect(node.textContent).toBe('Hello');
  });

  it('creates semantic elements with nested children in order', () => {
    const vnode = createElement('main', null,
      createElement('header', null, createElement('h1', null, 'Title')),
      createElement('section', null, 'Body'),
    );
    const dom = asElement(renderToDOM(vnode));
    expect(dom.tagName).toBe('MAIN');
    expect([...dom.children].map((c) => c.tagName)).toEqual(['HEADER', 'SECTION']);
    expect(dom.querySelector('h1')?.textContent).toBe('Title');
    expect(dom.textContent).toBe('TitleBody');
  });

  it('maps className/htmlFor and serialises attribute values', () => {
    const dom = asElement(renderToDOM(createElement('label', {
      className: 'hero', htmlFor: 'name', id: 'lbl', tabIndex: 0, 'aria-label': 'Name', 'data-x': 1.5,
    })));
    expect(dom.getAttribute('class')).toBe('hero');
    expect(dom.getAttribute('for')).toBe('name');
    expect(dom.id).toBe('lbl');
    expect(dom.getAttribute('tabIndex')).toBe('0');
    expect(dom.getAttribute('aria-label')).toBe('Name');
    expect(dom.dataset['x']).toBe('1.5');
  });

  it('handles boolean and empty attributes', () => {
    const dom = asElement(renderToDOM(createElement('button', {
      disabled: true, hidden: false, title: null, lang: undefined,
    })));
    expect(dom.hasAttribute('disabled')).toBe(true);
    expect(dom.hasAttribute('hidden')).toBe(false);
    expect(dom.hasAttribute('title')).toBe(false);
    expect(dom.hasAttribute('lang')).toBe(false);
  });

  it('registers handlers for delegation without attaching listeners or inline attributes', () => {
    const onClick = vi.fn();
    const onKeyDown = vi.fn();
    const addListener = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const dom = asElement(renderToDOM(createElement('button', { onClick, onKeyDown }, 'Click')));
    expect(addListener).not.toHaveBeenCalled();
    addListener.mockRestore();

    expect(getHandler(dom, 'click')).toBe(onClick);
    expect(getHandler(dom, 'keydown')).toBe(onKeyDown);
    expect(dom.getAttributeNames()).toEqual([]);

    dom.click(); // no root hub attached: nothing fires
    expect(onClick).not.toHaveBeenCalled();
  });

  it.each(['onMouseEnter', 'onFocus', 'onKeyPress'])('rejects non-delegated event prop %s', (name) => {
    expect(() => renderToDOM(createElement('button', { [name]: () => {} }))).toThrow(/not a delegated event/);
  });

  it('renders function components', () => {
    const Card = (props: VNodeProps): VNode =>
      createElement('article', { className: 'card' }, createElement('h3', null, String(props['title'])), ...props.children);
    const dom = asElement(renderToDOM(createElement(Card, { title: 'Profile' }, createElement('p', null, 'Body'))));
    expect(dom.tagName).toBe('ARTICLE');
    expect([...dom.children].map((c) => c.tagName)).toEqual(['H3', 'P']);
  });

  it('rejects a component that does not return a VNode', () => {
    const Broken = (() => '<b>oops</b>') as unknown as () => VNode;
    expect(() => renderToDOM(createElement(Broken))).toThrow(TypeError);
  });

  describe('XSS resistance', () => {
    it('renders <script>alert(1)</script> as inert text', () => {
      const payload = '<script>alert(1)</script>';
      const container = document.createElement('section');
      mount(createElement('p', null, payload), container);

      expect(container.querySelector('script')).toBeNull();
      expect(container.querySelector('p')?.childNodes).toHaveLength(1);
      expect(container.querySelector('p')?.firstChild?.nodeType).toBe(Node.TEXT_NODE);
      expect(container.textContent).toBe(payload);
    });

    it('does not create elements from <img onerror> payloads', () => {
      const container = document.createElement('section');
      mount(createElement('p', null, '<img src=x onerror=alert(1)> Safe Text'), container);
      expect(container.querySelector('img')).toBeNull();
      expect(container.textContent).toBe('<img src=x onerror=alert(1)> Safe Text');
    });

    it('keeps attribute payloads inside the attribute value', () => {
      const dom = asElement(renderToDOM(createElement('p', { title: '"><script>alert(1)</script>' })));
      expect(dom.children).toHaveLength(0);
      expect(dom.getAttribute('title')).toBe('"><script>alert(1)</script>');
    });

    it.each(['innerHTML', 'outerHTML', 'dangerouslySetInnerHTML'])('forbids the %s prop', (name) => {
      expect(() => renderToDOM(createElement('p', { [name]: '<img src=x onerror=alert(1)>' }))).toThrow(TypeError);
    });

    it.each(['onclick', 'onClick', 'onerror'])('rejects string handler %s', (name) => {
      const props: Props = { [name]: 'alert(1)' };
      expect(() => renderToDOM(createElement('button', props))).toThrow(TypeError);
    });
  });
});

describe('mount', () => {
  it('replaces existing container content with the rendered tree', () => {
    const container = document.createElement('section');
    container.append(document.createElement('p'), 'stale text');
    const dom = mount(createElement('main', { id: 'root-view' }, 'fresh'), container);
    expect(container.childNodes).toHaveLength(1);
    expect(container.firstChild).toBe(dom);
    expect(container.textContent).toBe('fresh');
  });
});
