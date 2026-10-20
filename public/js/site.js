// public/js/site.js

// Mobile menu toggle
(function () {
  const toggler = document.querySelector('.navbar-toggler');
  if (!toggler) return;

  function setOpen(open) {
    toggler.setAttribute('aria-expanded', String(open));
    toggler.setAttribute('aria-label', open ? 'Skjul meny' : 'Vis meny');
  }

  toggler.addEventListener('click', function () {
    setOpen(toggler.getAttribute('aria-expanded') !== 'true');
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && toggler.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggler.focus();
    }
  });
})();

// Prefetch pages on hover/touch in browsers without Speculation Rules
// (Chromium prerenders via the <script type="speculationrules"> in head.ejs instead)
(function () {
  if (HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules')) return;

  const saveData = navigator.connection && navigator.connection.saveData;
  if (saveData) return;

  const useLinkPrefetch = document.createElement('link').relList.supports('prefetch');
  const prefetched = new Set([location.pathname]);
  const HOVER_DELAY = 65;
  let hoverTimer = null;

  function prefetchable(anchor) {
    if (!anchor || !anchor.href || anchor.target === '_blank' || anchor.hasAttribute('download')) return null;
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin || url.search || url.pathname === '/skjema') return null;
    if (prefetched.has(url.pathname)) return null;
    return url;
  }

  function prefetch(url) {
    prefetched.add(url.pathname);
    if (useLinkPrefetch) {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = url.pathname;
      document.head.appendChild(link);
    } else {
      fetch(url.pathname, { credentials: 'same-origin', priority: 'low' }).catch(function () { });
    }
  }

  document.addEventListener('mouseover', function (e) {
    const url = prefetchable(e.target.closest('a'));
    if (!url) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function () { prefetch(url); }, HOVER_DELAY);
  }, { passive: true });

  document.addEventListener('mouseout', function (e) {
    if (e.target.closest('a')) clearTimeout(hoverTimer);
  }, { passive: true });

  ['touchstart', 'focusin'].forEach(function (type) {
    document.addEventListener(type, function (e) {
      const url = prefetchable(e.target.closest && e.target.closest('a'));
      if (url) prefetch(url);
    }, { passive: true });
  });
})();
