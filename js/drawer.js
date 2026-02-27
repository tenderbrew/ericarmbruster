/*
 * drawer.js — Shared navigation drawer controller
 * ================================================
 * Loaded on every page via a <script> tag. Controls the slide-out navigation
 * drawer (the panel that lists page links when you click "Interests" on desktop
 * or the hamburger "Menu" button on mobile).
 *
 * Responsibilities:
 *   1. Toggle the drawer open/closed when any toggle button is clicked
 *   2. Keep ARIA attributes in sync so screen readers know the drawer's state
 *   3. Close the drawer automatically when:
 *      - A link inside it is clicked (navigating away)
 *      - The user clicks anywhere outside the drawer (click-away dismiss)
 *      - The Escape key is pressed (keyboard accessibility)
 *
 * The entire script is wrapped in an IIFE (Immediately Invoked Function
 * Expression) to avoid polluting the global scope — no variables leak out.
 */
(function () {

  /* ── Element references ──────────────────────────────────────────────
   * `toggles` — every button on the page that has the `data-drawer-toggle`
   *   attribute. On desktop this is the "Interests" nav button; on mobile
   *   it's the hamburger "Menu" button. We collect them all into an array
   *   so we can update their ARIA state together.
   * `drawer` — the actual slide-out panel element (id="site-drawer").
   *   Contains grouped links to each section of the site.
   */
  var toggles = Array.from(document.querySelectorAll('[data-drawer-toggle]'));
  var drawer = document.getElementById('site-drawer');

  /* If the drawer element or toggle buttons aren't found in the DOM, bail
   * out immediately. This prevents errors on pages that might not include
   * the navigation markup. */
  if (!drawer || toggles.length === 0) return;

  /* ── Central state setter ────────────────────────────────────────────
   * All open/close logic flows through this single function, ensuring the
   * CSS class and ARIA attributes always stay in sync. The `.open` class
   * triggers CSS transitions that slide the drawer into view.
   * `aria-expanded` tells screen readers whether the controlled panel is
   * currently visible — "true" when open, "false" when closed.
   */
  function setOpen(isOpen) {
    drawer.classList.toggle('open', isOpen);
    toggles.forEach(function (btn) {
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }

  /* ── Toggle button click handler ─────────────────────────────────────
   * When any toggle button is clicked, flip the drawer to the opposite
   * state (open → closed, closed → open).
   * `stopPropagation()` prevents this click from also triggering the
   * document-level click-away listener below (which would immediately
   * close the drawer we just opened).
   */
  toggles.forEach(function (toggle) {
    toggle.addEventListener('click', function (event) {
      event.stopPropagation();
      setOpen(!drawer.classList.contains('open'));
    });
  });

  /* ── Link click auto-close ───────────────────────────────────────────
   * When the user clicks a link inside the drawer, close it immediately.
   * This ensures the drawer isn't left open when the new page loads (since
   * many of these are same-origin navigations that may use browser cache
   * and preserve scroll state).
   */
  drawer.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () {
      setOpen(false);
    });
  });

  /* ── Click-away dismiss ──────────────────────────────────────────────
   * Listens for any click on the entire document. If the click target is
   * NOT inside the drawer AND NOT inside any toggle button, close the
   * drawer. This gives users a natural way to dismiss the panel by
   * clicking on the page background.
   * Uses `.contains()` to check if the click target is a child of the
   * drawer or toggle, handling nested elements correctly.
   */
  document.addEventListener('click', function (event) {
    if (!drawer.contains(event.target) && !toggles.some(function (btn) { return btn.contains(event.target); })) {
      setOpen(false);
    }
  });

  /* ── Escape key dismiss ──────────────────────────────────────────────
   * Pressing Escape closes the drawer and returns keyboard focus to the
   * first toggle button. This is an important accessibility pattern —
   * keyboard users who tabbed into the drawer need a way to close it and
   * return to where they were. Moving focus back to the toggle prevents
   * focus from getting lost in the closed (hidden) panel.
   */
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      setOpen(false);
      if (toggles[0]) toggles[0].focus();
    }
  });
})();

/* ── Desktop interests dropdown ───────────────────────────────────────────
 * A separate, lightweight controller for the desktop-only interests dropdown.
 * Targets [data-interests-toggle] buttons and the #interests-dropdown panel.
 * Operates independently of the mobile site-drawer above.
 */
(function () {
  var toggle   = document.querySelector('[data-interests-toggle]');
  var dropdown = document.getElementById('interests-dropdown');

  if (!toggle || !dropdown) return;

  function setOpen(isOpen) {
    dropdown.classList.toggle('open', isOpen);
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }

  toggle.addEventListener('click', function (event) {
    event.stopPropagation();
    setOpen(!dropdown.classList.contains('open'));
  });

  dropdown.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () { setOpen(false); });
  });

  document.addEventListener('click', function (event) {
    if (!dropdown.contains(event.target) && !toggle.contains(event.target)) {
      setOpen(false);
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      setOpen(false);
      toggle.focus();
    }
  });
})();
