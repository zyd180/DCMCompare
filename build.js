/* Bundle src/* into one offline HTML file. */
'use strict';
var fs = require('fs');
var path = require('path');
var dir = __dirname;
function read(p) { return fs.readFileSync(path.join(dir, p), 'utf8'); }

/* 更新记录渲染成静态 HTML 注入，不在运行时用脚本拼 —— 弹框内容与产物同源，离线可读 */
function renderChangelog(hist) {
  return hist.map(function (h) {
    return '<div class="log-item"><div class="log-head"><b>v' + h.version + '</b>' +
      '<span>' + h.date + '</span></div><ul>' +
      h.items.map(function (it) { return '<li>' + it + '</li>'; }).join('') +
      '</ul></div>';
  }).join('');
}

var VER = require('./src/version.js').version;
var parts = {
  STYLE: read('src/style.css'),
  VERSION: VER,
  CHANGELOG: renderChangelog(require('./src/version.js').history),
  CORE: read('src/core.js'),
  VIEWS: read('src/views.js'),
  REPORT: read('src/report.js'),
  UI: read('src/ui.js')
};
var html = read('src/shell.html');
Object.keys(parts).forEach(function (k) {
  var safe = String(parts[k]).replace(/<\/script/gi, '<\\/script');
  /* VERSION 会出现多处（页头徽标 / 弹框标题 / 手册页脚），必须全局替换 */
  html = html.split('{{' + k + '}}').join(safe);
});
if (/\{\{[A-Z]+\}\}/.test(html)) throw new Error('未替换的占位符: ' + html.match(/\{\{[A-Z]+\}\}/g).join(','));

/* 版本号防漂：README 更新记录里最新一条必须与 version.js 一致，否则构建失败 */
var readme = read('README.md');
var m = readme.match(/^## 更新记录[\s\S]*?\n\|\s*v?([\d.]+)\s*\|/m);
if (!m) throw new Error('README 缺少「## 更新记录」表格，或首行不是版本行');
if (m[1] !== VER) throw new Error('版本号不一致：src/version.js=' + VER + '，README 更新记录首行=' + m[1]);

var out = path.join(dir, 'DCM_MAP_对比工具.html');
fs.writeFileSync(out, '\ufeff' + html, 'utf8');
var kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log('构建完成: ' + out);
console.log('版本: v' + VER);
console.log('大小: ' + kb + ' KB');
console.log('内联脚本: ' + (html.match(/^<script>/gm) || []).length + ' 段（行首独立标签；源码中的 script 字面量不计）');
console.log('外部资源引用: ' + ((html.match(/(src|href)=["']https?:/gi) || []).length));
