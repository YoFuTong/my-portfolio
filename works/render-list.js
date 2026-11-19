// works/render-list.js
(function () {
  'use strict';

  var category = document.body.dataset.category;
  var listEl = document.getElementById('entry-list');
  if (!category || !listEl) return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showEmpty(msg) {
    listEl.innerHTML = '<div class="empty">' + escapeHtml(msg) + '</div>';
  }

  function showLoading() {
    listEl.innerHTML = '<div class="loading">加载中…</div>';
  }

  function render(entries) {
    if (!entries.length) {
      showEmpty('作者还没有部署任何项目');
      return;
    }
    listEl.innerHTML = entries.map(function (e, i) {
      var num = String(i + 1).padStart(2, '0');
      var tags = (e.tags || []).map(function (t) {
        return '<span class="tag">' + escapeHtml(t) + '</span>';
      }).join('');
      var badge = e.draft !== false ? '<span class="badge">整理中</span>' : '';
      var draftAttr = e.draft !== false ? ' data-draft' : '';
      var href = e.href || '#';
      return (
        '<a class="entry reveal" href="' + escapeHtml(href) + '"' + draftAttr + '>' +
          '<span class="entry-num">' + num + '</span>' +
          '<div class="entry-body">' +
            '<h3>' + escapeHtml(e.title) + ' ' + badge + '</h3>' +
            '<p>' + escapeHtml(e.desc) + '</p>' +
            (tags ? '<div class="entry-tags">' + tags + '</div>' : '') +
          '</div>' +
          '<span class="entry-arrow" aria-hidden="true">→</span>' +
        '</a>'
      );
    }).join('');

    observeReveal();
    bindDraftClick();
  }

  /* 入场动画 */
  var io = null;
  function observeReveal() {
    var els = listEl.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window && !reduceMotion) {
      if (!io) {
        io = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible');
              io.unobserve(entry.target);
            }
          });
        }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
      }
      els.forEach(function (el, i) {
        el.style.transitionDelay = (i % 4) * 70 + 'ms';
        io.observe(el);
      });
    } else {
      els.forEach(function (el) { el.classList.add('is-visible'); });
    }
  }

  /* 整理中条目的轻提示 */
  var toast = document.createElement('div');
  toast.className = 'toast';
  document.body.appendChild(toast);
  var toastTimer;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 1800);
  }
  function bindDraftClick() {
    listEl.querySelectorAll('[data-draft]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        showToast('该条目正在整理中，稍后上线');
      });
    });
  }

  /* 年份 */
  var yearEl = document.getElementById('year');
  if (yearEl) { yearEl.textContent = new Date().getFullYear(); }

  /* 拉取数据 */
  showLoading();
  fetch('data/works.json', { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      var all = Array.isArray(data.entries) ? data.entries : [];
      var entries = all.filter(function (e) { return e.category === category; });
      render(entries);
    })
    .catch(function (err) {
      console.error(err);
      showEmpty('数据加载失败，请稍后再试');
    });
})();