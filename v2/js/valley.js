/*
 * valley.js — the valley follows the visitor's clock.
 * Picks a time-of-day class for <body> from the local hour; a manual toggle
 * cycles through the four states and persists in localStorage. No libraries.
 */
(function () {
  var MODES = ['dawn', 'day', 'dusk', 'night'];
  var GLYPHS = { dawn: '☼', day: '☀', dusk: '☽', night: '★' };
  var KEY = 'valley-time';

  function modeForHour(h) {
    if (h >= 5 && h < 9) return 'dawn';
    if (h >= 9 && h < 17) return 'day';
    if (h >= 17 && h < 21) return 'dusk';
    return 'night';
  }

  function apply(mode) {
    MODES.forEach(function (m) { document.body.classList.remove('t-' + m); });
    document.body.classList.add('t-' + mode);
    var btn = document.querySelector('.time-toggle');
    if (btn) {
      var glyph = btn.querySelector('.tt-glyph');
      var label = btn.querySelector('.tt-label');
      if (glyph) glyph.textContent = GLYPHS[mode];
      if (label) label.textContent = mode;
      btn.setAttribute('aria-label', 'Time of day: ' + mode + '. Activate to change.');
    }
  }

  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
  var current = (saved && MODES.indexOf(saved) !== -1)
    ? saved
    : modeForHour(new Date().getHours());
  apply(current);

  document.addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest && ev.target.closest('.time-toggle');
    if (!btn) return;
    current = MODES[(MODES.indexOf(current) + 1) % MODES.length];
    apply(current);
    try { localStorage.setItem(KEY, current); } catch (e) { /* private mode */ }
  });
})();
