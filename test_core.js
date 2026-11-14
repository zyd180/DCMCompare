/* DCM core regression + mutation tests. Run: node test_core.js */
'use strict';
var fs = require('fs');
var path = require('path');
var C = require('./src/core.js');

var FILE = process.argv[2] || 'E:/Project/DCM/ALL.DCM';
var failures = [];
function ok(cond, msg) {
  if (cond) console.log('  PASS  ' + msg);
  else { console.log('  FAIL  ' + msg); failures.push(msg); }
}
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + a + ', expect ' + b + ')'); }

console.log('== 1. 真实 DCM 全量解析 ==');
var buf = fs.readFileSync(FILE);
var dec = C.decodeDcm(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
console.log('  decoding: ' + dec.encoding + (dec.note ? ' | ' + dec.note : ''));
var ds = C.parseDcm(dec.text, path.basename(FILE));
console.log('  blocks=' + ds.stats.totalBlocks + ' maps=' + ds.maps.length +
  ' invalid=' + ds.stats.invalid + ' warnings=' + ds.warnings.length + ' unknownLines=' + ds.stats.unknownLines);
eq(ds.stats.totalBlocks, 22813, '顶层数据块总数');
eq(ds.stats.byKind.GRUPPENKENNFELD, 651, '2D MAP 数量');
eq(ds.stats.byKind.GRUPPENKENNLINIE, 422, '曲线数量');
eq(ds.stats.byKind.FESTWERTEBLOCK, 1926, '数组数量');
eq(ds.stats.byKind.FESTWERT, 18089, '标量数量');
eq(ds.stats.byKind.FESTKENNLINIE, 2, '固定轴曲线数量');
eq(ds.stats.byKind.STUETZSTELLENVERTEILUNG, 1723, '轴定义数量');
eq(ds.maps.length, 21090, '可比对象总数');
eq(ds.stats.invalid, 0, '维度校验无异常块');
eq(ds.stats.unknownLines, 0, '未识别顶层关键字为 0');

/* 自检：曾经被漏掉但确实存在的块类型，少任何一个都算清单不完整 */
var MUST_HAVE = ['FESTWERT', 'FESTWERTEBLOCK', 'GRUPPENKENNFELD', 'GRUPPENKENNLINIE',
  'FESTKENNLINIE', 'STUETZSTELLENVERTEILUNG'];
var missing = MUST_HAVE.filter(function (k) { return !ds.stats.byKind[k]; });
eq(missing.length, 0, '块类型清单自检（缺: ' + missing.join(',') + '）');

console.log('== 2. 同轴聚类 / 跨文件同名配对 ==');
var map2d = ds.maps.filter(function (m) { return m.type === 'map2d'; });
var sigs = {};
map2d.forEach(function (m) { sigs[m.axisSig] = 1; });
eq(Object.keys(sigs).length, 159, '2D MAP 同轴组数量');
var idx = C.buildIndex([ds]);
eq(idx.groups[0].maps.length, 60, '最大同轴组包含 60 张表');
eq(idx.groups[0].nx, 15, '最大同轴组 X 维');
eq(idx.groups[0].ny, 11, '最大同轴组 Y 维');
var ds2 = C.parseDcm(dec.text, 'ANOTHER_VERSION.DCM');
var idx2 = C.buildIndex([ds, ds2]);
eq(idx2.versionGroups.length, 21090, '两版 DCM 同名可配对对象数');
eq(idx2.versionGroups[0].items.length, 2, '同名配对每组 2 个版本');

console.log('== 3. 变异测试：改一格必须精确定位，还原必须 0 变化 ==');
var base = map2d[0];
console.log('  sample: ' + base.name + ' ' + base.nx + 'x' + base.ny + ' @line ' + base.startLine);
var mutant = JSON.parse(JSON.stringify(base));
mutant.v[3][5] += 10;
var d1 = C.computeDiff(base, mutant);
eq(d1.ok, true, '同维度对比可执行');
eq(d1.stats.changed, 1, '只报 1 格变化');
eq(d1.stats.changedCells[0].j, 3, '变化格行索引 j=3');
eq(d1.stats.changedCells[0].i, 5, '变化格列索引 i=5');
eq(d1.stats.changedCells[0].delta, 10, '变化量 = +10');
eq(d1.interpolated, false, '同轴对比未触发插值');
var restored = JSON.parse(JSON.stringify(base));
var d2 = C.computeDiff(base, restored);
eq(d2.stats.changed, 0, 'revert-to-pass: 还原后 0 格变化');
var dRel = C.computeDiff(base, mutant, { mode: 'relative' });
eq(dRel.relMode, true, '相对差模式生效');
ok(isFinite(dRel.stats.changedCells[0].rel) || base.v[3][5] === 0,
  '相对差在基准非 0 时有数值（基准为 0 时降级）');

console.log('== 4. 负例：维度不同必须拒绝 ==');
var otherDim = map2d.filter(function (m) { return m.nx !== base.nx || m.ny !== base.ny; })[0];
var dBad = C.computeDiff(base, otherDim);
eq(dBad.ok, false, '维度不同被拒绝');
ok(/维度不同/.test(dBad.reason), '拒绝原因写明维度不同');

console.log('== 5. 负例：轴刻度偏移必须标记插值 ==');
var shifted = JSON.parse(JSON.stringify(base));
shifted.x = shifted.x.map(function (v) { return v + 1; });
shifted.y = shifted.y.map(function (v) { return v + 1; });
var al = C.alignMaps(base, shifted);
eq(al.ok, true, '同维度但轴不同时可执行');
eq(al.interpolated, true, '轴不同被标记为已插值');
var dShift = C.computeDiff(base, shifted);
eq(dShift.interpolated, true, '差异结果携带插值标记');

console.log('== 6. 多对比包络与 3D 立方 ==');
var peers = idx.groups[0].maps.slice(1, 5);
var all = C.computeAllDiffs(idx.groups[0].maps[0], peers);
eq(all.diffs.length, 4, '4 张对比全部产出差异');
eq(all.envelope.count, 4, '包络覆盖 4 张对比');
var cube = C.buildCube(idx.groups[0].maps[0], peers);
eq(cube.layers.length, 5, '立方体层数 = 1 基准 + 4 对比');
eq(cube.profile(2, 3).length, 5, '沿第三维剖面点数 = 5');

console.log('== 7. 包络曲面的峰值来源变异测试 ==');
var eb = idx.groups[0].maps[0];
var e1 = JSON.parse(JSON.stringify(eb)); e1.v[2][3] += 10;
var e2 = JSON.parse(JSON.stringify(eb)); e2.v[2][3] += 3;
var e3 = JSON.parse(JSON.stringify(eb)); e3.v[5][6] -= 8;
var env = C.computeAllDiffs(eb, [e1, e2, e3]).envelope;
eq(env.which[2][3], 0, '(j=2,i=3) 峰值来自偏差更大的第 1 张');
eq(env.which[5][6], 2, '(j=5,i=6) 峰值来自第 3 张');
ok(Math.abs(env.maxAbs[2][3] - 10) < 1e-9, '包络幅值 = 10');
ok(Math.abs(env.maxAbs[5][6] - 8) < 1e-9, '负向偏差取绝对值 8');
var envZero = C.computeAllDiffs(eb, [JSON.parse(JSON.stringify(eb))]).envelope;
eq(envZero.maxAbs[2][3], 0, '全部对比无变化时包络为 0');

console.log('== 8. 变更体检与轴健康隐患 ==');
var htxt = [
  'GRUPPENKENNFELD H_M 6 5',
  ' ST/X 1 2 3 4 5 6',
  ' ST/Y 10', ' WERT 1 2 3 4 5 6',
  ' ST/Y 20', ' WERT 2 3 4 5 6 7',
  ' ST/Y 30', ' WERT 3 4 5 6 7 8',
  ' ST/Y 40', ' WERT 4 5 6 7 8 9',
  ' ST/Y 50', ' WERT 5 6 7 8 9 10', 'END'
].join('\n');
var hb = C.parseDcm(htxt, 'HEALTH.DCM').maps[0];
var h1 = JSON.parse(JSON.stringify(hb)); h1.v[2][2] += 10;
var q1 = C.inspectDiff(C.computeDiff(hb, h1));
eq(q1.isolated.length, 1, '单格改动必须报 1 个孤立突变点');
eq(q1.risk, 'high', '单格改动风险等级 high');
ok(q1.monotonic.length > 0, '单格改动触发沿轴趋势反转');
var h2 = JSON.parse(JSON.stringify(hb));
for (var pj = 1; pj <= 3; pj++) for (var pi = 1; pi <= 4; pi++) h2.v[pj][pi] += 2;
var q2 = C.inspectDiff(C.computeDiff(hb, h2));
eq(q2.isolated.length, 0, '整片连续改动必须 0 个孤立点');
eq(q2.changed, 12, '整片改动 12 格');
var q3 = C.inspectDiff(C.computeDiff(hb, JSON.parse(JSON.stringify(hb))));
eq(q3.isolated.length, 0, '还原后 0 个孤立点');
eq(q3.changed, 0, '还原后 0 变化格');
eq(q3.risk, 'none', '还原后风险 none');
var seEnum = C.suggestEps(hb);
eq(seEnum.eps, 1e-9, '整数枚举/开关量沿用 1e-9');
var hFloat = JSON.parse(JSON.stringify(hb));
for (pj = 0; pj < 5; pj++) for (pi = 0; pi < 6; pi++) hFloat.v[pj][pi] = 1234.5 + pj * 0.25 + pi;
var seFloat = C.suggestEps(hFloat);
ok(seFloat.eps > 1e-9, '连续量自动阈值随量级提高 (' + seFloat.eps.toExponential(2) + ')');
var hBig = JSON.parse(JSON.stringify(hFloat));
var dBig = C.computeDiff(hBig, hBig, { mode: 'relative' });
ok(dBig.zeroTol > 1e-12, '大量级基准的相对差零判定随量纲提高');
var hBadAxis = JSON.parse(JSON.stringify(hb)); hBadAxis.x = [1, 2, 5, 3, 4, 6];
var dBadAxis = C.computeDiff(hb, hBadAxis);
eq(dBadAxis.ok, false, '轴非单调且刻度不同时必须拒绝插值');
eq(dBadAxis.axisUnsafe, true, '拒绝原因标记为轴不安全');
ok(/非单调/.test(dBadAxis.reason), '拒绝原因写明非单调');
var hDupAxis = JSON.parse(JSON.stringify(hb)); hDupAxis.x = [1, 2, 2, 4, 5, 6];
eq(C.computeDiff(hb, hDupAxis).ok, false, '轴存在重复断点时必须拒绝插值');
var hMonoShift = JSON.parse(JSON.stringify(hb)); hMonoShift.x = hMonoShift.x.map(function (v) { return v + 1; });
eq(C.computeDiff(hb, hMonoShift).ok, true, '轴仍单调但刻度平移时允许插值（未误伤）');

console.log('== 9. 跨版本改名对齐 ==');
var RV = [[1, 2, 3], [4, 5, 6]];
function mkRenamed(names, file) {
  var lines = [];
  names.forEach(function (n) {
    lines.push('GRUPPENKENNFELD ' + n + ' 3 2', ' ST/X 1 2 3',
      ' ST/Y 10', ' WERT ' + RV[0].join(' '),
      ' ST/Y 20', ' WERT ' + RV[1].join(' '), 'END');
  });
  return C.parseDcm(lines.join('\n'), file);
}
var rA = mkRenamed(['Foo_M', 'Keep_M'], 'A.DCM');
var rB = mkRenamed(['Foo_M_V2', 'Keep_M'], 'B.DCM');
var mr = C.matchRenamed([rA, rB]);
eq(mr.ok, true, '两版 DCM 可执行改名对齐');
eq(mr.pairs[0].exact, 1, 'Keep_M 走精确同名配对');
eq(mr.pairs[0].onlyA, 1, 'Foo_M 仅在 A 出现');
eq(mr.pairs[0].onlyB, 1, 'Foo_M_V2 仅在 B 出现');
eq(mr.total, 1, '版本后缀改名必须检出 1 组候选');
var rc = mr.pairs[0].candidates[0];
eq(rc.a.name, 'Foo_M', '候选 A 名称正确');
eq(rc.b.name, 'Foo_M_V2', '候选 B 名称正确');
eq(rc.confidence, 'high', '完全同名归一化 + 数值一致 = 高置信');
ok(rc.valueSim === 1 && rc.nameSim >= 0.9, '数值与名称相似度均达标');
ok(rc.reasons.length >= 3, '候选带可追溯的判定依据');
eq(C.matchRenamed([rA, mkRenamed(['Foo_M', 'Keep_M'], 'B.DCM')]).total, 0,
  'revert-to-fail：还原同名后候选必须归零');
eq(C.matchRenamed([rA, mkRenamed(['Zebra_Q', 'Keep_M'], 'B.DCM')]).total, 0,
  '名称完全无关但数值相同，不得误配');
var rHalf = C.parseDcm([
  'GRUPPENKENNFELD Foo_M_V2 3 2', ' ST/X 1 2 3', ' ST/Y 10', ' WERT 1 2 3',
  ' ST/Y 20', ' WERT 4 99 99', 'END',
  'GRUPPENKENNFELD Keep_M 3 2', ' ST/X 1 2 3', ' ST/Y 10', ' WERT 1 2 3',
  ' ST/Y 20', ' WERT 4 5 6', 'END'
].join('\n'), 'B.DCM');
eq(C.matchRenamed([rA, rHalf]).total, 0, '数值改动过半不得误配');
var rManyA = mkRenamed(['AlphaA_M', 'AlphaB_M', 'AlphaC_M', 'Keep_M'], 'A.DCM');
var rManyB = mkRenamed(['ZetaX_M', 'ZetaY_M', 'ZetaZ_M', 'Keep_M'], 'B.DCM');
eq(C.matchRenamed([rManyA, rManyB]).total, 0,
  '同轴且数值完全相同的一批异名表不得互相乱配');
var rDupA = mkRenamed(['Foo_M', 'Foo_N', 'Keep_M'], 'A.DCM');
var rDupB = mkRenamed(['Foo_M_V2', 'Keep_M'], 'B.DCM');
eq(C.matchRenamed([rDupA, rDupB]).total, 1, '双向唯一：一个 B 对象只能配一个 A');
eq(C.matchRenamed([rA]).ok, false, '只有 1 份 DCM 时明确拒绝');
ok(C.normalizeName('Foo_M_V2') === 'foo_m' && C.nameSim('Foo_M', 'Foo_M_V2') === 1,
  '版本后缀归一化生效');

console.log('== 10. 结论层：改动模式与超差区间 ==');
var ST = [
  'GRUPPENKENNFELD S_M 6 5', ' ST/X 1 2 3 4 5 6',
  ' ST/Y 10', ' WERT 1 2 3 4 5 6',
  ' ST/Y 20', ' WERT 2 3 4 5 6 7',
  ' ST/Y 30', ' WERT 3 4 5 6 7 8',
  ' ST/Y 40', ' WERT 4 5 6 7 8 9',
  ' ST/Y 50', ' WERT 5 6 7 8 9 10', 'END'
].join('\n');
var sb = C.parseDcm(ST, 'S.DCM').maps[0];
function sClone(fn) { var m = JSON.parse(JSON.stringify(sb)); fn(m.v); return m; }
var sAll = sClone(function (v) { for (var j = 0; j < 5; j++) for (var i = 0; i < 6; i++) v[j][i] += 5; });
var sOne = sClone(function (v) { v[2][2] += 10; });
var sPatch = sClone(function (v) { for (var j = 1; j <= 3; j++) for (var i = 1; i <= 4; i++) v[j][i] += 2; });
var sNone = sClone(function () {});
function sm(m, opts) { return C.summarizeDiff([C.computeDiff(sb, m)], opts || { eps: 1e-9 }); }
var qAll = sm(sAll), qOne = sm(sOne), qPatch = sm(sPatch), qNone = sm(sNone);
eq(qAll.per[0].pattern, 'global_scale', '整表统一 +5 判为整体缩放');
eq(qAll.per[0].changed, 30, '整表 30 格全部变化');
eq(qOne.per[0].pattern, 'single_point', '单格改动判为单点修正');
eq(qPatch.per[0].pattern, 'local_patch', '连续 3×4 区块判为局部调整');
eq(qPatch.per[0].isolated, 0, '整片改动 0 孤立点');
eq(qNone.per[0].pattern, 'none', '还原后判为无变化');
eq(qNone.totalChanged, 0, '还原后 0 变化格');
/* 对比摘要降级为「评审参考」：只陈述事实，不再产出放行/驳回判定。
   判定是评审人的职责，工具给一句「建议驳回」会被当成签核结论。 */
eq(qAll.verdict, undefined, '对比摘要不再产出放行判定字段');
eq(qAll.verdictLabel, undefined, '对比摘要不再产出判定标签字段');
ok([qAll, qOne, qPatch, qNone, sm(sPatch, { eps: 1e-9, allowDelta: 1 })].every(function (q) {
  return q.lines.every(function (l) { return l.indexOf('建议') < 0; });
}), 'revert-to-fail：摘要任何一句都不含「建议」');
var qEx = sm(sPatch, { eps: 1e-9, allowDelta: 1 });
eq(qEx.exceedRegions.length, 1, 'allowDelta=1 时检出 1 个连通超差区间');
eq(qEx.exceedRegions[0].count, 12, '超差区间恰好 12 格');
eq(qEx.exceedRegions[0].xFrom, 2, '超差区间 X 起点为真实轴值 2');
eq(qEx.exceedRegions[0].xTo, 5, '超差区间 X 终点为真实轴值 5');
eq(qEx.exceedRegions[0].yFrom, 20, '超差区间 Y 起点为真实轴值 20');
eq(qEx.exceedRegions[0].yTo, 40, '超差区间 Y 终点为真实轴值 40');
eq(sm(sPatch, { eps: 1e-9 }).exceedRegions.length, 0, '未设允许偏差时不生成超差区间');
ok(qEx.lines.some(function (l) { return l.indexOf('X 2') >= 0 || l.indexOf('2 ~ 5') >= 0; }),
  '摘要句含真实轴值而非网格索引');
ok(qEx.lines.length >= 5, '摘要仍逐条陈述事实（对比项 / 模式 / 热点 / 体检 / 超差）');

console.log('== 11. 轴变更影响面 ==');
function axisDcm(blocks, file) {
  return C.parseDcm(blocks.map(function (b) {
    return ['GRUPPENKENNFELD ' + b.name + ' ' + b.x.length + ' ' + b.y.length,
      ' ST/X ' + b.x.join(' '),
      ' ST/Y ' + b.y[0], ' WERT ' + b.v[0].join(' '),
      ' ST/Y ' + b.y[1], ' WERT ' + b.v[1].join(' '), 'END'].join('\n');
  }).join('\n'), file);
}
var B1 = { name: 'TabA_M', x: [1, 2, 3], y: [10, 20], v: [[1, 2, 3], [4, 5, 6]] };
var B2 = { name: 'TabB_M', x: [1, 2, 3], y: [10, 20], v: [[1, 2, 3], [4, 5, 6]] };
var B3 = { name: 'TabC_M', x: [1, 2, 3], y: [30, 40], v: [[1, 2, 3], [4, 5, 6]] };
var B4 = { name: 'TabD_M', x: [1, 2, 3], y: [30, 40], v: [[1, 2, 3], [4, 5, 6]] };
var aA = axisDcm([B1, B2, B3, B4], 'A.DCM');
var aB = axisDcm([
  { name: 'TabA_M', x: [1, 2, 4], y: [10, 20], v: [[1, 2, 3], [4, 5, 6]] },
  { name: 'TabB_M', x: [1, 2, 4], y: [10, 20], v: [[1, 2, 3], [4, 5, 6]] },
  B3, B4
], 'B.DCM');
var axR = C.analyzeAxisChange([aA, aB]);
eq(axR.total, 1, 'X 相同但 Y 不同的两组表：只改一组 X 仍必须检出（完整轴指纹分桶）');
eq(axR.pairs[0].changedAxes[0].axis, 'X', '变化轴方向为 X');
eq(axR.pairs[0].changedAxes[0].affected.length, 2, '影响面恰好 2 张表，不多不少');
eq(axR.pairs[0].changedAxes[0].changeType, '局部扰动', '变化类型判为局部扰动');
eq(C.analyzeAxisChange([aA, axisDcm([B1, B2, B3, B4], 'B.DCM')]).total, 0,
  'revert-to-fail：两版轴完全相同必须 0 根变化轴');
var aShift = axisDcm([
  { name: 'TabA_M', x: [2, 3, 4], y: [10, 20], v: [[1, 2, 3], [4, 5, 6]] },
  { name: 'TabB_M', x: [2, 3, 4], y: [10, 20], v: [[1, 2, 3], [4, 5, 6]] },
  B3, B4
], 'B.DCM');
var axS = C.analyzeAxisChange([aA, aShift]);
eq(axS.pairs[0].changedAxes[0].changeType, '刻度平移', '整体平移判为刻度平移');
var aReorder = axisDcm([
  { name: 'TabA_M', x: [2, 1, 3], y: [10, 20], v: [[1, 2, 3], [4, 5, 6]] },
  { name: 'TabB_M', x: [2, 1, 3], y: [10, 20], v: [[1, 2, 3], [4, 5, 6]] },
  B3, B4
], 'B.DCM');
var axO = C.analyzeAxisChange([aA, aReorder]);
ok(axO.total >= 1 && axO.pairs[0].changedAxes.some(function (a) { return a.risk === 'high'; }),
  '轴顺序改变（非单调化）标为高风险');
eq(C.analyzeAxisChange([aA]).ok, false, '只有 1 份 DCM 时明确拒绝');
var bigNames = {};
idx.groups[0].maps.forEach(function (m) { bigNames[m.name] = 1; });
var bigB = C.parseDcm(dec.text, 'BIG_B.DCM');
bigB.maps.forEach(function (m) { if (bigNames[m.name]) m.x = m.x.map(function (v) { return v + 1; }); });
var axBig = C.analyzeAxisChange([C.parseDcm(dec.text, 'BIG_A.DCM'), bigB]);
ok(axBig.total >= 1, '真实 ALL.DCM 改共同轴后检出变化');
var axTop = axBig.pairs[0].changedAxes.slice().sort(function (a, b) {
  return b.affected.length - a.affected.length;
})[0];
eq(axTop.affected.length, 60, '最大同轴组影响面必须恰好 60 张表（少一张即失败）');
eq(axTop.changeType, '刻度平移', '整体 +1 判为刻度平移');

console.log('== 9. 全量标定量审查：类型分派与恒等式 ==');
function miniDcm(o) {
  return [
    'FESTWERT ' + o.scName, ' WERT ' + o.sc, 'END',
    'FESTWERTEBLOCK ARR ' + o.arr.length, ' WERT ' + o.arr.join(' '), 'END',
    'GRUPPENKENNLINIE CV 3', ' ST/X 10 20 30', ' WERT ' + o.cv.join(' '), 'END',
    'GRUPPENKENNFELD ' + o.mpName + ' 3 2', ' ST/X 1 2 3',
    ' ST/Y 10', ' WERT ' + o.mp[0].join(' '),
    ' ST/Y 20', ' WERT ' + o.mp[1].join(' '), 'END'
  ].join('\n');
}
function mini(o, file) { return C.parseDcm(miniDcm(o), file || 'A.DCM'); }
var S0 = { scName: 'SC_A', sc: 5, arr: [1, 2, 3, 4], cv: [1, 2, 3],
  mpName: 'MP_A', mp: [[1, 2, 3], [4, 5, 6]] };
var mA = mini(S0, 'A.DCM');
eq(mA.maps.map(function (m) { return m.type; }).join(','), 'scalar,array,curve,map2d',
  '小样本覆盖 4 类标定对象');
var auSame = C.buildFullAudit([mA, mini(S0, 'B.DCM')], { eps: 1e-9 });
eq(auSame.totals.total, 4, '两版全同：账本仍完整记录 4 条账目');
eq(auSame.totals.counts.unchanged, 4, '两版全同：4 条未变化项只做计数，不列清单');
eq(auSame.identity.ok, true, '恒等式：状态分项之和 = 账目数，A/B 侧全覆盖');
eq(auSame.pairs[0].identity.aCovered, 4, 'A 侧每个对象恰好归属一条账目');
eq(auSame.pairs[0].identity.bCovered, 4, 'B 侧每个对象恰好归属一条账目');
ok(auSame.summary.lines.join('').indexOf('建议') < 0, '两版全同：全量摘要不给建议');

/* 标量改值：旧二维判据必然误判为孤立点，新分派必须不驳回。
   inspectDiff 仍报 1 个孤立点 = revert-to-fail 的证据：把 analyzeOne 改回去，下面的断言就会红。 */
var S1 = JSON.parse(JSON.stringify(S0)); S1.sc = 9;
var scalarDiff = C.computeDiff(mA.maps[0], mini(S1, 'B.DCM').maps[0], { eps: 1e-9 });
eq(C.inspectDiff(scalarDiff).isolated.length, 1, '旧二维判据对 1×1 标量必报 1 个孤立点（错误结论）');
var auScalar = C.buildFullAudit([mA, mini(S1, 'B.DCM')], { eps: 1e-9 });
var eScalar = auScalar.entries.filter(function (e) { return e.type === 'scalar'; })[0];
eq(eScalar.inspect.applicable, false, '标量体检明确标记「孤立点/趋势反转判据不适用」');
eq(eScalar.inspect.isolated.length, 0, '标量改值不得报孤立突变点');
eq(eScalar.verdict, 'pass', '标量改值的审计判定不构成驳回信号（仅用于风险筛选，不作建议展示）');
eq(eScalar.status, 'changed', '标量改值仍正确计入有变化账目');
eq(eScalar.analysis.pattern, 'value_change', '标量改动模式判为单值调整');
eq(auScalar.entries.filter(C.isRiskItem).length, 0, '标量改值不得被视为风险项（旧口径为「不得计入高风险」）');
ok(auScalar.summary.lines.join('').indexOf('建议') < 0, '仅标量改值的全量摘要不给建议');
ok(!!eScalar.diff, '变化项保留 diff 供一维 Δ 视图与明细使用');
ok(!auSame.entries[0].diff, '未变化项不保留 diff 矩阵（全量体积控制）');

/* 一维邻域：改连续两格不得判孤立，只改一格必须判孤立 */
var S2 = JSON.parse(JSON.stringify(S0)); S2.arr = [1, 9, 9, 4];
var auArr = C.buildFullAudit([mA, mini(S2, 'B.DCM')], { eps: 1e-9 });
var eArr = auArr.entries.filter(function (e) { return e.type === 'array'; })[0];
eq(eArr.inspect.isolated.length, 0, '数组连续两格改动不得判孤立点');
eq(eArr.inspect.applicable, true, '数组仍适用邻域体检');
eq(eArr.inspect.monoY.length, 0, '一维对象不做 Y 方向趋势判定');
var S3 = JSON.parse(JSON.stringify(S0)); S3.arr = [1, 2, 9, 4];
var eArr1 = C.buildFullAudit([mA, mini(S3, 'B.DCM')], { eps: 1e-9 })
  .entries.filter(function (e) { return e.type === 'array'; })[0];
eq(eArr1.inspect.isolated.length, 1, 'revert-to-fail：数组只改 1 格必须报 1 个孤立点');
/* 2D MAP 行为不得回归 */
var S4 = JSON.parse(JSON.stringify(S0)); S4.mp[1][1] = 99;
var eMap = C.buildFullAudit([mA, mini(S4, 'B.DCM')], { eps: 1e-9 })
  .entries.filter(function (e) { return e.type === 'map2d'; })[0];
eq(eMap.inspect.isolated.length, 1, '2D MAP 单格改动仍报 1 个孤立点（原判定不变）');
eq(eMap.verdict, 'reject', '2D MAP 单格改动仍给出驳回信号（供「仅风险项」筛选，不对外作建议）');

/* 维度不同 / 新增删除 / 不做改名配对 */
var S5 = JSON.parse(JSON.stringify(S0));
var badDcm = miniDcm(S5).replace('FESTWERTEBLOCK ARR 4', 'FESTWERTEBLOCK ARR 3')
  .replace('WERT 1 2 3 4', 'WERT 1 2 3');
var auBad = C.buildFullAudit([mA, C.parseDcm(badDcm, 'B.DCM')], { eps: 1e-9 });
var eBad = auBad.entries.filter(function (e) { return e.type === 'array'; })[0];
eq(eBad.status, 'rejected', '维度不同进入 rejected 账目，不静默丢弃');
ok(/维度不同/.test(eBad.reason), 'rejected 账目给出可追溯原因');
eq(auBad.identity.ok, true, '存在 rejected 时恒等式仍成立');
var S6 = JSON.parse(JSON.stringify(S0)); S6.mpName = 'Zebra_Q'; S6.scName = 'SC_A_V2';
var auOnly = C.buildFullAudit([mA, mini(S6, 'B.DCM')], { eps: 1e-9 });
eq(auOnly.totals.counts.deleted, 2, '名称无关改名 → 2 个对象列为 B 版删除');
eq(auOnly.totals.counts.added, 2, '名称无关改名 → 2 个对象列为 B 版新增');
eq(auOnly.totals.counts.renamed, undefined, '账本不再产生改名配对状态');
eq(auOnly.identity.ok, true, '存在新增/删除时每个对象仍恰好归属一条账目');
var del = auOnly.entries.filter(function (e) { return e.status === 'deleted'; });
var add = auOnly.entries.filter(function (e) { return e.status === 'added'; });
ok(del.every(function (e) { return /B 版已删除/.test(e.reason); }), '删除项给出方向明确的说明');
ok(add.every(function (e) { return /B 版新增/.test(e.reason); }), '新增项给出方向明确的说明');
ok(del.every(function (e) { return !!e.a && !e.b; }), '删除项只带 A 侧信息');
ok(add.every(function (e) { return !e.a && !!e.b; }), '新增项只带 B 侧信息');
/* 版本后缀改名（数值完全相同）也必须不配对，分别进删除 / 新增 */
var S7 = JSON.parse(JSON.stringify(S0)); S7.mpName = 'MP_A_V2';
var auRen = C.buildFullAudit([mA, mini(S7, 'B.DCM')], { eps: 1e-9 });
eq(auRen.totals.counts.deleted, 1, 'revert-to-fail：改名对象旧名必须出现在 B 版删除');
eq(auRen.totals.counts.added, 1, 'revert-to-fail：改名对象新名必须出现在 B 版新增');
eq(auRen.totals.counts.renamed, undefined, '不做改名配对：即使数值完全相同也不自动配对');
eq(auRen.settings.renameMatching, false, '设置里明确记录未启用改名配对');
ok(auRen.warnings.some(function (w) { return /未启用改名配对/.test(w); }),
  '边界说明明示改名对象分别落在新增/删除清单');
ok(!auRen.entries.some(function (e) { return e.confidence || e.renameReasons; }),
  '账目里不再残留改名置信度或候选依据');
ok(auRen.summary.lines.join('').indexOf('建议') < 0, '存在未配对项时摘要也不给建议');
eq(C.buildFullAudit([mA]).ok, false, '只有 1 份 DCM 时全量变化清单明确拒绝');

console.log('== 10. 真实 ALL.DCM 全量审查（22813 项不丢项，含轴定义） ==');
var tAudit = Date.now();
var auReal = C.buildFullAudit([C.parseDcm(dec.text, 'ALL_A.DCM'),
  C.parseDcm(dec.text, 'ALL_B.DCM')], { eps: 1e-9 });
var auditMs = Date.now() - tAudit;
eq(auReal.totals.total, 22813, '真实文件全量账目 = 22813 条（21090 标定量 + 1723 轴定义）');
eq(auReal.totals.counts.unchanged, 22813, '自比时 22813 条全部为未变化');
eq(auReal.identity.ok, true, '真实文件恒等式通过（每个对象恰好归属一条账目）');
eq(auReal.totals.byType.scalar.total, 18089, '标量全部纳入账本');
eq(auReal.totals.byType.array.total, 1926, '数组全部纳入账本');
eq(auReal.totals.byType.curve.total, 424, '曲线全部纳入账本');
eq(auReal.totals.byType.map2d.total, 651, 'MAP 全部纳入账本');
eq(auReal.totals.byType.axis.total, 1723, '轴定义 1723 个全部作为正式标定量纳入账本');
eq(auReal.pairs[0].identity.aTotal, 22813, 'A 侧对象数含轴定义');
eq(auReal.pairs[0].identity.bTotal, 22813, 'B 侧对象数含轴定义');
eq(auReal.sources[0].objects, 22813, '数据源对象数口径含轴定义');
eq(auReal.sources[0].calibratables, 21090, '数值标定量单独保留口径');
eq(auReal.pairs[0].axisAppendix.countA, 1723, '轴定义 1723 个断点变化分类明细');
eq(auReal.pairs[0].axisAppendix.countB, 1723, 'B 版轴定义数量一致');
eq(auReal.pairs[0].axisAppendix.changed.length, 0, '自比时 0 根轴变化');
ok(auReal.totals.byType.axis.label.indexOf('轴定义') >= 0, '轴定义有独立类型标签');
ok(auditMs < 3000, '真实全量审查耗时 ' + auditMs + ' ms，在可接受范围');
ok(auReal.summary.lines.join('').indexOf('建议') < 0, '真实文件自比：全量摘要不给建议');
eq(auReal.totals.counts.unchanged, 22813, '真实文件自比：未变化项只计数，不生成清单数据');

console.log('== 11. 轴定义计入标定变化（变异测试 + revert-to-fail） ==');
// 按断点数组生成 DCM，声明数与实际点数同步，避免测试数据自身解析失败
function axDcm(points, extra, file) {
  var L = [
    'FESTWERT SC 5', 'END',
    'GRUPPENKENNFELD MP 3 2', ' ST/X 1 2 3', ' ST/Y 10', ' WERT 1 2 3',
    ' ST/Y 20', ' WERT 4 5 6', 'END'
  ];
  if (points) {
    L.push('STUETZSTELLENVERTEILUNG AX1 ' + points.length,
      ' EINHEIT_X "V"', ' ST/X ' + points.join(' '), 'END');
  }
  if (extra) L = L.concat(extra);
  return C.parseDcm(L.join('\n'), file || 'A.DCM');
}
var axA = axDcm([0, 1.1, 4, 5]);
// 1) 改单个断点：必须计入 changed，且不能被判「孤立突变点 / 高危」
var axOne = C.buildFullAudit([axA, axDcm([0, 1.2, 4, 5], null, 'B.DCM')], { eps: 1e-9 });
var axE = axOne.entries.filter(function (e) { return e.type === 'axis'; })[0];
eq(axE.status, 'changed', '改一个轴断点计入变化清单');
eq(axE.hasChange, true, '轴断点变化标记 hasChange');
eq(axE.inspect.isolated.length, 0, 'revert-to-fail：改单个断点不得判孤立突变点');
eq(axE.risk === 'high', false, 'revert-to-fail：改单个断点不得判高危');
eq(axE.stats.interpolated, false, '轴断点变化走逐点相减，不触发插值');
ok(Math.abs(axE.stats.maxAbs - 0.1) < 1e-9, 'max|Δ| 为真实断点差 0.1');
ok(!!axE.diff, '轴断点变化带逐点差异证据');
eq(axOne.totals.counts.changed, 1, '变化计数 +1，恒等式仍配平');
eq(axOne.identity.ok, true, '轴变化场景恒等式通过');
eq(axOne.totals.total, 3, '账目数 = 2 标定量 + 1 轴定义');
ok(axOne.summary.lines.join('').indexOf('轴定义') >= 0, '全量摘要列出轴定义类型');

// 2) 断点增删：必须计入 changed，不能落进 rejected 假装没变
var axResize = C.buildFullAudit([axA, axDcm([0, 1.1, 4, 5, 6], null, 'B2.DCM')], { eps: 1e-9 });
var axR = axResize.entries.filter(function (e) { return e.type === 'axis'; })[0];
eq(axR.status, 'changed', 'revert-to-fail：轴断点增删计入变化清单，不进 rejected');
eq(axResize.totals.counts.rejected, 0, '断点增删不产生被拒绝账目');
ok(!!axR.axisSeries && axR.axisSeries.kind === '断点增删', '给出断点增删类型');
eq(axR.axisSeries.a.length, 4, '序列对照保留 A 版 4 个断点');
eq(axR.axisSeries.b.length, 5, '序列对照保留 B 版 5 个断点');
eq(axResize.identity.ok, true, '断点增删场景恒等式通过');

/* 风险档位必须只有一个判据入口。
   旧「仅风险项」只判 verdict==='review'，而三轴表 / 轴断点增删 / 对比被拒绝
   三类都是 risk==='review' 且 verdict 为空 —— 最该被筛出来的项反而一个都筛不出来。 */
console.log('== 11b. 风险档位与「仅风险项」判据 ==');
ok(C.RISK_LEVELS.indexOf('review') >= 0, '风险档位含 review（结构性变化/需人工确认）');
eq(axR.risk, 'review', '轴断点增删标记 risk=review');
eq(C.isRiskItem(axR), true, 'revert-to-fail：轴断点增删必须被判为风险项');
var axRejected = C.buildFullAudit([mA, C.parseDcm(badDcm, 'B.BAD.DCM')], { eps: 1e-9 })
  .entries.filter(function (e) { return e.status === 'rejected'; })[0];
eq(!!axRejected, true, '构造出被拒绝账目');
eq(C.isRiskItem(axRejected), true, '对比被拒绝必须被判为风险项（risk=review）');
eq(C.isRiskItem(auSame.entries[0]), false, 'revert-to-pass：未变化的标量不是风险项');
eq(C.RISK_LABEL.review, '需人工确认', 'review 有独立中文标签，不并入 high/medium');
var badRisk = auReal.entries.concat(axOne.entries, axResize.entries)
  .filter(function (e) { return C.RISK_LEVELS.indexOf(e.risk) < 0; });
eq(badRisk.length, 0, '所有账目 risk 值都在合法档位内（越界会在这里变红）');

/* 全量账本只陈述事实：不生成任何「高风险 N 项」这类结论层指标。
   曾经算过 totals.highRisk / review / exceed 与 byType[].highRisk，但界面和报告一处都没展示，
   属于纯死代码，还会诱导后来人把它当放行结论用。删掉并用断言锁死，防止回潮。 */
console.log('== 11c. 账本不生成结论层指标（死指标已清理） ==');
eq(auReal.totals.highRisk, undefined, 'totals 不再产出 highRisk');
eq(auReal.totals.review, undefined, 'totals 不再产出 review 计数');
eq(auReal.totals.byType.scalar.highRisk, undefined, 'byType 不再产出 highRisk');
eq(auReal.totals.byType.axis.highRisk, undefined, '按类型分组同样不产出 highRisk');
ok(!!auReal.totals.counts && !!auReal.totals.byType, '事实性计数字段照常保留（状态分项与类型分组）');
/* exceed 曾被误判为死指标：它由 summarizeAudit 用别名 t.exceed 消费，删掉会让摘要输出 "undefined 项"。
   这里锁住「它必须仍然存在且能被摘要读到」，避免下次再把别名引用当成无引用。 */
ok(typeof auReal.totals.exceed === 'number', 'totals.exceed 仍然存在（被 summarizeAudit 消费）');
var auAllow = C.buildFullAudit([mA, mini(S1, 'B.ALLOW.DCM')], { eps: 1e-9, allowDelta: 1 });
var allowLine = auAllow.summary.lines.filter(function (l) { return l.indexOf('允许偏差') >= 0; })[0] || '';
ok(/超差对象 \d+ 项/.test(allowLine) && allowLine.indexOf('undefined') < 0,
  '设置允许偏差时摘要给出超差对象计数（删掉 exceed 会输出 undefined 并变红）');

// 3) 新增 / 删除轴定义：都要显式列出
var axAdd = C.buildFullAudit([axA, axDcm([0, 1.1, 4, 5],
  ['STUETZSTELLENVERTEILUNG AX2 2', ' ST/X 1 2', 'END'], 'B3.DCM')], { eps: 1e-9 });
eq(axAdd.totals.counts.added, 1, 'B 版新增轴定义进入 added');
ok(axAdd.entries.some(function (e) { return e.type === 'axis' && e.status === 'added'; }),
  '新增轴定义有独立账目');
eq(axAdd.identity.ok, true, '新增轴定义场景恒等式通过');
var axDel = C.buildFullAudit([axA, axDcm(null, null, 'B4.DCM')], { eps: 1e-9 });
eq(axDel.totals.counts.deleted, 1, 'A 版独有轴定义进入 deleted');
ok(axDel.entries.some(function (e) { return e.type === 'axis' && e.status === 'deleted'; }),
  '删除轴定义有独立账目');
eq(axDel.identity.ok, true, '删除轴定义场景恒等式通过');

// 4) 还原：轴定义回到未变化，归零
var axSame = C.buildFullAudit([axA, axDcm([0, 1.1, 4, 5], null, 'B5.DCM')], { eps: 1e-9 });
eq(axSame.totals.counts.changed, 0, 'revert-to-fail：还原后轴定义变化归零');
eq(axSame.totals.counts.unchanged, 3, '还原后 3 条全部为未变化');
eq(axSame.identity.ok, true, '还原后恒等式仍通过');
// 5) 包装对象必须能复用差异引擎：x 是固定索引，断点值在 v 里
var axCmp = C.axisToComparable(axA.axisDefs[0], axA);
var axCmpB = C.axisToComparable(axDcm([0, 1.2, 4, 5], null, 'B6.DCM').axisDefs[0], axA);
eq(axCmp.type, 'axis', '轴定义包装对象类型为 axis');
eq(axCmp.v[0].join(','), '0,1.1,4,5', '断点值放在 v 里（不是对齐轴）');
eq(axCmp.x.join(','), '0,1,2,3', '对齐轴为固定索引，避免断点变化触发插值');
eq(C.computeDiff(axCmp, axCmpB, { eps: 1e-9 }).interpolated, false,
  '两版断点不同也逐点相减，不插值');

console.log('');
if (failures.length) {
  console.log('FAILED ' + failures.length + ' 项:');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('ALL PASS');
