// src/recorder/consolidate.js
const CLICK_DEDUP_MS = 500;
const NAV_DEDUP_MS = 1000;

export function consolidate(events) {
  const steps = [];
  const focusBySelector = new Map(); // último foco (click editável ou field-focus) por seletor
  let lastClick = null;
  let lastNav = null;

  for (const ev of events) {
    switch (ev.kind) {
      case 'field-focus':
        focusBySelector.set(ev.selector, ev);
        break;

      case 'click': {
        if (ev.isEditable) {
          // clique em campo de texto é absorvido pelo passo fill; guarda print/coords
          focusBySelector.set(ev.selector, ev);
          break;
        }
        if (lastClick && lastClick.selector === ev.selector && ev.ts - lastClick.ts < CLICK_DEDUP_MS) break;
        lastClick = ev;
        steps.push(makeStep('click', ev, { screenshot: ev.screenshot, coords: ev.coords }));
        break;
      }

      case 'field-commit': {
        if (!ev.isPassword && (ev.value == null || ev.value === '')) break;
        const focus = focusBySelector.get(ev.selector) ?? null;
        steps.push(makeStep('fill', ev, {
          value: ev.isPassword ? null : ev.value,
          screenshot: focus?.screenshot ?? ev.screenshot ?? null,
          coords: focus?.coords ?? null,
        }));
        focusBySelector.delete(ev.selector);
        break;
      }

      case 'select':
        steps.push(makeStep('select', ev, { value: ev.value, screenshot: ev.screenshot }));
        break;

      case 'enter':
        steps.push(makeStep('enter', ev, { screenshot: null }));
        break;

      case 'navigation': {
        if (lastNav && lastNav.url === ev.url && ev.ts - lastNav.ts < NAV_DEDUP_MS) break;
        lastNav = ev;
        steps.push(makeStep('navigation', ev, { screenshot: ev.screenshot }));
        break;
      }
    }
  }
  return steps.map((s, i) => ({ ...s, index: i + 1 }));
}

function makeStep(type, ev, extra) {
  return {
    type,
    label: ev.label ?? null,
    selector: ev.selector ?? null,
    value: null,
    url: ev.url,
    title: ev.title ?? null,
    ts: ev.ts,
    isPassword: ev.isPassword ?? false,
    coords: null,
    screenshot: null,
    ...extra,
  };
}
