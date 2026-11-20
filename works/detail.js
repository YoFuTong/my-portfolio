(function () {
  'use strict';

  var postId = new URLSearchParams(location.search).get('post');
  var bodyEl = document.getElementById('post-body');
  var titleEl = document.getElementById('post-title');
  var catEl = document.getElementById('post-cat');
  var dateEl = document.getElementById('post-date');
  var tagsEl = document.getElementById('post-tags');
  var crumbTitle = document.getElementById('crumb-title');
  var crumbCat = document.getElementById('crumb-cat');

  var CAT_NAMES = { reverse: '逆向项目', review: '安全复盘', tools: '工具源码' };
  var CAT_PAGES = { reverse: 'reverse.html', review: 'review.html', tools: 'tools.html' };

  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fail(msg) {
    bodyEl.innerHTML = '<div class="empty">' + escapeHtml(msg) + '</div>';
  }

  if (!postId) { fail('缺少文章参数'); return; }

  /* 1. 先取元数据，渲染标题、分类、标签 */
  fetch('data/works.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) {
      var entry = (data.entries || []).find(function (e) { return e.id === postId; });
      if (!entry) throw new Error('未找到该文章');
      if (entry.draft === true) throw new Error('该文章正在整理中');

      document.title = entry.title + ' | 刘亿照';
      var meta = document.querySelector('meta[name="description"]');
      if (meta) meta.setAttribute('content', entry.desc || '');

      titleEl.textContent = entry.title;
      crumbTitle.textContent = entry.title;
      catEl.textContent = (CAT_NAMES[entry.category] || 'POST').toUpperCase() + ' · ' + postId.toUpperCase();

      var catName = CAT_NAMES[entry.category];
      if (catName) {
        crumbCat.textContent = catName;
        crumbCat.setAttribute('href', CAT_PAGES[entry.category]);
      }

      if (entry.date) dateEl.textContent = entry.date;
      tagsEl.innerHTML = (entry.tags || []).map(function (t) {
        return '<span class="tag">' + escapeHtml(t) + '</span>';
      }).join('');

      /* 2. 再取 md 正文 */
      return fetch(entry.post, { cache: 'no-cache' });
    })
    .then(function (r) { if (!r.ok) throw new Error('正文加载失败 HTTP ' + r.status); return r.text(); })
    .then(function (md) {
      /* --- 修改点开始 --- */
      
      // 去掉废弃的 highlight 选项，只保留基本解析
      marked.setOptions({
        gfm: true,
        breaks: false
      });

      // 将 md 转为 html
      bodyEl.innerHTML = marked.parse(md);

      // 手动扫描所有 pre code 块，应用 highlight.js 高亮
      if (window.hljs) {
        bodyEl.querySelectorAll('pre code').forEach(function(block) {
          hljs.highlightElement(block);
        });
      }

      /* --- 修改点结束 --- */

      /* 图片相对路径修正：md 在 posts/ 下，图在 posts/assets/xxx/ 下，
         md 里写 ./assets/xxx.png，渲染后转成 posts/assets/xxx.png */
      bodyEl.querySelectorAll('img').forEach(function (img) {
        var src = img.getAttribute('src');
        if (src && !/^(https?:)?\/\//.test(src) && !src.startsWith('/')) {
          img.setAttribute('src', 'posts/' + src.replace(/^\.\//, ''));
        }
      });

      /* 外链新窗口打开 */
      bodyEl.querySelectorAll('a[href^="http"]').forEach(function (a) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      });
    })
    .catch(function (err) {
      console.error(err);
      fail(err.message || '文章加载失败');
    });
})();