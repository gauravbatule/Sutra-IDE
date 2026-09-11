/**
 * Element Inspector Injection Script
 * Injected into the preview iframe to enable visual element selection.
 * Highlights elements on hover and captures click targets for targeted editing.
 */
(function() {
  'use strict';

  let inspectorActive = false;
  let highlightOverlay = null;
  let currentTarget = null;

  function createOverlay() {
    const overlay = document.createElement('div');
    overlay.id = '__sutra-element-inspector-overlay';
    overlay.style.cssText = `
      position: fixed;
      pointer-events: none;
      border: 2px solid #3b82f6;
      background: rgba(59, 130, 246, 0.08);
      z-index: 2147483647;
      transition: all 0.1s ease;
      display: none;
      border-radius: 3px;
    `;

    // Label
    const label = document.createElement('div');
    label.id = '__sutra-element-label';
    label.style.cssText = `
      position: absolute;
      top: -24px;
      left: -1px;
      background: #3b82f6;
      color: white;
      font-size: 11px;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      padding: 2px 6px;
      border-radius: 3px 3px 0 0;
      white-space: nowrap;
      pointer-events: none;
      line-height: 1.4;
    `;
    overlay.appendChild(label);

    document.body.appendChild(overlay);
    return overlay;
  }

  function getElementSelector(el) {
    if (el.id) return `#${el.id}`;
    const parts = [];
    let current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector = `#${current.id}`;
        parts.unshift(selector);
        break;
      }
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).slice(0, 2).join('.');
        if (classes) selector += '.' + classes;
      }
      // Add nth-child if needed for disambiguation
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          selector += `:nth-child(${idx})`;
        }
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function getCompactOuterHTML(el, maxLen) {
    maxLen = maxLen || 2000;
    const html = el.outerHTML;
    if (html.length <= maxLen) return html;
    // Truncate inner content but keep opening/closing tags
    const tagName = el.tagName.toLowerCase();
    const openTag = html.substring(0, html.indexOf('>') + 1);
    return openTag + '\n  <!-- ... truncated ' + el.children.length + ' children ... -->\n</' + tagName + '>';
  }

  function highlightElement(el) {
    if (!highlightOverlay) highlightOverlay = createOverlay();
    const rect = el.getBoundingClientRect();
    highlightOverlay.style.display = 'block';
    highlightOverlay.style.top = rect.top + 'px';
    highlightOverlay.style.left = rect.left + 'px';
    highlightOverlay.style.width = rect.width + 'px';
    highlightOverlay.style.height = rect.height + 'px';

    const label = highlightOverlay.querySelector('#__sutra-element-label');
    if (label) {
      const tag = el.tagName.toLowerCase();
      const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      const id = el.id ? '#' + el.id : '';
      label.textContent = tag + id + cls + ' (' + Math.round(rect.width) + '×' + Math.round(rect.height) + ')';
    }
  }

  function hideOverlay() {
    if (highlightOverlay) {
      highlightOverlay.style.display = 'none';
    }
  }

  function onMouseMove(e) {
    if (!inspectorActive) return;
    const el = e.target;
    if (el === highlightOverlay || el.id === '__sutra-element-label' || el.id === '__sutra-element-inspector-overlay') return;
    currentTarget = el;
    highlightElement(el);
  }

  function onClick(e) {
    if (!inspectorActive) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const el = currentTarget || e.target;
    if (!el || el === highlightOverlay) return;

    const rect = el.getBoundingClientRect();

    // Extract attributes
    const attributes = {};
    if (el.attributes) {
      for (let i = 0; i < el.attributes.length; i++) {
        const attr = el.attributes[i];
        attributes[attr.name] = attr.value;
      }
    }

    // Extract classList
    const classList = [];
    if (el.classList) {
      for (let i = 0; i < el.classList.length; i++) {
        classList.push(el.classList[i]);
      }
    }

    // Extract DOM hierarchy
    const hierarchy = [];
    let curr = el;
    while (curr && curr !== document.body && curr !== document.documentElement && hierarchy.length < 5) {
      let item = curr.tagName.toLowerCase();
      if (curr.id) item += '#' + curr.id;
      if (curr.className && typeof curr.className === 'string') {
        const cls = curr.className.trim().split(/\s+/).slice(0, 2).join('.');
        if (cls) item += '.' + cls;
      }
      hierarchy.unshift(item);
      curr = curr.parentElement;
    }

    // Extract enclosing semantic container
    let enclosing = el.parentElement;
    let containerSummary = null;
    while (enclosing && enclosing !== document.body && enclosing !== document.documentElement) {
      if (enclosing.id || enclosing.className || /^(article|section|form|nav|header|footer|main|aside|dialog|details)$/i.test(enclosing.tagName)) {
        containerSummary = {
          tag: enclosing.tagName.toLowerCase(),
          id: enclosing.id || '',
          className: typeof enclosing.className === 'string' ? enclosing.className : '',
          textPreview: (enclosing.textContent || '').trim().substring(0, 100),
        };
        break;
      }
      enclosing = enclosing.parentElement;
    }

    const data = {
      type: 'sutra-element-selected',
      selector: getElementSelector(el),
      tagName: el.tagName.toLowerCase(),
      outerHTML: getCompactOuterHTML(el, 3000),
      textContent: (el.textContent || '').trim().substring(0, 500),
      classList,
      attributes,
      hierarchy,
      enclosingContainer: containerSummary,
      pageUrl: window.location.pathname + window.location.search,
      pageTitle: document.title,
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      computedStyles: {
        backgroundColor: getComputedStyle(el).backgroundColor,
        color: getComputedStyle(el).color,
        fontSize: getComputedStyle(el).fontSize,
        fontFamily: getComputedStyle(el).fontFamily,
        padding: getComputedStyle(el).padding,
        margin: getComputedStyle(el).margin,
        borderRadius: getComputedStyle(el).borderRadius,
        display: getComputedStyle(el).display,
      },
      childCount: el.children.length,
    };

    window.parent.postMessage(data, '*');
  }

  // Listen for activation messages from parent
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'sutra-inspector-activate') {
      inspectorActive = true;
      document.body.style.cursor = 'crosshair';
      document.addEventListener('mousemove', onMouseMove, true);
      document.addEventListener('click', onClick, true);
    } else if (e.data && e.data.type === 'sutra-inspector-deactivate') {
      inspectorActive = false;
      document.body.style.cursor = '';
      hideOverlay();
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('click', onClick, true);
    }
  });
})();
