// src/recorder/instrument.js
export const BINDING = '__docAgentEvent';

export function buildInitScript() {
  return `(() => {
    if (window.__docAgentInstalled) return;
    window.__docAgentInstalled = true;

    const send = (payload) => {
      try { window.${BINDING}(JSON.stringify(payload)); } catch (e) {}
    };

    const pageHasPassword = () => !!document.querySelector('input[type="password"]');

    const isEditable = (el) => {
      if (!el || !el.tagName) return false;
      if (el.isContentEditable) return true;
      if (el.tagName === 'TEXTAREA') return true;
      if (el.tagName === 'INPUT') {
        const t = (el.type || 'text').toLowerCase();
        return !['button','submit','checkbox','radio','reset','file','image','range','color'].includes(t);
      }
      return false;
    };

    const labelFor = (el) => {
      if (!el || !el.getAttribute) return null;
      if (el.labels && el.labels.length) {
        const t = el.labels[0].innerText.trim();
        if (t) return t.slice(0, 80);
      }
      for (const attr of ['aria-label', 'placeholder', 'title', 'name']) {
        const v = el.getAttribute(attr);
        if (v && v.trim()) return v.trim().slice(0, 80);
      }
      // el.value only works as a label on button-like inputs (<input type="submit" value="...">);
      // never on editable fields — otherwise the typed value (a password, even) becomes the label.
      const isButtonLike = el.tagName === 'INPUT' &&
        ['button','submit','reset'].includes((el.type || '').toLowerCase());
      const text = (el.innerText || (isButtonLike ? el.value : '') || '').trim();
      return text ? text.slice(0, 80) : null;
    };

    const cssPath = (el) => {
      if (el.id) return '#' + CSS.escape(el.id);
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && parts.length < 4) {
        if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
        let part = node.tagName.toLowerCase();
        const parent = node.parentElement;
        if (parent) {
          const idx = Array.prototype.indexOf.call(parent.children, node);
          part += ':nth-child(' + (idx + 1) + ')';
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(' > ');
    };

    const INTERACTIVE = 'a, button, [role="button"], [role="menuitem"], [role="tab"], [role="link"], input, select, textarea, [contenteditable="true"], [onclick], label, summary';

    document.addEventListener('mousedown', (e) => {
      const el = e.target && e.target.closest ? e.target.closest(INTERACTIVE) : null;
      if (!el) return;                       // click on empty space: noise
      if (el.tagName === 'SELECT') return;   // dropdowns are handled on change
      send({
        kind: 'click', ts: Date.now(),
        label: labelFor(el), selector: cssPath(el),
        isEditable: isEditable(el),
        isPassword: el.type === 'password',
        coords: { x: e.clientX, y: e.clientY },
        pageHasPassword: pageHasPassword(),
      });
    }, true);

    document.addEventListener('focusin', (e) => {
      if (!isEditable(e.target)) return;
      send({
        kind: 'field-focus', ts: Date.now(),
        label: labelFor(e.target), selector: cssPath(e.target),
        isPassword: e.target.type === 'password',
        pageHasPassword: pageHasPassword(),
      });
    }, true);

    const commit = (el) => {
      if (!isEditable(el)) return;
      const isPw = el.type === 'password';
      send({
        kind: 'field-commit', ts: Date.now(),
        label: labelFor(el), selector: cssPath(el),
        isPassword: isPw,
        value: isPw ? null : (el.isContentEditable ? el.innerText : el.value),
        pageHasPassword: pageHasPassword(),
      });
    };

    document.addEventListener('focusout', (e) => commit(e.target), true);

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const t = e.target;
      // In a TEXTAREA/contenteditable, Enter inserts a line break — it is not a submit:
      // no partial commit and no 'enter' event.
      if (t && (t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (isEditable(t)) commit(t);
      send({
        kind: 'enter', ts: Date.now(),
        label: labelFor(t), selector: null,
        pageHasPassword: pageHasPassword(),
      });
    }, true);

    document.addEventListener('change', (e) => {
      if (!e.target || e.target.tagName !== 'SELECT') return;
      const opt = e.target.selectedOptions && e.target.selectedOptions[0];
      send({
        kind: 'select', ts: Date.now(),
        label: labelFor(e.target), selector: cssPath(e.target),
        value: opt ? opt.innerText.trim() : String(e.target.value),
        pageHasPassword: pageHasPassword(),
      });
    }, true);
  })();`;
}
