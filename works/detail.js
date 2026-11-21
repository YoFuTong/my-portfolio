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
      /* ---------- 3. 渲染 Markdown ---------- */
      // 配置 marked
      marked.setOptions({
        gfm: true,
        breaks: false
      });

      // 将 md 转为 html
      bodyEl.innerHTML = marked.parse(md);

      /* ---------- 4. 代码高亮 ---------- */
      // 手动扫描所有 pre code 块，应用 highlight.js 高亮
      if (window.hljs) {
        bodyEl.querySelectorAll('pre code').forEach(function(block) {
          hljs.highlightElement(block);
        });
      }

      /* ---------- 5. 代码块增强：复制 & 折叠 ---------- */
      bodyEl.querySelectorAll('pre').forEach(function(pre) {
        // 5.1 创建外层包裹容器
        var wrapper = document.createElement('div');
        wrapper.className = 'code-wrapper';
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);

        // 5.2 创建顶部工具栏（复制按钮）
        var toolbar = document.createElement('div');
        toolbar.className = 'code-toolbar';
        
        var copyBtn = document.createElement('button');
        copyBtn.className = 'code-btn';
        copyBtn.textContent = '复制';
        toolbar.appendChild(copyBtn);
        wrapper.appendChild(toolbar);

        // 5.3 复制逻辑
        copyBtn.addEventListener('click', function() {
          var codeText = pre.querySelector('code').innerText;
          navigator.clipboard.writeText(codeText).then(function() {
            copyBtn.textContent = '已复制!';
            copyBtn.classList.add('copied');
            setTimeout(function() {
              copyBtn.textContent = '复制';
              copyBtn.classList.remove('copied');
            }, 2000);
          }).catch(function(err) {
            console.error('复制失败: ', err);
            copyBtn.textContent = '复制失败';
          });
        });

        // 5.4 创建底部展开按钮和遮罩
        var expandWrapper = document.createElement('div');
        expandWrapper.className = 'code-expand-wrapper';
        
        var expandBtn = document.createElement('button');
        expandBtn.className = 'expand-btn';
        expandBtn.textContent = '展开全部代码 ↓';
        expandWrapper.appendChild(expandBtn);
        wrapper.appendChild(expandWrapper);

        // 5.5 判断高度，决定是否需要折叠
        // 稍微延时，等待 highlight.js 和字体渲染完毕，确保获取到真实高度
        setTimeout(function() {
          // 如果代码块高度超过 CSS 里设定的 400px，则添加折叠类
          if (pre.scrollHeight > 400) {
            wrapper.classList.add('is-collapsed');
          }
        }, 100); // 给字体留点加载时间

        // 5.6 展开/折叠逻辑
        expandBtn.addEventListener('click', function() {
          if (wrapper.classList.contains('is-collapsed')) {
            wrapper.classList.remove('is-collapsed');
            wrapper.classList.add('is-expanded');
            expandBtn.textContent = '收起代码 ↑';
          } else {
            wrapper.classList.add('is-collapsed');
            wrapper.classList.remove('is-expanded');
            expandBtn.textContent = '展开全部代码 ↓';
            // 收起后滚动回代码块顶部，体验更好
            wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
      });

      /* ---------- 6. 图片路径修正 ---------- */
      // md 在 posts/ 下，图在 posts/assets/xxx/ 下，
      // md 里写 ./assets/xxx.png，渲染后转成 posts/assets/xxx.png
      bodyEl.querySelectorAll('img').forEach(function (img) {
        var src = img.getAttribute('src');
        if (src && !/^(https?:)?\/\//.test(src) && !src.startsWith('/')) {
          img.setAttribute('src', 'posts/' + src.replace(/^\.\//, ''));
        }
      });

      /* ---------- 7. 外链新窗口打开 ---------- */
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