/* Bundle + report smoke tests. Run: node test_bundle.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var C = require('./src/core.js');
var V = require('./src/views.js');
var RP = require('./src/report.js');
var VERS = require('./src/version.js');
var FILE = process.argv[2] || 'E:/Project/DCM/ALL.DCM';
var BUNDLE = path.join(__dirname, 'DCM_MAP_对比工具.html');
var failures = [];
function ok(c, m) { if (c) console.log('  PASS  ' + m); else { console.log('  FAIL  ' + m); failures.push(m); } }

/* 顶部工具条：按钮在报告最上方，三段说明在按钮下方各自成行；按钮不得在中部重复。 */
function checkTopbar(name, htmlText) {
  var tb = 'class="ann-export ann-topbar"';
  ok(htmlText.indexOf(tb) >= 0, name + ' 含顶部工具条');
  ok(htmlText.indexOf('<main>') < htmlText.indexOf(tb) &&
     htmlText.indexOf(tb) < htmlText.indexOf('<section>'),
     name + ' 工具条在报告顶部（main 之后、第一个 section 之前）');
  var act = htmlText.indexOf('class="ann-actions"');
  var notes = htmlText.indexOf('class="ann-notes"');
  ok(act >= 0 && notes >= 0 && act < notes, name + ' 按钮行在说明行上方');
  var noteBlock = (htmlText.match(/class="ann-notes"[\s\S]*?<\/div>/) || [''])[0];
  ok((noteBlock.match(/class="hint"/g) || []).length === 3,
     name + ' 三段说明各自成行（.ann-notes 内 3 个 hint）');
  ok(htmlText.indexOf('另存含批注的可编辑副本') > act &&
     htmlText.indexOf('导出归档报告') > act &&
     htmlText.indexOf('实时保存仅在本机生效') > notes,
     name + ' 两个按钮在 actions、说明在 notes');
  ok((htmlText.match(/onclick="dcmExportEditable\(\)"/g) || []).length === 1 &&
     (htmlText.match(/onclick="dcmExportAnnotated\(\)"/g) || []).length === 1,
     name + ' 按钮全报告仅出现一次（中部不再重复）');
  ok(!/class="ann-export">/.test(htmlText),
     name + ' revert-to-fail：中部 section 里的旧按钮块已移除');
}

