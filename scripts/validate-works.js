// scripts/validate-works.js
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join('works', 'data', 'works.json');

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
    fail(`${pos} category 非法：${e.category}`);
  }
  if (ids.has(e.id)) {
    fail(`${pos} id 重复：${e.id}`);
  }
  ids.add(e.id);

  if (e.tags && !Array.isArray(e.tags)) {
    fail(`${pos} tags 必须是数组`);
  }

  // 终极排错逻辑：强制打印出它到底在找哪个文件
  if (e.draft === false && e.post) {
    const absPath = path.resolve(process.cwd(), 'works', e.post);
    if (!fs.existsSync(absPath)) {
      fail(`${pos} draft 为 false 但 Markdown 文件不存在。\n期望文件绝对路径: ${absPath}\n请检查文件是否真的推到了这个位置！`);
    }
  }
}

console.log('✅ 校验通过');