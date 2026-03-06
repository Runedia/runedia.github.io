document.addEventListener('DOMContentLoaded', () => {
  initNavHighlight();
  initMobileSidebar();
  initTOC();
  initScrollSpy();
});

/** Highlight the current page link in sidebar nav */
function initNavHighlight() {
  const currentPage = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.sidebar__nav a').forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPage) {
      link.classList.add('active');
    }
  });
}

/** Mobile sidebar toggle */
function initMobileSidebar() {
  const hamburger = document.querySelector('.header__hamburger');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.sidebar-overlay');

  if (!hamburger || !sidebar) return;

  hamburger.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
  });

  if (overlay) {
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
    });
  }
}

/** Auto-generate TOC from h2, h3 headings */
function initTOC() {
  const tocContainer = document.getElementById('toc');
  if (!tocContainer) return;

  const headings = document.querySelectorAll('.content h2, .content h3');
  if (headings.length === 0) return;

  const list = document.createElement('ul');
  list.className = 'sidebar__toc';

  headings.forEach((heading, index) => {
    if (!heading.id) {
      heading.id = 'section-' + index;
    }

    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#' + heading.id;
    a.textContent = heading.textContent;
    a.dataset.target = heading.id;

    if (heading.tagName === 'H3') {
      a.classList.add('toc-h3');
    }

    li.appendChild(a);
    list.appendChild(li);
  });

  tocContainer.appendChild(list);
}

/** Highlight current section in TOC on scroll */
function initScrollSpy() {
  const tocLinks = document.querySelectorAll('.sidebar__toc a');
  if (tocLinks.length === 0) return;

  const headings = [];
  tocLinks.forEach(link => {
    const target = document.getElementById(link.dataset.target);
    if (target) headings.push({ el: target, link });
  });

  function updateActive() {
    const scrollTop = window.scrollY + 100;
    let current = headings[0];

    for (const h of headings) {
      if (h.el.offsetTop <= scrollTop) {
        current = h;
      }
    }

    tocLinks.forEach(l => l.classList.remove('active'));
    if (current) current.link.classList.add('active');
  }

  window.addEventListener('scroll', updateActive, { passive: true });
  updateActive();
}
