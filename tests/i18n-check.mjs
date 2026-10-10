import fs from 'node:fs';
import path from 'node:path';

const en = JSON.parse(fs.readFileSync('src/_locales/en/messages.json', 'utf8'));
const zh = JSON.parse(fs.readFileSync('src/_locales/zh_CN/messages.json', 'utf8'));
const ek = Object.keys(en), zk = Object.keys(zh);
console.log('en keys:', ek.length, 'zh keys:', zk.length);
console.log('missing in zh:', ek.filter(k => !zk.includes(k)));
console.log('missing in en:', zk.filter(k => !ek.includes(k)));

const used = new Set();
function scan(p) {
  const s = fs.readFileSync(p, 'utf8');
  for (const m of s.matchAll(/data-i18n(?:-title)?="([a-zA-Z0-9_]+)"/g)) used.add(m[1]);
  for (const m of s.matchAll(/t\(\s*'([a-zA-Z0-9_]+)'/g)) used.add(m[1]);
  for (const m of s.matchAll(/getMessage\(\s*'([a-zA-Z0-9_]+)'/g)) used.add(m[1]);
}
function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(html|js)$/.test(f.name)) scan(p);
  }
}
walk('src');
const missing = [...used].filter(k => !ek.includes(k));
const unused = ek.filter(k => !used.has(k));
console.log('used keys:', used.size);
console.log('used but MISSING:', missing);
console.log('defined but UNUSED (allowed):', unused);
console.log('wakeAll refs remaining:', [...used].filter(k => /wakeAll/i.test(k)));