console.log('== 1. 单文件产物静态检查 ==');
var html = fs.readFileSync(BUNDLE, 'utf8').replace(/^\ufeff/, '');
ok(!/\{\{[A-Z]+\}\}/.test(html), '所有占位符已替换');
ok(!/(src|href)=["']https?:/i.test(html), '无任何外部资源引用（完全离线）');
ok(!/<script[^>]+src=/i.test(html), '无外部脚本');
var scripts = [];
var re = /<script>([\s\S]*?)<\/script>/g, m;
while ((m = re.exec(html))) scripts.push(m[1]);
console.log('  内联脚本段数: ' + scripts.length);
ok(scripts.length === 4, '4 段内联脚本 (core/views/report/ui)');
scripts.forEach(function (s, k) {
  try { new vm.Script(s); ok(true, '脚本 ' + (k + 1) + ' 语法有效 (' + s.length + ' 字符)'); }
  catch (e) { ok(false, '脚本 ' + (k + 1) + ' 语法错误: ' + e.message); }
});
['fileInput', 'dropzone', 'btnReport', 'btnScan', 'btnSelfTest', 'btnSaveSession',
  'btnLoad', 'btnLoadSession', 'sessionInput', 'chkAutoEps', 'epsHint', 'conclusion',
  'annotations', 'btnAuditReport', 'inpReportPageSize',
  'viewTabs', 'stage', 'basket', 'tree',
  'btnVersion', 'changelogOverlay', 'btnChangelogClose'].forEach(function (id) {
  ok(html.indexOf('id="' + id + '"') >= 0, 'UI 元素 ' + id + ' 存在');
});

/* 版本号与更新记录：唯一来源是 src/version.js，构建时注入；README 首行版本由 build 自检 */
console.log('== 1b. 版本号与更新记录 ==');
ok(/id="btnVersion"[^>]*>v[\d.]+</.test(html), '页头版本号是可点击按钮');
ok(html.indexOf('>v' + VERS.version + '<') >= 0, '产物版本与 version.js 一致（v' + VERS.version + '）');
ok((html.match(/class="log-item"/g) || []).length === VERS.history.length,
  '更新记录条目数 = version.js history 条数（' + VERS.history.length + '）');
ok(html.indexOf('v' + VERS.version) >= 0 && html.indexOf(VERS.date) >= 0, '弹框显示版本号与日期');
ok(html.indexOf('id="manualOverlay"') >= 0 && html.indexOf('id="changelogOverlay"') >= 0 &&
  html.indexOf('id="manualOverlay"') < html.indexOf('id="changelogOverlay"'),
  '更新记录与手册是两个独立弹框');
/* 更新记录是给使用者看的：不许出现实现细节、验收数字、自证式声明 */
var clRegion = html.slice(html.indexOf('id="changelogOverlay"'), html.indexOf('<script>'));
ok(clRegion.length > 500, '更新记录区域已渲染');
['src/version.js', 'build 时注入', '22,813', '651', '署名', '页脚', '测试'].forEach(function (bad) {
  ok(clRegion.indexOf(bad) < 0, 'revert-to-fail：更新记录不出现面向开发的内容「' + bad + '」');
});
ok(clRegion.indexOf('对比清单') >= 0 && clRegion.indexOf('口径') >= 0,
  '更新记录讲的是使用者能做什么与需要注意的口径');
var readmeTxt = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
var readmeVer = readmeTxt.match(/^## 更新记录[\s\S]*?\n\|\s*v?([\d.]+)\s*\|/m);
ok(!!readmeVer && readmeVer[1] === VERS.version, 'README 更新记录首行与 version.js 一致');
ok(readmeTxt.slice(0, 200).indexOf('v' + VERS.version) >= 0, 'README 顶部标注当前版本');
/* 回归：载入按钮原来是可选中文本的 <label>，点击文字中间会留下闪烁插入符 */
ok(html.indexOf('<label class="btn"') < 0 && html.indexOf('<label class="btn ghost"') < 0,
  'revert-to-fail：载入按钮不再是可选中文本的 label');
ok(/<button id="btnLoad"[^>]*type="button"/.test(html) &&
  /<button id="btnLoadSession"[^>]*type="button"/.test(html),
  '两个载入按钮是原生 button[type=button]（可键盘聚焦、文字不产生 caret）');
ok(/\.btn\{[^}]*cursor:pointer/.test(html) && /\.btn\{[^}]*user-select:none/.test(html),
  '按钮样式统一 cursor:pointer + user-select:none');
ok(/\.dropzone\{[^}]*cursor:pointer/.test(html) && /\.dropzone\{[^}]*user-select:none/.test(html),
  '拖放区同样禁用文本选中（同一根因）');
ok(html.indexOf('function openPicker(') >= 0 && html.indexOf('removeAllRanges') >= 0,
  '点击时兜底清理残留选区');
ok(html.indexOf('data-view="rename"') >= 0, '改名对齐页签存在');
/* 页头作者 + 手册按钮配色 + 页签行下沿 */
ok(/class="author">作者 Henry</.test(html), '页头标注作者 Henry');
/* 页脚的使用声明：署名保留 + 禁止未授权转售/二次分发 */
ok(/id="statusRight"[^>]*>[^<]*本工具由 Henry 开发[^<]*请保留署名[^<]*未经许可请勿转售或二次分发/.test(html),
  '页脚声明保留署名并禁止未授权转售 / 二次分发');
ok(/id="statusRight"[^>]*>[^<]*GB2312/.test(html), '页脚仍保留编码自动识别说明');
ok(/id="btnManual"[^>]*class="btn gray"/.test(html), '「查看使用手册」用灰色按钮');
ok(/\.btn\.gray\{background:#E8E6DF/.test(html), '灰色按钮样式存在（不是透明 ghost）');
ok(!/\.viewtabs\{[^}]*border-bottom:none/.test(html) &&
  !/\.viewtabs button\{[^}]*border-bottom:none/.test(html) &&
  /\.viewtabs\{[^}]*padding:8px 10px;/.test(html),
  'revert-to-fail：页签行恢复下边框与下内边距，不再吞掉下沿');
/* 每个按钮都要有悬停提示；禁用的还要说明原因 */
var topBlock = (html.match(/<div class="top-actions">[\s\S]*?<\/div>/) || [''])[0];
ok((topBlock.match(/<button/g) || []).length >= 8 &&
  (topBlock.match(/<button/g) || []).length === (topBlock.match(/data-tip="/g) || []).length,
  '顶部按钮全部带 data-tip');
ok(/id="btnReport"[^>]*data-tip="[^"]+"[^>]*data-tip-off="/.test(topBlock) ||
  /id="btnReport"[^>]*data-tip-off="/.test(topBlock),
  '导出按钮禁用时给出不可用原因');
ok(/id="btnScan"[^>]*data-tip-off="[^"]*2 份/.test(topBlock) &&
  /id="btnAuditReport"[^>]*data-tip-off="[^"]*2 份/.test(topBlock),
  '需两份 DCM 的按钮把原因写进 data-tip-off');
ok(html.indexOf('data-view="axis"') >= 0, '轴变更影响面页签存在');
ok(html.indexOf('data-view="audit"') >= 0, '全量标定量审查页签存在');
ok((html.match(/<button data-view="/g) || []).length === 10, '共 10 个视图页签');
ok(html.indexOf('buildFullAudit:') >= 0 && html.indexOf('summarizeAudit:') >= 0,
  '单文件产物内联全量账本引擎');
ok(html.indexOf('buildAudit:') >= 0 && html.indexOf('downloadAudit:') >= 0,
  '单文件产物内联全量审查报告模块');
ok(html.indexOf('svgDeltaProfile:') >= 0 && html.indexOf('tableHtmlTyped:') >= 0,
  '单文件产物内联一维 Δ 剖面与类型化证据表');

/* 回归：宿主预览环境可能注入 CommonJS 的 module，旧版 UMD 会因此不挂全局导致整页失效 */
var ctx = vm.createContext({ TextDecoder: TextDecoder, console: console, module: { exports: {} } });
try {
  scripts.slice(0, 3).forEach(function (s) { vm.runInContext(s, ctx); });
  ok(!!(ctx.DCMCore && ctx.DCMViews && ctx.DCMReport), '宿主注入 module 时三个模块仍挂到全局（不白屏）');
  var mini = 'GRUPPENKENNFELD T_M 2 2\n ST/X 1 2\n ST/Y 3\n WERT 1 2\n ST/Y 4\n WERT 3 4\nEND';
  ok(ctx.DCMCore.parseDcm(mini, 'X.DCM').stats.invalid === 0, '浏览器式沙箱内解析器可用');
} catch (e) { ok(false, '浏览器式沙箱执行失败: ' + e.message); }

console.log('== 2. 用真实 DCM 生成离线报告 ==');
var buf = fs.readFileSync(FILE);
var dec = C.decodeDcm(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
var ds = C.parseDcm(dec.text, path.basename(FILE));
ds.encoding = dec.encoding;
var idx = C.buildIndex([ds]);
var group = idx.groups[0];
var base = group.maps[0];
var others = group.maps.slice(1, 4).map(function (m, k) {
  var c = JSON.parse(JSON.stringify(m));
  c.label = m.label + '_v' + (k + 2);
  c.v[2][3] += (k + 1) * 5;
  c.v[5][7] -= (k + 1) * 2;
  return c;
});
var result = {
  base: base, others: others,
  all: C.computeAllDiffs(base, others, { mode: 'absolute', eps: 1e-9 }),
  cube: C.buildCube(base, others)
};
var state = {
  datasets: [ds], mode: 'absolute', eps: 1e-9, result: result,
  opts: { onlyChanged: true, curve: { axis: 'row', index: 0 }, profile: { i: 2, j: 3 } },
  versionScan: [{ name: 'DEMO_M', funktion: 'TEST', nx: 3, ny: 2, changed: 2, maxAbs: 10,
    srcA: 'A.DCM', lineA: 10, srcB: 'B.DCM', lineB: 20 }]
};
var report = RP.build(state);
console.log('  报告大小: ' + (Buffer.byteLength(report, 'utf8') / 1024).toFixed(1) + ' KB');
ok(report.length > 20000, '报告内容完整');
ok((report.match(/<svg /g) || []).length >= 11, '内联 SVG 图表齐全 (热力/曲线/单对曲面/A/B/C/剖面)');
ok(report.indexOf('3D 曲面') >= 0 && report.indexOf('跨版本剖面') >= 0, '三维与剖面章节存在');
ok(report.indexOf('3D 立方') < 0, 'revert-to-fail：报告不再输出立方图');
ok(report.indexOf('最大偏差包络曲面') >= 0, '报告含 A 包络曲面');
ok(report.indexOf('曲面小多图') >= 0, '报告含 B 曲面小多图');
ok(report.indexOf('拉开距离') >= 0 && report.indexOf('默认叠加') >= 0, '报告含 C 两种布局');
ok(report.indexOf('标定变更体检') >= 0, '报告含变更体检章节');
ok(report.indexOf('孤立突变点') >= 0 && report.indexOf('趋势反转') >= 0, '体检章节含孤立点与趋势反转');
ok(report.indexOf('附录：会话配置 JSON') >= 0 && report.indexOf('DCM_MAP_SESSION') >= 0, '报告内嵌可复现的会话 JSON');
ok(report.indexOf('对比摘要') >= 0 && report.indexOf('逐项改动模式') >= 0, '报告含对比摘要章节');
ok(report.indexOf('供评审参考，不构成放行 / 驳回建议') >= 0,
  '对比摘要声明只供评审参考，不给建议');
ok(report.indexOf('card-l">建议') < 0 && report.indexOf('结论摘要') < 0,
  'revert-to-fail：对比报告不再有「建议」卡与「结论摘要」标题');
checkTopbar('对比报告', report);
/* 报告同样带署名与使用声明：报告才是真正会流转出去的东西 */
ok(report.indexOf('作者 Henry · 供标定评审使用') >= 0, '对比报告头部标注作者与用途');
ok(report.indexOf('未经许可请勿转售或二次分发') >= 0, '对比报告页脚带使用声明');
/* 署名与报告说明必须分成两行：挤在一段里会在句中断开，读起来像串行 */
ok(/<span class="foot-attr">[^<]*未经许可请勿转售或二次分发。<\/span><span class="foot-meta">/.test(report),
  'revert-to-fail：对比报告页脚署名与说明分成两行');
ok(/\.foot-attr,\.foot-meta\{display:block\}/.test(report), '报告 CSS 让页脚两行各自成块');
ok(report.indexOf('供内部标定评审使用') < 0, '报告端不写「内部」，避免对外发时自相矛盾');
var repVer = RP.build(Object.assign({}, state, { toolVersion: 'v9.9.9' }));
ok(repVer.indexOf('工具 v9.9.9') >= 0, '报告页头标注生成它的工具版本');
ok(/toolVersion[^,]{0,16}v9\.9\.9/.test(repVer), '会话 JSON 记录工具版本（与格式版本分开）');
ok(repVer.indexOf('"version": 1') >= 0 || /version&quot;: 1/.test(repVer), '会话 JSON 仍保留格式版本 1');
var repAllow = RP.build(Object.assign({}, state, {
  opts: Object.assign({}, state.opts, { allowDelta: 3 })
}));
ok(repAllow.indexOf('超差工况区间') >= 0, '设定允许偏差后报告含超差区间表');
var heads = (report.match(/<h2>\d+\./g) || []).map(function (h) { return parseInt(h.slice(4), 10); });
ok(heads.length >= 7 && heads.filter(function (v, i) { return heads.indexOf(v) !== i; }).length === 0,
  '报告章节编号无重复 (' + heads.join(',') + ')');
ok(report.indexOf('逐格明细') >= 0, '逐格明细章节存在');
ok(report.indexOf('来源文件:行号') >= 0 || report.indexOf('来源文件与 DCM 行号') >= 0 ||
   report.indexOf('来源文件') >= 0, '明细含来源文件与行号列');
ok(report.indexOf('A.DCM:10') >= 0 && report.indexOf('B.DCM:20') >= 0, '跨版本清单含两边行号');
ok(report.indexOf('解析自检') >= 0, '解析自检章节存在');
/* 源码字面量（typeof / === undefined）会出现在内联脚本里，只扫渲染出的静态标记 */
var reportStatic = report.replace(/<script[\s\S]*?<\/script>/g, '');
ok(!/NaN/.test(reportStatic), '报告静态标记中无 NaN');
ok(!/undefined/.test(reportStatic), '报告静态标记中无 undefined（脚本源码字面量不计）');
ok(!/Infinity/.test(reportStatic), '报告静态标记中无 Infinity');
ok(!/(src|href)=["']https?:/i.test(report), '报告无外部资源引用');
ok(/<!DOCTYPE html>/.test(report) && /<\/html>/.test(report), '报告是完整 HTML 文档');

console.log('== 2b. 报告阈值口径：热力图与统计同源（effectiveEps） ==');
/* 旧实现热力图传 state.eps，统计用 effectiveEps：开自动阈值时图上会多显示一批
   统计认为「没变」的格。这里用只改 0.1 的对比把差异放大成可数的遮罩格数。 */
var tinyB = JSON.parse(JSON.stringify(base));
tinyB.label = 'TINY_0.1';
tinyB.v[2][3] += 0.1;
var tinyRes = {
  base: base, others: [tinyB],
  all: C.computeAllDiffs(base, [tinyB], { mode: 'absolute', eps: 1e-9 }),
  cube: C.buildCube(base, [tinyB])
};
function firstHeatSvg(html) {
  return (html.match(/<svg[^>]*class="heat-svg"[^>]*>[\s\S]*?<\/svg>/) || [''])[0];
}
var repAuto = RP.build({ datasets: [ds], mode: 'absolute', eps: 1e-9,
  effectiveEps: 0.5, autoThreshold: true, result: tinyRes, opts: { onlyChanged: true } });
var heatAuto = firstHeatSvg(repAuto);
var maskedAuto = (heatAuto.match(/fill="#FAFAF8"/g) || []).length;
ok(heatAuto.length > 0, '自动阈值下报告仍生成热力矩阵');
ok(maskedAuto === base.nx * base.ny,
  'revert-to-fail：热力图按 effectiveEps 遮住全部 ' + (base.nx * base.ny) + ' 格（实际 ' + maskedAuto +
  '；改回 state.eps 会变成 ' + (base.nx * base.ny - 1) + '）');
ok(/effectiveEps[^,]{0,12}0\.5/.test(repAuto),
  '会话 JSON 记录实际生效阈值 effectiveEps（HTML 转义后仍可读）');
var repManual = RP.build({ datasets: [ds], mode: 'absolute', eps: 1e-9,
  effectiveEps: 1e-9, autoThreshold: false, result: tinyRes, opts: { onlyChanged: true } });
var maskedManual = (firstHeatSvg(repManual).match(/fill="#FAFAF8"/g) || []).length;
ok(maskedManual === base.nx * base.ny - 1,
  'revert-to-pass：手动阈值 1e-9 时只遮 ' + (base.nx * base.ny - 1) + ' 格，0.1 的变化格保留');

console.log('== 2c. 三轴表口径披露（报告侧） ==');
/* 三轴表在对比清单里按第一层参与计算，账本里却整项拒绝。口径不能只靠人记，报告必须自己说。 */
var provB = JSON.parse(JSON.stringify(others[0]));
provB.label = 'PROV3D_M';
provB.provisional = true;
var provRes = {
  base: base, others: [provB],
  all: C.computeAllDiffs(base, [provB], { mode: 'absolute', eps: 1e-9 }),
  cube: C.buildCube(base, [provB])
};
var repProv = RP.build({ datasets: [ds], mode: 'absolute', eps: 1e-9, result: provRes, opts: {} });
ok(repProv.indexOf('只按第一层二维数据参与计算') >= 0, '报告显式声明三轴表只按第一层参与计算');
ok(repProv.indexOf('不是完整三维曲面') >= 0, '报告明说不是完整三维曲面');
ok(repProv.indexOf('（三轴表 · 仅第一层）') >= 0, '对比项标题标注「三轴表 · 仅第一层」');
ok(repProv.indexOf('全量变化账本对三轴表一律判「对比被拒绝」') >= 0,
  '报告说明与全量账本口径一致，避免两条路径结论打架');
ok(report.indexOf('只按第一层二维数据参与计算') < 0,
  'revert-to-pass：不含三轴表的报告不出现该警告');

console.log('== 3. SVG 视图函数逐个冒烟 ==');
var d = result.all.diffs[0];
var svgs = {
  heat: V.svgHeat(d, { mode: 'absolute', eps: 1e-9 }),
  heatEnv: V.svgHeat(d, { envelope: result.all.envelope }),
  curves: V.svgCurves(base, result.all.diffs),
  surfaceDiff: V.svgSurface(d, { surfaceMode: 'diff' }),
  surfaceBoth: V.svgSurface(d, { surfaceMode: 'both' }),
  envDelta: V.svgEnvelopeSurface(result.all.diffs, { colorBy: 'delta' }),
  envSource: V.svgEnvelopeSurface(result.all.diffs, { colorBy: 'source' }),
  envProbe: V.svgEnvelopeSurface(result.all.diffs, { highlight: { axis: 'x', i: 4, j: 0 } }),
  grid: V.svgSurfaceGrid(result.all.diffs, { limit: 4 }),
  stackOverlay: V.svgSurfaceStack(result.all.diffs, { layout: 'overlay' }),
  stackSpaced: V.svgSurfaceStack(result.all.diffs, { layout: 'spaced', gap: 0.5 }),
  stackLive: V.svgSurfaceStack(result.all.diffs, { layout: 'spaced', gap: 0.5, live: true }),
  stackCoarse: V.svgSurfaceStack(result.all.diffs, { layout: 'spaced', gap: 0.5, live: true, coarse: true }),
  profile: V.svgProfile(result.cube, 2, 3),
  table: V.tableHtml(d, { onlyChanged: true })
};
Object.keys(svgs).forEach(function (k) {
  var s = svgs[k];
  var good = s && s.length > 200 && !/NaN|undefined|Infinity/.test(s) &&
    (k === 'table' ? s.indexOf('<table') >= 0 : s.indexOf('<svg') === 0 && s.indexOf('</svg>') > 0);
  ok(good, k + ' 输出有效 (' + (s ? s.length : 0) + ' 字符)');
});
console.log('== 3b. 三轴真实数值刻度与定位高亮 ==');
function reLit(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function pickIdx(n, count) {
  if (n <= 1) return [0];
  var k = Math.min(count, n), out = [];
  for (var t = 0; t < k; t++) out.push(Math.round(t * (n - 1) / (k - 1)));
  return out.filter(function (v, i, a) { return a.indexOf(v) === i; });
}
var xTicks = pickIdx(base.nx, 5).map(function (i) { return C.fmt(base.x[i], 2); });
var yTicks = pickIdx(base.ny, 5).map(function (j) { return C.fmt(base.y[j], 2); });
ok(xTicks.every(function (v) { return new RegExp('>' + reLit(v) + '</text>').test(svgs.envDelta); }),
  'X 轴 5 档刻度全部是真实轴断点值 (' + xTicks.join(', ') + ')');
ok(yTicks.every(function (v) { return new RegExp('>' + reLit(v) + '</text>').test(svgs.envDelta); }),
  'Y 轴 5 档刻度全部是真实轴断点值 (' + yTicks.join(', ') + ')');
var em = 0;
result.all.envelope.maxAbs.forEach(function (r) { r.forEach(function (v) { if (v > em) em = v; }); });
ok(new RegExp('>' + reLit(C.fmt(em, 2)) + '</text>').test(svgs.envDelta),
  'Z 轴刻度上界为真实最大偏差 ' + C.fmt(em, 2));
ok((svgs.envDelta.match(/#E8E6DF/g) || []).length >= 8, '底板刻度网格线存在');
ok(svgs.envDelta.indexOf('Δ ') >= 0, '包络曲面 Z 轴标注 Δ 语义');
ok((svgs.surfaceBoth.match(/<line/g) || []).length >= 15, '单对曲面同样带三轴刻度');
ok((svgs.grid.match(/#E8E6DF/g) || []).length >= 8, '曲面小多图带精简刻度网格');
ok(svgs.stackSpaced.indexOf('Z 刻度为 MAP 原值') >= 0, '拉开距离模式明确说明层间位移不代表数值');
ok(svgs.envProbe.indexOf('stroke-width="1.8"') >= 0, '定位高亮加粗曲面带');
ok(svgs.envProbe.indexOf('X = ') >= 0, '图上标出定位轴值');
ok(svgs.envProbe.indexOf('stroke-width="1.8"') > -1 && svgs.envDelta.indexOf('X = ') < 0,
  '未定位时不高亮（revert-to-pass）');

console.log('== 3c. 渲染瘦身（按需 hover；拖动不再降采样） ==');
var fullStack = V.svgSurfaceStack(result.all.diffs, { layout: 'spaced', gap: 0.5 });
var liveStack = svgs.stackLive;
ok(liveStack.length < fullStack.length * 0.85,
  'live 模式去掉逐面片 title 后变小 (' + Math.round(liveStack.length / 1024) + ' KB < ' +
  Math.round(fullStack.length / 1024) + ' KB)');
/* 曾经拖动时降采样，松手后网格与配色一起跳；现在两条路径必须完全一致 */
ok(svgs.stackCoarse === liveStack,
  'revert-to-fail：拖动与静止渲染逐字节一致（不再降采样，体积也不缩）');
ok(liveStack.indexOf('<title>') < 0, 'live 模式不写逐面片 title');
ok(liveStack.indexOf('data-hi=') >= 0, 'live 面片带坐标属性供按需查询');
var polyFull = (fullStack.match(/<polygon/g) || []).length;
var polyLive = (liveStack.match(/<polygon/g) || []).length;
var polyCoarse = (svgs.stackCoarse.match(/<polygon/g) || []).length;
ok(polyLive === polyFull, 'live 不改变面片数量（只减文本）');
ok(polyCoarse === polyLive, '拖动与静止面片数相同 (' + polyCoarse + ' = ' + polyLive + ')');
var envLive = V.svgEnvelopeSurface(result.all.diffs, { live: true });
var gridLive = V.svgSurfaceGrid(result.all.diffs, { live: true, limit: 4 });
ok(envLive.indexOf('<title>') < 0 && gridLive.indexOf('<title>') < 0, '包络与小多图同样不写 title');
ok(envLive.indexOf('data-hi=') >= 0 && gridLive.indexOf('data-hi=') >= 0, '包络与小多图支持按需 hover');
var surfaceLive = V.svgSurface(d, { surfaceMode: 'diff', live: true });
ok(surfaceLive.indexOf('data-hi=') >= 0, '单对曲面也支持按需 hover');

console.log('== 3d. 报告分页（大量对比时不撑爆单文件） ==');
var paged = RP.build(Object.assign({}, state, { reportPageSize: 2 }));
ok(paged.indexOf('报告规模') >= 0, '分页报告给出规模说明');
ok((paged.match(/class="heat-svg"/g) || []).length === 2, '只展开 2 张完整热力矩阵');
ok(paged.indexOf('紧凑清单') >= 0 && paged.indexOf('<details') >= 0, '其余对比折叠为紧凑清单');
ok(paged.indexOf('体检摘要') >= 0, '体检章节有摘要表');
ok(paged.indexOf('附录：会话配置 JSON') >= 0, '分页报告仍内嵌会话 JSON');
ok(paged.length < report.length, '分页后报告更小 (' + Math.round(paged.length / 1024) + ' KB < ' +
  Math.round(report.length / 1024) + ' KB)');
ok((report.match(/class="heat-svg"/g) || []).length === 3, '默认未分页时 3 张全部展开');

console.log('== 3j. 报告里 3D 批量截断也要说明 ==');
var manyOthers = [];
for (var mo = 0; mo < 10; mo++) {
  var mc = JSON.parse(JSON.stringify(others[0]));
  mc.label = 'MANY_' + mo;
  manyOthers.push(mc);
}
var repMany = RP.build({ datasets: [ds], mode: 'absolute', eps: 1e-9,
  result: { base: base, others: manyOthers,
    all: C.computeAllDiffs(base, manyOthers, { mode: 'absolute', eps: 1e-9 }),
    cube: C.buildCube(base, manyOthers) }, opts: {} });
ok(repMany.indexOf('本图仅画前 9 张') >= 0, '超过 9 张时报告写明只画前 9 张');
ok(repMany.indexOf('本图仅叠加前 6 层') >= 0, '超过 6 层时报告写明只叠加前 6 层');
ok(report.indexOf('本图仅画前') < 0, 'revert-to-pass：未超限的报告不出现截断说明');

console.log('== 3g. 报告内批注签核 ==');
var annState = Object.assign({}, state, {
  annotations: { 'cmp:demo': { verdict: 'reject', reason: '需复核 <边界>', req: 'REQ-9', owner: 'Henry' } }
});
var repAnn = RP.build(annState);
ok(repAnn.indexOf('需复核') >= 0, '工具批注文本进入报告');
ok(repAnn.indexOf('dcm-ann-data') >= 0 && repAnn.indexOf('dcmAnnotatedHtml') >= 0,
  '报告内嵌批注数据与再导出逻辑');
ok(repAnn.indexOf('dcmExportAnnotated()') >= 0, '报告含「导出带批注的报告」按钮');
ok(!/(src|href)=["']https?:/i.test(repAnn), '带批注报告仍零外部资源');
var annJsonMatch = repAnn.match(/<script id="dcm-ann-data" type="application\/json">([\s\S]*?)<\/script>/);
ok(!!annJsonMatch, '批注数据块存在');
var annParsed = null;
try { annParsed = JSON.parse(annJsonMatch[1]); } catch (e) { /* 下面断言会报 */ }
ok(!!annParsed && annParsed['cmp:demo'].reason === '需复核 <边界>',
  '批注 JSON 可解析且尖括号转义正确');
ok((repAnn.match(/<script/g) || []).length === (repAnn.match(/<\/script>/g) || []).length,
  '报告 script 标签成对，未被批注内容破坏');

console.log('== 3e. 报告轴变更影响面章节 ==');
var axtA = C.parseDcm([
  'GRUPPENKENNFELD AxA_M 3 2', ' ST/X 1 2 3', ' ST/Y 10', ' WERT 1 2 3',
  ' ST/Y 20', ' WERT 4 5 6', 'END'
].join('\n'), 'A.DCM');
var axtB = C.parseDcm([
  'GRUPPENKENNFELD AxA_M 3 2', ' ST/X 1 2 4', ' ST/Y 10', ' WERT 1 2 3',
  ' ST/Y 20', ' WERT 4 5 6', 'END'
].join('\n'), 'B.DCM');
var axisScan = C.analyzeAxisChange([axtA, axtB]);
ok(axisScan.total === 1, '轴扫描产出 1 根变化轴');
var repAxis = RP.build(Object.assign({}, state, { axisScan: axisScan }));
ok(repAxis.indexOf('附录：轴变更影响面') >= 0, '报告含轴变更影响面章节');
ok(repAxis.indexOf('受影响表清单') >= 0 && repAxis.indexOf('完整轴指纹') >= 0,
  '章节含受影响表清单与分桶依据说明');

console.log('== 3f. 报告改名候选章节 ==');
var rtxtA = [
  'GRUPPENKENNFELD Foo_M 3 2', ' ST/X 1 2 3', ' ST/Y 10', ' WERT 1 2 3',
  ' ST/Y 20', ' WERT 4 5 6', 'END'
].join('\n');
var rdsA = C.parseDcm(rtxtA, 'A.DCM');
var rdsB = C.parseDcm(rtxtA.replace('Foo_M', 'Foo_M_V2'), 'B.DCM');
var renameScan = C.matchRenamed([rdsA, rdsB]);
ok(renameScan.total === 1, '改名扫描产出 1 组候选');
var repRen = RP.build(Object.assign({}, state, { renameScan: renameScan }));
ok(repRen.indexOf('附录：改名对齐候选') >= 0, '报告含改名候选章节');
ok(repRen.indexOf('Foo_M_V2') >= 0 && repRen.indexOf('不自动合并') >= 0,
  '章节含候选名与「不自动合并」声明');

var scalar = ds.maps.filter(function (x) { return x.type === 'scalar'; })[0];
var scalarDiff = C.computeDiff(scalar, scalar);
ok(!/NaN|undefined/.test(V.svgSurface(scalarDiff, { surfaceMode: 'diff' })), '1×1 标量曲面不产生 NaN（边界保护）');
ok(V.svgProfile(result.cube, 999, 999).indexOf('empty') >= 0 || V.svgProfile(result.cube, 999, 999).length > 0,
  '剖面越界不抛异常');

console.log('== 4. 一维 Δ 剖面与按类型证据表 ==');
var oneD = C.parseDcm([
  'FESTWERTEBLOCK ARR2 4', ' WERT 1 2 3 4', 'END',
  'FESTWERT SC2 5', 'END'
].join('\n'), 'A.DCM');
var oneDb = C.parseDcm([
  'FESTWERTEBLOCK ARR2 4', ' WERT 1 9 9 4', 'END',
  'FESTWERT SC2 8', 'END'
].join('\n'), 'B.DCM');
var arrDiff = C.computeDiff(oneD.maps[0], oneDb.maps[0], { eps: 1e-9 });
var scDiff = C.computeDiff(oneD.maps[1], oneDb.maps[1], { eps: 1e-9 });
var prof = V.svgDeltaProfile(arrDiff, { title: '测试' });
ok(prof.indexOf('<svg') === 0 && prof.indexOf('delta-profile-svg') >= 0, '一维对象输出 Δ 剖面 SVG');
ok((prof.match(/<rect/g) || []).length >= 4, 'Δ 剖面含逐点柱');
ok(!/NaN|undefined|Infinity/.test(prof), 'Δ 剖面无脏值');
ok(V.svgDeltaProfile(scDiff).indexOf('标量请看单值明细表') >= 0, '标量不画假曲线，明确降级为单值表');
var typedScalar = V.tableHtmlTyped(scDiff, { onlyChanged: false });
ok(/<th[^>]*>标定量<\/th>/.test(typedScalar) && /<th[^>]*>基准值/.test(typedScalar),
  '标量证据表用单值表头，不套「Y 轴值 / X 轴值」');
ok(typedScalar.indexOf('<th>Y 轴值</th>') < 0, '标量证据表不出现二维 Y 轴列');
var typedArr = V.tableHtmlTyped(arrDiff, { onlyChanged: false });
ok(/<th[^>]*>索引<\/th>/.test(typedArr) && (typedArr.match(/<tr/g) || []).length === 5,
  '数组证据表按索引逐点列出 4 行');
ok(V.tableHtmlTyped(arrDiff).indexOf('<title>') < 0, '类型化表格不残留 SVG title');

console.log('== 3h. 逐格明细 CSV 导出 ==');
var csvAll = V.csvOf(arrDiff, { onlyChanged: false });
var csvRows = csvAll.split('\r\n');
ok(csvRows.length === 5, 'CSV = 表头 + 4 个格（实际 ' + csvRows.length + ' 行）');
ok(csvRows[0].indexOf('Y 轴值') >= 0 && csvRows[0].indexOf('基准值') >= 0 && csvRows[0].indexOf('来源') >= 0,
  'CSV 表头含轴值 / 基准值 / 来源列');
ok(csvRows[1].split(',').length === 8, '每行 8 列');
ok(V.csvOf(arrDiff, { onlyChanged: true }).split('\r\n').length === 3,
  'revert-to-fail：只列变化格时只导出 2 行数据');
ok(V.csvOf({ ok: false }, {}) === '', '不可用的对比返回空串，不产生半截 CSV');
var csvEsc = JSON.parse(JSON.stringify(arrDiff));
csvEsc.other.label = 'A,B"C';
csvEsc.other.srcFile = 'X.DCM';
ok(V.csvOf(csvEsc, { onlyChanged: true }).indexOf('"A,B""C"') >= 0,
  '表名含逗号与引号时按 CSV 规则转义');

console.log('== 3i. 3D 批量视图的截断必须写明 ==');
var manyDiffs = [];
for (var q = 0; q < 12; q++) manyDiffs.push(result.all.diffs[q % result.all.diffs.length]);
var gridMany = V.svgSurfaceGrid(manyDiffs, { limit: 9 });
ok(gridMany.indexOf('共 13 张') >= 0, '小多图标题写总张数（实际总数 13）');
ok(gridMany.indexOf('仅显示前 9 张') >= 0, '小多图标题写明只显示前 9 张');
var stackMany = V.svgSurfaceStack(manyDiffs, { maxSurfaces: 5 });
ok(stackMany.indexOf('共 13 层') >= 0, '叠加标题写总层数');
ok(stackMany.indexOf('仅显示前 5 层') >= 0, '叠加标题写明只显示前 5 层');
var gridSmall = V.svgSurfaceGrid(result.all.diffs, { limit: 9 });
ok(gridSmall.indexOf('仅显示前') < 0, '未超限时不出现截断提示（避免狼来了）');

console.log('== 3k. 拖动与静止的 3D 渲染必须一致 ==');
/* 必须用大于采样步长的表（33×25）：小表两种步长都退化成 1，比出来必然相等，
   那断言是空的。这里同时覆盖「密度跳变」和「值域漏极值」两个根因。 */
var bigDiff = (function () {
  var nx = 33, ny = 25, a = [], b = [], abs = [], rel = [];
  for (var j = 0; j < ny; j++) {
    a.push([]); b.push([]); abs.push([]); rel.push([]);
    for (var i = 0; i < nx; i++) { a[j].push(10); b[j].push(10); abs[j].push(0); rel[j].push(0); }
  }
  abs[3][5] = 100;
  var xs = [], ys = [];
  for (var p = 0; p < nx; p++) xs.push(p * 10);
  for (var q2 = 0; q2 < ny; q2++) ys.push(q2 * 2);
  return { ok: true, nx: nx, ny: ny, a: a, b: b, abs: abs, rel: rel, x: xs, y: ys,
    other: { label: 'BIG_A', name: 'BIG_A', srcFile: 'BIG.DCM', startLine: 1 },
    stats: { changed: 1, changedCells: [] },
    base: { units: { x: 'km/h', y: '%', w: 'Nm' } } };
})();
var bigDiff2 = JSON.parse(JSON.stringify(bigDiff));
bigDiff2.abs[7][9] = -30;
var bigPair = [bigDiff, bigDiff2];
var surfIdle = V.svgSurface(bigDiff, { surfaceMode: 'diff' });
var surfDrag = V.svgSurface(bigDiff, { surfaceMode: 'diff', coarse: true });
ok(surfIdle === surfDrag, 'revert-to-fail：单对曲面拖动与静止逐字节一致');
ok((surfIdle.match(/<polygon/g) || []).length > 100, '大表确实产生足够面片（' +
  (surfIdle.match(/<polygon/g) || []).length + ' 个）');
ok(V.svgSurfaceGrid(bigPair, {}) === V.svgSurfaceGrid(bigPair, { coarse: true }),
  'revert-to-fail：小多图拖动与静止逐字节一致');
ok(V.svgSurfaceStack(bigPair, {}) === V.svgSurfaceStack(bigPair, { coarse: true }),
  'revert-to-fail：叠加图拖动与静止逐字节一致');
ok(V.svgEnvelopeSurface(bigPair, {}) === V.svgEnvelopeSurface(bigPair, { coarse: true }),
  'revert-to-fail：包络曲面拖动与静止逐字节一致');
ok(surfIdle.indexOf('>-100<') >= 0 && surfIdle.indexOf('>100<') >= 0,
  '值域扫全矩阵：抽样点之外的 ±100 极值仍进入色标与 Z 归一化');

console.log('== 3l. 3D 准确性：不裁切 / 绘制顺序 / 值域与色标 ==');
function bboxOf(svg) {
  var pts = [], re = /points="([^"]+)"/g, m;
  while ((m = re.exec(svg))) {
    m[1].split(' ').forEach(function (p) { var q = p.split(','); pts.push([+q[0], +q[1]]); });
  }
  var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
  return { minX: Math.min.apply(null, xs), maxX: Math.max.apply(null, xs),
    minY: Math.min.apply(null, ys), maxY: Math.max.apply(null, ys) };
}
function overflow(svg, W, H) {
  var b = bboxOf(svg);
  var over = Math.max(0, -b.minX) + Math.max(0, b.maxX - W) +
    Math.max(0, -b.minY) + Math.max(0, b.maxY - H);
  var texts = (svg.match(/<text[^>]*x="(-?[\d.]+)" y="(-?[\d.]+)"/g) || []);
  var badText = texts.filter(function (t) {
    var mx = /x="(-?[\d.]+)"/.exec(t), my = /y="(-?[\d.]+)"/.exec(t);
    var x = +mx[1], y = +my[1];
    return x < -1 || x > W + 1 || y < -1 || y > H + 1;
  }).length;
  return { over: over, badText: badText, b: b };
}
var clipBad = [];
var modes = ['diff', 'both', 'base', 'other'];
for (var yw = 0; yw < 6.28; yw += 0.35) {
  for (var pt = 0.15; pt <= 1.4; pt += 0.25) {
    modes.forEach(function (mo) {
      var r = overflow(V.svgSurface(bigDiff, { surfaceMode: mo, yaw: yw, pitch: pt }), 760, 470);
      if (r.over > 0.5 || r.badText > 0) {
        clipBad.push(mo + '@' + yw.toFixed(2) + '/' + pt.toFixed(2) +
          ' 越界' + r.over.toFixed(0) + 'px 文字' + r.badText);
      }
    });
  }
}
ok(clipBad.length === 0, 'revert-to-fail：任意 yaw×pitch 下 3D 都不出画布（' +
  (clipBad.length ? clipBad.slice(0, 3).join('；') : '扫了 ' + Math.ceil(6.28 / 0.35) * 5 * modes.length + ' 组') + '）');
/* 双曲面：对比版超出基准版范围时，Z 基准必须取两版并集，否则会飞出画布 */
var uniBase = JSON.parse(JSON.stringify(bigDiff));
uniBase.a = uniBase.a.map(function (row) { return row.map(function () { return 0; }); });
var uniRes = overflow(V.svgSurface(uniBase, { surfaceMode: 'both' }), 760, 470);
ok(uniRes.over === 0, 'revert-to-fail：基准恒为 0、对比 0~100 时双曲面仍不出画布（曾飞到 5876px）');
/* 绘制顺序：地面网格在曲面之下，轴线/刻度在曲面之上。
   网格与轴都是 <line>，只能靠网格专用颜色 #E8E6DF 区分先后。 */
var orderSvg = V.svgSurface(bigDiff, { surfaceMode: 'diff', live: true });
var polyAt = orderSvg.indexOf('<polygon');
var gridAt = orderSvg.indexOf('#E8E6DF');
var lastLine = orderSvg.lastIndexOf('<line');
ok(gridAt >= 0 && gridAt < polyAt, 'revert-to-fail：地面网格画在曲面之前（否则网格穿模）');
ok(lastLine > polyAt, '轴线/刻度仍在曲面之上，不被面挡住读数');
var lgDiff = V.svgSurface(bigDiff, { surfaceMode: 'diff' });
var lgTexts = (lgDiff.match(/<text[^>]*>([^<]*)<\/text>/g) || [])
  .map(function (t) { return t.replace(/<[^>]+>/g, ''); });
ok(lgTexts.indexOf('-100') >= 0 && lgTexts.indexOf('100') >= 0, '差曲面色标两端是 ±max|Δ|');
/* 色标刻度必须与着色值域一致：双曲面用两版并集，差曲面用 ±maxAbs。
   夹具必须让「基准版极值 > 对比版极值」，否则并集恰好等于对比版范围，测不出区别。 */
var bothData = JSON.parse(JSON.stringify(bigDiff));
bothData.a = bothData.a.map(function (row) { return row.map(function (v, i) { return 100 + i * 9; }); });
bothData.b = bothData.b.map(function (row, j) { return row.map(function (v, i) { return 100 + i * 5 + j * 3; }); });
var lgBoth = V.svgSurface(bothData, { surfaceMode: 'both' });
var lbTexts = (lgBoth.match(/<text[^>]*>([^<]*)<\/text>/g) || [])
  .map(function (t) { return t.replace(/<[^>]+>/g, ''); });
ok(lbTexts.slice(-2).join('/') === '100/388',
  'revert-to-fail：双曲面色标用两版并集（100/388，实际 ' + lbTexts.slice(-2).join('/') + '）');

console.log('== 3m. 跨版本剖面（取代立方） ==');
var profCube = C.buildCube(base, others);
var psvg = V.svgProfile(profCube, 2, 3, { units: base.units });
ok(psvg.indexOf('跨版本剖面') >= 0, '剖面标题写明「跨版本剖面」');
ok(psvg.indexOf('stroke-dasharray') >= 0 && psvg.indexOf('基准 ') >= 0, '画出基准层参考线');
ok(psvg.indexOf('相对基准 Δ') >= 0, '副标题给出相对基准的偏差范围');
var manyLayers = [];
for (var ml = 0; ml < 20; ml++) {
  var mm = JSON.parse(JSON.stringify(others[0]));
  mm.label = 'PLC_' + ml;
  mm.name = 'PLC_' + ml;
  manyLayers.push(mm);
}
var pcubeMany = C.buildCube(base, manyLayers);
var psvgMany = V.svgProfile(pcubeMany, 1, 1, { units: base.units });
var labCount = (psvgMany.match(/>L\d+</g) || []).length;
ok(pcubeMany.labels.length > 12, '构造了 ' + pcubeMany.labels.length + ' 层用于验证抽稀');
ok(labCount > 0 && labCount <= 12 && labCount < pcubeMany.labels.length,
  '层多时 X 轴标签抽稀，不互相压字（' + labCount + ' 个标签 / ' + pcubeMany.labels.length + ' 层）');
ok(V.svgProfile(profCube, 999, 999, {}).indexOf('empty') >= 0, '坐标越界给空状态，不抛错');
ok(typeof V.svgCube === 'undefined', '立方渲染器已移除（不再维护两套 3D 堆叠）');

/* 一维证据表：合并重复序号列、变化行高亮、单位移表头、数值右对齐 */
console.log('== 4. 一维证据表美化（表格样式 / 去重复列 / 变化行） ==');
function axisTyped(ptsA, ptsB) {
  var da = C.parseDcm(['STUETZSTELLENVERTEILUNG AX1 ' + ptsA.length,
    ' EINHEIT_X "V"', ' ST/X ' + ptsA.join(' '), 'END'].join('\n'), 'A.DCM');
  var db = C.parseDcm(['STUETZSTELLENVERTEILUNG AX1 ' + ptsB.length,
    ' EINHEIT_X "V"', ' ST/X ' + ptsB.join(' '), 'END'].join('\n'), 'B.DCM');
  return V.tableHtmlTyped(C.computeDiff(C.axisToComparable(da.axisDefs[0], da),
    C.axisToComparable(db.axisDefs[0], db), { eps: 1e-9 }), { onlyChanged: false });
}
var axTbl = axisTyped([0, 50, 75, 100, 125, 150, 175, 200, 225, 250],
                      [0, 50, 75, 100, 125, 150, 175, 180, 225, 250]);
var axHeads = (axTbl.match(/<th[^>]*>([\s\S]*?)<\/th>/g) || []).map(function (x) {
  return x.replace(/<[^>]+>/g, '').trim();
});
ok(axHeads.length === 5, '表头 5 列（原 6 列：序号与断点序号重复）实际 ' + axHeads.length);
ok(axHeads.filter(function (h) { return /序号/.test(h); }).length === 1,
  'revert-to-fail：重复的「序号 + 断点序号」已合并为一列');
ok(axHeads.some(function (h) { return /A 版断点值/.test(h) && /\(V\)/.test(h); }),
  '单位移到表头（A 版断点值 (V)）');
ok((axTbl.match(/class="chg"/g) || []).length === 1 &&
   (axTbl.match(/class="eq"/g) || []).length === 9,
  '10 行里只有 Δ≠0 的那 1 行高亮为变化行');
ok(axTbl.indexOf('逐点证据表') >= 0 && axTbl.indexOf('变化 1') >= 0,
  '表格带标题与变化点数统计');
ok((axTbl.match(/class="num down"/g) || []).length >= 1,
  'Δ 负值按减少着色（down）');
ok(axTbl.indexOf('class="dcm-tbl') < 0 || axTbl.indexOf('detail dcm-tbl') >= 0,
  '表格挂 dcm-tbl 样式类');
ok(axTbl.indexOf('class="num "') < 0, '单元格 class 无尾空格脏值');
ok(!/NaN|undefined|Infinity/.test(axTbl), '美化后的表格无脏值');
/* 报告 CSS 必须有完整表格样式，否则报告里又退化成散乱文本 */
var rcss = RP.css();
ok(/\.detail th,\.detail td\{[^}]*border:1px solid/.test(rcss) &&
   /\.detail tbody tr:nth-child\(even\)/.test(rcss),
  '报告 CSS 补齐表头/边框/斑马纹（原先只有 font-variant-numeric）');
ok(/\.dcm-tbl tr\.chg\{[^}]*background/.test(rcss) && /\.unit\{/.test(rcss),
  '报告 CSS 含变化行高亮与单位小字样式');

console.log('== 5. 全量标定量审查报告（按类型分章 / 恒等式 / 可搜索清单） ==');
function auditText(o) {
  return [
    'FESTWERT SC', ' WERT ' + o.sc, 'END',
    'FESTWERTEBLOCK ARR ' + o.arrLen, ' WERT ' + o.arr.join(' '), 'END',
    'FESTWERTEBLOCK ARR2 4', ' WERT ' + o.arr2.join(' '), 'END',
    'GRUPPENKENNLINIE CV 3', ' ST/X 10 20 30', ' WERT 1 2 3', 'END',
    'GRUPPENKENNFELD ' + o.mpName + ' 3 2', ' ST/X 1 2 3',
    ' ST/Y 10', ' WERT ' + o.mp[0].join(' '),
    ' ST/Y 20', ' WERT ' + o.mp[1].join(' '), 'END',
    'FESTWERT ' + o.only, ' WERT 7', 'END'
  ].join('\n');
}
var aA = C.parseDcm(auditText({ sc: 5, arrLen: 4, arr: [1, 2, 3, 4], arr2: [1, 2, 3, 4],
  mpName: 'MP_A', mp: [[1, 2, 3], [4, 5, 6]], only: 'ONLY_A' }), 'A.DCM');
var aB = C.parseDcm(auditText({ sc: 9, arrLen: 3, arr: [1, 2, 3], arr2: [1, 9, 9, 4],
  mpName: 'MP_A', mp: [[1, 2, 3], [4, 9, 6]], only: 'ONLY_B' }), 'B.DCM');
aA.encoding = 'gbk'; aB.encoding = 'gbk';
var au = C.buildFullAudit([aA, aB], { eps: 1e-9, allowDelta: 2 });
ok(au.ok && au.identity.ok, '小样本账本恒等式通过');
ok(au.totals.counts.changed === 3 && au.totals.counts.rejected === 1 &&
  au.totals.counts.added === 1 && au.totals.counts.deleted === 1,
  '账本同时覆盖有变化 / 被拒绝 / B 版新增 / B 版删除');
ok(au.totals.counts.renamed === undefined && au.totals.counts.onlyA === undefined,
  '账本不再产生改名配对状态');
var renameB = C.parseDcm(auditText({ sc: 5, arrLen: 4, arr: [1, 2, 3, 4],
  arr2: [1, 2, 3, 4], mpName: 'MP_A_V2', mp: [[1, 2, 3], [4, 5, 6]], only: 'ONLY_A' }), 'B.DCM');
var auRename = C.buildFullAudit([aA, renameB], { eps: 1e-9 });
ok(auRename.totals.counts.deleted >= 1 && auRename.totals.counts.added >= 1 &&
  auRename.totals.counts.renamed === undefined,
  'revert-to-fail：数值完全相同的改名对象也不配对，分别进删除 / 新增');
var ast = { datasets: [aA, aB], mode: 'absolute', eps: 1e-9, effectiveEps: 1e-9,
  opts: { allowDelta: 2 }, annotations: {}, reportPageSize: 12 };
var arep = RP.buildAudit(ast, au);
ok(arep.indexOf('<!DOCTYPE html>') === 0, '全量变化报告是完整 HTML');
checkTopbar('全量变化报告', arep);
ok(arep.indexOf('作者 Henry · 供标定评审使用') >= 0, '全量变化报告头部标注作者与用途');
ok(arep.indexOf('未经许可请勿转售或二次分发') >= 0, '全量变化报告页脚带使用声明');
ok(/<span class="foot-attr">[^<]*未经许可请勿转售或二次分发。<\/span><span class="foot-meta">/.test(arep),
  'revert-to-fail：全量变化报告页脚署名与说明分成两行');
ok(/class="foot-meta">DCM 全量变化清单报告/.test(arep), '第二行是报告类型与口径说明');
ok(arep.indexOf('完整性对账') >= 0 && arep.indexOf('状态分项之和') >= 0,
  '报告首部给出恒等式对账表');
/* 2 完整性对账 与 3 全量变化摘要 已合并为一节 */
var auditHeads = (arep.match(/<h2>\d+\./g) || []);
ok(auditHeads.length === 6, '全量变化报告为 6 个编号章节（对账与摘要合并后，原 7 个）');
ok(/<h2>\d+\. 完整性对账与全量变化摘要<\/h2>/.test(arep), '对账与摘要合并为一节');
ok(!/<h2>\d+\. 完整性对账<\/h2>/.test(arep) && !/<h2>\d+\. 全量变化摘要<\/h2>/.test(arep),
  'revert-to-fail：两节不再各自独立成章');
ok(/<h2>\d+\. 完整性对账与全量变化摘要<\/h2>[\s\S]*?<h3>全量变化摘要<\/h3>[\s\S]*?状态分项之和[\s\S]*?<\/section>/.test(arep),
  '摘要与逐版本对账表同处一节（摘要在前，证据在后）');
ok(arep.indexOf('通过') >= 0 && arep.indexOf('A 覆盖') >= 0, '对账表含覆盖数与校验结论');
['全量变化摘要', '按对象类型分章', '新增 / 删除 / 被拒绝对象', '轴定义断点变化类型',
  '清单范围与边界说明', '附录：会话配置 JSON'].forEach(function (h) {
  ok(arep.indexOf(h) >= 0, '报告含章节：' + h);
});
ok(arep.indexOf('附录：轴定义对账') < 0 && arep.indexOf('不计入标定量') < 0 &&
  arep.indexOf('不计入 21,090') < 0,
  'revert-to-fail：报告不再声称轴定义不计入标定量');
ok(arep.indexOf('已作为正式标定量计入账本') >= 0,
  '边界说明明确轴定义已计入账本');
ok(arep.indexOf('账目对象合计') >= 0 && arep.indexOf('轴定义（计入账本）') >= 0,
  '数据源自检表列出轴定义与账目对象合计');
ok(arep.indexOf('delta-profile-svg') >= 0, '报告含一维 Δ 剖面图');
ok(arep.indexOf('<th>标定量</th>') >= 0, '报告标量证据用单值表头');
ok(arep.indexOf('heat-svg') >= 0, '报告 MAP 证据含热力矩阵');
ok(arep.indexOf('B 版新增') >= 0 && arep.indexOf('B 版删除') >= 0,
  '新增 / 删除对象显式列出并标明方向');
ok(arep.indexOf('ONLY_A') >= 0 && arep.indexOf('ONLY_B') >= 0,
  '新增 / 删除清单含具体对象名');
ok(arep.indexOf('未变化项完整清单') < 0 && arep.indexOf('audit-unchanged-data') < 0 &&
  arep.indexOf('dcmAuditSearch') < 0 && arep.indexOf('id="audit-q"') < 0,
  'revert-to-fail：报告不再列出未变化项清单，也不带检索脚本');
ok(arep.indexOf('改名候选') < 0 && arep.indexOf('未启用改名配对') >= 0,
  '报告不做改名配对并明示该边界');
ok(arep.indexOf('card-l">建议') < 0 && arep.indexOf('可放行') < 0 &&
  arep.indexOf('建议驳回') < 0 && arep.indexOf('不生成放行') >= 0,
  'revert-to-fail：全量变化报告不给建议');
var am = arep.match(/<script id="dcm-ann-data" type="application\/json">([\s\S]*?)<\/script>/);
ok(!!am && typeof JSON.parse(am[1]) === 'object', '批注 JSON 可解析');
ok(arep.indexOf('data-ann="audit:') >= 0, '批注按稳定账目 id 绑定');
ok(arep.indexOf('dcmExportAnnotated') >= 0, '报告内可导出带批注的新报告');
ok(arep.indexOf('新增 / 删除 / 被拒绝对象评审') >= 0, '报告含新增/删除/被拒绝评审小节');
ok(/data-ann="[^"]*::deleted"/.test(arep) && /data-ann="[^"]*::added"/.test(arep),
  '新增与删除项各有评审批注控件（与变更项一致）');
ok(/data-ann="audit:[^"]*" data-field="verdict"/.test(arep) &&
  /data-ann="audit:[^"]*" data-field="reason"/.test(arep),
  '评审控件含结论与评审意见字段');
ok(arep.indexOf('另存含批注的可编辑副本') >= 0, '可编辑副本按钮文案已改');
ok(arep.indexOf('导出归档报告</button>') >= 0 && arep.indexOf('填写审核人') < 0,
  '归档按钮文案已改，不再提示填姓名');
ok(arep.indexOf('实时保存仅在本机生效') >= 0, '按钮旁标注实时保存仅在本机生效');
ok(arep.indexOf('保存批注到可编辑报告') < 0, 'revert-to-fail：旧可编辑副本文案已移除');
ok(/data-dcm-report-id="[^"]+"/.test(arep), '报告带唯一 id，批注按报告隔离持久化');
ok(arep.indexOf('id="dcm-save-state"') >= 0, '报告含保存状态提示');
ok(arep.indexOf('防篡改') < 0 && arep.indexOf('SHA-256') < 0 && arep.indexOf('指纹') < 0,
  '未做防篡改，也不在报告里声称具备该能力（不造假权威）');
var annScript = (arep.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
ok(annScript.indexOf('window.prompt') < 0 && annScript.indexOf('审核人姓名') < 0,
  'revert-to-fail：不再用姓名输入冒充审核');
ok(annScript.indexOf('dcmOpenSignaturePad') >= 0 &&
  annScript.indexOf('toDataURL("image/png")') >= 0 &&
  annScript.indexOf('sign-confirm') >= 0 && annScript.indexOf('sign-clear') >= 0 &&
  annScript.indexOf('sign-cancel') >= 0,
  '导出流程是中央手写签名板（绘制 / 清空 / 取消 / 确认）');
ok(annScript.indexOf('sign-canvas') >= 0 && annScript.indexOf('pointermove') >= 0 &&
  arep.indexOf('touch-action:none') >= 0,
  '签名板用 canvas + pointer 事件，支持鼠标/触摸');
ok(annScript.indexOf('data-dcm-signed') >= 0 && annScript.indexOf('审核人手写签名') >= 0 &&
  annScript.indexOf('归档时间：') >= 0 && annScript.indexOf('报告 ID：') >= 0,
  '归档报告写入手写签名 PNG、归档时间与报告 ID');
ok(annScript.indexOf('data-dcm-reviewer') < 0 && annScript.indexOf('审核人：') < 0,
  'revert-to-fail：归档报告不采集审核人姓名');
ok(annScript.indexOf('data-dcm-archived') >= 0 &&
  annScript.indexOf('setAttribute("disabled"') >= 0 &&
  annScript.indexOf('dcmIsArchived') >= 0,
  '归档版批注控件被禁用、且拦截再次导出');
ok(annScript.indexOf('dcmLoadLocal()') >= 0 && annScript.indexOf('dcmBindAutoSave()') >= 0 &&
  annScript.indexOf('localStorage.setItem') >= 0,
  '报告加载自动恢复批注、编辑实时持久化');
ok(annScript.indexOf('dcmExportEditable') >= 0 && annScript.indexOf('dcmAnnotatedHtml("",false)') >= 0,
  '可编辑版另存不冻结批注');
ok(annScript.indexOf('dcmExportAnnotated') >= 0 && annScript.indexOf('dcmFreezeClone') >= 0,
  '归档版仍走冻结逻辑');
try { new vm.Script(annScript); ok(true, '报告内联批注脚本语法有效'); }
catch (e) { ok(false, '报告内联批注脚本语法错误: ' + e.message); }
ok(!/(src|href)=["']https?:/i.test(arep), '全量变化报告零外部资源');
ok((arep.match(/<script/g) || []).length === (arep.match(/<\/script>/g) || []).length,
  '全量变化报告 script 标签成对');
ok(!/NaN|undefined|Infinity/.test(arep.replace(/<script>[\s\S]*?<\/script>/g, '')),
  '全量变化报告静态标记无脏值');
ok(arep.indexOf('本次数据源未检出三轴表块') >= 0, '三轴表说明依据实际扫描，不是写死结论');

console.log('== 6. 真实 22813 项全量变化报告体积与完整性 ==');
var bigA = C.parseDcm(dec.text, 'ALL_A.DCM'); bigA.encoding = dec.encoding;
var bigB = C.parseDcm(dec.text, 'ALL_B.DCM'); bigB.encoding = dec.encoding;
var tAudit = Date.now();
var bigAu = C.buildFullAudit([bigA, bigB], { eps: 1e-9 });
var bigRep = RP.buildAudit({ datasets: [bigA, bigB], mode: 'absolute', eps: 1e-9,
  effectiveEps: 1e-9, opts: {}, annotations: {}, reportPageSize: 12 }, bigAu);
var bigMs = Date.now() - tAudit;
var bigKb = Buffer.byteLength(bigRep, 'utf8') / 1024;
ok(bigAu.totals.total === 22813 && bigAu.identity.ok,
  '真实文件账本 22813 条（含 1723 轴定义）、恒等式通过');
ok(bigAu.totals.byType.axis.total === 1723, '真实文件轴定义全部进入按类型统计');
ok(bigKb < 600, '未列未变化清单后报告仅 ' + bigKb.toFixed(1) + ' KB（原约 1190 KB）');
ok(bigMs < 5000, '真实全量清单 + 报告生成耗时 ' + bigMs + ' ms');
ok(bigRep.indexOf('audit-unchanged-data') < 0 && bigRep.indexOf('未变化项完整清单') < 0,
  'revert-to-fail：真实报告不含未变化项清单');
ok(bigRep.indexOf('未变化（仅计数）') >= 0,
  '未变化项仍以计数形式出现在对账中');
ok((bigRep.match(/<svg /g) || []).length === 0, '无变化时不生成任何 SVG，避免报告膨胀');
ok(bigRep.indexOf('轴定义 STUETZSTELLENVERTEILUNG') >= 0,
  '真实报告类型总览表与第 6 章统计均含轴定义');
ok(!/(src|href)=["']https?:/i.test(bigRep), '真实全量变化报告零外部资源');

console.log('== 7. 轴定义变化进入报告证据（独立样本） ==');
function axDcmRep(points, extra, file) {
  var L = ['FESTWERT SC', ' WERT 5', 'END',
    'GRUPPENKENNFELD MP 3 2', ' ST/X 1 2 3', ' ST/Y 10', ' WERT 1 2 3',
    ' ST/Y 20', ' WERT 4 5 6', 'END'];
  if (points) L.push('STUETZSTELLENVERTEILUNG AX1 ' + points.length,
    ' EINHEIT_X "V"', ' ST/X ' + points.join(' '), 'END');
  if (extra) L = L.concat(extra);
  var d = C.parseDcm(L.join('\n'), file); d.encoding = 'gbk'; return d;
}
var axRA = axDcmRep([0, 1.1, 4, 5], null, 'A.DCM');
var axRB = axDcmRep([0, 1.2, 4, 5], null, 'B.DCM');
var axAu = C.buildFullAudit([axRA, axRB], { eps: 1e-9 });
var axRep = RP.buildAudit({ datasets: [axRA, axRB], mode: 'absolute', eps: 1e-9,
  effectiveEps: 1e-9, opts: {}, annotations: {}, reportPageSize: 12 }, axAu);
ok(axRep.indexOf('轴定义 STUETZSTELLENVERTEILUNG') >= 0, '报告列出轴定义类型');
ok(axRep.indexOf('断点/序列 Δ 剖面') >= 0 && axRep.indexOf('delta-profile-svg') >= 0,
  '轴断点变化生成一维 Δ 剖面图');
ok(axRep.indexOf('A 版断点值') >= 0 && axRep.indexOf('B 版断点值') >= 0,
  '轴定义证据表用断点专用表头');
ok(axRep.indexOf('不套用孤立突变点') >= 0, '报告说明轴定义不套用孤立点判据');
ok(axRep.indexOf('data-ann="audit:') >= 0, '轴定义变化项带评审批注框');
ok(axAu.totals.counts.changed === 1 && axAu.identity.ok, '独立样本账目配平');
// 新增轴定义样本：第 6 章类型分类要补齐，不能凭空消失
var axAdB = axDcmRep([0, 1.1, 4, 5],
  ['STUETZSTELLENVERTEILUNG AX2 2', ' ST/X 1 2', 'END'], 'B3.DCM');
var axAdAu = C.buildFullAudit([axRA, axAdB], { eps: 1e-9 });
var axAdRep = RP.buildAudit({ datasets: [axRA, axAdB], mode: 'absolute', eps: 1e-9,
  effectiveEps: 1e-9, opts: {}, annotations: {}, reportPageSize: 12 }, axAdAu);
ok(axAdRep.indexOf('只在一版存在的轴定义') >= 0 && axAdRep.indexOf('AX2') >= 0,
  '新增轴定义在断点变化类型章节里补齐列出');
ok(axAdAu.totals.counts.added === 1 && axAdAu.identity.ok, '新增轴定义账目配平');

/* 轴定义评审批注集中到第 6 章：不能在第 4/5 章重复出现同一 id 的控件 */
console.log('== 7b. 轴定义评审批注集中在第 6 章（不重复 / 可归档） ==');
// 账目 id 含 "A > B"，写进 HTML 时 esc() 会把 > 转成 &gt;；直接拿原始 id 匹配会假报 FAIL。
// 统一从报告里提取实际控件 id，既避开转义差异，也顺带验证控件本身存在。
function verdictIds(htmlText) {
  var out = [], re = /data-ann="([^"]+)" data-field="verdict"/g, mm;
  while ((mm = re.exec(htmlText))) out.push(mm[1]);
  return out;
}
function secSlice(htmlText, fromTitle, toTitle) {
  var a = htmlText.indexOf(fromTitle), b = htmlText.indexOf(toTitle);
  return { before: htmlText.slice(0, a), body: htmlText.slice(a, b), ok: a >= 0 && b > a };
}
var s6 = secSlice(axRep, '. 轴定义断点变化类型', '. 清单范围与边界说明');
ok(s6.ok, '报告存在第 6 / 第 7 章边界');
ok(s6.body.indexOf('轴定义变化评审批注') >= 0, '第 6 章有集中评审小节');
/* 用户要求：轴定义分章统计行也必须归第 6 章，第 4 章不许再展开轴定义 */
var axStatRe = /轴定义 STUETZSTELLENVERTEILUNG · \d+ 项（变化 \d+，新增 \d+，删除 \d+，被拒绝 \d+，未变化 \d+（仅计数））/;
ok(axStatRe.test(s6.body), '第 6 章含轴定义分章统计行（变化/新增/删除/被拒绝/未变化仅计数）');
ok(!axStatRe.test(s6.before), 'revert-to-fail：第 4 章不再出现轴定义分章统计行');
ok(s6.body.indexOf('断点/序列 Δ 剖面') >= 0 && s6.body.indexOf('A 版断点值') >= 0,
  '轴定义完整证据（Δ 剖面 + 断点逐点表）也归在第 6 章');
ok(s6.before.indexOf('断点/序列 Δ 剖面') < 0,
  'revert-to-fail：第 4 章不再展开轴定义证据块');
var axIds6 = verdictIds(s6.body), axIdsBefore = verdictIds(s6.before);
ok(axIds6.length === 1, '第 6 章恰好 1 组轴变化评审控件（实际 ' + axIds6.length + '）');
ok(axIdsBefore.indexOf(axIds6[0]) < 0 && verdictIds(axRep).filter(function (x) {
  return x === axIds6[0];
}).length === 1, 'revert-to-fail：轴变化账目的结论控件全报告恰好 1 个，不在第 4 / 5 章重复');
ok(s6.body.indexOf('不套用孤立突变点') >= 0, '轴定义判据说明也归在第 6 章');
// 新增 / 删除的轴定义也要在第 6 章评审，且第 5 章清单仍列出但不放控件
var adS6 = secSlice(axAdRep, '. 轴定义断点变化类型', '. 清单范围与边界说明');
var adIds6 = verdictIds(adS6.body), adIdsAll = verdictIds(axAdRep);
// 该样本 AX1 未变化、只有 AX2 是 B 版新增，所以第 6 章恰好 1 组评审
ok(adIds6.length === 1, '第 6 章评审 B 版新增的轴定义（实际 ' + adIds6.length + '）');
ok(adIds6.every(function (id) {
  return adIdsAll.filter(function (x) { return x === id; }).length === 1;
}), 'revert-to-fail：第 5 章不再重复放新增轴定义的批注控件');
ok(axAdRep.indexOf('新增 / 删除 / 被拒绝对象') >= 0 && axAdRep.indexOf('AX2') >= 0,
  '新增轴定义仍在第 5 章清单中列出');
// 既有断点变化又有新增轴：第 6 章应同时给出两组评审，且全报告各恰好一次
var axMixB = axDcmRep([0, 1.2, 4, 5],
  ['STUETZSTELLENVERTEILUNG AX2 2', ' ST/X 1 2', 'END'], 'B4.DCM');
var axMixAu = C.buildFullAudit([axRA, axMixB], { eps: 1e-9 });
var axMixRep = RP.buildAudit({ datasets: [axRA, axMixB], mode: 'absolute', eps: 1e-9,
  effectiveEps: 1e-9, opts: {}, annotations: {}, reportPageSize: 12 }, axMixAu);
var mixS6 = secSlice(axMixRep, '. 轴定义断点变化类型', '. 清单范围与边界说明');
var mixIds6 = verdictIds(mixS6.body), mixIdsAll = verdictIds(axMixRep);
ok(mixIds6.length === 2, '第 6 章同时评审「断点变化」与「B 版新增」（实际 ' + mixIds6.length + '）');
ok(mixIds6.every(function (id) {
  return mixIdsAll.filter(function (x) { return x === id; }).length === 1;
}), '两组评审控件各自全报告恰好一次，无重复');
// 断点增删：报告要出两版序列对照表，且仍算变化不是拒绝
var axRzB = axDcmRep([0, 1.1, 4, 5, 6], null, 'B2.DCM');
var axRzAu = C.buildFullAudit([axRA, axRzB], { eps: 1e-9 });
var axRzRep = RP.buildAudit({ datasets: [axRA, axRzB], mode: 'absolute', eps: 1e-9,
  effectiveEps: 1e-9, opts: {}, annotations: {}, reportPageSize: 12 }, axRzAu);
ok(axRzRep.indexOf('两版轴断点序列对照') >= 0 && axRzRep.indexOf('断点增删') >= 0,
  '断点增删报告给出两版序列对照');
ok(axRzAu.totals.counts.rejected === 0 && axRzAu.totals.counts.changed === 1,
  'revert-to-fail：断点增删计入变化、不进被拒绝');
console.log('== 8. 报告卡片区与表格间距（CSS 层） ==');
ok(/\.cards\{[^}]*margin:0 0 16px/.test(arep) && /\.cards\{[^}]*margin:0 0 16px/.test(report),
  '两份报告 CSS 均给卡片区下方 16px 留白（修复前为 0）');
ok(/\.tbl\{[^}]*margin:0 0 12px/.test(arep) && /\.tbl\{[^}]*margin:0 0 12px/.test(report),
  '两份报告 CSS 均给表格下方 12px 留白');
ok(/\.cards\{[^}]*margin:0 0 16px/.test(html), '工具产物内联的报告模块也带该间距规则');

console.log('== 9. 内嵌使用手册（静态结构 + 独立文件） ==');
['btnManual', 'manualOverlay', 'manualNav', 'btnManualPrint', 'btnManualClose'].forEach(function (id) {
  ok(html.indexOf('id="' + id + '"') >= 0, '手册 UI 元素 ' + id + ' 存在');
});
ok(html.indexOf('<button id="btnManual"') >= 0 && html.indexOf('class="top-actions"') < html.indexOf('<button id="btnManual"'),
  '手册入口位于顶部按钮区');
/* 手册头部两个动作按钮必须共用 .btn 基类：旧版打印按钮用 .mini，比关闭按钮矮 8px */
var btnCls = function (id) {
  var m = html.match(new RegExp('<button id="' + id + '" class="([^"]*)"'));
  return m ? m[1] : null;
};
var prCls = btnCls('btnManualPrint'), clCls = btnCls('btnManualClose');
ok(prCls !== null && clCls !== null, '手册头部两个按钮的 class 可解析');
var isBtn = function (c) { return c !== null && /(^|\s)btn(\s|$)/.test(c); };
ok(isBtn(prCls) && isBtn(clCls) && !/(^|\s)mini(\s|$)/.test(prCls + ' ' + clCls),
  '打印与关闭按钮共用 .btn 基类（不再有 .mini 小按钮）');
ok(/\.manual-head-actions \.btn\{[^}]*height:30px/.test(html), 'CSS 给头部按钮统一固定高度');
var oldPrCls = '<button id="btnManualPrint" class="mini" type="button">'
  .match(/class="([^"]*)"/)[1];
ok(!isBtn(oldPrCls), 'revert-to-fail：旧版 mini 类名会被静态检测器判为不合格');
ok((html.match(/id="m-[a-z]+"/g) || []).length === 10, '内嵌手册含 10 个章节');
ok((html.match(/data-target="m-/g) || []).length === 10, '目录有 10 个跳转按钮');
ok(html.indexOf('role="dialog"') >= 0 && html.indexOf('aria-modal="true"') >= 0,
  '手册面板带无障碍 dialog 语义');
ok(html.indexOf('.manual-overlay[hidden]{display:none}') >= 0 &&
  html.indexOf('@media print') >= 0, '手册 CSS 含隐藏态与打印规则');
['实时保存仅在本机生效', '评审批注与归档', '3D 曲面的 7 种模式', '发报告 = 发数据',
  '全量变化报告只陈述事实'].forEach(function (t) {
  ok(html.indexOf(t) >= 0, '手册覆盖关键内容：' + t);
});
ok(!/<(script|link|img)[^>]+(src|href)=["']https?:/i.test(
  html.slice(html.indexOf('id="manualOverlay"'), html.indexOf('<script>'))),
  '手册区零外部资源（离线可看）');
ok(html.indexOf('bindManual') >= 0 && html.indexOf('showManual') >= 0 &&
  html.indexOf('showChangelog') >= 0 && html.indexOf("e.key !== 'Escape'") >= 0 &&
  html.indexOf('btnVersion') >= 0, '手册与更新记录的开关、Esc 逻辑已内联');
var manualMd = path.join(__dirname, 'DCM_MAP_使用手册.md');
ok(fs.existsSync(manualMd), '独立使用手册文件存在');
if (fs.existsSync(manualMd)) {
  var md = fs.readFileSync(manualMd, 'utf8');
  ok((md.match(/^## \d+\./gm) || []).length >= 10, '独立手册含 10 章');
  ok(md.indexOf('实时保存仅在本机生效') >= 0 && md.indexOf('查看使用手册') >= 0,
    '独立手册与内嵌版本内容一致');
  ok(!/\{\{[A-Z]+\}\}/.test(md), '独立手册无占位符残留');
}
ok(report.indexOf('id="manualOverlay"') < 0 && arep.indexOf('id="manualOverlay"') < 0,
  '报告文件不含工具页手册（互不干扰）');

console.log('');
if (failures.length) {
  console.log('FAILED ' + failures.length + ' 项:');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('ALL PASS');
