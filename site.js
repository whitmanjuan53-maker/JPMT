(function () {
  var header = document.querySelector('.header');
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('primary-nav');
  var backdrop = document.querySelector('.nav-backdrop');
  if (!header || !toggle || !nav) return;

  var mqMobile = window.matchMedia('(max-width: 768px)');

  function updateNavAria() {
    if (!mqMobile.matches) {
      nav.removeAttribute('aria-hidden');
      return;
    }
    nav.setAttribute('aria-hidden', header.classList.contains('nav-open') ? 'false' : 'true');
  }

  function setOpen(open) {
    header.classList.toggle('nav-open', open);
    document.body.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if (backdrop) backdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
    updateNavAria();
  }

  toggle.addEventListener('click', function () {
    setOpen(!header.classList.contains('nav-open'));
  });

  if (backdrop) {
    backdrop.addEventListener('click', function () {
      setOpen(false);
    });
  }

  nav.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () {
      setOpen(false);
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setOpen(false);
  });

  window.addEventListener('resize', function () {
    if (window.matchMedia('(min-width: 769px)').matches) setOpen(false);
    else updateNavAria();
  });

  updateNavAria();

  // Header scroll effect
  function handleScroll() {
    if (window.scrollY > 50) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  }

  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll(); // Check on load
})();

(function () {
  var form = document.getElementById('quote-request-form');
  if (form) {
    var feedback = document.getElementById('quote-form-feedback');
    var submitBtn = document.getElementById('quote-form-submit');
    var params = new URLSearchParams(window.location.search);

    if (params.has('origin_zip')) {
      var originEl = document.getElementById('origin');
      if (originEl) originEl.value = params.get('origin_zip') || '';
    }
    if (params.has('dest_zip')) {
      var destEl = document.getElementById('dest');
      if (destEl) destEl.value = params.get('dest_zip') || '';
    }
    if (params.has('equipment')) {
      var eqEl = document.getElementById('equipment');
      if (eqEl) {
        var v = params.get('equipment');
        if (v && Array.prototype.some.call(eqEl.options, function (o) { return o.value === v; })) {
          eqEl.value = v;
        }
      }
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (feedback) {
        feedback.textContent = '';
        feedback.className = 'form-feedback';
      }
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.setAttribute('aria-busy', 'true');
        submitBtn.classList.add('is-loading');
      }
      function finish() {
        if (feedback) {
          feedback.textContent =
            'Thank you. Your quote request was received; our team will follow up shortly.';
          feedback.className = 'form-feedback form-feedback--success is-visible';
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.removeAttribute('aria-busy');
          submitBtn.classList.remove('is-loading');
        }
        form.reset();
      }
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(finish);
      });
    });
  }
})();
