// src/recorder/consolidate.js
const CLICK_DEDUP_MS = 500;
const NAV_DEDUP_MS = 1000;

export function consolidate(events) {
  const steps = [];
  const focusBySelector = new Map(); // last focus (editable click or field-focus) per selector
  const lastCommitBySelector = new Map(); // last committed value per selector (dedups Enter+focusout)
  let lastClick = null;
  let lastNav = null;

  for (const ev of events) {
    switch (ev.kind) {
      case 'field-focus':
        focusBySelector.set(ev.selector, ev);
        lastCommitBySelector.delete(ev.selector); // new focus: a real re-edit may legitimately repeat the value
        break;

      case 'click': {
        if (ev.isEditable) {
          // a click on a text field is absorbed by the fill step; keep its screenshot/coords
          focusBySelector.set(ev.selector, ev);
          lastCommitBySelector.delete(ev.selector);
          break;
        }
        if (lastClick && lastClick.selector === ev.selector && ev.ts - lastClick.ts < CLICK_DEDUP_MS) break;
        lastClick = ev;
        steps.push(makeStep('click', ev, { screenshot: ev.screenshot, coords: ev.coords }));
        break;
      }

      case 'field-commit': {
        if (!ev.isPassword && (ev.value == null || ev.value === '')) break;
        // Enter commits, and the focusout right after commits again with the same value:
        // with no new focus on the selector, the second commit is a duplicate and is dropped.
        if (lastCommitBySelector.has(ev.selector) && lastCommitBySelector.get(ev.selector) === ev.value) break;
        lastCommitBySelector.set(ev.selector, ev.value);
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
