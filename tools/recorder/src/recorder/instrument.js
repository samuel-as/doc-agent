// src/recorder/instrument.js
import { createSensitivity } from './sensitivity.js';

export const BINDING = '__docAgentEvent';

export function buildInitScript() {
  return `(() => {
    if (window.__docAgentInstalled) return;
    window.__docAgentInstalled = true;

    // Timestamp of the last DOM mutation, read by the recorder to decide when a page has
    // finished rendering (SETTLE_EXPR in recorder.js). The observer lives here, installed
    // with the script at document start, so nothing that happens before the recorder asks
    // is missed.
    window.__docAgentLastMutation = Date.now();
    try {
      new MutationObserver(() => { window.__docAgentLastMutation = Date.now(); })
        .observe(document, { subtree: true, childList: true, attributes: true });
    } catch (e) {}

    // Sensitive-field classifier, inlined from src/recorder/sensitivity.js (pure, self-contained).
    const sensitivityOf = (${createSensitivity.toString()})();

    const send = (payload) => {
      try { window.${BINDING}(JSON.stringify(payload)); } catch (e) {}
    };

    // Shadow DOM: e.target is retargeted to the host; composedPath()[0] is the real element.
    const target = (e) => {
      const p = e.composedPath ? e.composedPath() : null;
      const t = (p && p.length ? p[0] : e.target) || null;
      return t && t.nodeType === 1 ? t : (t && t.parentElement) || null;
    };

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

    const isToggle = (el) => el && el.tagName === 'INPUT' && ['checkbox','radio'].includes((el.type || '').toLowerCase());

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
      // In a contenteditable, innerText IS the content the user typed: commit() masks the
      // value of a sensitive field, and reading it here would ship the same text as label.
      if (el.isContentEditable) return null;
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

    const fieldInfo = (el, value) => ({
      type: el.type, autocomplete: el.getAttribute('autocomplete'), name: el.getAttribute('name'), id: el.id,
      placeholder: el.getAttribute('placeholder'), ariaLabel: el.getAttribute('aria-label'),
      labelText: el.labels && el.labels.length ? el.labels[0].innerText : null, value: value,
    });

    const rectOf = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) return null;
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };

    // Rects of every VISIBLE sensitive field right now — the recorder paints them over.
    // Light DOM only via querySelectorAll; the event target is added so a field inside a
    // shadow root is covered at least when it is the one being used.
    const sensitiveRects = (extra) => {
      const els = Array.prototype.slice.call(document.querySelectorAll('input, textarea'));
      if (extra && (extra.tagName === 'INPUT' || extra.tagName === 'TEXTAREA') && els.indexOf(extra) < 0) els.push(extra);
      const out = [];
      for (const el of els) {
        const reason = sensitivityOf(fieldInfo(el, el.value));
        if (!reason) continue;
        const r = rectOf(el);
        if (r) out.push({ x: r.x, y: r.y, w: r.w, h: r.h, reason: reason });
      }
      return out;
    };
    window.__docAgentSensitiveRects = () => sensitiveRects(null);

    const base = (kind, el) => ({
      kind: kind, ts: Date.now(),
      label: el ? labelFor(el) : null, selector: el ? cssPath(el) : null,
      scrollY: window.scrollY, viewportH: window.innerHeight,
      sensitiveRects: sensitiveRects(el),
      // Drives the URL rule in the recorder. Unlike the rects, this does not depend on
      // visibility: a password field scrolled out of view or hidden behind a step of the
      // form still makes this a login screen.
      hasPasswordField: !!document.querySelector('input[type="password"]'),
    });

    const INTERACTIVE = 'a, button, [role="button"], [role="menuitem"], [role="tab"], [role="link"], input, select, textarea, [contenteditable="true"], [onclick], label, summary';

    // Interactive ancestor: the usual closest(); otherwise up to 5 levels looking for a
    // pointer cursor (SPAs wire clicks on plain divs/spans without a role).
    const interactiveFrom = (el) => {
      if (!el) return null;
      const byClosest = el.closest ? el.closest(INTERACTIVE) : null;
      if (byClosest) return byClosest;
      let node = el, depth = 0;
      while (node && node.nodeType === 1 && depth < 5) {
        if (node === document.body || node === document.documentElement) return null;
        if (getComputedStyle(node).cursor === 'pointer') return node;
        node = node.parentElement; depth++;
      }
      return null;
    };

    // Keyboard events with nothing focused land on document.body, and labelFor(body) is
    // 80 characters of the page text — not a label. Only a real control names a step.
    const focusTarget = (el) => (el && (isEditable(el) || interactiveFrom(el)) ? el : null);

    document.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const el = interactiveFrom(target(e));
      if (!el) return;                       // click on empty space: noise
      if (el.tagName === 'SELECT') return;   // dropdowns are handled on change
      if (isToggle(el)) return;              // checkbox/radio are handled on change
      if (el.tagName === 'LABEL' && isToggle(el.control)) return; // same: the change event carries the step
      const reason = isEditable(el) ? sensitivityOf(fieldInfo(el, '')) : null;
      send({
        ...base('click', el),
        isEditable: isEditable(el),
        isSensitive: !!reason, sensitiveReason: reason,
        coords: { x: e.clientX, y: e.clientY },
      });
    }, true);

    document.addEventListener('focusin', (e) => {
      const t = target(e);
      if (!isEditable(t)) return;
      const reason = sensitivityOf(fieldInfo(t, ''));
      send({ ...base('field-focus', t), isSensitive: !!reason, sensitiveReason: reason });
    }, true);

    const commit = (el) => {
      if (!isEditable(el)) return;
      const raw = el.isContentEditable ? el.innerText : el.value;
      const reason = sensitivityOf(fieldInfo(el, raw));
      // The value of a sensitive field never leaves the page.
      send({ ...base('field-commit', el), isSensitive: !!reason, sensitiveReason: reason, value: reason ? null : raw });
    };

    document.addEventListener('focusout', (e) => commit(target(e)), true);

    document.addEventListener('keydown', (e) => {
      const t = target(e);
      if (e.key === 'Enter') {
        // In a TEXTAREA/contenteditable, Enter inserts a line break — it is not a submit:
        // no partial commit and no 'enter' event.
        if (t && (t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (isEditable(t)) commit(t);
        send({ ...base('enter', focusTarget(t)), selector: null });
        return;
      }
      if (!(e.ctrlKey || e.altKey || e.metaKey)) return;
      if (['Control','Alt','Meta','Shift'].includes(e.key)) return; // modifier alone
      const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (e.ctrlKey && ['C','V','A','Z'].includes(k)) return;      // copy/paste/select-all/undo are noise
      if (!/^[A-Z0-9]$/.test(k) && !/^F([1-9]|1[0-2])$/.test(k)) return;
      const combo = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Cmd']
        .filter(Boolean).concat(k).join('+');
      send({ ...base('shortcut', focusTarget(t)), value: combo });
    }, true);

    document.addEventListener('change', (e) => {
      const t = target(e);
      if (!t) return;
      if (t.tagName === 'SELECT') {
        const opt = t.selectedOptions && t.selectedOptions[0];
        send({ ...base('select', t), value: opt ? opt.innerText.trim() : String(t.value) });
        return;
      }
      if (isToggle(t)) {
        const r = t.getBoundingClientRect();
        send({ ...base('check', t), value: t.checked ? 'on' : 'off', coords: { x: r.left + r.width / 2, y: r.top + r.height / 2 } });
      }
    }, true);

    // Drag & drop: 'drag-start' carries the screenshot/coords (the screen before the move);
    // 'drag' (on drop) carries the destination label. The consolidation merges the two.
    let dragging = null;
    document.addEventListener('dragstart', (e) => {
      const el = target(e);
      if (!el) return;
      dragging = { label: labelFor(el), selector: cssPath(el) };
      send({ ...base('drag-start', el), coords: { x: e.clientX, y: e.clientY } });
    }, true);
    document.addEventListener('drop', (e) => {
      if (!dragging) return;
      const dest = interactiveFrom(target(e)) || target(e);
      send({ ...base('drag', null), label: dragging.label, selector: dragging.selector, target: dest ? labelFor(dest) : null });
      dragging = null;
    }, true);
    document.addEventListener('dragend', () => { dragging = null; }, true);
  })();`;
}
