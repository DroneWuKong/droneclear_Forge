/* Associate existing visible field captions and keep genuine overflow reachable. */
(() => {
  'use strict';
  let serial = 0;
  const explicit = {
    'f-task': 'Task', 'f-lic': 'License', 'f-verdict': 'Verdict',
    'sort-select': 'Sort order', 'feed-sort': 'Sort order',
    'view-mode-toggle': 'JSON view', 'rf-trace-slider': 'Point along route'
  };
  const named = el => el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ||
    (el.labels && [...el.labels].some(label => label.textContent.trim()));
  function associate(el) {
    if (named(el) || ['hidden','submit','button','reset'].includes(el.type)) return;
    if (!el.id) el.id = 'site-field-' + (++serial);
    if (el.previousElementSibling?.tagName === 'LABEL' && el.previousElementSibling.textContent.trim()) {
      el.previousElementSibling.htmlFor = el.id; return;
    }
    // Only use a caption from a field with exactly one form control. Never guess
    // from placeholder, selected value, arbitrary surrounding prose or ID text.
    for (let box = el.parentElement, depth = 0; box && depth < 3; box = box.parentElement, depth++) {
      if (box.querySelectorAll('input:not([type="hidden"]), select, textarea').length !== 1) break;
      const caption = box.querySelector('label, .input-label, .cfg-label, .slider-label, .ig-setup-label, .setup-label, .field-label, .picker-label');
      if (caption && caption.textContent.trim()) {
        if (caption.tagName === 'LABEL') caption.htmlFor = el.id;
        else {
          if (!caption.id) caption.id = 'site-caption-' + (++serial);
          el.setAttribute('aria-labelledby', caption.id);
        }
        return;
      }
      // Setup cards use short visible headings immediately above their select.
      const previous = el.previousElementSibling;
      if (previous && /^(SPAN|H3|H4)$/.test(previous.tagName) && previous.textContent.trim() && previous.textContent.trim().length < 80) {
        if (!previous.id) previous.id = 'site-caption-' + (++serial);
        el.setAttribute('aria-labelledby', previous.id); return;
      }
    }
    if (explicit[el.id]) {
      const label = document.createElement('label');
      label.htmlFor = el.id; label.className = 'site-field-caption'; label.textContent = explicit[el.id];
      // An empty decorative switch label must not swallow the new visible caption.
      const anchor = el.closest('label') || el;
      anchor.before(label);
    }
  }
  function theme() {
    const root = document.documentElement;
    let dark = root.getAttribute('data-theme') !== 'light';
    for (const el of [document.body, root]) {
      const rgb = getComputedStyle(el).backgroundColor.match(/[\d.]+/g)?.map(Number);
      if (rgb && (rgb.length < 4 || rgb[3] > 0.95)) {
        dark = (rgb[0]*0.2126 + rgb[1]*0.7152 + rgb[2]*0.0722) < 128;
        break;
      }
    }
    const value = dark && location.pathname !== '/clock/' && location.pathname !== '/builder/' ? 'dark' : 'light';
    if (root.dataset.siteContrast !== value) root.dataset.siteContrast = value;
  }
  function enhance() {
    theme();
    document.querySelectorAll('input, select, textarea').forEach(associate);
    document.querySelectorAll('.compliance-table-wrap, .compare-table-wrap, pre, .mg-code, .tg-code, .ai-code, .cu-code, .sw-code, .ig-code, .fc-code' + (location.pathname === '/api-docs/' ? ', .card' : '')).forEach(el => {
      const style = getComputedStyle(el);
      const scrolls = ((/auto|scroll/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1) ||
        (/auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1));
      if (scrolls && !el.querySelector('a[href], button, input, select, textarea, [tabindex="0"]')) {
        if (!el.hasAttribute('tabindex')) { el.tabIndex = 0; el.dataset.siteScrollFocus = 'true'; }
      } else if (el.dataset.siteScrollFocus === 'true') { el.removeAttribute('tabindex'); delete el.dataset.siteScrollFocus; }
    });
  }
  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true; requestAnimationFrame(() => { pending = false; enhance(); });
  }
  function start() {
    document.documentElement.dataset.siteRoute = location.pathname;
    enhance();
    new MutationObserver(schedule).observe(document.body, {childList: true, subtree: true});
    new MutationObserver(schedule).observe(document.documentElement, {attributes:true, attributeFilter:['data-theme','class','style']});
    addEventListener('resize', schedule);
    document.addEventListener('change', schedule);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true}); else start();
})();
