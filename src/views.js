/* SVG views: heat matrix, slice curves, 3D surface, 3D cube, profile, detail table. */
(function (root, factory) {
  var dep = root.DCMCore || (typeof require === 'function' ? require('./core.js') : null);
  var api = factory(dep);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DCMViews = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  'use strict';

  var PALETTE = ['#185FA5', '#D85A30', '#0F6E56', '#7F77DD', '#BA7517', '#D4537E', '#3B6D11', '#A32D2D'];
  var NEUTRAL = [241, 239, 232], POS = [226, 75, 74], NEG = [55, 138, 221];

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function hex(c) {
    return '#' + c.map(function (v) { return ('0' + Math.round(clamp(v, 0, 255)).toString(16)).slice(-2); }).join('');
  }
  function mix(a, b, t) { return a.map(function (v, i) { return v + (b[i] - v) * t; }); }
  function diverging(v, max) {
    if (v === null || v === undefined || !isFinite(v) || max <= 0) return hex(NEUTRAL);
    var t = Math.pow(clamp(Math.abs(v) / max, 0, 1), 0.65);
    return hex(mix(NEUTRAL, v >= 0 ? POS : NEG, t));
  }
  function sequential(t) {
    t = clamp(t, 0, 1);
    return hex(mix([181, 212, 244], [226, 75, 74], t));
  }
  function fmt(v, d) { return C.fmt(v, d); }
  function svgOpen(w, h, extra) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="100%" ' +
      'preserveAspectRatio="xMidYMid meet" role="img" ' + (extra || '') + '>';
  }
  function txt(x, y, s, size, fill, anchor, weight) {
    return '<text x="' + x + '" y="' + y + '" font-size="' + (size || 11) + '" fill="' + (fill || '#2C2C2A') +
      '" font-family="system-ui,-apple-system,Segoe UI,sans-serif" text-anchor="' + (anchor || 'start') +
      '" font-weight="' + (weight || 400) + '">' + esc(s) + '</text>';
  }

  function matrixOf(diff, mode, envelope) {
    if (envelope) return envelope.maxAbs;
    if (mode === 'relative') {
      return diff.rel.map(function (r) { return r.map(function (v) { return v === null ? 0 : v; }); });
    }
    return diff.abs;
  }

  function svgHeat(diff, opts) {
    opts = opts || {};
    var mode = opts.mode || 'absolute';
    var envelope = opts.envelope || null;
    var m = matrixOf(diff, mode, envelope);
    var nx = diff.nx, ny = diff.ny;
    if (!nx || !ny) return '<p class="empty">无可显示数据</p>';
    var max = 0;
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var v = Math.abs(m[j][i]);
      if (isFinite(v) && v > max) max = v;
    }
    if (opts.maxScale) max = Math.max(max, opts.maxScale);
    var cw = clamp(Math.floor(620 / nx), 14, 44);
    var ch = clamp(Math.floor(420 / ny), 14, 40);
    var padL = 74, padT = 30, padB = 46, padR = 18;
    var W = padL + cw * nx + padR, H = padT + ch * ny + padB;
    var s = [svgOpen(W, H, 'class="heat-svg"')];
    s.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#FFFFFF"/>');
    s.push(txt(padL, 18, opts.title || ('差异矩阵 · ' + (mode === 'relative' ? '相对差 %' : '绝对差')), 13, '#2C2C2A', 'start', 500));
    for (j = 0; j < ny; j++) {
      s.push(txt(padL - 8, padT + j * ch + ch / 2 + 4, fmt(diff.y[j], 3), 10, '#5F5E5A', 'end'));
      for (i = 0; i < nx; i++) {
        var val = m[j][i];
        var changed = Math.abs(val) > (opts.eps || 1e-9);
        var fill = envelope ? diverging(val, max) : diverging(val, max);
        if (opts.onlyChanged && !changed) fill = '#FAFAF8';
        var a = diff.a[j][i], b = diff.b[j][i];
        var tip = 'Y=' + fmt(diff.y[j], 4) + '  X=' + fmt(diff.x[i], 4) + '\n' +
          '基准=' + fmt(a) + '  对比=' + fmt(b) + '\nΔ=' + fmt(b - a) +
          (Math.abs(a) > 1e-12 ? '  相对=' + fmt(((b - a) / Math.abs(a)) * 100, 3) + '%' : '  基准为 0') +
          (diff.interpolated ? '\n[已插值对齐]' : '') +
          (envelope ? '\n[全部对比的最大偏差包络]' : '');
        s.push('<rect x="' + (padL + i * cw) + '" y="' + (padT + j * ch) + '" width="' + (cw - 1) +
          '" height="' + (ch - 1) + '" fill="' + fill + '" stroke="#FFFFFF" stroke-width="0.6" ' +
          'data-i="' + i + '" data-j="' + j + '" data-tip="' + esc(tip) + '"><title>' + esc(tip) + '</title></rect>');
        if (cw >= 30 && ch >= 22 && (opts.showValues || (opts.onlyChanged && changed))) {
          var label = fmt(val, Math.abs(val) >= 100 ? 0 : 1);
          s.push(txt(padL + i * cw + cw / 2, padT + j * ch + ch / 2 + 3, label, 9,
            Math.abs(val) / (max || 1) > 0.6 ? '#FFFFFF' : '#2C2C2A', 'middle'));
        }
      }
    }
    var stepX = Math.max(1, Math.ceil(nx / 12));
    for (i = 0; i < nx; i += stepX) {
      s.push(txt(padL + i * cw + cw / 2, padT + ny * ch + 16, fmt(diff.x[i], 2), 10, '#5F5E5A', 'middle'));
    }
    s.push(txt(padL + cw * nx / 2, H - 8, 'X ' + (diff.base.units.x || '') + '   (' + nx + ' 点)', 11, '#5F5E5A', 'middle'));
    s.push(txt(14, padT + ch * ny / 2, 'Y ' + (diff.base.units.y || ''), 11, '#5F5E5A', 'start'));
    s.push(txt(W - padR, H - 8, '红=增大  蓝=减小', 10, '#888780', 'end'));
    s.push('</svg>');
    return s.join('');
  }

  function svgCurves(base, diffs, opts) {
    opts = opts || {};
    var byRow = opts.axis !== 'col';
    var count = byRow ? base.nx : base.ny;
    var idx = clamp(opts.index || 0, 0, count - 1);
    var xs = byRow ? base.x : base.y;
    var series = [{ label: '基准 · ' + base.name, color: '#2C2C2A', dash: '', values: [] }];
    for (var p = 0; p < count; p++) series[0].values.push(byRow ? base.v[idx][p] : base.v[p][idx]);
    diffs.forEach(function (d, k) {
      if (!d.ok) return;
      var vals = [];
      for (p = 0; p < count; p++) vals.push(byRow ? d.b[idx][p] : d.b[p][idx]);
      series.push({ label: d.other.label || d.other.name, color: PALETTE[k % PALETTE.length], dash: '', values: vals });
    });
    var lo = Infinity, hi = -Infinity;
    series.forEach(function (se) { se.values.forEach(function (v) { if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-12) { hi += 1; lo -= 1; }
    var pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    var W = 760, H = 380, L = 76, R = 190, T = 34, B = 54;
    var pw = W - L - R, ph = H - T - B;
    var s = [svgOpen(W, H, 'class="curve-svg"')];
    s.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#FFFFFF"/>');
    s.push(txt(L, 20, '切面曲线叠加 · ' + (byRow ? '固定 Y=' : '固定 X=') + fmt(byRow ? base.y[idx] : base.x[idx], 3), 13, '#2C2C2A', 'start', 500));
    for (var g = 0; g <= 4; g++) {
      var gy = T + ph * g / 4, gv = hi - (hi - lo) * g / 4;
      s.push('<line x1="' + L + '" y1="' + gy + '" x2="' + (L + pw) + '" y2="' + gy + '" stroke="#E8E6DF" stroke-width="1"/>');
      s.push(txt(L - 8, gy + 4, fmt(gv, 2), 10, '#5F5E5A', 'end'));
    }
    var vx = function (p) { return L + (count === 1 ? pw / 2 : pw * p / (count - 1)); };
    var vy = function (v) { return T + ph * (hi - v) / (hi - lo); };
    var xstep = Math.max(1, Math.ceil(count / 10));
    for (p = 0; p < count; p += xstep) {
      s.push(txt(vx(p), T + ph + 18, fmt(xs[p], 2), 10, '#5F5E5A', 'middle'));
    }
    series.forEach(function (se) {
      var pts = se.values.map(function (v, p) { return vx(p) + ',' + vy(v); }).join(' ');
      s.push('<polyline points="' + pts + '" fill="none" stroke="' + se.color + '" stroke-width="' +
        (se.dash ? 1.6 : 2) + '" stroke-linejoin="round" stroke-linecap="round"/>');
      se.values.forEach(function (v, p) {
        if (p % Math.max(1, Math.ceil(count / 24)) === 0) {
          s.push('<circle cx="' + vx(p) + '" cy="' + vy(v) + '" r="2" fill="' + se.color + '"/>');
        }
      });
    });
    s.push(txt(L + pw / 2, H - 12, (byRow ? 'X ' : 'Y ') + (byRow ? base.units.x : base.units.y), 11, '#5F5E5A', 'middle'));
    s.push('<line x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (T + ph) + '" stroke="#B4B2A9" stroke-width="1"/>');
    s.push('<line x1="' + L + '" y1="' + (T + ph) + '" x2="' + (L + pw) + '" y2="' + (T + ph) + '" stroke="#B4B2A9" stroke-width="1"/>');
    s.push(txt(L + R + pw - 4, 34, 'Z / W ' + (base.units.w || ''), 11, '#5F5E5A', 'end'));
    series.forEach(function (se, k) {
      var ly = T + 18 + k * 22;
      s.push('<line x1="' + (L + pw + 16) + '" y1="' + ly + '" x2="' + (L + pw + 38) + '" y2="' + ly + '" stroke="' + se.color + '" stroke-width="2.5"/>');
      var label = se.label.length > 26 ? se.label.slice(0, 25) + '…' : se.label;
      s.push(txt(L + pw + 44, ly + 4, label, 10, '#2C2C2A'));
    });
    s.push('</svg>');
    return s.join('');
  }

  function projector(w, h, o) {
    var cy = Math.cos(o.yaw), sy = Math.sin(o.yaw), cp = Math.cos(o.pitch), sp = Math.sin(o.pitch);
    var cx = o.cx === undefined ? w / 2 : o.cx;
    var ccy = o.cy === undefined ? h / 2 : o.cy;
    return function (X, Y, Z) {
      var xr = X * cy - Y * sy, yr = X * sy + Y * cy;
      return {
        x: cx + xr * o.scale,
        y: ccy - (Z * cp - yr * sp) * o.scale,
        d: yr * cp + Z * sp
      };
    };
  }

  function surfaceData(diff, opts) {
    var mode = opts.mode || 'diff';
    var src = mode === 'diff' ? diff.abs : (mode === 'base' ? diff.a : diff.b);
    var nx = diff.nx, ny = diff.ny;
    /* 网格密度固定，不再随拖动降采样：密度一变，线框与坐标轴的对应关系就跟着变，
       松手瞬间整张图会「跳」一下。26×22 的上限已经足够轻量。 */
    var stepI = Math.max(1, Math.ceil(nx / 26));
    var stepJ = Math.max(1, Math.ceil(ny / 22));
    var ii = [], jj = [];
    for (var i = 0; i < nx; i += stepI) ii.push(i);
    if (ii[ii.length - 1] !== nx - 1) ii.push(nx - 1);
    for (var j = 0; j < ny; j += stepJ) jj.push(j);
    if (jj[jj.length - 1] !== ny - 1) jj.push(ny - 1);
    /* 值域必须扫全矩阵：只统计抽样点会漏掉极值，Z 归一化和配色就跟着采样步长漂 */
    var lo = Infinity, hi = -Infinity;
    for (var m = 0; m < ny; m++) {
      for (var n = 0; n < nx; n++) {
        var v = src[m][n];
        if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      }
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (mode === 'diff') { var mm = Math.max(Math.abs(lo), Math.abs(hi), 1e-12); lo = -mm; hi = mm; }
    if (hi - lo < 1e-12) { hi += 1; lo -= 1; }
    return { src: src, ii: ii, jj: jj, lo: lo, hi: hi, mode: mode };
  }

  function svgSurface(diff, opts) {
    opts = opts || {};
    if (!diff || !diff.ok) return '<p class="empty">该对比不可用，无法绘制曲面。</p>';
    var W = 760, H = 470;
    var o = viewOpts(opts, W, H, -0.75, 0.75);
    var proj = projector(W, H, o);
    var sd = surfaceData(diff, { mode: opts.surfaceMode || 'diff' });
    var polys = [];
    function addSurface(src, lo, hi, colorFn, alpha, stroke) {
      for (var a = 0; a < sd.jj.length - 1; a++) {
        for (var b = 0; b < sd.ii.length - 1; b++) {
          var i0 = sd.ii[b], i1 = sd.ii[b + 1], j0 = sd.jj[a], j1 = sd.jj[a + 1];
          var X = function (i) { return sd.ii.length > 1 ? (i / Math.max(1, diff.nx - 1) - 0.5) * 2 : 0; };
          var Y = function (j) { return sd.jj.length > 1 ? (j / Math.max(1, diff.ny - 1) - 0.5) * 2 : 0; };
          var Z = function (v) { return ((v - lo) / (hi - lo) - 0.5) * 1.5; };
          var v00 = src[j0][i0], v10 = src[j0][i1], v01 = src[j1][i0], v11 = src[j1][i1];
          var p0 = proj(X(i0), Y(j0), Z(v00)), p1 = proj(X(i1), Y(j0), Z(v10));
          var p2 = proj(X(i1), Y(j1), Z(v11)), p3 = proj(X(i0), Y(j1), Z(v01));
          var mean = (v00 + v10 + v01 + v11) / 4;
          var hl = opts.highlight;
          var isHl = hl && hl.axis !== 'none' && (
            (hl.axis === 'x' && i0 <= hl.i && i1 >= hl.i) ||
            (hl.axis === 'y' && j0 <= hl.j && j1 >= hl.j));
          polys.push({
            pts: [p0, p1, p2, p3],
            d: (p0.d + p1.d + p2.d + p3.d) / 4,
            color: colorFn(mean), alpha: alpha, hi: i0, hj: j0,
            stroke: isHl ? '#D85A30' : stroke, strokeWidth: isHl ? 1.8 : 0.4
          });
        }
      }
    }
    var mode = opts.surfaceMode || 'diff';
    var axisLo = sd.lo, axisHi = sd.hi;
    if (mode === 'both') {
      /* 两版共用一个 Z 基准取的是「并集」，不是基准版的值域：
         只按基准版算的话，对比版超出它的部分会画出 [-0.75,0.75] 之外，
         实测能飞到画布外几千像素（整张图只剩几根线）。 */
      var ad = surfaceData(diff, { mode: 'base' });
      var bd = surfaceData(diff, { mode: 'other' });
      var bothLo = Math.min(ad.lo, bd.lo), bothHi = Math.max(ad.hi, bd.hi);
      if (bothHi - bothLo < 1e-12) { bothHi += 1; bothLo -= 1; }
      axisLo = bothLo; axisHi = bothHi;
      addSurface(diff.a, bothLo, bothHi, function () { return '#B4B2A9'; }, 0.55, '#FFFFFF');
      addSurface(diff.b, bothLo, bothHi, function (v) { return sequential((v - bothLo) / (bothHi - bothLo)); }, 0.9, '#FFFFFF');
    } else if (mode === 'base' || mode === 'other') {
      var dd = surfaceData(diff, { mode: mode });
      axisLo = dd.lo; axisHi = dd.hi;
      addSurface(dd.src, dd.lo, dd.hi, function (v) { return sequential((v - dd.lo) / (dd.hi - dd.lo)); }, 1, '#FFFFFF');
    } else {
      addSurface(sd.src, sd.lo, sd.hi, function (v) { return diverging(v, Math.max(Math.abs(sd.lo), Math.abs(sd.hi))); }, 1, '#FFFFFF');
    }
    polys.sort(function (a, b) { return a.d - b.d; });
    var s = [svgOpen(W, H, 'class="surface-svg"')];
    s.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#FFFFFF"/>');
    /* 顺序：地面网格 → 曲面 → 轴线/刻度/高亮。反了就会「网格压在面上」。 */
    var axOpts = { proj: proj, x: diff.x, y: diff.y, nx: diff.nx, ny: diff.ny,
      lo: axisLo, hi: axisHi, z0: -0.75, zSpan: 1.5, units: diff.base.units,
      zLabel: mode === 'diff' ? 'Δ' : 'Z', highlight: opts.highlight };
    s.push(axisSvg(Object.assign({}, axOpts, { part: 'grid' })));
    polys.forEach(function (p) {
      var pts = p.pts.map(function (q) { return q.x.toFixed(1) + ',' + q.y.toFixed(1); }).join(' ');
      var hover = opts.live ? ' data-hi="' + p.hi + '" data-hj="' + p.hj + '"' : '';
      s.push('<polygon points="' + pts + '" fill="' + p.color + '" fill-opacity="' + p.alpha +
        '" stroke="' + p.stroke + '" stroke-width="' + (p.strokeWidth || 0.4) + '"' + hover + '/>');
    });
    s.push(axisSvg(Object.assign({}, axOpts, { part: 'frame' })));
    s.push(txt(16, 22, '3D 曲面 · ' + ({ diff: '差曲面 (Δ)', base: '基准曲面', other: '对比曲面', both: '双曲面叠加' }[mode]), 13, '#2C2C2A', 'start', 500));
    s.push(txt(16, 40, '拖动旋转 · 滚轮缩放 · Z 轴按值域归一化', 10, '#888780'));
    var lx = W - 150;
    /* 色标刻度必须标「实际用来着色的值域」：差曲面是 ±max|Δ|，
       基准/对比/双曲面是 Z 轴的 lo..hi（基准曲面值域），否则读数和颜色对不上 */
    var lgLo = mode === 'diff' ? sd.lo : axisLo;
    var lgHi = mode === 'diff' ? sd.hi : axisHi;
    s.push(txt(lx, H - 52, '色标', 10, '#5F5E5A'));
    for (var c = 0; c < 10; c++) {
      var t = c / 9;
      var col = mode === 'diff' ? diverging((t - 0.5) * 2 * Math.max(Math.abs(sd.lo), Math.abs(sd.hi)),
        Math.max(Math.abs(sd.lo), Math.abs(sd.hi))) : sequential(t);
      s.push('<rect x="' + (lx + c * 13) + '" y="' + (H - 46) + '" width="13" height="12" fill="' + col + '"/>');
    }
    s.push(txt(lx, H - 26, fmt(lgLo, 2), 10, '#5F5E5A'));
    s.push(txt(lx + 130, H - 26, fmt(lgHi, 2), 10, '#5F5E5A', 'end'));
    s.push('</svg>');
    return s.join('');
  }

  function gridIndices(nx, ny, maxI, maxJ) {
    var ii = [], jj = [];
    var sI = Math.max(1, Math.ceil(nx / maxI)), sJ = Math.max(1, Math.ceil(ny / maxJ));
    for (var i = 0; i < nx; i += sI) ii.push(i);
    if (ii[ii.length - 1] !== nx - 1) ii.push(nx - 1);
    for (var j = 0; j < ny; j += sJ) jj.push(j);
    if (jj[jj.length - 1] !== ny - 1) jj.push(ny - 1);
    return { ii: ii, jj: jj };
  }

  function meshPolys(cfg) {
    var polys = [], ii = cfg.ii, jj = cfg.jj, src = cfg.src;
    var span = cfg.zSpan === undefined ? 1.5 : cfg.zSpan;
    var off = cfg.zOff || 0;
    function X(i) { return ii.length > 1 ? (i / Math.max(1, cfg.nx - 1) - 0.5) * 2 : 0; }
    function Y(j) { return jj.length > 1 ? (j / Math.max(1, cfg.ny - 1) - 0.5) * 2 : 0; }
    function Z(v) { return ((v - cfg.lo) / (cfg.hi - cfg.lo) - 0.5) * span + off; }
    for (var a = 0; a < jj.length - 1; a++) {
      for (var b = 0; b < ii.length - 1; b++) {
        var i0 = ii[b], i1 = ii[b + 1], j0 = jj[a], j1 = jj[a + 1];
        var v00 = src[j0][i0], v10 = src[j0][i1], v01 = src[j1][i0], v11 = src[j1][i1];
        var p0 = cfg.proj(X(i0), Y(j0), Z(v00)), p1 = cfg.proj(X(i1), Y(j0), Z(v10));
        var p2 = cfg.proj(X(i1), Y(j1), Z(v11)), p3 = cfg.proj(X(i0), Y(j1), Z(v01));
        var mean = (v00 + v10 + v01 + v11) / 4;
        var hl = cfg.highlight;
        var isHl = hl && hl.axis !== 'none' && (
          (hl.axis === 'x' && i0 <= hl.i && i1 >= hl.i) ||
          (hl.axis === 'y' && j0 <= hl.j && j1 >= hl.j));
        polys.push({
          pts: [p0, p1, p2, p3], d: (p0.d + p1.d + p2.d + p3.d) / 4,
          color: cfg.colorFn ? cfg.colorFn(mean, i0, j0) : '#B4B2A9',
          alpha: cfg.alpha === undefined ? 1 : cfg.alpha,
          stroke: isHl ? '#D85A30' : (cfg.stroke || '#FFFFFF'),
          strokeWidth: isHl ? 1.8 : 0.4,
          hi: i0, hj: j0,
          title: cfg.live ? '' : (cfg.titleFn ? cfg.titleFn(i0, j0, mean) : '')
        });
      }
    }
    return polys;
  }

  /* live=true：面片只带坐标属性，tooltip 由宿主按坐标查数据生成，不写长文本。 */
  function polysSvg(polys, opts) {
    opts = opts || {};
    return polys.slice().sort(function (a, b) { return a.d - b.d; }).map(function (p) {
      var pts = p.pts.map(function (q) { return q.x.toFixed(1) + ',' + q.y.toFixed(1); }).join(' ');
      var hover = opts.live ? ' data-hi="' + p.hi + '" data-hj="' + p.hj + '"' : '';
      var op = p.alpha === 1 ? '' : ' fill-opacity="' + p.alpha + '"';
      return '<polygon points="' + pts + '" fill="' + p.color + '"' + op +
        ' stroke="' + p.stroke + '" stroke-width="' + (p.strokeWidth || 0.4) + '"' + hover + '>' +
        (!opts.live && p.title ? '<title>' + esc(p.title) + '</title>' : '') + '</polygon>';
    }).join('');
  }

  function shortName(s, n) {
    s = String(s || ''); n = n || 24;
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  /* 按实际投影范围反推缩放，保证整张图落在画布内。
     写死 190 时默认视角 (yaw .72 / pitch .86) 上下各溢 61px、最坏 138px，顶/底被切。
     X/Y 归一到 [-1,1]、Z 到 [zMin,zMax]；轴标签画在 -1.16 处，一并算进去。 */
  function fitScale(W, H, cx, cy, yaw, pitch, zMin, zMax, pad) {
    var cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    var maxL = 1e-9, maxR = 1e-9, maxU = 1e-9, maxD = 1e-9;
    function acc(X, Y, Z) {
      var xr = X * cyw - Y * syw, yr = X * syw + Y * cyw;
      var dx = xr, dy = Z * cp - yr * sp;   /* 屏幕 y = cy - dy*scale，所以 dy>0 靠上 */
      if (dx < 0) maxL = Math.max(maxL, -dx); else maxR = Math.max(maxR, dx);
      if (dy > 0) maxU = Math.max(maxU, dy); else maxD = Math.max(maxD, -dy);
    }
    var zs = [zMin, zMax, (zMin + zMax) / 2];
    [-1, 1].forEach(function (X) {
      [-1, 1].forEach(function (Y) { zs.forEach(function (Z) { acc(X, Y, Z); }); });
    });
    /* 轴标签与轴名锚点 */
    acc(-1.16, -1.16, zMin); acc(1.2, -1.16, zMin); acc(-1.16, 1.2, zMin);
    var p = pad === undefined ? 38 : pad;
    return Math.min((cx - p) / maxL, (W - p - cx) / maxR,
      (cy - p) / maxU, (H - p - cy) / maxD);
  }

  function viewOpts(opts, W, H, zMin, zMax, cxOff) {
    var yaw = opts.yaw === undefined ? 0.72 : opts.yaw;
    var pitch = opts.pitch === undefined ? 0.86 : opts.pitch;
    var cx = W / 2 + (cxOff || 0), cy = H / 2;
    var fit = fitScale(W, H, cx, cy, yaw, pitch,
      zMin === undefined ? -0.75 : zMin, zMax === undefined ? 0.75 : zMax);
    /* opts.scale 现在是「相对自适应比例的倍数」，1 = 刚好放下 */
    var mul = opts.scale === undefined ? 1 : opts.scale;
    return { yaw: yaw, pitch: pitch, scale: fit * mul, cx: cx, cy: cy };
  }

  function seg(a, b, color, w) {
    return '<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) +
      '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) +
      '" stroke="' + color + '" stroke-width="' + w + '"/>';
  }

  function pickIdx(n, count) {
    if (n <= 1) return [0];
    var k = Math.min(count, n), out = [];
    for (var t = 0; t < k; t++) out.push(Math.round(t * (n - 1) / (k - 1)));
    return out.filter(function (v, i, a) { return a.indexOf(v) === i; });
  }

  /* Three axes with real numeric ticks + base grid + optional probe highlight. */
  function axisSvg(c) {
    var out = [], proj = c.proj, part = c.part || 'all';
    var ux = c.units.x || '', uy = c.units.y || '', uz = c.units.w || '';
    var zLabel = c.zLabel || 'Z', compact = !!c.compact;
    var X = function (i) { return c.nx > 1 ? (i / Math.max(1, c.nx - 1) - 0.5) * 2 : 0; };
    var Y = function (j) { return c.ny > 1 ? (j / Math.max(1, c.ny - 1) - 0.5) * 2 : 0; };
    var Z = function (t) { return c.z0 + c.zSpan * t; };
    var ix = pickIdx(c.nx, compact ? 3 : 5), iy = pickIdx(c.ny, compact ? 3 : 5);
    var O = proj(-1, -1, c.z0), PX = proj(1, -1, c.z0), PY = proj(-1, 1, c.z0);
    var PZ = proj(-1, -1, Z(1));
    /* 地面网格单独成段：必须先画，否则会压在曲面上（曲面最低点正好落在 z0，
       网格线和面重合，看起来像线穿进了曲面）。 */
    if (part !== 'frame') {
      ix.forEach(function (i) { out.push(seg(proj(X(i), -1, c.z0), proj(X(i), 1, c.z0), '#E8E6DF', 0.7)); });
      iy.forEach(function (j) { out.push(seg(proj(-1, Y(j), c.z0), proj(1, Y(j), c.z0), '#E8E6DF', 0.7)); });
    }
    if (part === 'grid') return out.join('');
    out.push(seg(O, PX, '#5F5E5A', 1.2));
    out.push(seg(O, PY, '#5F5E5A', 1.2));
    out.push(seg(O, PZ, '#5F5E5A', 1.2));
    ix.forEach(function (i) {
      var p = proj(X(i), -1, c.z0), q = proj(X(i), -1.1, c.z0);
      out.push(seg(p, q, '#5F5E5A', 0.8));
      out.push(txt(q.x, q.y + 11, fmt(c.x[i], 2), compact ? 9 : 10, '#5F5E5A', 'middle'));
    });
    iy.forEach(function (j) {
      var p = proj(-1, Y(j), c.z0), q = proj(-1.1, Y(j), c.z0);
      out.push(seg(p, q, '#5F5E5A', 0.8));
      out.push(txt(q.x - 4, q.y + 3, fmt(c.y[j], 2), compact ? 9 : 10, '#5F5E5A', 'end'));
    });
    var zt = compact ? 2 : 4;
    for (var t = 0; t <= zt; t++) {
      var f = t / zt, p2 = proj(-1, -1, Z(f)), q2 = proj(-1.1, -1, Z(f));
      out.push(seg(p2, q2, '#5F5E5A', 0.8));
      out.push(txt(q2.x - 4, q2.y + 3, fmt(c.lo + (c.hi - c.lo) * f, 2), compact ? 9 : 10, '#5F5E5A', 'end'));
    }
    out.push(txt(PX.x + 6, PX.y + 4, 'X ' + ux, compact ? 9 : 11, '#5F5E5A'));
    out.push(txt(PY.x + 6, PY.y + 4, 'Y ' + uy, compact ? 9 : 11, '#5F5E5A'));
    out.push(txt(PZ.x + 6, PZ.y - 4, zLabel + ' ' + uz, compact ? 9 : 11, '#5F5E5A'));
    var hl = c.highlight;
    if (hl && hl.axis !== 'none') {
      var a, b, lab, label;
      if (hl.axis === 'x') {
        a = proj(X(hl.i), -1, c.z0); b = proj(X(hl.i), 1, c.z0);
        lab = proj(X(hl.i), 1.14, c.z0);
        label = 'X = ' + fmt(c.x[hl.i], 3) + ' ' + ux;
      } else {
        a = proj(-1, Y(hl.j), c.z0); b = proj(1, Y(hl.j), c.z0);
        lab = proj(1.14, Y(hl.j), c.z0);
        label = 'Y = ' + fmt(c.y[hl.j], 3) + ' ' + uy;
      }
      out.push(seg(a, b, '#D85A30', 2));
      out.push(txt(lab.x, lab.y + 4, label, compact ? 10 : 11, '#993C1D', 'middle', 500));
    }
    return out.join('');
  }

  function colorScaleSvg(x, y, divMax, lo, hi) {
    var out = [txt(x, y - 8, '色标', 10, '#5F5E5A')];
    for (var c = 0; c < 10; c++) {
      var t = c / 9;
      var col = divMax ? diverging((t - 0.5) * 2 * divMax, divMax) : sequential(t);
      out.push('<rect x="' + (x + c * 13) + '" y="' + y + '" width="13" height="12" fill="' + col + '"/>');
    }
    out.push(txt(x, y + 26, fmt(lo, 2), 10, '#5F5E5A'));
    out.push(txt(x + 130, y + 26, fmt(hi, 2), 10, '#5F5E5A', 'end'));
    return out.join('');
  }

  /* A: envelope surface, Z = signed max |delta| across all comparisons */
  function svgEnvelopeSurface(diffs, opts) {
    opts = opts || {};
    var good = diffs.filter(function (d) { return d.ok; });
    if (!good.length) return '<p class="empty">没有可执行的对比，无法生成包络曲面。</p>';
    var f = good[0], nx = f.nx, ny = f.ny;
    var src = [], which = [], maxAbs = 1e-12;
    for (var j = 0; j < ny; j++) {
      var row = [], wrow = [];
      for (var i = 0; i < nx; i++) {
        var best = 0, wk = -1;
        good.forEach(function (d, k) {
          var v = d.abs[j][i];
          if (Math.abs(v) > Math.abs(best)) { best = v; wk = k; }
        });
        row.push(best); wrow.push(wk);
        if (Math.abs(best) > maxAbs) maxAbs = Math.abs(best);
      }
      src.push(row); which.push(wrow);
    }
    var W = 760, H = 470;
    var po = viewOpts(opts, W, H, -0.75, 0.75, -40);
    var proj = projector(W, H, po);
    var g = gridIndices(nx, ny, 26, 22);
    var bySource = opts.colorBy === 'source';
    var eps = opts.eps === undefined ? 1e-12 : opts.eps;
    var counts = good.map(function () { return 0; });
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
      var w = which[j][i];
      if (w >= 0 && Math.abs(src[j][i]) > eps) counts[w]++;
    }
    var polys = meshPolys({
      nx: nx, ny: ny, ii: g.ii, jj: g.jj, src: src, lo: -maxAbs, hi: maxAbs,
      proj: proj, zSpan: 1.5, alpha: 1, highlight: opts.highlight, live: opts.live,
      colorFn: function (v, i, jj2) {
        if (bySource) { var w = which[jj2][i]; return w < 0 ? '#F1EFE8' : PALETTE[w % PALETTE.length]; }
        return diverging(v, maxAbs);
      },
      titleFn: function (i, jj2) {
        var w = which[jj2][i];
        return 'X=' + fmt(f.x[i], 3) + '  Y=' + fmt(f.y[jj2], 3) + '\nmax|Δ|=' + fmt(Math.abs(src[jj2][i])) +
          '  Δ=' + fmt(src[jj2][i]) + '\n来源: ' + (w >= 0 ? (good[w].other.label || good[w].other.name) : '无差异');
      }
    });
    var s = [svgOpen(W, H, 'class="envelope-svg"')];
    s.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#FFFFFF"/>');
    var envAx = { proj: proj, x: f.x, y: f.y, nx: nx, ny: ny,
      lo: -maxAbs, hi: maxAbs, z0: -0.75, zSpan: 1.5, units: f.base.units,
      zLabel: 'Δ', highlight: opts.highlight };
    s.push(axisSvg(Object.assign({}, envAx, { part: 'grid' })));
    s.push(polysSvg(polys, { live: opts.live }));
    s.push(axisSvg(Object.assign({}, envAx, { part: 'frame' })));
    s.push(txt(16, 22, '最大偏差包络曲面 (A) · Δ = 各对比 max|Δ| 的有符号值', 13, '#2C2C2A', 'start', 500));
    s.push(txt(16, 40, '每个工况点取 N 张对比里偏差最大的那张；' +
      (bySource ? '颜色 = 造成峰值的表' : '颜色 = Δ，红为正、蓝为负'), 10, '#888780'));
    var lx = W - 220, ly = 66;
    s.push(txt(lx, ly, bySource ? '来源表 / 峰值格数' : '峰值来源统计', 11, '#5F5E5A', 'start', 500));
    good.slice(0, 12).forEach(function (d, k) {
      var yy = ly + 18 + k * 20;
      var col = bySource ? PALETTE[k % PALETTE.length] : diverging((k % 2 ? 1 : -1) * maxAbs, maxAbs);
      s.push('<rect x="' + lx + '" y="' + (yy - 10) + '" width="12" height="12" fill="' + col + '"/>');
      s.push(txt(lx + 18, yy, shortName(d.other.label || d.other.name, 19) + '  ' + counts[k] + ' 格', 10, '#2C2C2A'));
    });
    if (good.length > 12) s.push(txt(lx, ly + 18 + 12 * 20, '其余 ' + (good.length - 12) + ' 张…', 10, '#888780'));
    if (!bySource) s.push(colorScaleSvg(12, H - 46, maxAbs, -maxAbs, maxAbs));
    s.push('</svg>');
    return s.join('');
  }

  /* B: small multiples, shared Z domain and color scale */
  function svgSurfaceGrid(diffs, opts) {
    opts = opts || {};
    var good = diffs.filter(function (d) { return d.ok; });
    if (!good.length) return '<p class="empty">没有可执行的对比，无法生成曲面小多图。</p>';
    var f = good[0], nx = f.nx, ny = f.ny;
    var layers = [{ label: '基准 · ' + (f.base.label || f.base.name), v: f.a, changed: 0 }]
      .concat(good.map(function (d) { return { label: d.other.label || d.other.name, v: d.b, changed: d.stats.changed }; }));
    var limit = clamp(opts.limit || 9, 2, 12);
    var show = layers.slice(0, limit);
    var flat = show.map(function (L) { return [].concat.apply([], L.v); });
    var lo = Infinity, hi = -Infinity;
    flat.forEach(function (r) { r.forEach(function (v) { if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-12) { hi += 1; lo -= 1; }
    var cols = Math.min(3, show.length), rows = Math.ceil(show.length / cols);
    var cw = 252, ch = 214, W = cols * cw + 16, H = rows * ch + 62;
    var po = viewOpts(opts, W, H);
    var g = gridIndices(nx, ny, 12, 10);
    var s = [svgOpen(W, H, 'class="grid-svg"')];
    s.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#FFFFFF"/>');
    var gridAll = layers.length;
    s.push(txt(12, 20, '曲面小多图 (B) · 共 ' + gridAll + ' 张' +
      (gridAll > show.length ? '，仅显示前 ' + show.length + ' 张' : '') +
      '，统一 Z 值域与色标', 13, '#2C2C2A', 'start', 500));
    show.forEach(function (L, k) {
      var bx = 8 + (k % cols) * cw, cyTop = 30 + Math.floor(k / cols) * ch;
      /* 每格按自身盒子自适应，不再写死 58：小图同样会顶到边框 */
      var cellScale = fitScale(cw, ch, cw / 2, ch / 2, po.yaw, po.pitch, -0.525, 0.525, 18) *
        (opts.smallScale === undefined ? 1 : opts.smallScale);
      var p2 = { yaw: po.yaw, pitch: po.pitch, scale: cellScale,
        cx: bx + cw / 2, cy: cyTop + ch / 2 - 2 };
      var proj = projector(W, H, p2);
      var gAx = { proj: proj, x: f.x, y: f.y, nx: nx, ny: ny,
        lo: lo, hi: hi, z0: -0.525, zSpan: 1.05, units: f.base.units,
        compact: true, highlight: opts.highlight };
      s.push('<rect x="' + bx + '" y="' + cyTop + '" width="' + (cw - 6) + '" height="' + (ch - 6) +
        '" fill="#FFFFFF" stroke="#E8E6DF" stroke-width="0.6" rx="8"/>');
      s.push(axisSvg(Object.assign({}, gAx, { part: 'grid' })));
      s.push(polysSvg(meshPolys({
        nx: nx, ny: ny, ii: g.ii, jj: g.jj, src: L.v, lo: lo, hi: hi,
        proj: proj, zSpan: 1.05, alpha: 1, highlight: opts.highlight, live: opts.live,
        colorFn: function (v) { return sequential((v - lo) / (hi - lo)); },
        titleFn: function (i, jj2) {
          return L.label + '\nX=' + fmt(f.x[i], 3) + ' Y=' + fmt(f.y[jj2], 3) + ' 值=' + fmt(L.v[jj2][i]);
        }
      }), { live: opts.live }));
      s.push(axisSvg(Object.assign({}, gAx, { part: 'frame' })));
      s.push(txt(bx + 8, cyTop + 16, shortName(L.label, 30), 11, '#2C2C2A', 'start', 500));
      s.push(txt(bx + 8, cyTop + 32, k === 0 ? '基准' : '变化格 ' + L.changed + ' / ' + (nx * ny), 10, '#888780'));
    });
    s.push(colorScaleSvg(12, H - 42, null, lo, hi));
    s.push(txt(W - 12, H - 26, '拖动旋转对全部小图同时生效', 10, '#888780', 'end'));
    s.push('</svg>');
    return s.join('');
  }

  /* C: N surfaces stacked, either overlaid or pulled apart along the third axis */
  function svgSurfaceStack(diffs, opts) {
    opts = opts || {};
    var good = diffs.filter(function (d) { return d.ok; });
    if (!good.length) return '<p class="empty">没有可执行的对比，无法叠加曲面。</p>';
    var f = good[0], nx = f.nx, ny = f.ny;
    var layers = [{ label: '基准 · ' + (f.base.label || f.base.name), v: f.a, color: '#5F5E5A' }]
      .concat(good.map(function (d, k) {
        return { label: d.other.label || d.other.name, v: d.b, color: PALETTE[k % PALETTE.length] };
      }));
    var maxN = clamp(opts.maxSurfaces || 5, 2, 12);
    var visible = opts.visible || [];
    var cand = layers.slice(0, maxN).map(function (L, k) { return { L: L, k: k }; })
      .filter(function (x) { return visible[x.k] !== false; });
    if (!cand.length) return '<p class="empty">所有层都被隐藏了，勾选层复选框即可显示。</p>';
    var lo = Infinity, hi = -Infinity;
    cand.forEach(function (x) {
      x.L.v.forEach(function (r) { r.forEach(function (v) { if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
    });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-12) { hi += 1; lo -= 1; }
    var W = 760, H = 470;
    var spaced = opts.layout === 'spaced';
    var gap = spaced ? (opts.gap === undefined ? 0.45 : opts.gap) : 0;
    var zBase = -(cand.length - 1) * gap / 2;
    /* 多层叠起来以后 Z 方向比单张高，按实际层数与间距算竖向量程 */
    var po = viewOpts(opts, W, H, zBase - 0.6,
      zBase + (cand.length - 1) * gap + 0.6, -50);
    var proj = projector(W, H, po);
    var alpha = spaced ? 0.94 : (opts.opacity === undefined ? 0.55 : opts.opacity);
    var g = gridIndices(nx, ny, 22, 18);
    var all = [], labels = [];
    cand.forEach(function (x, idx) {
      var off = zBase + idx * gap;
      all = all.concat(meshPolys({
        nx: nx, ny: ny, ii: g.ii, jj: g.jj, src: x.L.v, lo: lo, hi: hi,
        proj: proj, zSpan: 1.2, zOff: off, alpha: alpha, highlight: opts.highlight, live: opts.live,
        colorFn: function () { return x.L.color; },
        titleFn: function (i, jj2) {
          return 'L' + (x.k + 1) + ' ' + x.L.label + '\nX=' + fmt(f.x[i], 3) +
            ' Y=' + fmt(f.y[jj2], 3) + ' 值=' + fmt(x.L.v[jj2][i]);
        }
      }));
      labels.push({ p: proj(-1.08, -1, off + 0.35), text: 'L' + (x.k + 1) });
    });
    var s = [svgOpen(W, H, 'class="stack-svg"')];
    s.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#FFFFFF"/>');
    s.push(txt(16, 22, 'N 张曲面叠加 (C) · ' + (spaced ? '拉开距离' : '默认叠加') +
      ' · 共 ' + layers.length + ' 层' +
      (layers.length > maxN ? '（仅显示前 ' + maxN + ' 层）' : '') +
      (cand.length < Math.min(layers.length, maxN) ? '，当前可见 ' + cand.length + ' 层' : ''),
      13, '#2C2C2A', 'start', 500));
    s.push(txt(16, 40, (spaced ? ('层间距 ' + fmt(gap, 2) + '（仅用于分开显示，Z 刻度为 MAP 原值）') :
      '所有层共用一个 Z 基准，半透明叠合') + ' · 三轴刻度为真实数值 · 拖动旋转', 10, '#888780'));
    var stAx = { proj: proj, x: f.x, y: f.y, nx: nx, ny: ny,
      lo: lo, hi: hi, z0: zBase - 0.6, zSpan: 1.2, units: f.base.units,
      highlight: opts.highlight };
    s.push(axisSvg(Object.assign({}, stAx, { part: 'grid' })));
    s.push(polysSvg(all, { live: opts.live }));
    if (spaced) labels.forEach(function (l) { s.push(txt(l.p.x - 6, l.p.y + 4, l.text, 10, '#5F5E5A', 'end')); });
    s.push(axisSvg(Object.assign({}, stAx, { part: 'frame' })));
    var lx = W - 196, ly = 66;
    s.push(txt(lx, ly, '层 / MAP', 11, '#5F5E5A', 'start', 500));
    cand.slice(0, 12).forEach(function (x, k) {
      var yy = ly + 18 + k * 20;
      s.push('<rect x="' + lx + '" y="' + (yy - 10) + '" width="12" height="12" fill="' + x.L.color + '"/>');
      s.push(txt(lx + 18, yy, 'L' + (x.k + 1) + ' ' + shortName(x.L.label, 17), 10, '#2C2C2A'));
    });
    s.push(colorScaleSvg(12, H - 46, null, lo, hi));
    s.push('</svg>');
    return s.join('');
  }

  /* 跨版本剖面：同一个工况格在对比清单各层（各 MAP / 各版本）上的取值。
     层多时标签抽稀，并画出基准层的水平参考线，直接看出抬高还是压低。 */
  function svgProfile(cube, i, j, opts) {
    opts = opts || {};
    var prof = cube.profile(i, j);
    if (!prof.length) return '<p class="empty">坐标越界，无法取剖面。</p>';
    var vals = prof.map(function (p) { return p.value; }).filter(function (v) { return isFinite(v); });
    if (!vals.length) return '<p class="empty">该坐标没有可显示的数值。</p>';
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi - lo < 1e-12) { hi += 1; lo -= 1; }
    var pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    var W = 760, H = 300, L = 78, R = 26, T = 54, B = 84;
    var pw = W - L - R, ph = H - T - B;
    var baseV = prof[0].value, dMin = Infinity, dMax = -Infinity;
    prof.forEach(function (p) {
      if (!isFinite(p.value)) return;
      var dd = p.value - baseV;
      if (dd < dMin) dMin = dd;
      if (dd > dMax) dMax = dd;
    });
    var u = opts.units || {};
    var uw = u.w ? ' ' + u.w : '';
    var s = [svgOpen(W, H, 'class="profile-svg"')];
    s.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#FFFFFF"/>');
    s.push(txt(16, 22, '跨版本剖面 · X=' + fmt(cube.x[i], 3) + '，Y=' + fmt(cube.y[j], 3) +
      '（共 ' + prof.length + ' 层）', 13, '#2C2C2A', 'start', 500));
    s.push(txt(16, 40, '同一格在各层上的取值 · 第 1 层为基准 · 相对基准 Δ ' +
      (dMin === dMax ? fmt(dMax) : fmt(dMin) + ' ~ ' + fmt(dMax)) + uw, 10, '#888780'));
    var vx = function (k) { return L + (prof.length === 1 ? pw / 2 : pw * k / (prof.length - 1)); };
    var vy = function (v) { return T + ph * (hi - v) / (hi - lo); };
    for (var g = 0; g <= 4; g++) {
      var gy = T + ph * g / 4;
      s.push('<line x1="' + L + '" y1="' + gy + '" x2="' + (L + pw) + '" y2="' + gy + '" stroke="#E8E6DF" stroke-width="1"/>');
      s.push(txt(L - 8, gy + 4, fmt(hi - (hi - lo) * g / 4, 2), 10, '#5F5E5A', 'end'));
    }
    /* 基准层水平参考线 */
    s.push('<line x1="' + L + '" y1="' + vy(baseV).toFixed(1) + '" x2="' + (L + pw) + '" y2="' + vy(baseV).toFixed(1) +
      '" stroke="#2C2C2A" stroke-width="1" stroke-dasharray="4 3" opacity="0.5"/>');
    s.push(txt(L + pw - 4, vy(baseV) - 5, '基准 ' + fmt(baseV, 2) + uw, 9, '#5F5E5A', 'end'));
    var pts = prof.map(function (p, k) { return vx(k) + ',' + vy(p.value); }).join(' ');
    s.push('<polyline points="' + pts + '" fill="none" stroke="#185FA5" stroke-width="2.2" stroke-linejoin="round"/>');
    var step = prof.length > 12 ? Math.ceil(prof.length / 10) : 1;
    prof.forEach(function (p, k) {
      s.push('<circle cx="' + vx(k) + '" cy="' + vy(p.value) + '" r="' + (k === 0 ? 3.8 : 3) +
        '" fill="' + (k === 0 ? '#2C2C2A' : '#D85A30') + '"><title>L' + (k + 1) + ' ' +
        esc(p.label) + '：' + fmt(p.value) + uw + '</title></circle>');
      if (k % step !== 0 && k !== prof.length - 1) return;
      s.push(txt(vx(k), vy(p.value) - 9, fmt(p.value, 2), 10, '#2C2C2A', 'middle'));
      var lbl = p.label.length > 12 ? p.label.slice(0, 11) + '…' : p.label;
      s.push(txt(vx(k), T + ph + 20, 'L' + (k + 1), 10, '#5F5E5A', 'middle'));
      s.push(txt(vx(k), T + ph + 36, lbl, 9, '#888780', 'middle'));
    });
    s.push(txt(L + pw / 2, H - 10, '第三维：对比清单中的顺序（第 1 层为基准）', 11, '#5F5E5A', 'middle'));
    s.push('</svg>');
    return s.join('');
  }

  function tableHtml(diff, opts) {
    opts = opts || {};
    if (!diff || !diff.ok) return '<p class="empty">' + esc(diff && diff.reason || '无数据') + '</p>';
    var cells = diff.stats.changedCells;
    if (!opts.onlyChanged) {
      cells = [];
      for (var j = 0; j < diff.ny; j++) for (var i = 0; i < diff.nx; i++) {
        cells.push({ i: i, j: j, x: diff.x[i], y: diff.y[j], a: diff.a[j][i], b: diff.b[j][i],
          delta: diff.b[j][i] - diff.a[j][i], rel: diff.rel[j][i] });
      }
    }
    var limit = opts.limit || 1500;
    var rows = cells.slice(0, limit).map(function (c) {
      return '<tr><td>' + fmt(c.y, 4) + '</td><td>' + fmt(c.x, 4) + '</td><td>' + fmt(c.a) + '</td><td>' + fmt(c.b) +
        '</td><td class="' + (c.delta > 0 ? 'up' : (c.delta < 0 ? 'down' : '')) + '">' + fmt(c.delta) + '</td><td>' +
        (c.rel === null ? '基准为 0' : fmt(c.rel, 3) + '%') + '</td><td>' + esc(diff.other.srcFile) + ':' + diff.other.startLine +
        '</td></tr>';
    }).join('');
    return '<div class="tbl-wrap"><table class="detail"><thead><tr><th>Y 轴值</th><th>X 轴值</th><th>基准原值</th>' +
      '<th>对比原值</th><th>Δ</th><th>相对差</th><th>来源文件:行号</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (cells.length > limit ? '<p class="hint">明细共 ' + cells.length + ' 行，报告内仅列出前 ' + limit + ' 行。</p>' : '');
  }

  /* 一维标定对象（数组 / 曲线）的 Δ 剖面：上半基准 vs 对比折线，下半逐点 Δ 柱。
     标量只有 1 个值，没有「沿轴」概念，交给单值明细表，不画假曲线。 */
  function svgDeltaProfile(diff, opts) {
    opts = opts || {};
    if (!diff || !diff.ok || diff.ny !== 1 || diff.nx < 2) {
      return '<p class="empty">该视图只适用于一维数组 / 曲线 / 轴断点序列；标量请看单值明细表。</p>';
    }
    var n = diff.nx, step = Math.max(1, Math.ceil(n / 60)), pts = [], i;
    for (i = 0; i < n; i += step) pts.push(i);
    if (pts[pts.length - 1] !== n - 1) pts.push(n - 1);
    var av = diff.a[0], bv = diff.b[0], dv = diff.abs[0], rv = diff.rel ? diff.rel[0] : null;
    var lo = Infinity, hi = -Infinity, dmax = 0;
    pts.forEach(function (k) {
      [av[k], bv[k]].forEach(function (v) {
        if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      });
      if (isFinite(dv[k])) dmax = Math.max(dmax, Math.abs(dv[k]));
    });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-12) { hi += 1; lo -= 1; }
    var pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
    if (dmax <= 0) dmax = 1;
    var W = 760, H = 330, L = 76, R = 150, T = 40, B = 58;
    var pw = W - L - R, ph = H - T - B;
    var topH = ph * 0.56, zeroY = T + ph * 0.80, barH = ph * 0.16;
    var X = function (k) { return L + (n > 1 ? k / (n - 1) : 0) * pw; };
    var Y = function (v) { return T + topH - (v - lo) / (hi - lo) * (topH - 12); };
    var ux = (diff.base.units && diff.base.units.x) || '';
    var uw = (diff.base.units && diff.base.units.w) || '';
    var s = [svgOpen(W, H, 'class="delta-profile-svg"')];
    s.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#FFFFFF"/>');
    s.push(txt(L, 20, opts.title || ('一维 Δ 剖面 · ' + (diff.other.label || diff.other.name)), 13, '#2C2C2A', 'start', 500));
    var isAxis = diff.base.type === 'axis' || diff.base.isAxisDef;
    s.push(txt(L, 34, '上：基准 / 对比原值   下：逐点 Δ   ·   ' +
      (isAxis ? '横轴为断点序号，纵轴为断点数值' :
        (diff.base.axisFromIndex ? '横轴为元素索引' : '横轴为真实 X 断点')), 10, '#888780'));
    // 网格
    for (var g = 0; g <= 4; g++) {
      var gy = T + g * (topH - 12) / 4;
      s.push('<line x1="' + L + '" y1="' + gy.toFixed(1) + '" x2="' + (L + pw) +
        '" y2="' + gy.toFixed(1) + '" stroke="#E8E6DF" stroke-width="1"/>');
      s.push(txt(L - 8, gy + 4, fmt(hi - g * (hi - lo) / 4, 2), 10, '#5F5E5A', 'end'));
    }
    s.push('<line x1="' + L + '" y1="' + zeroY.toFixed(1) + '" x2="' + (L + pw) +
      '" y2="' + zeroY.toFixed(1) + '" stroke="#B4B2A9" stroke-width="1"/>');
    // Δ 柱
    pts.forEach(function (k) {
      var v = dv[k] || 0, bh = Math.abs(v) / dmax * barH;
      var by = v >= 0 ? zeroY - bh : zeroY;
      var bw = Math.max(2, Math.min(18, pw / pts.length * 0.7));
      var tip = 'X=' + fmt(diff.x[k], 4) + ' ' + ux + '\n基准=' + fmt(av[k]) + '  对比=' + fmt(bv[k]) +
        '\nΔ=' + fmt(v) + (rv && rv[k] !== null ? '  相对=' + fmt(rv[k], 3) + '%' : '  基准为 0') +
        (diff.interpolated ? '\n[已插值对齐]' : '');
      s.push('<rect x="' + (X(k) - bw / 2).toFixed(1) + '" y="' + by.toFixed(1) +
        '" width="' + bw.toFixed(1) + '" height="' + Math.max(0.6, bh).toFixed(1) +
        '" fill="' + (v >= 0 ? '#E24B4A' : '#378ADD') + '" fill-opacity="0.85" data-tip="' +
        esc(tip) + '"><title>' + esc(tip) + '</title></rect>');
    });
    // 两条折线
    function pathOf(arr, color, dash) {
      var d = pts.map(function (k, q) {
        return (q ? 'L' : 'M') + X(k).toFixed(1) + ',' + Y(arr[k]).toFixed(1);
      }).join(' ');
      return '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.8" ' +
        (dash ? 'stroke-dasharray="' + dash + '" ' : '') + 'stroke-linejoin="round"/>';
    }
    s.push(pathOf(av, '#2C2C2A', ''));
    s.push(pathOf(bv, '#D85A30', ''));
    pts.forEach(function (k) {
      s.push('<circle cx="' + X(k).toFixed(1) + '" cy="' + Y(bv[k]).toFixed(1) +
        '" r="2.2" fill="#D85A30"/>');
    });
    // X 刻度
    var tickStep = Math.max(1, Math.ceil(pts.length / 10));
    pts.forEach(function (k, q) {
      if (q % tickStep && q !== pts.length - 1) return;
      s.push(txt(X(k), H - B + 18, fmt(diff.x[k], 2), 10, '#5F5E5A', 'middle'));
    });
    s.push(txt(L + pw / 2, H - 8, 'X ' + esc(ux) + '   ·   ' + n + ' 点' +
      (step > 1 ? '（每 ' + step + ' 点显示 1 个）' : ''), 11, '#5F5E5A', 'middle'));
    // 图例
    s.push('<line x1="' + (L + pw + 14) + '" y1="' + (T + 8) + '" x2="' + (L + pw + 38) +
      '" y2="' + (T + 8) + '" stroke="#2C2C2A" stroke-width="2"/>');
    s.push(txt(L + pw + 42, T + 12, '基准', 10, '#5F5E5A'));
    s.push('<line x1="' + (L + pw + 14) + '" y1="' + (T + 28) + '" x2="' + (L + pw + 38) +
      '" y2="' + (T + 28) + '" stroke="#D85A30" stroke-width="2"/>');
    s.push(txt(L + pw + 42, T + 32, '对比', 10, '#5F5E5A'));
    s.push(txt(L + pw + 14, T + 56, 'Z 单位 ' + esc(uw || '（空）'), 10, '#5F5E5A'));
    s.push(txt(L + pw + 14, T + 72, 'max|Δ| ' + fmt(dmax), 10, '#5F5E5A'));
    s.push(txt(L + pw + 14, zeroY + 4, 'Δ=0', 10, '#888780'));
    s.push(txt(W - R + 6, zeroY - barH - 6, '+' + fmt(dmax, 2), 9, '#A32D2D'));
    s.push('</svg>');
    return s.join('');
  }

  /* 按对象类型给证据表：标量是单值行，一维对象是沿 X 的序列，二维沿用原网格表。
     不把 1×1 标量塞进「Y 轴值 / X 轴值」的二维表头里。 */
  /* 逐格明细导出 CSV：给标定工程师贴 Excel 用。
     BOM 由调用方加（Excel 识别中文），这里只管内容与转义。 */
  function csvCell(v) {
    var s = String(v === undefined || v === null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvOf(diff, opts) {
    opts = opts || {};
    if (!diff || !diff.ok) return '';
    var b = diff.base || {}, o = diff.other || {}, u = b.units || {};
    var ux = u.x ? ' (' + u.x + ')' : '', uy = u.y ? ' (' + u.y + ')' : '', uw = u.w ? ' (' + u.w + ')' : '';
    var head = ['表名', 'Y 轴值' + uy, 'X 轴值' + ux, '基准值' + uw, '对比值' + uw,
      'Δ' + uw, '相对差 %', '来源'];
    var cells = diff.stats.changedCells;
    if (!opts.onlyChanged) {
      cells = [];
      for (var j = 0; j < diff.ny; j++) for (var i = 0; i < diff.nx; i++) {
        cells.push({ i: i, j: j, x: diff.x[i], y: diff.y[j], a: diff.a[j][i], b: diff.b[j][i],
          delta: diff.b[j][i] - diff.a[j][i], rel: diff.rel[j][i] });
      }
    }
    var src = (o.srcFile || '') + ':' + (o.startLine || '');
    var lines = [head.map(csvCell).join(',')];
    cells.forEach(function (c) {
      lines.push([o.label || o.name || '', fmt(c.y, 4), fmt(c.x, 4), fmt(c.a), fmt(c.b),
        fmt(c.delta), (c.rel === null || c.rel === undefined ? '' : fmt(c.rel, 3)), src].map(csvCell).join(','));
    });
    return lines.join('\r\n');
  }
  function tableHtmlTyped(diff, opts) {
    opts = opts || {};
    if (!diff || !diff.ok) return '<p class="empty">对比不可用</p>';
    var t = (diff.base && diff.base.type) || 'map2d';
    if (t === 'map2d' || t === 'map3d') return tableHtml(diff, opts);
    var limit = opts.limit || 1500;
    var uw = (diff.base.units && diff.base.units.w) || '';
    var ux = (diff.base.units && diff.base.units.x) || '';
    var unitTag = function (u) { return u ? ' <span class="unit">(' + esc(u) + ')</span>' : ''; };
    var cell = function (cls, body) { return '<td class="' + cls + '">' + body + '</td>'; };
    var numCell = function (v, tone) {
      return cell(tone ? 'num ' + tone : 'num', esc(fmt(v)));
    };
    if (t === 'scalar') {
      var a0 = diff.a[0][0], b0 = diff.b[0][0], d0 = diff.abs[0][0];
      var r0 = diff.rel && diff.rel[0] ? diff.rel[0][0] : null;
      var sTone = Math.abs(d0) > (opts.eps || 1e-9) ? (d0 > 0 ? 'up' : 'down') : '';
      return '<div class="tbl-wrap"><table class="detail dcm-tbl"><thead><tr><th>标定量</th><th>单位</th>' +
        '<th class="num">基准值' + unitTag(uw) + '</th><th class="num">对比值' + unitTag(uw) +
        '</th><th class="num">Δ' + unitTag(uw) + '</th><th class="num">相对差</th>' +
        '<th>A 来源:行号</th><th>B 来源:行号</th></tr></thead><tbody>' +
        '<tr class="' + (sTone ? 'chg' : 'eq') + '"><td>' + esc(diff.base.name) +
        '</td><td>' + esc(uw || '（空）') + '</td>' + numCell(a0) + numCell(b0) +
        cell(sTone ? 'num ' + sTone : 'num', esc(fmt(d0))) +
        '<td class="num">' + (r0 === null ? '基准为 0' : esc(fmt(r0, 3)) + '%') +
        '</td><td>' + esc(diff.base.srcFile) + ':' + diff.base.startLine +
        '</td><td>' + esc(diff.other.srcFile) + ':' + diff.other.startLine +
        '</td></tr></tbody></table></div>';
    }
    var axisMode = t === 'axis' || diff.base.isAxisDef;
    // x 是索引时，diff.x[i] 就是 i，「序号」与「断点序号/索引」是同一列，合并掉；
    // 曲线用真实 X 轴时两者不同，保留序号 + X 轴值两列。
    var indexAxis = !!diff.base.axisFromIndex || axisMode;
    var colPos = indexAxis ? (axisMode ? '断点序号' : '索引') : '序号';
    var colA = (axisMode ? 'A 版断点值' : '基准值') + unitTag(uw);
    var colB = (axisMode ? 'B 版断点值' : '对比值') + unitTag(uw);
    var head = '<thead><tr><th class="num">' + colPos + '</th>' +
      (indexAxis ? '' : '<th class="num">X 轴值' + unitTag(ux) + '</th>') +
      '<th class="num">' + colA + '</th><th class="num">' + colB + '</th>' +
      '<th class="num">Δ' + unitTag(uw) + '</th><th class="num">相对差</th></tr></thead>';
    var rows = [], count = 0, changedRows = 0;
    for (var i = 0; i < diff.nx; i++) {
      var a = diff.a[0][i], b = diff.b[0][i], d = diff.abs[0][i];
      var r = diff.rel && diff.rel[0] ? diff.rel[0][i] : null;
      var isChg = Math.abs(d) > (opts.eps || 1e-9);
      if (opts.onlyChanged && !isChg) continue;
      if (count >= limit) break;
      var tone = isChg ? (d > 0 ? 'up' : 'down') : '';
      if (isChg) changedRows++;
      rows.push('<tr class="' + (isChg ? 'chg' : 'eq') + '">' +
        cell('num', i) +
        (indexAxis ? '' : cell('num', esc(fmt(diff.x[i], 3)))) +
        numCell(a) + numCell(b) +
        cell(tone ? 'num ' + tone : 'num', esc(fmt(d))) +
        cell(tone ? 'num ' + tone : 'num', r === null ? '基准为 0' : esc(fmt(r, 3)) + '%') +
        '</tr>');
      count++;
    }
    var caption = '<div class="dcm-tbl-cap"><b>逐点证据表</b> · 共 ' + count + ' 个数据点，' +
      '<span class="up">变化 ' + changedRows + '</span> 个' + (axisMode ? '（轴断点）' : '') +
      (count >= limit ? ' · 仅列出前 ' + limit + ' 行' : '') + '</div>';
    return '<div class="tbl-wrap">' + caption +
      '<table class="detail dcm-tbl">' + head + '<tbody>' + rows.join('') +
      '</tbody></table></div>';
  }

  return {
    esc: esc, fmt: fmt, diverging: diverging, sequential: sequential, PALETTE: PALETTE,
    svgHeat: svgHeat, svgCurves: svgCurves, svgSurface: svgSurface,
    svgEnvelopeSurface: svgEnvelopeSurface, svgSurfaceGrid: svgSurfaceGrid,
    svgSurfaceStack: svgSurfaceStack,
    svgProfile: svgProfile, tableHtml: tableHtml,
    svgDeltaProfile: svgDeltaProfile, tableHtmlTyped: tableHtmlTyped, csvOf: csvOf
  };
});
