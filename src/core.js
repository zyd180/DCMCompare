/* DCM core: parsing, indexing, alignment and diff. No DOM dependency. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DCMCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var KNOWN = [
    'FESTWERT', 'FESTWERTEBLOCK', 'GRUPPENKENNFELD', 'GRUPPENKENNLINIE',
    'FESTKENNLINIE', 'STUETZSTELLENVERTEILUNG', 'KENNFELD', 'KENNLINIE',
    'KENNFELD3D', 'GRUPPENKENNFELD3D', 'STUETZSTELLENVERTEILUNG3D'
  ];
  var KW = new RegExp('^(' + KNOWN.join('|') + ')\\s+(\\S+)((?:\\s+\\d+)*)\\s*$');
  var NUMRE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  var IGNORE_TOP = /^(KONSERVIERUNG_FORMAT|END|FUNKTIONEN|FKT)\b/;

  function nums(s) {
    var m = String(s).match(NUMRE);
    return m ? m.map(Number) : [];
  }

  function decodeDcm(buffer) {
    var text = null, encoding = '', note = '';
    if (typeof TextDecoder !== 'undefined') {
      var candidates = ['gbk', 'gb18030', 'gb2312'];
      for (var i = 0; i < candidates.length; i++) {
        try {
          text = new TextDecoder(candidates[i]).decode(buffer);
          encoding = candidates[i];
          break;
        } catch (e) { /* try next */ }
      }
    }
    if (text === null) {
      var bytes = new Uint8Array(buffer);
      var parts = [], CH = 8192;
      for (var p = 0; p < bytes.length; p += CH) {
        parts.push(String.fromCharCode.apply(null, bytes.subarray(p, p + CH)));
      }
      text = parts.join('');
      encoding = 'latin1';
      note = '当前环境不支持 GBK 解码，中文描述可能乱码；标定数值为 ASCII，不受影响。';
    }
    return { text: text, encoding: encoding, note: note };
  }

  function q(v) {
    var n = Number(v);
    if (!isFinite(n)) return 'NaN';
    return n.toFixed(9);
  }

  function axisSig(x, y) {
    return x.length + 'x' + y.length + ':' + x.map(q).join(',') + '|' + y.map(q).join(',');
  }

  function quoted(t) {
    var m = /"([^"]*)"/.exec(t);
    return m ? m[1] : '';
  }

  function parseDcm(text, fileName) {
    var lines = String(text).split(/\r?\n/);
    var id = 'ds_' + Math.random().toString(36).slice(2, 9);
    var ds = {
      id: id, fileName: fileName || 'DCM', lineCount: lines.length,
      blocks: [], maps: [], axisDefs: [], warnings: [], unknowns: [],
      stats: { totalBlocks: 0, byKind: {}, invalid: 0, unknownLines: 0 }
    };
    var i = 0;
    while (i < lines.length) {
      var t = lines[i].trim();
      if (t === '') { i++; continue; }
      if (t === 'FUNKTIONEN') {
        var k = i + 1;
        while (k < lines.length && lines[k].trim() !== 'END') k++;
        i = k + 1;
        continue;
      }
      var m = KW.exec(t);
      if (!m) {
        if (/^[A-Z][A-Z_0-9]*\b/.test(t) && !IGNORE_TOP.test(t)) {
          ds.unknowns.push({ line: i + 1, text: t.slice(0, 100) });
          ds.stats.unknownLines++;
        }
        i++;
        continue;
      }
      var kind = m[1], name = m[2];
      var dims = (m[3] || '').trim().split(/\s+/).filter(Boolean).map(Number);
      var startLine = i + 1;
      var body = [], j = i + 1;
      while (j < lines.length && lines[j].trim() !== 'END') {
        body.push({ t: lines[j].trim(), line: j + 1 });
        j++;
      }
      var endLine = j + 1;
      i = j + 1;

      var b = parseBlock(kind, name, dims, body, startLine, endLine, ds);
      ds.blocks.push(b);
      ds.stats.totalBlocks++;
      ds.stats.byKind[kind] = (ds.stats.byKind[kind] || 0) + 1;
      if (!b.valid) {
        ds.stats.invalid++;
        ds.warnings.push(fileName + ':' + startLine + ' ' + name + ' - ' + b.issues.join('; '));
      }
      if (b.type === 'axisDef') ds.axisDefs.push(b);
      else if (b.type) ds.maps.push(toMap(b, ds));
    }
    if (ds.unknowns.length) {
      ds.warnings.push('发现 ' + ds.unknowns.length + ' 行未识别的顶层关键字，已保留在报告中（未静默丢弃）。前 3 行: ' +
        ds.unknowns.slice(0, 3).map(function (u) { return u.line + ':' + u.text; }).join(' / '));
    }
    return ds;
  }

  function parseBlock(kind, name, dims, body, startLine, endLine, ds) {
    var b = {
      kind: kind, name: name, dims: dims, startLine: startLine, endLine: endLine,
      srcFile: ds.fileName, type: '', nx: 0, ny: 0, nz: 0,
      x: [], y: [], z: [], v: [], layers: [],
      units: { x: '', y: '', z: '', w: '' },
      langname: '', funktion: '', axisRefX: '', axisRefY: '',
      axisFromIndex: false, valid: true, issues: [], provisional: false,
      flatW: [], rowList: []
    };
    var curRow = null, curLayer = null;
    for (var n = 0; n < body.length; n++) {
      var t = body[n].t, line = body[n].line;
      if (t.charAt(0) === '*') {
        var parts = t.split(/\s+/);
        if (parts[0] === '*SSTX' && parts[1]) b.axisRefX = parts[1];
        else if (parts[0] === '*SSTY' && parts[1]) b.axisRefY = parts[1];
        else if (parts[0] === '*SSTZ' && parts[1]) b.axisRefZ = parts[1];
        continue;
      }
      if (t.indexOf('LANGNAME') === 0) { b.langname = quoted(t); continue; }
      if (t.indexOf('FUNKTION') === 0) { b.funktion = t.split(/\s+/)[1] || ''; continue; }
      if (t.indexOf('EINHEIT_') === 0) {
        var key = t.slice(8, 9).toLowerCase();
        if (b.units.hasOwnProperty(key)) b.units[key] = quoted(t);
        continue;
      }
      if (t.indexOf('ST/X') === 0) { b.x = b.x.concat(nums(t.slice(4))); continue; }
      if (t.indexOf('ST/Y') === 0) {
        var vy = nums(t.slice(4));
        b.y.push(vy.length ? vy[0] : b.y.length);
        curRow = [];
        b.rowList.push(curRow);
        continue;
      }
      if (t.indexOf('ST/Z') === 0) {
        var vz = nums(t.slice(4));
        b.z.push(vz.length ? vz[0] : b.z.length);
        curLayer = [];
        b.layers.push(curLayer);
        curRow = null;
        continue;
      }
      if (t.indexOf('WERT') === 0) {
        var vv = nums(t.slice(4));
        for (var w = 0; w < vv.length; w++) b.flatW.push(vv[w]);
        if (curLayer) {
          if (!curRow || (dims[0] && curRow.length >= dims[0])) { curRow = []; curLayer.push(curRow); }
          for (w = 0; w < vv.length; w++) curRow.push(vv[w]);
        } else if (curRow) {
          for (w = 0; w < vv.length; w++) curRow.push(vv[w]);
        }
        continue;
      }
      if (t !== '') b.issues.push('第 ' + line + ' 行未识别的子项: ' + t.slice(0, 60));
    }
    classify(b, dims);
    return b;
  }

  function classify(b, dims) {
    var k = b.kind;
    if (k === 'STUETZSTELLENVERTEILUNG' || k === 'STUETZSTELLENVERTEILUNG3D') {
      b.type = 'axisDef';
      b.nx = dims[0] || b.x.length;
      if (b.x.length !== b.nx) b.issues.push('轴点数 ' + b.x.length + ' 与声明 ' + b.nx + ' 不符');
      b.valid = b.issues.length === 0;
      return;
    }
    if (k === 'FESTWERT') {
      b.type = 'scalar'; b.nx = 1; b.ny = 1;
      b.x = [0]; b.y = [0]; b.axisFromIndex = true;
      b.v = [[b.flatW.length ? b.flatW[0] : 0]];
    } else if (k === 'FESTWERTEBLOCK') {
      b.type = 'array'; b.nx = dims[0] || b.flatW.length; b.ny = 1;
      b.x = range(b.nx); b.y = [0]; b.axisFromIndex = true;
      b.v = [b.flatW.slice(0, b.nx)];
    } else if (k === 'GRUPPENKENNLINIE' || k === 'FESTKENNLINIE' || k === 'KENNLINIE') {
      b.type = 'curve'; b.nx = dims[0] || b.flatW.length; b.ny = 1;
      if (!b.x.length) { b.x = range(b.nx); b.axisFromIndex = true; }
      b.y = [0];
      b.v = [b.flatW.slice(0, b.nx)];
    } else if (k === 'GRUPPENKENNFELD' || k === 'KENNFELD') {
      b.type = 'map2d'; b.nx = dims[0] || 0; b.ny = dims[1] || 0;
      if (!b.x.length) { b.x = range(b.nx); b.axisFromIndex = true; }
      b.v = b.rowList.length ? b.rowList.map(function (r) { return r.slice(); }) : chunk(b.flatW, b.nx);
      if (!b.y.length) { b.y = range(b.ny); }
    } else {
      b.type = 'map3d'; b.nx = dims[0] || 0; b.ny = dims[1] || 0; b.nz = dims[2] || 0;
      b.provisional = true;
      if (!b.x.length) b.x = range(b.nx);
      if (!b.y.length) b.y = range(b.ny);
      if (!b.z.length) b.z = range(b.nz);
      b.layers = b.layers.length ? b.layers : [chunk(b.flatW, b.nx)];
      b.layers = b.layers.map(function (L) { return L.length ? L : chunk(b.flatW, b.nx); });
      b.v = b.layers[0] || [];
    }
    var expected = b.nx * b.ny;
    var got = b.type === 'map3d' ? countCells(b.layers) : countCells([b.v]);
    if (b.nx <= 0 || b.ny <= 0) { b.issues.push('缺少维度声明'); }
    if (b.type === 'curve' || b.type === 'array') {
      if (b.flatW.length !== b.nx) b.issues.push('WERT 点数 ' + b.flatW.length + ' 与声明 ' + b.nx + ' 不符');
      if (b.x.length !== b.nx) b.issues.push('ST/X 点数 ' + b.x.length + ' 与声明 ' + b.nx + ' 不符');
    } else if (b.type === 'map2d') {
      if (b.x.length !== b.nx) b.issues.push('ST/X 点数 ' + b.x.length + ' 与声明 ' + b.nx + ' 不符');
      if (b.v.length !== b.ny) b.issues.push('ST/Y 行数 ' + b.v.length + ' 与声明 ' + b.ny + ' 不符');
      else for (var r = 0; r < b.v.length; r++) {
        if (b.v[r].length !== b.nx) b.issues.push('第 ' + (r + 1) + ' 行 WERT 点数 ' + b.v[r].length + ' 应为 ' + b.nx);
      }
      if (b.flatW.length !== expected) b.issues.push('WERT 总点数 ' + b.flatW.length + ' 应为 ' + expected);
    } else if (b.type === 'map3d') {
      if (got !== expected * (b.nz || 1)) b.issues.push('三轴表数据点数 ' + got + ' 与声明不符（该格式未经实测，按推测规则解析）');
    }
    b.valid = b.issues.length === 0;
  }

  function range(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }
  function chunk(a, n) {
    var out = [];
    if (!n) return out;
    for (var i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
    return out;
  }
  function countCells(layers) {
    var c = 0;
    for (var i = 0; i < layers.length; i++) for (var j = 0; j < layers[i].length; j++) c += layers[i][j].length;
    return c;
  }

  function toMap(b, ds) {
    return {
      key: ds.id + '::' + b.name, id: ds.id, name: b.name, type: b.type,
      nx: b.nx, ny: b.ny, nz: b.nz, x: b.x, y: b.y, z: b.z,
      v: b.v, layers: b.layers, units: b.units, langname: b.langname,
      funktion: b.funktion, axisRefX: b.axisRefX, axisRefY: b.axisRefY,
      axisFromIndex: b.axisFromIndex, provisional: b.provisional,
      valid: b.valid, issues: b.issues.slice(),
      srcFile: b.srcFile, startLine: b.startLine, endLine: b.endLine,
      axisSig: axisSig(b.x, b.y), label: b.name
    };
  }

  /* 轴定义升级为正式标定量：STUETZSTELLENVERTEILUNG 的断点值放在 x 里、v 为空，
     这里把它包装成标准的一维可比对象（断点是「值」、对齐轴是固定索引）。
     若把断点值本身当对齐轴，A/B 断点一变就会被 alignMaps 判为「轴不同」并双线性插值，
     那会得到一张看着正常、其实全错的表。固定索引轴保证逐点相减，不做插值。 */
  function axisToComparable(d, ds) {
    var n = d.x.length, idx = [];
    for (var i = 0; i < n; i++) idx.push(i);
    return {
      key: ds.id + '::axis::' + d.name, id: ds.id, name: d.name, type: 'axis',
      nx: n, ny: 1, nz: 0, x: idx, y: [0], z: [],
      v: [d.x.slice()], layers: [],
      units: { x: '', y: '', z: '', w: (d.units && d.units.x) || '' },
      langname: d.langname || '', funktion: d.funktion || '',
      axisRefX: '', axisRefY: '', axisFromIndex: true, provisional: false,
      valid: d.valid !== false, issues: (d.issues || []).slice(),
      srcFile: d.srcFile, startLine: d.startLine, endLine: d.endLine,
      axisSig: '', label: d.name, isAxisDef: true
    };
  }

  function buildIndex(datasets) {
    var all = [], groups = {}, nameGroups = {};
    datasets.forEach(function (ds) {
      ds.maps.forEach(function (m) {
        if (!m.valid) return;
        m.label = shortLabel(m.name, ds.fileName);
        all.push(m);
        var ng = nameGroups[m.name] || (nameGroups[m.name] = { name: m.name, items: [] });
        ng.items.push(m);
        if (m.axisFromIndex) return; // 标量与索引轴数组没有真实轴，不参与同轴聚类
        var sig = (m.ny > 1 ? 'M:' : 'C:') + m.axisSig;
        var g = groups[sig] || (groups[sig] = {
          sig: sig, nx: m.nx, ny: m.ny, x: m.x, y: m.y,
          kind: m.ny > 1 ? 'map2d' : 'curve', maps: []
        });
        g.maps.push(m);
      });
    });
    var groupList = Object.keys(groups).map(function (k) { return groups[k]; });
    groupList.sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind === 'map2d' ? -1 : 1;
      return b.maps.length - a.maps.length || b.nx * b.ny - a.nx * a.ny;
    });
    var versionGroups = Object.keys(nameGroups).map(function (k) { return nameGroups[k]; })
      .filter(function (g) { return g.items.length > 1; })
      .sort(function (a, b) { return b.items.length - a.items.length; });
    return { all: all, groups: groupList, versionGroups: versionGroups };
  }

  function shortLabel(name, file) {
    return name + ' [' + String(file).replace(/\.[^.]+$/, '') + ']';
  }

  function arrEq(a, b, eps) {
    if (!a || !b || a.length !== b.length) return false;
    eps = eps || 1e-9;
    for (var i = 0; i < a.length; i++) {
      var scale = Math.max(1, Math.abs(a[i]), Math.abs(b[i]));
      if (Math.abs(a[i] - b[i]) > eps * scale) return false;
    }
    return true;
  }

  function axisFrac(arr, v) {
    if (!arr || arr.length === 0) return { a: 0, b: 0, t: 0 };
    if (arr.length === 1) return { a: 0, b: 0, t: 0 };
    for (var k = 0; k < arr.length - 1; k++) {
      var lo = Math.min(arr[k], arr[k + 1]), hi = Math.max(arr[k], arr[k + 1]);
      if (v >= lo && v <= hi) {
        var d = arr[k + 1] - arr[k];
        return { a: k, b: k + 1, t: d === 0 ? 0 : (v - arr[k]) / d };
      }
    }
    var last = arr.length - 1;
    if ((arr[last] > arr[0] && v > arr[last]) || (arr[last] < arr[0] && v < arr[last])) return { a: last, b: last, t: 0 };
    return { a: 0, b: 0, t: 0 };
  }

  function bilinearAt(m, xq, yq) {
    var ax = axisFrac(m.x, xq), ay = axisFrac(m.y, yq);
    var r0 = m.v[ay.a] || [], r1 = m.v[ay.b] || [];
    var v00 = r0[ax.a], v10 = r0[ax.b], v01 = r1[ax.a], v11 = r1[ax.b];
    var f = function (v, fb) { return isFinite(v) ? v : (isFinite(fb) ? fb : 0); };
    v00 = f(v00, 0); v10 = f(v10, v00); v01 = f(v01, v00); v11 = f(v11, v10);
    return (v00 * (1 - ax.t) + v10 * ax.t) * (1 - ay.t) + (v01 * (1 - ax.t) + v11 * ax.t) * ay.t;
  }

  function axisHealth(arr) {
    var issues = [];
    if (!arr || arr.length < 2) return { ok: true, issues: issues };
    var inc = 0, dec = 0;
    for (var i = 1; i < arr.length; i++) {
      var d = arr[i] - arr[i - 1];
      if (d > 0) inc++;
      else if (d < 0) dec++;
      else issues.push('重复断点 @' + i + ' = ' + fmt(arr[i], 4));
    }
    if (inc > 0 && dec > 0) issues.unshift('轴断点非单调（同时存在递增与递减区间）');
    return { ok: issues.length === 0, issues: issues };
  }

  function alignMaps(base, other) {
    if (base.nx !== other.nx || base.ny !== other.ny) {
      return {
        ok: false,
        reason: '维度不同：基准 ' + base.nx + '×' + base.ny + '，对比 ' + other.nx + '×' + other.ny + '。已拒绝对比，不做硬凑。'
      };
    }
    var same = arrEq(base.x, other.x) && arrEq(base.y, other.y);
    if (same) return { ok: true, v: other.v, interpolated: false };
    var problems = [];
    [['对比 X', other.x], ['对比 Y', other.y], ['基准 X', base.x], ['基准 Y', base.y]].forEach(function (p) {
      var h = axisHealth(p[1]);
      if (!h.ok) problems.push(p[0] + ' 轴: ' + h.issues.join('；'));
    });
    if (problems.length) {
      return {
        ok: false, axisUnsafe: true,
        reason: '轴刻度不一致且轴断点不健康，双线性插值会取错区间，已拒绝对比（不是给一个看着正常的错误结果）：' +
          problems.join(' / ')
      };
    }
    var out = [];
    for (var j = 0; j < base.ny; j++) {
      var row = [];
      for (var i = 0; i < base.nx; i++) row.push(bilinearAt(other, base.x[i], base.y[j]));
      out.push(row);
    }
    return { ok: true, v: out, interpolated: true };
  }

  function computeDiff(base, other, opts) {
    opts = opts || {};
    var eps = typeof opts.eps === 'number' ? opts.eps : 1e-9;
    var relMode = opts.mode === 'relative';
    var al = alignMaps(base, other);
    if (!al.ok) return { ok: false, reason: al.reason, axisUnsafe: !!al.axisUnsafe, base: base, other: other };
    var mag = 0;
    for (var mj = 0; mj < base.ny; mj++) for (var mi = 0; mi < base.nx; mi++) {
      var mv = Math.abs(base.v[mj][mi]);
      if (isFinite(mv) && mv > mag) mag = mv;
    }
    var zeroTol = typeof opts.zeroTol === 'number' ? opts.zeroTol : Math.max(1e-12, mag * 1e-9);
    var abs = [], rel = [], changedCells = [];
    var maxAbs = 0, sumAbs = 0, minSigned = Infinity, maxSigned = -Infinity;
    var minI = Infinity, maxI = -Infinity, minJ = Infinity, maxJ = -Infinity;
    for (var j = 0; j < base.ny; j++) {
      var ar = [], rr = [];
      for (var i = 0; i < base.nx; i++) {
        var a = base.v[j][i], b = al.v[j][i];
        var d = b - a;
        var ad = Math.abs(d);
        var rv = Math.abs(a) < zeroTol ? null : (d / Math.abs(a)) * 100;
        ar.push(d); rr.push(rv);
        sumAbs += ad;
        if (ad > maxAbs) maxAbs = ad;
        if (d < minSigned) minSigned = d;
        if (d > maxSigned) maxSigned = d;
        if (ad > eps) {
          changedCells.push({
            i: i, j: j, x: base.x[i], y: base.y[j],
            a: a, b: b, delta: d, rel: rv, interpolated: al.interpolated
          });
          if (i < minI) minI = i; if (i > maxI) maxI = i;
          if (j < minJ) minJ = j; if (j > maxJ) maxJ = j;
        }
      }
      abs.push(ar); rel.push(rr);
    }
    var total = base.nx * base.ny;
    return {
      ok: true, base: base, other: other, interpolated: al.interpolated,
      nx: base.nx, ny: base.ny, x: base.x, y: base.y,
      a: base.v, b: al.v, abs: abs, rel: rel, relMode: relMode, zeroTol: zeroTol,
      stats: {
        total: total, changed: changedCells.length, ratio: total ? changedCells.length / total : 0,
        maxAbs: maxAbs, minSigned: isFinite(minSigned) ? minSigned : 0,
        maxSigned: isFinite(maxSigned) ? maxSigned : 0,
        meanAbs: total ? sumAbs / total : 0,
        bbox: changedCells.length ? { minI: minI, maxI: maxI, minJ: minJ, maxJ: maxJ } : null,
        changedCells: changedCells
      }
    };
  }

  function computeAllDiffs(base, others, opts) {
    var diffs = others.map(function (o) { return computeDiff(base, o, opts); });
    var ok = diffs.filter(function (d) { return d.ok; });
    var env = null;
    if (ok.length && base.nx && base.ny) {
      var maxAbs = [], which = [];
      for (var j = 0; j < base.ny; j++) {
        var mr = [], wr = [];
        for (var i = 0; i < base.nx; i++) {
          var best = 0, idx = -1;
          ok.forEach(function (d, k) {
            var v = Math.abs(d.abs[j][i]);
            if (v > best) { best = v; idx = k; }
          });
          mr.push(best); wr.push(idx);
        }
        maxAbs.push(mr); which.push(wr);
      }
      env = { maxAbs: maxAbs, which: which, count: ok.length };
    }
    return { diffs: diffs, envelope: env };
  }

  /* 按量纲推算变化判定阈值：开关量/枚举量沿用 1e-9，连续量按量级取相对精度。 */
  function suggestEps(base) {
    var mag = 0, intLike = true;
    for (var j = 0; j < base.v.length; j++) for (var i = 0; i < base.v[j].length; i++) {
      var v = base.v[j][i];
      if (!isFinite(v)) continue;
      if (Math.abs(v) > mag) mag = Math.abs(v);
      if (v !== Math.round(v)) intLike = false;
    }
    var unit = (base.units && base.units.w) || '';
    if (mag < 1e-12) return { eps: 1e-9, basis: '基准全零，沿用 1e-9' };
    if (intLike && mag <= 16) {
      return { eps: 1e-9, basis: '整数枚举/开关量（量级 ' + fmt(mag, 2) + '），沿用 1e-9' };
    }
    var eps = Math.max(1e-9, mag * 1e-6);
    if (/%|percent|perc/i.test(unit)) eps = Math.max(eps, 1e-4);
    return { eps: eps, basis: '量级 ' + fmt(mag, 3) + ' × 1e-6' + (unit ? '（单位 ' + unit + '）' : '') };
  }

  /* 标定变更体检：孤立突变点 + 沿轴趋势反转。 */
  function inspectDiff(diff, opts) {
    opts = opts || {};
    if (!diff || !diff.ok) return { ok: false };
    var nx = diff.nx, ny = diff.ny;
    var eps = typeof opts.eps === 'number' ? opts.eps : 1e-9;
    var changed = [], count = 0, j, k;
    for (j = 0; j < ny; j++) {
      var row = [];
      for (k = 0; k < nx; k++) {
        var c = Math.abs(diff.abs[j][k]) > eps;
        row.push(c); if (c) count++;
      }
      changed.push(row);
    }
    var isolated = [], NB = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (j = 0; j < ny; j++) for (k = 0; k < nx; k++) {
      if (!changed[j][k]) continue;
      var neighbours = 0;
      for (var n = 0; n < NB.length; n++) {
        var ii = k + NB[n][0], jj = j + NB[n][1];
        if (ii >= 0 && ii < nx && jj >= 0 && jj < ny && changed[jj][ii]) neighbours++;
      }
      if (neighbours === 0) {
        isolated.push({ i: k, j: j, x: diff.x[k], y: diff.y[j],
          a: diff.a[j][k], b: diff.b[j][k], delta: diff.abs[j][k] });
      }
    }
    function scan(seqA, seqB, axisVals, label, fixedIndex, fixedValue) {
      var res = [];
      for (var t = 0; t < seqA.length - 1; t++) {
        var da = seqA[t + 1] - seqA[t], db = seqB[t + 1] - seqB[t];
        if (Math.abs(da) <= eps || Math.abs(db) <= eps) continue;
        if (da * db < 0) res.push({
          axis: label, fixedIndex: fixedIndex, fixedValue: fixedValue,
          at: t, from: axisVals[t], to: axisVals[t + 1],
          baseStep: da, otherStep: db
        });
      }
      return res;
    }
    var mono = [];
    for (j = 0; j < ny; j++) mono = mono.concat(scan(diff.a[j], diff.b[j], diff.x, 'X', j, diff.y[j]));
    for (k = 0; k < nx; k++) {
      var ca = [], cb = [];
      for (j = 0; j < ny; j++) { ca.push(diff.a[j][k]); cb.push(diff.b[j][k]); }
      mono = mono.concat(scan(ca, cb, diff.y, 'Y', k, diff.x[k]));
    }
    var risk = isolated.length ? 'high' : (mono.length ? 'medium' : (count ? 'low' : 'none'));
    return {
      ok: true, eps: eps, changed: count, isolated: isolated,
      monotonic: mono,
      monoX: mono.filter(function (m) { return m.axis === 'X'; }),
      monoY: mono.filter(function (m) { return m.axis === 'Y'; }),
      risk: risk
    };
  }

  /* ---------- 跨版本改名对齐 ---------- */
  function normalizeName(n) {
    return String(n || '').replace(/_V\d+$/i, '').replace(/_\d+$/, '').toLowerCase();
  }

  function nameTokens(n) {
    return String(n || '')
      .replace(/_V\d+$/i, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .split(/[^a-z0-9]+/).filter(function (t) { return t.length > 1; });
  }

  function nameSim(a, b) {
    var na = normalizeName(a), nb = normalizeName(b);
    if (na === nb) return 1;
    var ta = nameTokens(a), tb = nameTokens(b);
    var sa = {}, sb = {}, inter = 0, union = 0;
    ta.forEach(function (t) { sa[t] = 1; });
    tb.forEach(function (t) { sb[t] = 1; });
    Object.keys(sa).forEach(function (k) { union++; if (sb[k]) inter++; });
    Object.keys(sb).forEach(function (k) { if (!sa[k]) union++; });
    var jac = union ? inter / union : 0;
    var l = 0, mn = Math.min(na.length, nb.length), mx = Math.max(na.length, nb.length);
    while (l < mn && na.charAt(l) === nb.charAt(l)) l++;
    return 0.6 * jac + 0.4 * (mx ? l / mx : 0);
  }

  function unitsEq(a, b) {
    var ua = a.units || {}, ub = b.units || {};
    return ['x', 'y', 'z', 'w'].every(function (k) { return (ua[k] || '') === (ub[k] || ''); });
  }

  function valueSim(a, b, eps) {
    if (!a || !b || a.nx !== b.nx || a.ny !== b.ny) {
      return { sim: 0, same: 0, total: 0, meanAbs: 0 };
    }
    var tol = typeof eps === 'number' ? eps : 1e-9;
    var total = a.nx * a.ny, same = 0, sum = 0;
    for (var j = 0; j < a.ny; j++) for (var i = 0; i < a.nx; i++) {
      var va = a.v[j][i], vb = b.v[j][i];
      if (!isFinite(va) || !isFinite(vb)) continue;
      var d = Math.abs(va - vb);
      sum += d;
      if (d <= tol * Math.max(1, Math.abs(va), Math.abs(vb))) same++;
    }
    return { sim: total ? same / total : 0, same: same, total: total, meanAbs: total ? sum / total : 0 };
  }

  function mapRef(m) {
    return {
      name: m.name, key: m.key, srcFile: m.srcFile, startLine: m.startLine,
      nx: m.nx, ny: m.ny, funktion: m.funktion, type: m.type
    };
  }

  /* 只在相邻两版之间找「改名」：先精确同名，再对仅出现在一版的对象匹配。
     必须同时满足 名称相似 + 维度/轴指纹一致 + 数值相似，并做双向唯一约束，
     否则同轴且数值相同的 60 张模式表会被乱配成对。 */
  function matchRenamed(datasets, opts) {
    opts = opts || {};
    var minScore = opts.minScore === undefined ? 0.72 : opts.minScore;
    var minValueSim = opts.minValueSim === undefined ? 0.75 : opts.minValueSim;
    var minNameSim = opts.minNameSim === undefined ? 0.25 : opts.minNameSim;
    var minCells = opts.minCells === undefined ? 4 : opts.minCells;
    if (!datasets || datasets.length < 2) {
      return { ok: false, reason: '改名对齐需要至少 2 份 DCM', pairs: [], total: 0 };
    }
    var pairs = [];
    for (var di = 0; di < datasets.length - 1; di++) {
      var A = datasets[di], B = datasets[di + 1];
      var mapA = {}, mapB = {};
      A.maps.forEach(function (m) { if (m.valid && m.nx * m.ny >= minCells) mapA[m.name] = m; });
      B.maps.forEach(function (m) { if (m.valid && m.nx * m.ny >= minCells) mapB[m.name] = m; });
      var exact = 0, onlyA = [], onlyB = [];
      Object.keys(mapA).forEach(function (n) { if (mapB[n]) exact++; else onlyA.push(mapA[n]); });
      Object.keys(mapB).forEach(function (n) { if (!mapA[n]) onlyB.push(mapB[n]); });
      var buckets = {};
      onlyB.forEach(function (m) {
        var k = m.nx + 'x' + m.ny + ':' + m.axisSig;
        (buckets[k] || (buckets[k] = [])).push(m);
      });
      var cands = [];
      onlyA.forEach(function (a) {
        var k = a.nx + 'x' + a.ny + ':' + a.axisSig;
        (buckets[k] || []).forEach(function (b) {
          var ns = nameSim(a.name, b.name);
          if (ns < minNameSim) return;
          var vs = valueSim(a, b, opts.eps);
          if (vs.sim < minValueSim) return;
          var fSame = !!(a.funktion && a.funktion === b.funktion);
          var uSame = unitsEq(a, b);
          var score = 0.55 * vs.sim + 0.30 * ns + (fSame ? 0.08 : 0) + (uSame ? 0.07 : 0);
          if (score < minScore) return;
          var confidence = (vs.sim >= 0.98 && ns >= 0.6) ? 'high' : (score >= 0.82 ? 'medium' : 'low');
          var reasons = [
            '维度与轴指纹完全一致 (' + a.nx + '×' + a.ny + ')',
            '数值相同 ' + vs.same + '/' + vs.total + ' 格 (' + (vs.sim * 100).toFixed(1) + '%)',
            '名称相似度 ' + ns.toFixed(3) + '（归一化: ' + normalizeName(a.name) + ' / ' + normalizeName(b.name) + '）'
          ];
          if (fSame) reasons.push('同一 FUNKTION: ' + a.funktion);
          if (uSame && (a.units.w || a.units.x)) reasons.push('单位一致: ' + (a.units.w || a.units.x));
          cands.push({
            a: mapRef(a), b: mapRef(b), valueSim: vs.sim, sameCells: vs.same,
            totalCells: vs.total, meanAbs: vs.meanAbs, nameSim: ns, score: score,
            confidence: confidence, reasons: reasons, axisMatch: true
          });
        });
      });
      cands.sort(function (x, y) { return y.score - x.score || y.valueSim - x.valueSim; });
      var usedA = {}, usedB = {}, picked = [];
      cands.forEach(function (c) {
        if (usedA[c.a.key] || usedB[c.b.key]) return;
        usedA[c.a.key] = 1; usedB[c.b.key] = 1; picked.push(c);
      });
      pairs.push({
        fileA: A.fileName, fileB: B.fileName, exact: exact,
        onlyA: onlyA.length, onlyB: onlyB.length, candidates: picked
      });
    }
    var total = pairs.reduce(function (s, p) { return s + p.candidates.length; }, 0);
    return {
      ok: true, pairs: pairs, total: total,
      settings: { minScore: minScore, minValueSim: minValueSim, minNameSim: minNameSim, minCells: minCells }
    };
  }

  /* ---------- 结论层：把差异翻译成工程判断 ---------- */
  var PATTERN_LABEL = {
    none: '无变化', single_point: '单点修正', global_scale: '整体缩放',
    shape_change: '形状重构', local_patch: '局部调整', value_change: '单值调整',
    mixed: '多种模式混合'
  };
  var VERDICT_LABEL = { pass: '可放行', review: '需人工复核', reject: '建议驳回' };
  var TYPE_LABEL = {
    scalar: '标量 FESTWERT', array: '数组 FESTWERTEBLOCK',
    curve: '曲线 KENNLINIE', map2d: '二维 MAP KENNFELD',
    axis: '轴定义 STUETZSTELLENVERTEILUNG',
    map3d: '三轴表（格式未实测）', unknown: '未分类对象'
  };
  var STATUS_LABEL = {
    changed: '有变化', unchanged: '未变化', rejected: '对比被拒绝',
    added: 'B 版新增', deleted: 'B 版删除'
  };

  /* 体检风险档位。review 不是笔误、也不能并进 medium：
     它专指「结构性变化或无法逐点比较，需人工确认」——三轴表、轴断点增删、对比被拒绝三种情形。
     语义与 high（数值改动有高危信号）不同，合并会丢掉「为什么需要人看」这个信息。
     凡是判断「这一项要不要人复核」，一律走 isRiskItem()，不要各自写条件。 */
  var RISK_LEVELS = ['high', 'medium', 'low', 'review', 'none'];
  var RISK_LABEL = { high: '高', medium: '中', low: '低', review: '需人工确认', none: '无' };
  function isRiskItem(e) {
    if (!e) return false;
    return e.risk === 'high' || e.risk === 'review' ||
      e.verdict === 'reject' || e.verdict === 'review';
  }

  function connectedRegions(mask, nx, ny, mag) {
    var seen = [], regions = [], NB = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (var j = 0; j < ny; j++) {
      var row = [];
      for (var i = 0; i < nx; i++) row.push(false);
      seen.push(row);
    }
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
      if (!mask[j][i] || seen[j][i]) continue;
      var q = [[i, j]], cells = [], head = 0, maxA = 0;
      seen[j][i] = true;
      while (head < q.length) {
        var p = q[head++];
        cells.push(p);
        var mv = mag ? mag[p[1]][p[0]] : 0;
        if (mv > maxA) maxA = mv;
        for (var k = 0; k < 4; k++) {
          var ii = p[0] + NB[k][0], jj = p[1] + NB[k][1];
          if (ii >= 0 && ii < nx && jj >= 0 && jj < ny && mask[jj][ii] && !seen[jj][ii]) {
            seen[jj][ii] = true; q.push([ii, jj]);
          }
        }
      }
      var minI = nx, maxI = -1, minJ = ny, maxJ = -1;
      cells.forEach(function (c) {
        if (c[0] < minI) minI = c[0]; if (c[0] > maxI) maxI = c[0];
        if (c[1] < minJ) minJ = c[1]; if (c[1] > maxJ) maxJ = c[1];
      });
      regions.push({ cells: cells, minI: minI, maxI: maxI, minJ: minJ, maxJ: maxJ,
        count: cells.length, maxAbs: maxA });
    }
    return regions;
  }

  function quantileRange(vals, axisVals) {
    if (!vals.length) return null;
    var s = vals.slice().sort(function (a, b) { return a - b; });
    var lo = s[Math.floor((s.length - 1) * 0.1)];
    var hi = s[Math.floor((s.length - 1) * 0.9)];
    var inside = s.filter(function (v) { return v >= lo && v <= hi; }).length;
    return { from: axisVals[lo], to: axisVals[hi], i0: lo, i1: hi, share: inside / s.length };
  }

  function analyzeOne(d, opts) {
    opts = opts || {};
    var nx = d.nx, ny = d.ny, total = nx * ny;
    var eps = typeof opts.eps === 'number' ? opts.eps : 1e-9;
    var allow = typeof opts.allowDelta === 'number' && isFinite(opts.allowDelta) ? opts.allowDelta : null;
    var mask = [], mag = [], changed = 0, pos = 0, neg = 0, absDs = [];
    var maxAbs = 0, iList = [], jList = [];
    for (var j = 0; j < ny; j++) {
      var mr = [], ar = [];
      for (var i = 0; i < nx; i++) {
        var v = d.abs[j][i], ad = Math.abs(v), ch = ad > eps;
        mr.push(ch); ar.push(ad);
        if (ch) {
          changed++; if (v > 0) pos++; else neg++;
          absDs.push(ad); iList.push(i); jList.push(j);
        }
        if (ad > maxAbs) maxAbs = ad;
      }
      mask.push(mr); mag.push(ar);
    }
    var ratio = total ? changed / total : 0;
    var signRatio = changed ? Math.max(pos, neg) / changed : 0;
    var meanAbs = changed ? absDs.reduce(function (a, b) { return a + b; }, 0) / changed : 0;
    var sd = 0;
    if (changed > 1) {
      sd = Math.sqrt(absDs.reduce(function (a, b) { return a + (b - meanAbs) * (b - meanAbs); }, 0) / changed);
    }
    var cv = meanAbs > 0 ? sd / meanAbs : 0;
    var ins = inspectForType(d, { eps: eps });
    var isolated = ins.isolated.length, monotonic = ins.monotonic.length;
    var otype = ins.type;
    var pattern;
    if (!changed) pattern = 'none';
    else if (otype === 'scalar') pattern = 'value_change';
    else if (ratio <= 0.05 && isolated > 0) pattern = 'single_point';
    else if (ratio >= 0.8 && cv < 0.35 && signRatio >= 0.9) pattern = 'global_scale';
    else if (ratio >= 0.8) pattern = 'shape_change';
    else pattern = 'local_patch';
    var direction = !changed ? 'flat' :
      (signRatio >= 0.9 ? (pos >= neg ? 'increase' : 'decrease') : 'mixed');
    var xr = quantileRange(iList, d.x), yr = quantileRange(jList, d.y);
    var exceedMask = allow !== null ?
      mag.map(function (r) { return r.map(function (v) { return v > allow; }); }) : null;
    var exceed = exceedMask ? connectedRegions(exceedMask, nx, ny, mag) : [];
    var reasons = [], verdict = 'pass';
    // 标量 / 三轴表没有可用的二维邻域，不能拿「孤立点」当驳回依据
    if (ins.applicable && isolated > 0) { verdict = 'reject'; reasons.push('检出 ' + isolated + ' 个孤立突变点'); }
    if (monotonic > 0) {
      if (pattern === 'shape_change') {
        verdict = 'reject';
        reasons.push('检出 ' + monotonic + ' 处沿轴趋势反转，伴随整表形状重构');
      } else {
        if (verdict === 'pass') verdict = 'review';
        reasons.push('检出 ' + monotonic + ' 处趋势反转，多为改动区块边界效应，需确认边界是否平滑');
      }
    }
    if (pattern === 'shape_change' && verdict !== 'reject') {
      verdict = 'review'; reasons.push('整表形状重构，幅度或方向不一致');
    }
    if (exceed.length && verdict !== 'reject') {
      verdict = 'review'; reasons.push('存在 ' + exceed.length + ' 处超过允许偏差的工况区间');
    }
    if (d.interpolated && verdict === 'pass') {
      verdict = 'review'; reasons.push('数值经插值对齐，不是原始逐格值');
    }
    if (!reasons.length) {
      reasons.push(ins.applicable ? '未发现孤立突变点、趋势反转或超差区间' :
        (ins.note || '单值/一维对象按类型判定') + '；未超过允许偏差');
    }
    return {
      label: d.other.label || d.other.name, nx: nx, ny: ny, total: total,
      type: otype, typeLabel: ins.typeLabel, applicable: ins.applicable,
      inspectNote: ins.note,
      changed: changed, ratio: ratio, signRatio: signRatio,
      pattern: pattern, patternLabel: PATTERN_LABEL[pattern], direction: direction,
      meanAbs: meanAbs, cv: cv, maxAbs: maxAbs,
      isolated: isolated, monotonic: monotonic,
      hotspot: { x: xr, y: yr }, exceedRegions: exceed, allowDelta: allow,
      verdict: verdict, verdictLabel: VERDICT_LABEL[verdict], reasons: reasons,
      axisX: d.x, axisY: d.y, units: d.base.units || {}
    };
  }

  function summarizeDiff(diffs, opts) {
    opts = opts || {};
    var good = diffs.filter(function (d) { return d && d.ok; });
    if (!good.length) {
      return { ok: false, lines: ['没有可执行的对比。'], per: [],
        pattern: 'none', exceedRegions: [] };
    }
    var per = good.map(function (d) { return analyzeOne(d, opts); });
    var pats = {};
    per.forEach(function (p) { pats[p.pattern] = (pats[p.pattern] || 0) + 1; });
    var pattern = Object.keys(pats).length === 1 ? per[0].pattern : 'mixed';
    var totalChanged = per.reduce(function (s, p) { return s + p.changed; }, 0);
    var maxAbs = per.reduce(function (s, p) { return Math.max(s, p.maxAbs); }, 0);
    var iso = per.reduce(function (s, p) { return s + p.isolated; }, 0);
    var mono = per.reduce(function (s, p) { return s + p.monotonic; }, 0);
    var allExceed = [];
    per.forEach(function (p) {
      p.exceedRegions.forEach(function (r) {
        allExceed.push({
          label: p.label, xFrom: p.axisX[r.minI], xTo: p.axisX[r.maxI],
          yFrom: p.axisY[r.minJ], yTo: p.axisY[r.maxJ], count: r.count,
          maxAbs: r.maxAbs, units: p.units
        });
      });
    });
    allExceed.sort(function (a, b) { return b.maxAbs - a.maxAbs; });
    var best = per.slice().sort(function (a, b) { return b.changed - a.changed; })[0];
    var dirLabel = { increase: '整体抬高', decrease: '整体压低', mixed: '有升有降', flat: '无变化' }[best.direction];
    var lines = [];
    lines.push('本次共 ' + good.length + ' 项对比，累计 ' + totalChanged +
      ' 个工况格发生变化（单表 ' + best.total + ' 格）。');
    lines.push('主导改动模式：' + PATTERN_LABEL[pattern] + '；方向：' + dirLabel +
      '；最大 |Δ| = ' + fmt(maxAbs) + '。');
    if (best.type === 'map2d' && best.hotspot.x && best.hotspot.y) {
      lines.push('变化最密集的工况区间：X ' + fmt(best.hotspot.x.from, 3) + ' ~ ' +
        fmt(best.hotspot.x.to, 3) + ' ' + (best.units.x || '') + '，Y ' +
        fmt(best.hotspot.y.from, 3) + ' ~ ' + fmt(best.hotspot.y.to, 3) + ' ' +
        (best.units.y || '') + '，覆盖约 ' + (best.hotspot.x.share * 100).toFixed(0) + '% 的变化格。');
    } else if ((best.type === 'array' || best.type === 'curve') && best.hotspot.x) {
      lines.push('变化最密集的 ' + (best.type === 'curve' ? 'X 轴' : '索引') + '区间：' +
        fmt(best.hotspot.x.from, 3) + ' ~ ' + fmt(best.hotspot.x.to, 3) + ' ' +
        (best.units.x || '') + '（一维对象，无 Y 轴维度）。');
    } else if (best.type === 'scalar') {
      lines.push('主导项为标量（单值），不涉及工况区间；max |Δ| = ' + fmt(best.maxAbs) + '。');
    }
    lines.push('体检汇总：孤立突变点 ' + iso + ' 个，沿轴趋势反转 ' + mono + ' 处。');
    if (per.some(function (p) { return !p.applicable; })) {
      lines.push('注：标量/一维对象按类型分派体检，标量无邻域概念，孤立点与趋势反转判据对其不适用。');
    }
    var allow = typeof opts.allowDelta === 'number' && isFinite(opts.allowDelta) ? opts.allowDelta : null;
    if (allow === null) lines.push('未设置允许偏差，未生成超差工况区间。');
    else {
      lines.push('允许偏差 ' + fmt(allow, 3) + '：超差工况区间 ' + allExceed.length + ' 处。');
      allExceed.slice(0, 3).forEach(function (e) {
        lines.push('  · ' + e.label + '：X ' + fmt(e.xFrom, 2) + '~' + fmt(e.xTo, 2) +
          '，Y ' + fmt(e.yFrom, 2) + '~' + fmt(e.yTo, 2) + '，' + e.count +
          ' 格，max|Δ| ' + fmt(e.maxAbs) + '。');
      });
    }
    /* 对比摘要只陈述差异事实，不给放行/驳回建议：
       判定属于评审人的职责，工具给一句「建议驳回」既越权又会被当成签核结论。
       需要「结论」时由人在评审批注里写。 */
    return {
      ok: true, per: per, lines: lines, pattern: pattern,
      patternLabel: PATTERN_LABEL[pattern], totalChanged: totalChanged,
      maxAbs: maxAbs, isolated: iso, monotonic: mono,
      allowDelta: allow, exceedRegions: allExceed
    };
  }

  /* ---------- 全量标定量审查 ---------- */
  /* 现状：21,090 个对象里 18,089 个是标量、1,926 个是数组，
     过去一律被当成 nx×ny 二维网格。1×1 的四邻域恒为空 → 标量改值必判
     「孤立突变点 / 高危 / 驳回」，这是错误结论。下面按对象类型分派体检。 */
  function objectTypeOf(m) {
    if (!m) return 'unknown';
    if (m.type && TYPE_LABEL[m.type]) return m.type;
    if (m.nx === 1 && m.ny === 1) return 'scalar';
    return m.ny > 1 ? 'map2d' : 'curve';
  }

  function mergeObj(base, extra) {
    var out = {}, k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    for (k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
    return out;
  }

  /* 与 inspectDiff 返回结构兼容，额外给出 type / applicable / note。
     applicable=false 表示「孤立点/趋势反转这套判据对该类型不适用」，
     下游不得据此驳回 —— 这是标量误判的根因。 */
  function inspectForType(diff, opts) {
    opts = opts || {};
    if (!diff || !diff.ok) {
      return { ok: false, applicable: false, type: 'unknown', typeLabel: TYPE_LABEL.unknown,
        changed: 0, isolated: [], monotonic: [], monoX: [], monoY: [],
        risk: 'none', note: '对比不可用，未做体检' };
    }
    var t = objectTypeOf(diff.base);
    var base = inspectDiff(diff, opts);
    if (t === 'scalar') {
      return {
        ok: true, applicable: false, type: t, typeLabel: TYPE_LABEL[t], eps: base.eps,
        changed: base.changed, isolated: [], monotonic: [], monoX: [], monoY: [],
        risk: base.changed ? 'low' : 'none',
        note: '标量只有一个值，没有邻域与沿轴趋势；孤立突变点与趋势反转判定不适用，按变化幅度与允许偏差判断。'
      };
    }
    if (t === 'axis') {
      // 轴定义是断点序列，不是 MAP 数值网格：改单个断点是正常标定，不能按「孤立突变点」当误改信号。
      // 真正该报的是改后断点是否还单调、有无重复——用 axisHealth 判，而不是通用四邻域。
      var bPts = diff.b && diff.b[0] ? diff.b[0] : [];
      var ah = axisHealth(bPts);
      var ahIssues = ah.issues || [];
      return {
        ok: true, applicable: false, type: t, typeLabel: TYPE_LABEL[t], eps: base.eps,
        changed: base.changed, isolated: [], monotonic: [], monoX: [], monoY: [],
        risk: ahIssues.length ? 'high' : (base.changed ? 'low' : 'none'),
        note: '轴定义是一维断点序列：逐点比较断点数值，改单个断点属正常标定，不套用孤立突变点/趋势反转判据。' +
          '改后断点' + (ahIssues.length ? '不健康（' + ahIssues.join('；') + '）' : '保持单调、无重复断点') + '。'
      };
    }
    if (t === 'array' || t === 'curve') {
      return {
        ok: true, applicable: true, type: t, typeLabel: TYPE_LABEL[t], eps: base.eps,
        changed: base.changed, isolated: base.isolated,
        monotonic: base.monoX, monoX: base.monoX, monoY: [], risk: base.risk,
        note: '一维对象：孤立点按左右相邻两点判定，趋势反转只沿 ' +
          (t === 'curve' ? '真实 X 轴' : '索引轴') + ' 检查，无 Y 方向。'
      };
    }
    if (t === 'map3d') {
      return {
        ok: true, applicable: false, type: t, typeLabel: TYPE_LABEL[t], eps: base.eps,
        changed: base.changed, isolated: [], monotonic: [], monoX: [], monoY: [],
        risk: 'review',
        note: '三轴表格式未经实测，当前仅解析第一层二维数据，不纳入体检与放行判定。'
      };
    }
    return mergeObj(base, {
      applicable: true, type: t, typeLabel: TYPE_LABEL[t],
      note: '二维 MAP：四邻域孤立点 + X/Y 双轴趋势反转。'
    });
  }

  function auditId(tag, name, suffix) {
    return 'audit:' + tag + '::' + name + (suffix ? '::' + suffix : '');
  }

  function dimsOf(m) {
    return m.isAxisDef ? (m.nx + ' 个断点') : (m.nx + '×' + m.ny);
  }

  function effEpsFor(m, opts) {
    if (opts.autoEps) return suggestEps(m).eps;
    return typeof opts.eps === 'number' ? opts.eps : 1e-9;
  }

  function auditSide(m) {
    if (!m) return null;
    var t = objectTypeOf(m);
    return {
      name: m.name, type: t, nx: m.nx, ny: m.ny, dims: dimsOf(m),
      units: (m.units && m.units.w) || '', funktion: m.funktion || '',
      srcFile: m.srcFile, startLine: m.startLine, endLine: m.endLine,
      label: m.label || m.name,
      value: t === 'scalar' && m.v && m.v[0] ? m.v[0][0] : null,
      values: t === 'scalar' || !m.v || !m.v[0] ? null : m.v[0].slice(0, 40),
      x: m.x ? m.x.slice(0, 40) : [],
      axisFromIndex: !!m.axisFromIndex,
      isAxisDef: !!m.isAxisDef
    };
  }

  function makeAuditEntry(tag, a, b, opts) {
    var t = objectTypeOf(a);
    var e = {
      id: auditId(tag, a.name, a.isAxisDef ? 'axis' : ''), name: a.name, type: t, typeLabel: TYPE_LABEL[t],
      dims: dimsOf(a), units: (a.units && a.units.w) || '',
      funktion: a.funktion || '', pairKind: 'same_name',
      a: auditSide(a), b: auditSide(b),
      keyA: a.key, keyB: b.key,
      srcA: a.srcFile, srcB: b.srcFile,
      lineA: a.startLine, lineB: b.startLine,
      status: 'unchanged', hasChange: false, risk: 'none', verdict: '',
      reason: '', diff: null, stats: null, inspect: null, analysis: null
    };
    if (t === 'map3d' || a.provisional || b.provisional) {
      e.status = 'rejected'; e.risk = 'review';
      e.reason = '三轴表格式未经实测，当前仅解析第一层二维数据，不纳入全量审查';
      return e;
    }
    var eps = effEpsFor(a, opts);
    e.eps = eps;

    // 轴定义断点增删：维度不同，无法逐点对齐，但它就是标定变化，不能丢进「被拒绝」里假装没变。
    // 给出两版断点序列对照，按整项变化计入清单，仍可评审。
    if (t === 'axis' && a.nx !== b.nx) {
      var cmp = compareAxisValues(a.v[0], b.v[0]);
      e.axisSeries = { a: a.v[0].slice(), b: b.v[0].slice(), kind: cmp.kind, detail: cmp.detail || '' };
      e.status = 'changed'; e.hasChange = true; e.risk = 'review';
      e.reason = '轴断点数 ' + a.nx + ' → ' + b.nx + '（' + cmp.kind +
        '），无法逐点对齐，按整项变化计入清单；两版断点序列见证据表。';
      e.stats = { changed: 1, total: 1, maxAbs: 0, meanAbs: 0, ratio: 1, interpolated: false };
      e.inspect = { ok: true, applicable: false, type: 'axis', typeLabel: TYPE_LABEL.axis, eps: eps,
        changed: 1, isolated: [], monotonic: [], monoX: [], monoY: [], risk: 'review',
        note: '轴断点增删属结构性变化，逐点 Δ 不适用；请对照两版断点序列确认插值区间是否受影响。' };
      return e;
    }

    var d = computeDiff(a, b, { eps: eps, mode: opts.mode || 'absolute' });
    if (!d.ok) {
      e.status = 'rejected'; e.risk = 'review'; e.reason = d.reason;
      return e;
    }
    var ins = inspectForType(d, { eps: eps });
    var an = analyzeOne(d, { eps: eps, allowDelta: opts.allowDelta });
    // 未变化项不保留 diff 矩阵：21,090 项全量审查时内存与报告体积都靠这条
    e.diff = null; e.inspect = ins; e.analysis = an;
    e.stats = {
      changed: d.stats.changed, total: d.stats.total,
      maxAbs: d.stats.maxAbs, meanAbs: d.stats.meanAbs,
      ratio: d.stats.ratio, interpolated: !!d.interpolated
    };
    if (t === 'scalar') {
      e.stats.valueA = d.a[0][0];
      e.stats.valueB = d.b[0][0];
      e.stats.delta = d.abs[0][0];
      e.stats.relPct = (d.rel && d.rel[0]) ? d.rel[0][0] : null;
    }
    e.hasChange = d.stats.changed > 0;
    if (e.hasChange) e.diff = d;
    e.status = e.hasChange ? 'changed' : 'unchanged';
    e.risk = ins.risk;
    e.verdict = an.verdict;
    e.patternLabel = an.patternLabel;
    if (d.interpolated) e.reason = '轴刻度不同，数值已插值对齐（不是原始逐格值）';
    return e;
  }

  function onlyAuditEntry(tag, m, status) {
    var t = objectTypeOf(m), side = auditSide(m);
    // deleted = 仅 A 版存在（在 B 版被删除）；added = 仅 B 版存在（B 版新增）
    var inA = status === 'deleted', inB = status === 'added';
    return {
      id: auditId(tag, m.name, status + (m.isAxisDef ? '-axis' : '')),
      name: m.name, type: t, typeLabel: TYPE_LABEL[t],
      dims: side.dims, units: side.units, funktion: side.funktion,
      pairKind: 'unpaired',
      a: inA ? side : null, b: inB ? side : null,
      keyA: inA ? m.key : null, keyB: inB ? m.key : null,
      srcA: inA ? m.srcFile : null, srcB: inB ? m.srcFile : null,
      lineA: inA ? m.startLine : null, lineB: inB ? m.startLine : null,
      status: status, hasChange: false, risk: 'review', verdict: '',
      reason: inA ? '仅在 A 版存在：B 版已删除该对象' : '仅在 B 版存在：B 版新增该对象',
      diff: null, stats: null, inspect: null, analysis: null
    };
  }

  /* 完整账本：每个 A 对象、每个 B 对象都必须恰好归属一条记录。
     互斥状态：changed / unchanged / rejected / added(B版新增) / deleted(B版删除)。
     恒等式 counts 之和 === entries.length，且 a 侧条数 === A 对象数、b 侧 === B 对象数。
     不做改名配对：改名对象会分别出现在 deleted 与 added，由人对照。 */
  function buildFullAudit(datasets, opts) {
    opts = opts || {};
    if (!datasets || datasets.length < 2) {
      return { ok: false, reason: '全量审查需要至少 2 份 DCM（同一标定量的跨版本对比）',
        pairs: [], entries: [], sources: [], totals: {}, identity: { ok: false },
        warnings: [], lines: [], settings: {} };
    }
    // 按用户要求不做改名配对：改名的对象会分别落到「B 版删除」与「B 版新增」，
    // 由人对照，不让算法猜。这个边界必须在报告里明示。
    var warnings = [], pairs = [], allEntries = [];

    for (var di = 0; di < datasets.length - 1; di++) {
      var A = datasets[di], B = datasets[di + 1];
      // 带序号：同一文件被载入两次时，各版本对的账目 id 仍唯一，批注不会串
      var tag = '#' + (di + 1) + ' ' + A.fileName + ' > ' + B.fileName;
      // 轴定义升级为正式标定量：与标定量一起进账本、一起参与恒等式与变化清单。
      // 用命名空间键配对，轴定义与标定量即使同名也不会互相覆盖（实测本文件 0 冲突，但规则不能靠数据侥幸）。
      var va = A.maps.filter(function (m) { return m.valid; }).concat(
        (A.axisDefs || []).filter(function (d) { return d.valid !== false; })
          .map(function (d) { return axisToComparable(d, A); }));
      var vb = B.maps.filter(function (m) { return m.valid; }).concat(
        (B.axisDefs || []).filter(function (d) { return d.valid !== false; })
          .map(function (d) { return axisToComparable(d, B); }));
      function pairKey(m) { return (m.isAxisDef ? 'axis::' : 'obj::') + m.name; }
      var nameA = {}, nameB = {};
      va.forEach(function (m) { nameA[pairKey(m)] = m; });
      vb.forEach(function (m) { nameB[pairKey(m)] = m; });

      var entries = [], usedB = {};
      va.forEach(function (a) {
        var k = pairKey(a), b = nameB[k];
        if (b && b.isAxisDef === a.isAxisDef) {
          usedB[k] = 1;
          entries.push(makeAuditEntry(tag, a, b, opts));
        } else {
          entries.push(onlyAuditEntry(tag, a, 'deleted'));
        }
      });
      vb.forEach(function (b) {
        var k = pairKey(b);
        if (!usedB[k]) entries.push(onlyAuditEntry(tag, b, 'added'));
      });

      var counts = { changed: 0, unchanged: 0, rejected: 0, added: 0, deleted: 0 };
      entries.forEach(function (e) { counts[e.status]++; });
      var sum = 0;
      Object.keys(counts).forEach(function (k) { sum += counts[k]; });
      var aCovered = entries.filter(function (e) { return !!e.a; }).length;
      var bCovered = entries.filter(function (e) { return !!e.b; }).length;
      var identity = {
        ok: sum === entries.length && aCovered === va.length && bCovered === vb.length,
        expected: entries.length, actual: sum,
        aTotal: va.length, aCovered: aCovered,
        bTotal: vb.length, bCovered: bCovered,
        detail: '账目 ' + entries.length + ' 条 = 状态分项之和 ' + sum +
          '；A 侧覆盖 ' + aCovered + '/' + va.length + '，B 侧覆盖 ' + bCovered + '/' + vb.length
      };

      var axisA = {}, axisB = {};
      (A.axisDefs || []).forEach(function (d) { axisA[d.name] = d; });
      (B.axisDefs || []).forEach(function (d) { axisB[d.name] = d; });
      var axisChanged = [];
      Object.keys(axisA).forEach(function (n) {
        var other = axisB[n];
        var cmp = compareAxisValues(axisA[n].x, other ? other.x : null);
        if (cmp.kind !== '未变') {
          axisChanged.push({ name: n, changeType: cmp.kind, detail: cmp.detail || '',
            lineA: axisA[n].startLine, lineB: other ? other.startLine : null,
            countA: axisA[n].x.length, countB: other ? other.x.length : 0 });
        }
      });
      var axisAppendix = {
        countA: (A.axisDefs || []).length, countB: (B.axisDefs || []).length,
        changed: axisChanged,
        hint: '轴定义已作为正式标定量计入账本，此处补充断点变化类型分类；新增 / 删除的轴定义在变化清单中列出。'
      };

      var provisional = va.concat(vb).filter(function (m) {
        return !m.isAxisDef && (m.provisional || objectTypeOf(m) === 'map3d');
      });
      if (provisional.length) {
        warnings.push(tag + '：检出 ' + provisional.length +
          ' 个三轴表块，格式未经实测，仅解析第一层，已明确排除出对比并列入被拒绝账目。');
      }
      // va/vb 现在含轴定义，无效块数只能按各自来源的 maps 计算，不能拿合并长度去减
      var invalidA = A.maps.length - A.maps.filter(function (m) { return m.valid; }).length;
      var invalidB = B.maps.length - B.maps.filter(function (m) { return m.valid; }).length;
      var invalidAxis = (A.axisDefs.length + B.axisDefs.length) -
        (A.axisDefs.concat(B.axisDefs).filter(function (d) { return d.valid !== false; })).length;
      if (invalidA + invalidB + invalidAxis) {
        warnings.push(tag + '：' + (invalidA + invalidB + invalidAxis) +
          ' 个块解析校验未通过，未进入账本（详见数据源自检章节）。');
      }
      pairs.push({
        fileA: A.fileName, fileB: B.fileName, tag: tag, entries: entries,
        counts: counts, identity: identity, axisAppendix: axisAppendix,
        aTotal: va.length, bTotal: vb.length
      });
      allEntries = allEntries.concat(entries);
    }

    var totalCounts = { changed: 0, unchanged: 0, rejected: 0, added: 0, deleted: 0 };
    pairs.forEach(function (p) {
      Object.keys(totalCounts).forEach(function (k) { totalCounts[k] += p.counts[k]; });
    });
    var byType = {};
    allEntries.forEach(function (e) {
      var g = byType[e.type] || (byType[e.type] = {
        type: e.type, label: TYPE_LABEL[e.type] || e.type, total: 0, changed: 0,
        rejected: 0, added: 0, deleted: 0, maxAbs: 0, units: {}
      });
      g.total++;
      if (e.hasChange) g.changed++;
      if (e.status === 'rejected') g.rejected++;
      if (e.status === 'added') g.added++;
      if (e.status === 'deleted') g.deleted++;
      if (e.stats && isFinite(e.stats.maxAbs)) g.maxAbs = Math.max(g.maxAbs, e.stats.maxAbs);
      if (e.units) g.units[e.units] = (g.units[e.units] || 0) + 1;
    });
    var coverageOk = pairs.every(function (p) { return p.identity.ok; });
    var totals = {
      total: allEntries.length, counts: totalCounts, byType: byType,
      changedCells: allEntries.reduce(function (s, e) {
        return s + (e.stats ? e.stats.changed : 0);
      }, 0),
      maxAbs: allEntries.reduce(function (s, e) {
        return Math.max(s, e.stats && isFinite(e.stats.maxAbs) ? e.stats.maxAbs : 0);
      }, 0),
      /* exceed 不是死指标：summarizeAudit 用它生成「允许偏差 N：超差对象 M 项」这句事实。
         highRisk / review 才是纯死代码（界面与报告零引用），已删除。 */
      exceed: allEntries.filter(function (e) {
        return e.analysis && e.analysis.exceedRegions && e.analysis.exceedRegions.length;
      }).length,
      identityOk: coverageOk
    };
    warnings.push('未启用改名配对：版本升级把对象改名时，旧名计入「B 版删除」、新名计入「B 版新增」，' +
      '请在变化清单里人工对照，工具不猜测对应关系。');
    var audit = {
      ok: true, pairs: pairs, entries: allEntries, totals: totals,
      sources: datasets.map(function (ds) {
        return { fileName: ds.fileName,
          objects: ds.maps.length + (ds.axisDefs || []).length,
          calibratables: ds.maps.length,
          blocks: ds.stats.totalBlocks, axisDefs: (ds.axisDefs || []).length,
          invalid: ds.stats.invalid, encoding: ds.encoding || '' };
      }),
      identity: {
        ok: coverageOk,
        detail: pairs.map(function (p) { return p.tag + '：' + p.identity.detail; }).join('；')
      },
      warnings: warnings,
      settings: {
        eps: opts.eps, autoEps: !!opts.autoEps, mode: opts.mode || 'absolute',
        allowDelta: typeof opts.allowDelta === 'number' ? opts.allowDelta : null,
        renameMatching: false
      }
    };
    audit.summary = summarizeAudit(audit);
    return audit;
  }

  /* 只陈述「有哪些变化」，不做放行/驳回判断，也不给处置建议。 */
  function summarizeAudit(audit) {
    if (!audit || !audit.ok) {
      return { ok: false, lines: ['全量变化清单不可用：' + ((audit && audit.reason) || '未知原因')],
        identity: { ok: false } };
    }
    var t = audit.totals, c = t.counts;
    var lines = [];
    lines.push('比较范围：' + audit.pairs.length + ' 组相邻版本对，共 ' + t.total + ' 条账目。数据源：' +
      audit.sources.map(function (s) { return s.fileName + '（' + s.objects + ' 项）'; }).join(' → ') + '。');
    lines.push('变化清单：有变化 ' + c.changed + ' 项，B 版新增 ' + c.added + ' 项，B 版删除 ' + c.deleted +
      ' 项，对比被拒绝 ' + c.rejected + ' 项；未变化 ' + c.unchanged +
      ' 项只做计数与完整性核对，不逐项列出。');
    var typeBits = Object.keys(t.byType).map(function (k) {
      var g = t.byType[k];
      return g.label + ' ' + g.total + ' 项（变化 ' + g.changed + '）';
    });
    lines.push('按对象类型：' + typeBits.join('；') + '。');
    lines.push('累计变化 ' + t.changedCells + ' 个数据点，最大 |Δ| = ' + fmt(t.maxAbs) + '。');
    lines.push('完整性校验：' + (audit.identity.ok ? '通过' : '未通过') + '。' + audit.identity.detail +
      '。每个对象都恰好归属一条账目，未变化项也已核对计数。');
    if (audit.settings.allowDelta !== null) {
      lines.push('允许偏差 ' + fmt(audit.settings.allowDelta, 3) + '：超差对象 ' + t.exceed + ' 项。');
    } else lines.push('未设置允许偏差，未生成超差工况区间。');
    audit.warnings.forEach(function (w) { lines.push('边界说明：' + w); });
    if (!audit.identity.ok) lines.push('完整性校验未通过：账本存在缺口，本清单不覆盖全部对象。');
    return { ok: true, lines: lines, identity: audit.identity };
  }

  /* ---------- 轴变更影响面 ---------- */
  /* 引用名几乎一对一，只按 *SSTX 名反查会漏掉同轴的一批表；
     必须同时按轴数值指纹聚类，才能回答「改这套轴影响多少张表」。 */
  function axisGroups(ds) {
    var groups = {}, defs = {};
    (ds.axisDefs || []).forEach(function (a) {
      defs[a.name] = { values: a.x, n: a.nx, startLine: a.startLine };
    });
    (ds.maps || []).forEach(function (m) {
      if (!m.valid || m.axisFromIndex) return; // 标量与索引轴数组没有真实轴
      // 完整轴指纹：只按 X 分桶会把「X 相同但 Y 不同」的多组表混在一起，掩盖轴变更
      var k = m.nx + 'x' + m.ny + '|' + m.x.map(q).join(',') + '|' + m.y.map(q).join(',');
      var g = groups[k] || (groups[k] = {
        x: m.x, y: m.y, nx: m.nx, ny: m.ny, refs: [], defNames: {}
      });
      g.refs.push(m);
      if (m.axisRefX) g.defNames[m.axisRefX] = 1;
      if (m.axisRefY) g.defNames[m.axisRefY] = 1;
    });
    return { groups: groups, defs: defs, defCount: Object.keys(defs).length };
  }

  function refNameSet(refs) {
    var s = {};
    refs.forEach(function (m) { s[m.name] = 1; });
    return s;
  }

  function jaccard(a, b) {
    var inter = 0, union = 0;
    Object.keys(a).forEach(function (k) { union++; if (b[k]) inter++; });
    Object.keys(b).forEach(function (k) { if (!a[k]) union++; });
    return union ? inter / union : 0;
  }

  function compareAxisValues(a, b) {
    if (!a || !b) return { kind: '缺失', detail: '另一版找不到对应轴' };
    if (a.length !== b.length) {
      return { kind: '断点增删', detail: a.length + ' → ' + b.length + ' 个断点' };
    }
    var diffs = a.map(function (v, i) { return b[i] - v; });
    if (diffs.every(function (d) { return Math.abs(d) <= 1e-9; })) return { kind: '未变' };
    if (diffs.every(function (d) { return Math.abs(d - diffs[0]) <= 1e-9; })) {
      return { kind: '刻度平移', detail: '整体 ' + (diffs[0] > 0 ? '+' : '') + fmt(diffs[0], 4) };
    }
    var sa = a.slice().sort(function (p, r) { return p - r; });
    var sb = b.slice().sort(function (p, r) { return p - r; });
    if (sa.every(function (v, i) { return Math.abs(v - sb[i]) <= 1e-9; })) {
      return { kind: '顺序改变', detail: '断点集合相同但顺序变化（可能破坏单调性）' };
    }
    return { kind: '局部扰动', detail: '部分断点数值变化' };
  }

  function analyzeAxisChange(datasets, opts) {
    opts = opts || {};
    if (!datasets || datasets.length < 2) {
      return { ok: false, reason: '轴变更影响面需要至少 2 份 DCM', pairs: [], total: 0 };
    }
    var minOverlap = opts.minOverlap === undefined ? 0.5 : opts.minOverlap;
    var pairs = [];
    for (var di = 0; di < datasets.length - 1; di++) {
      var A = axisGroups(datasets[di]), B = axisGroups(datasets[di + 1]);
      var changed = [], keysB = Object.keys(B.groups);
      Object.keys(A.groups).forEach(function (k) {
        if (B.groups[k]) return; // 整套轴完全一致
        var ga = A.groups[k], sa = refNameSet(ga.refs), best = null, bestSim = 0;
        keysB.forEach(function (k2) {
          var gb2 = B.groups[k2];
          if (gb2.nx !== ga.nx || gb2.ny !== ga.ny) return;
          var sim = jaccard(sa, refNameSet(gb2.refs));
          if (sim > bestSim) { bestSim = sim; best = gb2; }
        });
        // 找不到同一批表 = 对象被删除/改名，不是轴变更，不误报
        if (!best || bestSim < minOverlap) return;
        var byName = {};
        ga.refs.concat(best.refs).forEach(function (m) {
          if (!byName[m.name]) byName[m.name] = m; // 同一张表在两版只算一个受影响对象
        });
        var defNames = Object.keys(ga.defNames).concat(Object.keys(best.defNames))
          .filter(function (v, i, arr) { return arr.indexOf(v) === i; });
        [['X', ga.x, best.x], ['Y', ga.y, best.y]].forEach(function (p) {
          var cmp = compareAxisValues(p[1], p[2]);
          if (cmp.kind === '未变') return;
          changed.push({
            axis: p[0], valuesA: p[1], valuesB: p[2],
            changeType: cmp.kind, detail: cmp.detail, refSimilarity: bestSim,
            defNames: defNames, dims: ga.nx + '×' + ga.ny,
            affected: Object.keys(byName).map(function (kk) { return mapRef(byName[kk]); }),
            risk: (cmp.kind === '顺序改变' || cmp.kind === '断点增删') ? 'high' : 'medium'
          });
        });
      });
      changed.sort(function (a, b) { return b.affected.length - a.affected.length; });
      pairs.push({
        fileA: datasets[di].fileName, fileB: datasets[di + 1].fileName,
        changedAxes: changed,
        groupsA: Object.keys(A.groups).length,
        groupsB: Object.keys(B.groups).length,
        defCountA: A.defCount, defCountB: B.defCount
      });
    }
    var total = pairs.reduce(function (s, p) { return s + p.changedAxes.length; }, 0);
    return { ok: true, pairs: pairs, total: total };
  }

  function buildCube(base, others, opts) {
    opts = opts || {};
    var labels = [], layers = [], skipped = [];
    labels.push(base.label || base.name);
    layers.push(base.v);
    others.forEach(function (o) {
      var al = alignMaps(base, o);
      if (!al.ok) { skipped.push({ name: o.label || o.name, reason: al.reason }); return; }
      labels.push(o.label || o.name);
      layers.push(al.v);
    });
    return {
      ok: true, nx: base.nx, ny: base.ny, x: base.x, y: base.y,
      labels: labels, layers: layers, skipped: skipped,
      profile: function (i, j) {
        if (i < 0 || j < 0 || i >= base.nx || j >= base.ny) return [];
        return layers.map(function (L, k) {
          var row = L && L[j];
          return { k: k, label: labels[k], value: row && isFinite(row[i]) ? row[i] : null };
        });
      }
    };
  }

  function fmt(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return '-';
    var d = typeof digits === 'number' ? digits : 6;
    var s = Number(v).toFixed(d);
    if (Math.abs(Number(v)) >= 1e6 || (Math.abs(Number(v)) > 0 && Math.abs(Number(v)) < 1e-4)) {
      return Number(v).toExponential(3);
    }
    return s.replace(/\.?0+$/, function (m) { return m.indexOf('.') === 0 ? '' : m; });
  }

  return {
    decodeDcm: decodeDcm, parseDcm: parseDcm, buildIndex: buildIndex,
    alignMaps: alignMaps, computeDiff: computeDiff, computeAllDiffs: computeAllDiffs,
    buildCube: buildCube, inspectDiff: inspectDiff, suggestEps: suggestEps,
    axisHealth: axisHealth, matchRenamed: matchRenamed, nameSim: nameSim,
    valueSim: valueSim, normalizeName: normalizeName,
    summarizeDiff: summarizeDiff, analyzeOne: analyzeOne,
    buildFullAudit: buildFullAudit, summarizeAudit: summarizeAudit,
    inspectForType: inspectForType, objectTypeOf: objectTypeOf,
    PATTERN_LABEL: PATTERN_LABEL, VERDICT_LABEL: VERDICT_LABEL,
    TYPE_LABEL: TYPE_LABEL, STATUS_LABEL: STATUS_LABEL,
    RISK_LEVELS: RISK_LEVELS, RISK_LABEL: RISK_LABEL, isRiskItem: isRiskItem,
    buildAxisIndex: axisGroups, analyzeAxisChange: analyzeAxisChange,
    compareAxisValues: compareAxisValues, axisToComparable: axisToComparable,
    axisSig: axisSig, arrEq: arrEq, fmt: fmt, nums: nums
  };
});
