// scripts/validate-works.js
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join('works', 'data', 'works.json');
const DETAIL_DIR = path.join('works', 'detail');

function fail(msg) {
  console.error('❌ ' + msg);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch (e) {
  fail('works.json 不是合法 JSON：' + e.message);
}

if (!Array.isArray(data.entries)) {
  fail('entries 必须是数组');
}

const REQUIRED = ['id', 'category', 'title', 'desc', 'href'];
const VALID_CATS = ['reverse', 'review', 'tools'];
const ids = new Set();

for (const [i, e] of data.entries.entries()) {
  const pos = `entries[${i}]`;
  for (const k of REQUIRED) {
    if (!e[k] || typeof e[k] !== 'string') {
      fail(`${pos} 缺少或不是字符串字段：${k}`);
    }
  }
  if (!VALID_CATS.includes(e.category)) {
    fail(`${pos} category 非法：${e.category}（允许：${VALID_CATS.join(', ')}）`);
  }
  if (ids.has(e.id)) {
    fail(`${pos} id 重复：${e.id}`);
  }
  ids.add(e.id);

  if (e.tags && !Array.isArray(e.tags)) {
    fail(`${pos} tags 必须是数组`);
  }

  // draft 为 false 时，检查详情页文件是否存在
    // draft 为 false 时，检查 post 对应的 Markdown 文件是否存在
  if (e.draft === false && e.post) {
    // process.cwd() 是当前项目根目录
    const postFile = path.join(process.cwd(), e.post);
    if (!fs.existsSync(postFile)) {
      fail(`${pos} draft 为 false 但 Markdown 文件不存在：${e.post}`);
    }
  }
}
const byCat = {};
data.entries.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + 1; });
const drafts = data.entries.filter(e => e.draft !== false).length;

console.log('✅ 校验通过');
console.log('   总数：' + data.entries.length);
console.log('   整理中：' + drafts);
console.log('   分类：' + JSON.stringify(byCat));

// 写入 Actions Summary
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    '### 作品数据校验',
    '',
    '- ✅ 校验通过',
    `- 总数：${data.entries.length}`,
    `- 整理中：${drafts}`,
    `- 分类：${Object.entries(byCat).map(([k, v]) => `${k}(${v})`).join(' / ')}`,
  ];
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}