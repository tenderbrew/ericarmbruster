/**
 * drawer.js
 * Shared navigation controller used by every page.
 * It toggles the drawer open/closed, keeps ARIA state in sync,
 * and closes on outside click, link click, or Escape key.
 */
(function () {
  // Both desktop ("interests") and mobile ("menu") buttons use this selector.
  var toggles = Array.from(document.querySelectorAll('[data-drawer-toggle]'));
  var drawer = document.getElementById('site-drawer');
  if (!drawer || toggles.length === 0) return;

  // Single state setter: updates drawer class and ARIA state in one place.
  function setOpen(isOpen) {
    drawer.classList.toggle('open', isOpen);
    toggles.forEach(function (btn) {
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }

  // Click on any toggle flips current drawer state.
  toggles.forEach(function (toggle) {
    toggle.addEventListener('click', function (event) {
      event.stopPropagation();
      setOpen(!drawer.classList.contains('open'));
    });
  });

  // Navigating from the drawer closes it so the next page starts clean.
  drawer.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () {
      setOpen(false);
    });
  });

  // Click-away behavior for mouse/touch users.
  document.addEventListener('click', function (event) {
    if (!drawer.contains(event.target) && !toggles.some(function (btn) { return btn.contains(event.target); })) {
      setOpen(false);
    }
  });

  // Escape close supports keyboard users and restores focus context.
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      setOpen(false);
      if (toggles[0]) toggles[0].focus();
    }
  });
})();
