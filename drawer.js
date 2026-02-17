(function () {
  var toggles = Array.from(document.querySelectorAll('[data-drawer-toggle]'));
  var drawer = document.getElementById('site-drawer');
  if (!drawer || toggles.length === 0) return;

  function setOpen(isOpen) {
    drawer.classList.toggle('open', isOpen);
    toggles.forEach(function (btn) {
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }

  toggles.forEach(function (toggle) {
    toggle.addEventListener('click', function (event) {
      event.stopPropagation();
      setOpen(!drawer.classList.contains('open'));
    });
  });

  drawer.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () {
      setOpen(false);
    });
  });

  document.addEventListener('click', function (event) {
    if (!drawer.contains(event.target) && !toggles.some(function (btn) { return btn.contains(event.target); })) {
      setOpen(false);
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      setOpen(false);
      if (toggles[0]) toggles[0].focus();
    }
  });
})();
