// src/recorder/consolidate.js
const CLICK_DEDUP_MS = 500;
const NAV_DEDUP_MS = 1000;

const baseUrl = (u) => String(u ?? '').split(/[?#]/)[0];

export function consolidate(events) {
  const steps = [];
  const focusBySelector = new Map();      // last focus (editable click or field-focus) per selector
  const lastCommitBySelector = new Map(); // last committed value per selector (dedups Enter+focusout)
  const lastScrollByPage = new Map();     // base url -> scrollY of the last action there
  let lastClick = null;
  let lastNav = null;
  let lastCheck = null;
  let lastShortcut = null;
  let pendingDrag = null;

  // "scrolled" = the user moved more than half a viewport since the previous action on the
  // same page. Computed at the moment of the action (focus for fills), never for the first
  // action on a page.
  const scrolledFlag = (ev) => {
    if (typeof ev.scrollY !== 'number') return false;
    const key = baseUrl(ev.url);
    const prev = lastScrollByPage.get(key);
    lastScrollByPage.set(key, ev.scrollY);
    if (prev == null) return false;
    const half = (ev.viewportH ?? 0) / 2;
    return half > 0 && Math.abs(ev.scrollY - prev) > half;
  };

  for (const ev of events) {
    switch (ev.kind) {
      case 'field-focus': {
        // Chrome fires focusin right after the mousedown on the same field. The click
        // already computed `scrolled` and carries the screenshot/coords; by then the
        // scroll position is identical, so the focus on its own computes false and used
        // to overwrite the click's entry. Inside the dedup window the two events are one
        // interaction, so the flag and the capture are kept.
        const prev = focusBySelector.get(ev.selector);
        const scrolled = scrolledFlag(ev);
        const sameInteraction = prev && Math.abs(ev.ts - prev.ts) < CLICK_DEDUP_MS;
        const shotFrom = sameInteraction && prev.screenshot ? prev : ev;
        focusBySelector.set(ev.selector, {
          ...ev,
          scrolled: sameInteraction ? scrolled || prev.scrolled : scrolled,
          screenshot: shotFrom.screenshot,
          coords: shotFrom.coords,
          sensitiveRects: shotFrom.sensitiveRects,
        });
        lastCommitBySelector.delete(ev.selector); // new focus: a real re-edit may legitimately repeat the value
        break;
      }

      case 'click': {
        if (ev.isEditable) {
          // a click on a text field is absorbed by the fill step; keep its screenshot/coords/rects
          focusBySelector.set(ev.selector, { ...ev, scrolled: scrolledFlag(ev) });
          lastCommitBySelector.delete(ev.selector);
          break;
        }
        const scrolled = scrolledFlag(ev);
        if (lastClick && lastClick.selector === ev.selector && ev.ts - lastClick.ts < CLICK_DEDUP_MS) break;
        lastClick = ev;
        steps.push(makeStep('click', ev, { screenshot: ev.screenshot, coords: ev.coords, scrolled }));
        break;
      }

      case 'field-commit': {
        if (!ev.isSensitive && (ev.value == null || ev.value === '')) break;
        // Enter commits, and the focusout right after commits again with the same value:
        // with no new focus on the selector, the second commit is a duplicate and is dropped.
        if (lastCommitBySelector.has(ev.selector) && lastCommitBySelector.get(ev.selector) === ev.value) break;
        lastCommitBySelector.set(ev.selector, ev.value);
        const focus = focusBySelector.get(ev.selector) ?? null;
        steps.push(makeStep('fill', ev, {
          value: ev.isSensitive ? null : ev.value,
          screenshot: focus?.screenshot ?? ev.screenshot ?? null,
          coords: focus?.coords ?? null,
          sensitiveRects: focus?.screenshot ? (focus.sensitiveRects ?? []) : (ev.sensitiveRects ?? []),
          scrolled: focus ? focus.scrolled : scrolledFlag(ev),
        }));
        focusBySelector.delete(ev.selector);
        break;
      }

      case 'select':
        steps.push(makeStep('select', ev, { value: ev.value, screenshot: ev.screenshot, scrolled: scrolledFlag(ev) }));
        break;

      case 'check': {
        const scrolled = scrolledFlag(ev);
        if (lastCheck && lastCheck.selector === ev.selector && lastCheck.value === ev.value && ev.ts - lastCheck.ts < CLICK_DEDUP_MS) break;
        lastCheck = ev;
        steps.push(makeStep('check', ev, { value: ev.value, screenshot: ev.screenshot, coords: ev.coords, scrolled }));
        break;
      }

      case 'shortcut': {
        if (lastShortcut && lastShortcut.value === ev.value && ev.ts - lastShortcut.ts < CLICK_DEDUP_MS) break;
        lastShortcut = ev;
        steps.push(makeStep('shortcut', ev, { value: ev.value, screenshot: ev.screenshot }));
        break;
      }

      case 'drag-start':
        pendingDrag = ev; // the step is only created on drop
        break;

      case 'drag': {
        const start = pendingDrag;
        pendingDrag = null;
        steps.push(makeStep('drag', ev, {
          target: ev.target ?? null,
          screenshot: start?.screenshot ?? null,
          coords: start?.coords ?? null,
          sensitiveRects: start?.sensitiveRects ?? [],
        }));
        break;
      }

      case 'enter':
        steps.push(makeStep('enter', ev, { screenshot: null }));
        break;

      case 'navigation': {
        lastScrollByPage.delete(baseUrl(ev.url)); // the first action on the new page is never "scrolled"
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
    isSensitive: ev.isSensitive ?? false,
    sensitiveReason: ev.isSensitive ? (ev.sensitiveReason ?? null) : null,
    coords: null,
    screenshot: null,
    sensitiveRects: ev.sensitiveRects ?? [], // internal: consumed by session.finalize, then dropped
    ...extra,
  };
}
