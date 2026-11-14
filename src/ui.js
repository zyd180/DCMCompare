/* UI controller. */
(function () {
  'use strict';
  var C = window.DCMCore, V = window.DCMViews, RP = window.DCMReport;
  var $ = function (id) { return document.getElementById(id); };
  var esc = V.esc;
  function shortLabel(s, n) {
    n = n || 12; s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function defaultOpts() {
    return {
      surfaceMode: 'diff', surface: { yaw: 0.72, pitch: 0.86, zoom: 1 },
      envelopeColor: 'delta', gridLimit: 9,
      surfaceProbe: { axis: 'none', index: 0 },
      stack: { layout: 'spaced', gap: 0.45, opacity: 0.55, maxSurfaces: 5, visible: [] },
      renameOpts: { minScore: 0.72, minValueSim: 0.75, minNameSim: 0.25, minCells: 4 },
      audit: {
        type: 'all', status: 'changes', search: '', page: 0, pageSize: 40,
        detailId: '', onlyRisk: false
      },
      allowDelta: null,
      curve: { axis: 'row', index: 0 }, profile: { i: 0, j: 0 },
      heatIndex: 0, heatEnvelope: false, tableIndex: 0,
      onlyChanged: false, showValues: false
    };
  }

  var state = {
    datasets: [], index: null, basket: [], baseKey: null,
    /* 版本号由 build 注入到 <html data-dcm-version>，报告据此标注生成它的工具版本 */
    toolVersion: (document.documentElement.getAttribute('data-dcm-version') || ''),
    mode: 'absolute', eps: 1e-9, autoThreshold: false, effectiveEps: 1e-9,
    view: 'heat', listMode: 'groups', search: '',
    result: null, inspect: null, versionScan: null, renameScan: null,
    axisScan: null, audit: null, auditRunning: false, reportPageSize: 12,
    annotations: {}, sessionJson: null,
    opts: defaultOpts()
  };

  function effEps(base) {
    return state.autoThreshold ? C.suggestEps(base).eps : state.eps;
  }

  function status(msg, warn) {
    $('statusText').textContent = msg;
    $('statusText').className = warn ? 'warn-t' : '';
  }

  var resultCache = { key: '', result: null, inspect: null };

  function computeResult() {
    if (!state.basket.length) {
      state.result = null; state.inspect = null; resultCache.key = '';
      return;
    }
    var base = state.basket.filter(function (m) { return m.key === state.baseKey; })[0] || state.basket[0];
    state.baseKey = base.key;
    var eps = effEps(base);
    state.effectiveEps = eps;
    var key = [state.baseKey, state.mode, eps,
      state.basket.map(function (m) { return m.key; }).join('|')].join('::');
    if (resultCache.key === key && resultCache.result) {
      state.result = resultCache.result;
      state.inspect = resultCache.inspect;
      return;
    }
    var others = state.basket.filter(function (m) { return m !== base; });
    state.result = {
      base: base, others: others,
      all: C.computeAllDiffs(base, others, { mode: state.mode, eps: eps }),
      cube: C.buildCube(base, others, {})
    };
    state.inspect = state.result.all.diffs.map(function (d) {
      return d.ok ? C.inspectForType(d, { eps: eps }) : null;
    });
    resultCache = { key: key, result: state.result, inspect: state.inspect };
  }

  function goodDiffs() {
    return state.result ? state.result.all.diffs.filter(function (d) { return d.ok; }) : [];
  }

  /* ---------- file loading ---------- */
  var loadFails = [];

  /* 成功与失败都走这里收尾。旧实现只在「最后一个文件成功」时重建索引：
     只要最后一个是失败的那个，前面已解析的文件就躺在 datasets 里但界面没刷新，
     按钮还是禁用状态，看起来像"什么都没发生"。失败必须被看见，成功的数据也不能白读。 */
  function finishLoad() {
    if (!state.datasets.length) {
      status('载入失败：没有可用文件（' + loadFails.join('；') + '）', true);
      renderAll();
      return;
    }
    state.index = C.buildIndex(state.datasets);
    $('dropzone').style.display = 'none';
    var n = state.datasets.length;
    $('btnReport').disabled = false;
    $('btnScan').disabled = n < 2;
    $('btnAuditReport').disabled = n < 2;
    state.audit = null; // 数据源变了，旧账本作废，不拿过期结论当证据
    var bad = state.datasets.reduce(function (a, d) { return a + d.stats.invalid; }, 0);
    status('已载入 ' + n + ' 个文件 · ' + state.index.all.length + ' 个可比对象 · 异常块 ' + bad +
      (loadFails.length ? ' · 失败 ' + loadFails.length + ' 个' : ''), bad > 0 || loadFails.length > 0);
    renderAll();
    if (loadFails.length) {
      $('stage').insertAdjacentHTML('afterbegin',
        '<div class="warnbox"><b>' + loadFails.length + ' 个文件载入失败，其余文件仍可使用</b><br>' +
        loadFails.map(esc).join('<br>') + '</div>');
    }
  }

  function loadFiles(files) {
    var list = Array.prototype.slice.call(files).filter(function (f) { return f && f.size; });
    if (!list.length) return;
    var done = 0;
    loadFails = [];
    /* 按用户选择顺序回填：并行读取谁先完成不确定，直接 push 会让
       「A → B」的审查方向随文件大小反掉（小文件先读完就排到前面）。 */
    var slots = new Array(list.length), errs = new Array(list.length);
    status('正在解析 ' + list.length + ' 个文件…');
    function settle() {
      done++;
      if (done !== list.length) return;
      loadFails = errs.filter(Boolean);
      slots.forEach(function (ds) { if (ds) state.datasets.push(ds); });
      finishLoad();
    }
    list.forEach(function (f, idx) {
      f.arrayBuffer().then(function (buf) {
        var dec = C.decodeDcm(buf);
        var ds = C.parseDcm(dec.text, f.name);
        ds.encoding = dec.encoding;
        ds.decodeNote = dec.note;
        slots[idx] = ds;
        settle();
      }).catch(function (e) {
        errs[idx] = f.name + '：' + (e && e.message ? e.message : '读取失败');
        settle();
      });
    });
  }

  /* ---------- left panel ---------- */
  function renderDsList() {
    $('dsCount').textContent = state.datasets.length + ' 个文件';
    $('objCount').textContent = state.index ? state.index.all.length + ' 个对象' : '';
    $('dsList').innerHTML = state.datasets.map(function (d) {
      return '<div><span class="ds-name" title="' + esc(d.fileName) + '">' + esc(d.fileName) + '</span>' +
        '<span class="ds-meta">' + d.stats.totalBlocks + ' 块 · ' + esc(d.encoding) + '</span>' +
        '<button class="mini ds-del" data-act="dsdel" data-ds="' + esc(d.id) +
        '" data-tip="移除该数据源">×</button></div>';
    }).join('');
  }

  /* 移除一个数据源：索引、对比清单、账本全部按它作废，不能留下指向已删文件的条目。
     对比清单按 m.id（数据源 id）过滤 —— 同名文件载入两次时按文件名会误删另一份。 */
  function removeDataset(dsId) {
    var ds = state.datasets.filter(function (d) { return d.id === dsId; })[0];
    if (!ds) return;
    state.datasets = state.datasets.filter(function (d) { return d.id !== dsId; });
    var dropped = state.basket.filter(function (m) { return m.id === dsId; }).length;
    state.basket = state.basket.filter(function (m) { return m.id !== dsId; });
    if (!state.basket.some(function (m) { return m.key === state.baseKey; })) {
      state.baseKey = state.basket.length ? state.basket[0].key : null;
    }
    state.index = state.datasets.length ? C.buildIndex(state.datasets) : null;
    state.result = null; state.inspect = null;
    state.versionScan = null; state.renameScan = null; state.axisScan = null;
    state.audit = null; state.auditSig = '';
    resultCache.key = '';
    var n = state.datasets.length;
    $('btnReport').disabled = n === 0;
    $('btnScan').disabled = n < 2;
    $('btnAuditReport').disabled = n < 2;
    $('dropzone').style.display = n ? 'none' : '';
    renderAll();
    status('已移除 ' + ds.fileName + (dropped ? '，并从对比清单移除 ' + dropped + ' 项' : '') +
      ' · 剩余 ' + n + ' 个文件', n === 0);
  }

  function match(m) {
    if (!state.search) return true;
    var q = state.search.toLowerCase();
    return (m.name + ' ' + m.funktion + ' ' + m.nx + 'x' + m.ny + ' ' + m.srcFile).toLowerCase().indexOf(q) >= 0;
  }

  /* 三轴表只解析第一层：在列表、对比清单、报告里都必须显式标出来，
     否则用户会把它当完整三维数据用。计算逻辑不动，只做口径披露。 */
  function provTag3d(m) {
    return m && m.provisional ?
      '<span class="badge tag3d" title="三轴表格式未经实测，仅解析第一层二维数据参与对比">3D·仅第一层</span>' : '';
  }

  function itemHtml(m) {
    return '<div class="item"><span class="nm" title="' + esc(m.name) + ' · ' + esc(m.langname) + '">' + esc(m.name) +
      '</span>' + provTag3d(m) + '<span class="src">' + esc(m.srcFile.replace(/\.[^.]+$/, '')) + '</span>' +
      '<button class="mini" data-act="add" data-key="' + esc(m.key) + '" data-tip="加入对比清单">＋</button></div>';
  }

  function renderTree() {
    if (!state.index) return;
    var html = [], shown = 0;
    if (state.listMode === 'groups') {
      state.index.groups.forEach(function (g, gi) {
        var maps = g.maps.filter(match);
        if (!maps.length) return;
        if (shown++ > 220) return;
        var label = (g.kind === 'map2d' ? 'MAP' : '曲线') + ' ' + g.nx + '×' + g.ny + ' · ' + maps.length + ' 张';
        html.push('<div class="grp' + (shown <= 3 ? ' open' : '') + '" data-gi="' + gi + '">' +
          '<div class="grp-head"><button class="mini" data-act="toggle" data-tip="展开/收起">▾</button><span class="gname" title="' +
          esc(label) + '">' + esc(label) + '</span><span class="badge">同轴</span>' +
          '<button class="mini" data-act="group" data-gi="' + gi + '" data-tip="整组加入清单">整组加入</button></div>' +
          '<div class="grp-items">' + maps.map(itemHtml).join('') + '</div></div>');
      });
    } else if (state.listMode === 'versions') {
      state.index.versionGroups.forEach(function (g, gi) {
        if (!match(g.items[0])) return;
        if (shown++ > 220) return;
        html.push('<div class="grp' + (shown <= 3 ? ' open' : '') + '">' +
          '<div class="grp-head"><button class="mini" data-act="toggle" data-tip="展开/收起">▾</button><span class="gname" title="' +
          esc(g.name) + '">' + esc(g.name) + '</span><span class="badge">' + g.items.length + ' 版</span>' +
          '<button class="mini" data-act="vgroup" data-gi="' + gi + '" data-tip="整组加入清单">整组加入</button></div>' +
          '<div class="grp-items">' + g.items.map(itemHtml).join('') + '</div></div>');
      });
      if (!html.length) html.push('<p class="hint">需要载入 2 份以上 DCM 才有跨版本同名对象。</p>');
    } else {
      var all = state.index.all.filter(match);
      html.push('<p class="hint">匹配 ' + all.length + ' 个对象，最多列出前 300 个。用搜索缩小范围。</p>');
      html.push(all.slice(0, 300).map(itemHtml).join(''));
    }
    $('tree').innerHTML = html.join('');
  }

  function findMap(key) {
    var m = state.index.all.filter(function (x) { return x.key === key; })[0];
    if (m) return m;
    // 轴定义不在 index.all（buildIndex 只收录 ds.maps），按 key 现场包装成可比对象，
    // 否则变化清单里点「加入对比清单」会静默失败。key 与 buildFullAudit 用的是同一套规则。
    for (var i = 0; i < state.datasets.length; i++) {
      var ds = state.datasets[i];
      for (var j = 0; j < (ds.axisDefs || []).length; j++) {
        var c = C.axisToComparable(ds.axisDefs[j], ds);
        if (c.key === key) return c;
      }
    }
    return null;
  }

  function addToBasket(m) {
    if (!m) return;
    if (state.basket.some(function (x) { return x.key === m.key; })) return;
    state.basket.push(m);
    if (!state.baseKey) state.baseKey = m.key;
    if (m.provisional) {
      status('已加入 ' + (m.label || m.name) + '：这是三轴表，仅第一层二维数据参与对比，不是完整三维结果', true);
    }
    renderAll();
  }

  function provNote(maps) {
    var n = (maps || []).filter(function (m) { return m && m.provisional; }).length;
    return n ? '；其中 ' + n + ' 张三轴表仅第一层参与对比' : '';
  }

  function addMany(maps, resetBase) {
    if (!maps || !maps.length) return;
    var added = 0, addedMaps = [];
    maps.forEach(function (m) {
      if (state.basket.some(function (x) { return x.key === m.key; })) return;
      state.basket.push(m); added++; addedMaps.push(m);
    });
    if (resetBase || (added && !state.baseKey)) {
      state.baseKey = maps[0].key;
      if (resetBase && state.basket.length > maps.length) {
        status('整组加入 ' + added + ' 张，基准已自动切到该组第一张（避免与清单里其它维度的表冲突）' + provNote(addedMaps));
      } else status('已加入 ' + added + ' 张 MAP，对比清单共 ' + state.basket.length + ' 项' + provNote(addedMaps));
      renderAll();
      return;
    }
    status('已加入 ' + added + ' 张 MAP，对比清单共 ' + state.basket.length + ' 项' + provNote(addedMaps));
    renderAll();
  }

  /* ---------- basket & settings ---------- */
  function renderBasket() {
    $('basketCount').textContent = state.basket.length ? '(' + state.basket.length + ' 项 · 点标签设基准)' : '';
    if (!state.basket.length) {
      $('basket').innerHTML = '<span class="hint" style="margin:0">从左侧点「＋」加入 MAP，或在同轴组上点「整组加入」。</span>';
    } else {
      $('basket').innerHTML = state.basket.map(function (m) {
        return '<span class="chip' + (m.key === state.baseKey ? ' base' : '') + '" data-act="setbase" data-key="' +
          esc(m.key) + '" title="' + esc(m.name) + ' · ' + esc(m.srcFile) + ':' + m.startLine +
          (m.provisional ? ' · 三轴表，仅第一层参与对比' : '') + '"><span class="t">' +
          esc(m.label || m.name) + '</span>' + provTag3d(m) + '<b data-act="del" data-key="' + esc(m.key) +
          '" data-tip="从清单移除">×</b></span>';
      }).join('');
    }
    var sel = $('selBase');
    sel.innerHTML = state.basket.map(function (m) {
      return '<option value="' + esc(m.key) + '"' + (m.key === state.baseKey ? ' selected' : '') + '>' +
        esc(m.label || m.name) + '</option>';
    }).join('');
  }

  /* 对比摘要：只陈述差异事实，供评审参考。不产出「可放行/建议驳回」这类结论——
     那是评审人的职责，工具越权给建议会被当成签核意见。 */
  function renderConclusion() {
    var el = $('conclusion'), good = goodDiffs();
    if (!state.result || !good.length) { el.innerHTML = ''; return; }
    var s = C.summarizeDiff(good, {
      eps: state.effectiveEps, allowDelta: state.opts.allowDelta
    });
    var html = '<div class="concl-head"><span>对比摘要</span><span class="hint" style="margin:0">' +
      esc(s.patternLabel) + ' · 供评审参考，不构成放行/驳回建议</span></div>';
    html += '<ul class="concl-lines">' + s.lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>';
    html += '<div class="concl-tools"><label>允许偏差 <input type="number" step="any" data-opt="allowDelta" value="' +
      (state.opts.allowDelta === null ? '' : state.opts.allowDelta) +
      '" placeholder="留空=不设"></label><span class="hint" style="margin:0">填数值后自动列出超差工况区间（真实轴值）</span></div>';
    if (s.exceedRegions.length) {
      html += '<table class="concl-tbl"><thead><tr><th>对比项</th><th>X 区间</th><th>Y 区间</th><th>格数</th><th>max |Δ|</th></tr></thead><tbody>';
      s.exceedRegions.slice(0, 12).forEach(function (e) {
        html += '<tr><td>' + esc(shortLabel(e.label, 26)) + '</td><td>' + V.fmt(e.xFrom, 2) + ' ~ ' + V.fmt(e.xTo, 2) +
          ' ' + esc(e.units.x || '') + '</td><td>' + V.fmt(e.yFrom, 2) + ' ~ ' + V.fmt(e.yTo, 2) +
          ' ' + esc(e.units.y || '') + '</td><td>' + e.count + '</td><td>' + V.fmt(e.maxAbs) + '</td></tr>';
      });
      html += '</tbody></table>';
      if (s.exceedRegions.length > 12) {
        html += '<p class="hint">共 ' + s.exceedRegions.length + ' 处超差区间，界面列出前 12 处，报告含全部。</p>';
      }
    }
    html += '<div class="concl-pats">' + s.per.slice(0, 8).map(function (p) {
      return '<span class="mini" title="' + esc(p.label) + '">' + esc(shortLabel(p.label, 22)) +
        ' · ' + esc(p.patternLabel) + '</span>';
    }).join('') + '</div>';
    el.innerHTML = html;
  }

  function annOptions(cur) {
    return [['pending', '待确认'], ['approve', '通过'], ['reject', '驳回']].map(function (o) {
      return '<option value="' + o[0] + '"' + (cur === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');
  }

  function renderAnnotations() {
    var el = $('annotations'), good = goodDiffs();
    if (!state.result || !good.length) { el.innerHTML = ''; return; }
    var filled = 0;
    var rows = good.map(function (d) {
      var k = 'cmp:' + d.other.key, a = state.annotations[k] || {};
      if (a.reason || a.req || a.owner || (a.verdict && a.verdict !== 'pending')) filled++;
      return '<div class="ann-row"><span class="ann-name" title="' + esc(d.other.label || d.other.name) + '">' +
        esc(shortLabel(d.other.label || d.other.name, 26)) + '</span>' +
        '<select data-ann="' + esc(k) + '" data-field="verdict">' + annOptions(a.verdict || 'pending') + '</select>' +
        '<input data-ann="' + esc(k) + '" data-field="reason" placeholder="评审意见" value="' + esc(a.reason || '') + '">' +
        '<input data-ann="' + esc(k) + '" data-field="req" placeholder="需求号" value="' + esc(a.req || '') + '">' +
        '<input data-ann="' + esc(k) + '" data-field="owner" placeholder="责任人" value="' + esc(a.owner || '') + '">' +
        '</div>';
    }).join('');
    el.innerHTML = '<div class="ann-head"><span>评审批注</span><span class="hint" style="margin:0">' +
      filled + ' / ' + good.length + ' 项已填写 · 随会话与 HTML 报告一起导出</span></div>' + rows;
  }

  function annEdit(t) {
    if (!t || !t.dataset || !t.dataset.ann) return;
    var k = t.dataset.ann, f = t.dataset.field;
    if (!state.annotations[k]) state.annotations[k] = {};
    state.annotations[k][f] = t.value;
  }

  function renderStats() {
    var good = goodDiffs();
    if (!state.result || !good.length) { $('stats').innerHTML = ''; return; }
    var d = good[Math.min(state.opts.heatIndex, good.length - 1)] || good[0];
    var interp = good.filter(function (x) { return x.interpolated; }).length;
    var bad = state.result.all.diffs.length - good.length;
    var iso = 0, mono = 0, high = 0;
    (state.inspect || []).forEach(function (x) {
      if (!x || !x.ok) return;
      iso += x.isolated.length;
      mono += x.monotonic.length;
      if (x.risk === 'high') high++;
    });
    $('stats').innerHTML =
      stat('对比项', String(good.length)) +
      stat('当前对比变化格', d.stats.changed + ' / ' + d.stats.total) +
      stat('最大 |Δ|', V.fmt(d.stats.maxAbs), 'up') +
      stat('平均 |Δ|', V.fmt(d.stats.meanAbs)) +
      stat('变化占比', (d.stats.ratio * 100).toFixed(1) + '%') +
      stat('孤立突变点', String(iso), iso ? 'up' : '') +
      stat('趋势反转处', String(mono), mono ? 'up' : '') +
      stat('高风险对比', String(high), high ? 'up' : '') +
      stat('插值 / 拒绝', interp + ' / ' + bad, (interp || bad) ? 'up' : '');
  }

  function renderEpsHint() {
    var base = state.result && state.result.base;
    $('epsHint').textContent = state.autoThreshold ?
      ('自动 ' + C.fmt(state.effectiveEps, 3) + (base ? ' · ' + C.suggestEps(base).basis : '（载入后按基准表计算）')) :
      ('手动 ' + C.fmt(state.eps, 3));
    $('inpEps').disabled = state.autoThreshold;
    $('chkAutoEps').checked = state.autoThreshold;
    $('btnSaveSession').disabled = !state.datasets.length;
  }
  function stat(l, v, cls) {
    return '<div class="stat"><div class="l">' + esc(l) + '</div><div class="v ' + (cls || '') + '">' + esc(v) + '</div></div>';
  }

  /* ---------- stage ---------- */
  function empty(msg) { return '<p class="empty">' + esc(msg) + '</p>'; }

  function toolsHtml(inner) { return '<div class="stage-tools">' + inner + '</div>'; }
  function sel(id, opt, options, current) {
    return '<label>' + id + ' <select data-opt="' + opt + '">' + options.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(current) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select></label>';
  }

  /* 3D 面片不写长 title，hover 时按坐标现查数据。 */
  function surfaceHoverText(i, j) {
    var R = state.result;
    if (!R || !R.base || !isFinite(i) || !isFinite(j)) return '';
    var b = R.base;
    if (i < 0 || j < 0 || i >= b.nx || j >= b.ny) return '';
    var lines = [
      'X=' + C.fmt(b.x[i], 3) + ' ' + (b.units.x || '') +
        '   Y=' + C.fmt(b.y[j], 3) + ' ' + (b.units.y || ''),
      '基准  ' + C.fmt(b.v[j][i]) + ' ' + (b.units.w || '')
    ];
    var gd = goodDiffs();
    gd.slice(0, 6).forEach(function (d, k) {
      lines.push('L' + (k + 2) + ' ' + shortLabel(d.other.label || d.other.name, 16) +
        '  ' + C.fmt(d.b[j][i]) + '   Δ=' + C.fmt(d.abs[j][i]));
    });
    if (gd.length > 6) lines.push('…其余 ' + (gd.length - 6) + ' 张见报告');
    return lines.join('\n');
  }

  function axisWarnHtml() {
    if (!state.result) return '';
    var bad = state.result.all.diffs.filter(function (d) { return !d.ok && d.axisUnsafe; });
    if (!bad.length) return '';
    return '<div class="warnbox"><b>轴断点不健康，' + bad.length + ' 项对比已拒绝</b><br>' +
      bad.map(function (d) { return esc(d.other.label || d.other.name) + '：' + esc(d.reason); }).join('<br>') +
      '</div>';
  }

  function renderStage() {
    renderStageInner();
    var w = axisWarnHtml();
    if (w) $('stage').insertAdjacentHTML('afterbegin', w);
  }

  function renderStageInner() {
    var st = $('stage'), good = goodDiffs();
    if (state.view === 'help') { st.innerHTML = helpHtml(); return; }
    if (state.view === 'scan') { st.innerHTML = scanHtml(); return; }
    if (state.view === 'rename') { st.innerHTML = renameHtml(); return; }
    if (state.view === 'axis') { st.innerHTML = axisHtml(); return; }
    if (state.view === 'audit') { st.innerHTML = auditHtml(); return; }
    if (!state.result || !good.length) {
      st.innerHTML = empty(state.basket.length < 2 ? '对比清单需要至少 2 张 MAP（1 基准 + 1 对比）。' : '没有可执行的对比，请检查维度与拒绝原因。');
      return;
    }
    var base = state.result.base, o = state.opts;
    var pick = function (i) { return good[Math.max(0, Math.min(i, good.length - 1))]; };

    if (state.view === 'heat') {
      var opts = good.map(function (d, k) { return [k, (d.other.label || d.other.name) + (d.interpolated ? ' [已插值]' : '')]; });
      opts.push(['env', '最大偏差包络（全部对比）']);
      var cur = o.heatEnvelope ? 'env' : Math.min(o.heatIndex, good.length - 1);
      var head = toolsHtml(sel('显示', 'heatIndex', opts, cur) +
        '<span class="hint" style="margin:0">红=增大 · 蓝=减小 · 灰=未变 · 悬停看原值</span>');
      var svg;
      /* 阈值必须与统计同源：开自动阈值时 state.eps 仍是手填的小值，
         用它判断「是否变化」会让图多显示一批统计认为没变的格 */
      if (o.heatEnvelope && state.result.all.envelope) {
        svg = V.svgHeat(pick(0), { mode: state.mode, eps: state.effectiveEps, envelope: state.result.all.envelope,
          onlyChanged: o.onlyChanged, showValues: o.showValues, title: '最大偏差包络 · ' + good.length + ' 张对比' });
      } else {
        svg = V.svgHeat(pick(o.heatIndex), { mode: state.mode, eps: state.effectiveEps,
          onlyChanged: o.onlyChanged, showValues: o.showValues,
          title: '差异热力矩阵 · ' + (pick(o.heatIndex).other.label || pick(o.heatIndex).other.name) });
      }
      st.innerHTML = head + (pick(o.heatIndex).interpolated && !o.heatEnvelope ? warnInterp() : '') + svg;

    } else if (state.view === 'curve') {
      var maxIdx = (o.curve.axis === 'col' ? base.ny : base.nx) - 1;
      o.curve.index = Math.max(0, Math.min(o.curve.index, maxIdx));
      st.innerHTML = toolsHtml(
        sel('固定', 'curve.axis', [['row', '固定 Y（沿 X 扫）'], ['col', '固定 X（沿 Y 扫）']], o.curve.axis) +
        '<label>序号 <input type="number" data-opt="curve.index" data-type="number" min="0" max="' + maxIdx +
        '" value="' + o.curve.index + '" style="width:76px"></label>' +
        '<span class="hint" style="margin:0">黑线=基准，彩线=各对比，共 ' + (good.length + 1) + ' 条</span>') +
        V.svgCurves(base, good, o.curve);

    } else if (state.view === 'surface') {
      var sm = o.surfaceMode;
      var vo = { yaw: o.surface.yaw, pitch: o.surface.pitch, scale: o.surface.zoom };
      var t2 = sel('曲面', 'surfaceMode', [
        ['diff', '差曲面 Z=Δ (1+1)'], ['both', '基准 + 对比 (1+1)'],
        ['base', '基准曲面'], ['other', '对比曲面'],
        ['envelope', '最大偏差包络 (A · N 张)'],
        ['grid', '曲面小多图 (B · N 张)'],
        ['stack', 'N 张叠加 (C)']
      ], sm);
      if (['diff', 'both', 'base', 'other'].indexOf(sm) >= 0) {
        t2 += sel('对象', 'heatIndex', good.map(function (d, k) { return [k, d.other.label || d.other.name]; }), o.heatIndex);
      }
      if (sm === 'envelope') {
        t2 += sel('着色', 'envelopeColor', [['delta', '按 Δ 红蓝'], ['source', '按来源表']], o.envelopeColor);
      }
      if (sm === 'grid') {
        t2 += '<label>张数 <input type="number" data-opt="gridLimit" data-type="number" min="2" max="12" value="' +
          o.gridLimit + '" style="width:64px"></label>';
      }
      var layerChips = '';
      if (sm === 'stack') {
        t2 += sel('布局', 'stack.layout', [['spaced', '拉开距离'], ['overlay', '默认叠加']], o.stack.layout);
        if (o.stack.layout === 'spaced') {
          t2 += '<label>间距 <input type="number" data-opt="stack.gap" data-type="number" min="0.1" max="1.2" step="0.05" value="' +
            o.stack.gap + '" style="width:68px"></label>';
        } else {
          t2 += '<label>透明度 <input type="number" data-opt="stack.opacity" data-type="number" min="0.15" max="1" step="0.05" value="' +
            o.stack.opacity + '" style="width:68px"></label>';
        }
        t2 += '<label>张数 <input type="number" data-opt="stack.maxSurfaces" data-type="number" min="2" max="12" value="' +
          o.stack.maxSurfaces + '" style="width:64px"></label>';
        var vis = o.stack.visible || [];
        var names = ['基准'].concat(good.map(function (d) { return d.other.label || d.other.name; }));
        layerChips = toolsHtml('<span class="hint" style="margin:0">层显隐：</span>' +
          names.slice(0, o.stack.maxSurfaces).map(function (nm, k) {
            return '<label title="' + esc(nm) + '"><input type="checkbox" data-cmd="toggleLayer" data-k="' + k +
              '"' + (vis[k] !== false ? ' checked' : '') + '> L' + (k + 1) + ' ' + esc(shortLabel(nm, 12)) + '</label>';
          }).join(''));
      }
      var probe = o.surfaceProbe;
      t2 += sel('定位轴', 'surfaceProbe.axis', [['none', '不定位'], ['x', 'X = 某值'], ['y', 'Y = 某值']], probe.axis);
      if (probe.axis !== 'none') {
        var axisVals = probe.axis === 'x' ? base.x : base.y;
        var probeUnit = probe.axis === 'x' ? (base.units.x || '') : (base.units.y || '');
        t2 += sel('定位值', 'surfaceProbe.index', axisVals.map(function (v, k) {
          return [k, V.fmt(v, 3) + (probeUnit ? ' ' + probeUnit : '')];
        }), Math.min(probe.index, axisVals.length - 1));
      }
      t2 += '<button class="mini" data-cmd="surfaceReset" data-tip="回到默认视角">复位视角</button>' +
        '<span class="hint" style="margin:0">三轴标注真实数值刻度 · 拖动旋转 · 滚轮缩放</span>';
      var pIdx = 0;
      if (probe.axis !== 'none') {
        pIdx = Math.max(0, Math.min(probe.index, (probe.axis === 'x' ? base.nx : base.ny) - 1));
      }
      var hl = probe.axis === 'none' ? null : {
        axis: probe.axis, i: probe.axis === 'x' ? pIdx : 0, j: probe.axis === 'y' ? pIdx : 0
      };
      var vo2 = Object.assign({}, vo, {
        highlight: hl, live: true
      });
      var surfSvg;
      if (sm === 'envelope') {
        surfSvg = V.svgEnvelopeSurface(good, Object.assign({}, vo2, { colorBy: o.envelopeColor }));
      } else if (sm === 'grid') {
        surfSvg = V.svgSurfaceGrid(good, Object.assign({}, vo2, { limit: o.gridLimit }));
      } else if (sm === 'stack') {
        surfSvg = V.svgSurfaceStack(good, Object.assign({}, vo2, {
          layout: o.stack.layout, gap: o.stack.gap, opacity: o.stack.opacity,
          maxSurfaces: o.stack.maxSurfaces, visible: o.stack.visible
        }));
      } else {
        surfSvg = V.svgSurface(pick(o.heatIndex), Object.assign({}, vo2, { surfaceMode: sm }));
      }
      var hint = sm === 'envelope' ? '每个工况点取全部对比里偏差最大的一张：Z 为有符号 Δ，可切「按来源表」看是哪张表造成的峰值。' :
        sm === 'grid' ? '每张 MAP 一张小曲面，统一 Z 值域与色标，形状差异一眼可扫。' :
        sm === 'stack' ? (o.stack.layout === 'spaced' ?
          'N 张完整曲面沿第三维拉开间距，避免互相遮挡；可调间距、张数并逐层开关。' :
          'N 张曲面共用一个 Z 基准半透明叠合，层多时会互相遮挡，建议改用「拉开距离」。') :
        '单对模式：一张基准 + 一张对比；Z 轴按值域归一化，差曲面红=正差、蓝=负差。';
      if (hl) {
        var hv = (hl.axis === 'x' ? base.x : base.y)[pIdx];
        hint += ' 已定位 ' + (hl.axis === 'x' ? 'X' : 'Y') + ' = ' + V.fmt(hv, 3) + ' ' +
          (hl.axis === 'x' ? (base.units.x || '') : (base.units.y || '')) +
          '，橙色描边标出该轴值对应的曲面带，悬停面片可看具体数值。';
      }
      st.innerHTML = toolsHtml(t2) + layerChips +
        '<p class="surface-hint">' + hint + ' 全部为内联 SVG 矢量。</p>' + surfSvg;

    } else if (state.view === 'profile') {
      var cube = state.result.cube;
      if (!cube || cube.labels.length < 2) {
        st.innerHTML = '<p class="empty">对比清单至少 2 项，才能看跨版本剖面。</p>';
      } else {
        var pr = o.profile;
        var pi = Math.max(0, Math.min(pr.i, cube.nx - 1));
        var pj = Math.max(0, Math.min(pr.j, cube.ny - 1));
        var ux = base.units.x ? ' ' + base.units.x : '', uy = base.units.y ? ' ' + base.units.y : '';
        var xOpts = cube.x.map(function (v, k) { return [k, V.fmt(v, 3) + ux]; });
        var yOpts = cube.y.map(function (v, k) { return [k, V.fmt(v, 3) + uy]; });
        st.innerHTML = toolsHtml(
          sel('X 轴值', 'profile.i', xOpts, pi) +
          sel('Y 轴值', 'profile.j', yOpts, pj) +
          '<button class="mini" data-cmd="profileMax" data-tip="跳到所有层里差异最大的那一格">变化最大的格</button>' +
          '<span class="hint" style="margin:0">也可在「差异热力矩阵」直接点格子跳过来</span>') +
          V.svgProfile(cube, pi, pj, { units: base.units });
      }

    } else if (state.view === 'table') {
      st.innerHTML = toolsHtml(
        sel('对象', 'tableIndex', good.map(function (d, k) { return [k, d.other.label || d.other.name]; }), o.tableIndex) +
        '<label><input type="checkbox" data-opt="onlyChanged" ' + (o.onlyChanged ? 'checked' : '') + '> 只列变化格</label>' +
        '<button class="mini" data-cmd="csvExport" data-tip="导出当前明细为 CSV">导出 CSV</button>' +
        '<span class="hint" style="margin:0">每行含 Y/X 轴值、两边原值、Δ、相对差、来源文件与 DCM 行号；CSV 带 BOM，Excel 直接打开</span>') +
        V.tableHtml(pick(o.tableIndex), { onlyChanged: o.onlyChanged, limit: 3000 });
    }
  }

  function warnInterp() {
    return '<div class="warnbox">该对比的轴刻度与基准不一致，数值已双线性插值到基准轴。<b>不是原始逐格值</b>，明细与报告中均会标注。</div>';
  }

  function axisHtml() {
    var r = state.axisScan;
    var head = '<div class="panel-body" style="padding:0 0 10px">' +
      '<p class="hint" style="margin:0 0 10px">改一根轴断点会波及所有引用它的表。DCM 里 <code>*SSTX/*SSTY</code> 引用名几乎一对一，只按名字反查只能查到 1 张表；这里按<b>完整轴指纹（维度 + X + Y 数值）</b>分桶，再用两版引用表名称的重合度配对，才能算出真实影响面。只分析<b>已发生的变更</b>，不做假设预演。</p>' +
      toolsHtml('<button class="btn primary" data-cmd="doAxis" data-tip="扫轴断点变化" data-tip-off="需 2 份以上 DCM"' +
        (state.datasets.length < 2 ? ' disabled' : '') + '>扫描轴变更</button>' +
        '<span class="hint" style="margin:0">仅对相邻两版比较；找不到同一批表时判为对象增删，不误报为轴变更</span>') + '</div>';
    if (!r) {
      return head + empty(state.datasets.length < 2 ?
        '需要载入至少 2 份 DCM，再点「扫描轴变更」。' :
        '尚未扫描。点「扫描轴变更」开始。');
    }
    if (!r.ok) return head + '<div class="warnbox">' + esc(r.reason) + '</div>';
    var body = '';
    r.pairs.forEach(function (p, pi) {
      body += '<h3 style="font-size:12px;color:#0C447C;margin:14px 0 6px">' + esc(p.fileA) + ' → ' + esc(p.fileB) +
        ' · 轴指纹组 ' + p.groupsA + ' → ' + p.groupsB + ' · 轴定义 ' + p.defCountA + ' → ' + p.defCountB +
        ' · 变化轴 ' + p.changedAxes.length + ' 根</h3>';
      if (!p.changedAxes.length) {
        body += '<div class="okbox">未发现轴断点变化。两版轴数值完全一致。</div>';
        return;
      }
      p.changedAxes.forEach(function (a, ai) {
        var tone = a.risk === 'high' ? '#A32D2D' : '#BA7517';
        body += '<div class="grp open" style="margin-bottom:8px"><div class="grp-head">' +
          '<span class="gname"><b>' + a.axis + ' 轴 · ' + esc(a.dims) + '</b> · ' + esc(a.changeType) +
          ' · 影响 <b style="color:' + tone + '">' + a.affected.length + ' 张表</b> · 风险 <span style="color:' + tone + '">' +
          (a.risk === 'high' ? '高' : '中') + '</span></span>' +
          '<button class="mini" data-act="axisadd" data-pi="' + pi + '" data-ai="' + ai + '" data-tip="加入受影响表">加入对比清单</button></div>' +
          '<div class="grp-items" style="max-height:none">' +
          '<p class="hint" style="margin:0 0 6px">' + esc(a.detail) + ' · 两版引用表重合度 ' +
          (a.refSimilarity * 100).toFixed(0) + '%' +
          (a.defNames.length ? ' · 关联轴定义 ' + esc(a.defNames.slice(0, 3).join(', ')) : '') + '</p>' +
          '<p class="hint" style="margin:0 0 6px">A: ' + esc(a.valuesA.slice(0, 6).map(function (v) { return V.fmt(v, 2); }).join(', ')) +
          (a.valuesA.length > 6 ? ' …' : '') + '<br>B: ' +
          esc(a.valuesB.slice(0, 6).map(function (v) { return V.fmt(v, 2); }).join(', ')) +
          (a.valuesB.length > 6 ? ' …' : '') + '</p>' +
          '<details><summary>受影响表清单（' + a.affected.length + ' 张，含来源行号）</summary>' +
          a.affected.slice(0, 80).map(function (m) {
            return '<div class="item"><span class="nm">' + esc(m.name) + '</span><span class="src">' +
              esc(m.srcFile) + ':' + m.startLine + '</span></div>';
          }).join('') + '</details></div></div>';
      });
    });
    return head + body;
  }

  function runAxisScan() {
    if (state.datasets.length < 2) { status('轴变更影响面需要至少 2 份 DCM', true); return; }
    status('正在扫描轴变更影响面…');
    setTimeout(function () {
      var r = C.analyzeAxisChange(state.datasets, {});
      state.axisScan = r;
      state.view = 'axis'; syncTabs(); renderStage();
      status(r.ok ? ('轴变更扫描完成：' + r.total + ' 根轴发生变化') : r.reason, !r.ok);
    }, 0);
  }

  function renameHtml() {
    var r = state.renameScan, q = state.opts.renameOpts;
    var head = '<div class="panel-body" style="padding:0 0 10px">' +
      '<p class="hint" style="margin:0 0 10px">版本升级把表改名时，同名配对会漏报。这里只在相邻两版之间找「改名但内容基本一致」的表：先精确同名配对，再对仅出现在一版的对象按 维度 + 轴指纹 分桶，用名称相似度与数值相似度打分，并做双向唯一约束。<b>只给候选，不自动合并</b>——同轴且数值完全相同的几十张模式表不会被乱配成对。</p>' +
      toolsHtml('<button class="btn primary" data-cmd="doRename" data-tip="扫改名候选" data-tip-off="需 2 份以上 DCM"' +
        (state.datasets.length < 2 ? ' disabled' : '') + '>扫描改名候选</button>' +
        '<label>最低总分 <input type="number" data-opt="renameOpts.minScore" data-type="number" min="0.4" max="1" step="0.02" value="' +
        q.minScore + '" style="width:72px"></label>' +
        '<label>最低相同格率 <input type="number" data-opt="renameOpts.minValueSim" data-type="number" min="0" max="1" step="0.05" value="' +
        q.minValueSim + '" style="width:72px"></label>' +
        '<label>最低名称相似度 <input type="number" data-opt="renameOpts.minNameSim" data-type="number" min="0" max="1" step="0.05" value="' +
        q.minNameSim + '" style="width:72px"></label>') + '</div>';
    if (!r) {
      return head + empty(state.datasets.length < 2 ?
        '需要载入至少 2 份 DCM，再点「扫描改名候选」。' :
        '尚未扫描。点「扫描改名候选」开始。');
    }
    if (!r.ok) return head + '<div class="warnbox">' + esc(r.reason) + '</div>';
    var body = '';
    r.pairs.forEach(function (p, pi) {
      body += '<h3 style="font-size:12px;color:#0C447C;margin:14px 0 6px">' + esc(p.fileA) + ' → ' + esc(p.fileB) +
        ' · 精确同名 ' + p.exact + ' 组 / 仅 A ' + p.onlyA + ' 项 / 仅 B ' + p.onlyB + ' 项 / 候选 ' +
        p.candidates.length + ' 组</h3>';
      if (!p.candidates.length) {
        body += '<p class="hint">该版本对未发现改名候选。若确有改名，可下调阈值后重扫。</p>';
        return;
      }
      body += '<div class="tbl-wrap"><table class="detail"><thead><tr><th>A 名称</th><th>B 名称</th><th>维度</th>' +
        '<th>相同格率</th><th>名称相似</th><th>总分</th><th>置信度</th><th>判定依据</th><th>操作</th></tr></thead><tbody>';
      p.candidates.forEach(function (c, ci) {
        var conf = { high: '高', medium: '中', low: '低' }[c.confidence] || c.confidence;
        var color = c.confidence === 'high' ? '#0F6E56' : (c.confidence === 'medium' ? '#BA7517' : '#888780');
        body += '<tr><td>' + esc(c.a.name) + '</td><td>' + esc(c.b.name) + '</td><td>' + c.a.nx + '×' + c.a.ny +
          '</td><td>' + (c.valueSim * 100).toFixed(1) + '%</td><td>' + c.nameSim.toFixed(3) +
          '</td><td>' + c.score.toFixed(3) + '</td><td style="color:' + color + '">' + conf +
          '</td><td><details><summary>展开</summary>' + c.reasons.map(esc).join('<br>') +
          '</details></td><td><button class="mini" data-act="renameadd" data-pi="' + pi + '" data-ci="' + ci +
          '" data-tip="加入对比清单">加入对比清单</button></td></tr>';
      });
      body += '</tbody></table></div>';
    });
    if (!r.total) {
      body += '<div class="okbox">扫描完成：未发现改名候选。两版对象要么精确同名，要么名称/数值差异过大；同名配对不受影响。</div>';
    }
    return head + body;
  }

  function runRename() {
    if (state.datasets.length < 2) { status('改名对齐需要至少 2 份 DCM', true); return; }
    status('正在扫描改名候选…');
    setTimeout(function () {
      var r = C.matchRenamed(state.datasets, state.opts.renameOpts);
      state.renameScan = r;
      state.view = 'rename'; syncTabs(); renderStage();
      status(r.ok ? ('改名对齐扫描完成：' + r.total + ' 组候选（仅给候选，不自动合并）') : r.reason, !r.ok);
    }, 0);
  }

  /* ---------- 全量标定量审查：完整账本 + 类型分派结论 ---------- */
  function auditSig() {
    // 配置一变，旧账本就是过期清单；不能拿它当证据
    return [state.datasets.length, state.eps, state.autoThreshold, state.mode,
      state.opts.allowDelta].join('::');
  }

  function buildAuditNow() {
    state.audit = C.buildFullAudit(state.datasets, {
      eps: state.eps, autoEps: state.autoThreshold, mode: state.mode,
      allowDelta: state.opts.allowDelta
    });
    state.auditSig = auditSig();
    return state.audit;
  }

  function runAudit() {
    if (state.datasets.length < 2) { status('全量变化清单需要至少 2 份 DCM', true); return; }
    state.auditRunning = true;
    status('正在生成全量变化清单（对账全部对象，只输出变化项）…');
    renderStage();
    setTimeout(function () {
      try {
        var t0 = Date.now();
        buildAuditNow();
        var cc = state.audit.totals.counts;
        var changeCount = cc.changed + cc.added + cc.deleted + cc.rejected;
        state.opts.audit.page = 0;
        state.opts.audit.detailId = '';
        state.auditRunning = false;
        state.view = 'audit'; syncTabs(); renderStage();
        status('全量变化清单已生成：' + changeCount + ' 项变化 / ' +
          state.audit.totals.total + ' 条账目 · ' + (Date.now() - t0) +
          ' ms · 完整性校验' + (state.audit.identity.ok ? '通过' : '未通过'),
          !state.audit.identity.ok);
      } catch (err) {
        state.auditRunning = false; renderStage();
        status('全量变化清单生成失败：' + err.message, true);
      }
    }, 20);
  }

  function auditFiltered() {
    var a = state.audit, o = state.opts.audit;
    if (!a) return [];
    var s = String(o.search || '').toLowerCase();
    return a.entries.filter(function (e) {
      if (o.type !== 'all' && e.type !== o.type) return false;
      if (o.status === 'changes') { if (e.status === 'unchanged') return false; }
      else if (o.status !== 'all' && e.status !== o.status) return false;
      if (o.onlyRisk && !C.isRiskItem(e)) return false;
      if (s && (e.name + ' ' + e.funktion + ' ' + e.units + ' ' + (e.b ? e.b.name : ''))
        .toLowerCase().indexOf(s) < 0) return false;
      return true;
    });
  }

  function auditStatusBadge(st) {
    var tone = { changed: 'up', rejected: 'warn', added: 'up',
      deleted: 'warn', unchanged: '' }[st] || '';
    return '<span class="badge ' + tone + '">' + esc(C.STATUS_LABEL[st] || st) + '</span>';
  }

  function auditChangeCell(e) {
    if (!e.stats) return '<span class="hint">—</span>';
    if (e.type === 'scalar') {
      return esc(V.fmt(e.stats.valueA)) + ' → ' + esc(V.fmt(e.stats.valueB)) +
        ' <span class="hint">(' + (e.stats.relPct === null ? '基准为 0' : V.fmt(e.stats.relPct, 2) + '%') + ')</span>';
    }
    if (e.type === 'axis') {
      return e.axisSeries ? esc(e.axisSeries.kind) + ' ' +
        esc(String(e.axisSeries.a.length)) + ' → ' + esc(String(e.axisSeries.b.length)) + ' 断点' :
        e.stats.changed + ' / ' + e.stats.total + ' 个断点';
    }
    return e.stats.changed + ' / ' + e.stats.total + ' 格' +
      (e.stats.interpolated ? ' <span class="hint">[已插值]</span>' : '');
  }

  /* 审查账目里的每一项（含新增 / 删除 / 被拒绝）都能写评审，key 用稳定账目 id */
  function auditAnnRow(e) {
    var k = e.id, a = state.annotations[k] || {};
    return '<div class="ann-row"><span class="ann-name" title="' + esc(e.name) + '">' +
      esc(shortLabel(e.name, 26)) + ' <span class="hint" style="margin:0">' +
      esc(C.STATUS_LABEL[e.status] || e.status) + '</span></span>' +
      '<select data-ann="' + esc(k) + '" data-field="verdict">' + annOptions(a.verdict || 'pending') + '</select>' +
      '<input data-ann="' + esc(k) + '" data-field="reason" placeholder="评审意见" value="' + esc(a.reason || '') + '">' +
      '<input data-ann="' + esc(k) + '" data-field="req" placeholder="需求号" value="' + esc(a.req || '') + '">' +
      '<input data-ann="' + esc(k) + '" data-field="owner" placeholder="责任人" value="' + esc(a.owner || '') + '">' +
      '</div>';
  }

  function auditDetailHtml(e) {
    if (!e) return '';
    var s = ['<div class="audit-detail"><h3>证据 · ' + esc(e.name) + ' <span class="hint">' +
      esc(e.typeLabel) + ' · ' + esc(e.dims) + ' · 单位 ' + esc(e.units || '（空）') + '</span></h3>'];
    s.push('<p class="hint">A：' + esc(e.srcA || '—') + ':' + (e.lineA || '—') +
      '　B：' + esc(e.srcB || '—') + ':' + (e.lineB || '—') + '</p>');
    if (e.inspect && e.inspect.note) s.push('<p class="hint">判定口径：' + esc(e.inspect.note) + '</p>');
    if (e.reason) s.push('<div class="warnbox">' + esc(e.reason) + '</div>');
    if (e.axisSeries) {
      s.push('<p class="hint">两版轴断点序列对照（' + esc(e.axisSeries.kind) + '）：</p>');
      var aUnit = e.units ? ' <span class="unit">(' + esc(e.units) + ')</span>' : '';
      s.push('<div class="tbl-wrap"><div class="dcm-tbl-cap"><b>断点序列</b> · A ' +
        e.axisSeries.a.length + ' 个 → B ' + e.axisSeries.b.length + ' 个</div>' +
        '<table class="detail dcm-tbl"><thead><tr><th class="num">断点序号</th>' +
        '<th class="num">A 版断点值' + aUnit + '</th><th class="num">B 版断点值' + aUnit +
        '</th><th class="num">Δ</th></tr></thead><tbody>');
      var n = Math.max(e.axisSeries.a.length, e.axisSeries.b.length);
      for (var k = 0; k < n; k++) {
        var hasA = k < e.axisSeries.a.length, hasB = k < e.axisSeries.b.length;
        var vaS = hasA ? V.fmt(e.axisSeries.a[k]) : '—';
        var vbS = hasB ? V.fmt(e.axisSeries.b[k]) : '—';
        var dlt = (hasA && hasB) ? (e.axisSeries.b[k] - e.axisSeries.a[k]) : null;
        var isDif = !(hasA && hasB) || Math.abs(dlt) > 1e-9;
        var tone = dlt !== null && isDif ? (dlt > 0 ? 'up' : 'down') : '';
        s.push('<tr class="' + (isDif ? 'chg' : 'eq') + '"><td class="num">' + k +
          '</td><td class="num">' + esc(vaS) + '</td><td class="num">' + esc(vbS) +
          '</td><td class="' + (tone ? 'num ' + tone : 'num') + '">' +
          (dlt === null ? '—' : esc(V.fmt(dlt))) + '</td></tr>');
      }
      s.push('</tbody></table></div>');
    }
    if (e.diff) {
      if (e.type === 'array' || e.type === 'curve' || e.type === 'axis') {
        s.push(V.svgDeltaProfile(e.diff, { title: e.name + ' · 断点/序列 Δ 剖面' }));
      } else if (e.type === 'map2d') {
        s.push(V.svgHeat(e.diff, { mode: state.mode, eps: e.eps || state.eps,
          title: e.name + ' · 差异热力矩阵' }));
      }
      s.push(V.tableHtmlTyped(e.diff, { onlyChanged: false, limit: 500 }));
    } else if (e.status === 'added' || e.status === 'deleted') {
      s.push('<p class="hint">' + esc(e.reason || '该对象只在一版中存在') +
        '。未做改名配对，请在新增/删除清单里人工对照。</p>');
    } else if (e.status === 'unchanged') {
      s.push('<div class="okbox">两版逐点完全一致，未变化项同样已核对。</div>');
    }
    s.push('<div class="ann-head"><span>评审批注</span><span class="hint" style="margin:0">' +
      '随会话与 HTML 报告一起导出；归档后批注只读</span></div>');
    s.push(auditAnnRow(e));
    s.push('</div>');
    return s.join('');
  }

  function auditHtml() {
    var a = state.audit, o = state.opts.audit;
    var can = state.datasets.length >= 2;
    var head = '<p class="hint">对两份及以上 DCM 的<b>全部标定量</b>（标量 / 数组 / 曲线 / MAP / <b>轴定义</b>）逐项同名配对，' +
      '给出<b>变化清单</b>：数值有变化、B 版新增、B 版删除、对比被拒绝。轴定义按断点序列逐点比较，断点增删按整项变化计入；' +
      '未变化项只做计数与完整性核对，不逐项列出；' +
      '<b>不做改名配对</b>，改名对象分别落在新增与删除里由人对照。本页只陈述变化，不做放行判断。</p>';
    if (!a) {
      return head + '<div class="panel-body" style="padding:18px">' +
        '<p class="hint" style="margin:0 0 12px">' + (can ?
          (state.auditRunning ? '正在构建账本…' :
            '尚未生成清单。会覆盖每一个对象做完整性对账，但只列出有变化、新增、删除与被拒绝的项。') :
          '单份 DCM 无法做跨版本标定量对比，请再载入一份 DCM。') + '</p>' +
        '<button class="btn primary" data-cmd="doAudit" data-tip="生成变化清单" data-tip-off="需 2 份以上 DCM"' +
        (can && !state.auditRunning ? '' : ' disabled') + '>' +
        (state.auditRunning ? '生成中…' : '开始生成全量变化清单') + '</button></div>';
    }
    var c = a.totals.counts, t = a.totals;
    var s = [head];
    if (!a.identity.ok) {
      s.push('<div class="warnbox"><b>完整性校验未通过</b><br>' + esc(a.identity.detail) +
        '<br>账本有缺口，本清单不覆盖全部对象。</div>');
    }
    s.push('<div class="stats" style="margin-top:0">' +
      stat('账目总数', t.total) + stat('有变化', c.changed, c.changed ? 'up' : '') +
      stat('B 版新增', c.added, c.added ? 'up' : '') +
      stat('B 版删除', c.deleted, c.deleted ? 'up' : '') +
      stat('被拒绝', c.rejected, c.rejected ? 'up' : '') +
      stat('未变化（仅计数）', c.unchanged) +
      stat('变化数据点', t.changedCells) +
      stat('完整性校验', a.identity.ok ? '通过' : '未通过', a.identity.ok ? '' : 'up') + '</div>');

    s.push('<div class="conclusion" style="margin-top:10px"><h3 style="margin:0 0 8px">全量变化摘要</h3>' +
      '<ul style="margin:0;padding-left:20px">' +
      a.summary.lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' +
      '<div class="row" style="margin-top:10px">' +
      '<button class="btn primary" data-cmd="doAuditReport" data-tip="导出变化清单报告">导出全量变化报告</button>' +
      '<button class="btn ghost" data-cmd="doAudit" data-tip="按当前阈值重算">重新生成</button></div></div>');

    // 按类型对账
    s.push('<div class="tbl-wrap" style="margin-top:12px"><table class="detail"><thead><tr>' +
      '<th>对象类型</th><th>账目数</th><th>有变化</th><th>新增</th><th>删除</th><th>被拒绝</th><th>max |Δ|</th>' +
      '</tr></thead><tbody>');
    Object.keys(t.byType).forEach(function (k) {
      var g = t.byType[k];
      s.push('<tr><td>' + esc(g.label) + '</td><td>' + g.total + '</td><td>' + g.changed +
        '</td><td>' + g.added + '</td><td>' + g.deleted + '</td><td>' + g.rejected +
        '</td><td>' + V.fmt(g.maxAbs) + '</td></tr>');
    });
    s.push('</tbody></table></div>');
    s.push('<p class="hint">轴定义已作为正式标定量计入上表与完整性恒等式；' +
      '报告「轴定义断点变化类型」一节集中给出分章统计、刻度平移 / 断点增删 / 顺序改变等变化类型分类、' +
      '完整证据与评审批注。</p>');
    if (a.warnings.length) {
      s.push('<div class="hint" style="margin-top:8px"><b>边界说明</b><br>' +
        a.warnings.map(esc).join('<br>') + '</div>');
    }

    // 筛选
    var typeOpts = [['all', '全部类型']].concat(Object.keys(t.byType).map(function (k) {
      return [k, t.byType[k].label + ' (' + t.byType[k].total + ')'];
    }));
    var changeTotal = c.changed + c.added + c.deleted + c.rejected;
    var statusOpts = [['changes', '全部变化 (' + changeTotal + ')'],
      ['all', '全部账目（含未变化 ' + c.unchanged + '）']]
      .concat(Object.keys(C.STATUS_LABEL).map(function (k) {
        return [k, C.STATUS_LABEL[k] + ' (' + (c[k] || 0) + ')'];
      }));
    var rows = auditFiltered();
    var pageSize = Math.max(1, Number(o.pageSize) || 40);
    var pages = Math.max(1, Math.ceil(rows.length / pageSize));
    o.page = Math.max(0, Math.min(o.page, pages - 1));
    s.push(toolsHtml(sel('类型', 'audit.type', typeOpts, o.type) +
      sel('状态', 'audit.status', statusOpts, o.status) +
      '<label>检索 <input type="text" data-opt="audit.search" value="' + esc(o.search) +
      '" placeholder="名称 / 功能 / 单位，回车生效" style="width:170px"></label>' +
      '<label><input type="checkbox" data-opt="audit.onlyRisk"' + (o.onlyRisk ? ' checked' : '') + '> 仅风险项</label>' +
      '<label>每页 <input type="number" data-opt="audit.pageSize" data-type="number" min="10" max="200" step="10" value="' +
      pageSize + '" style="width:62px"></label>' +
      '<span class="hint" style="margin:0">筛选命中 ' + rows.length +
      ' 条 · 默认只列变化；改名未配对，改名对象见「B 版新增 / B 版删除」</span>'));

    var from = o.page * pageSize, pageRows = rows.slice(from, from + pageSize);
    s.push('<div class="tbl-wrap"><table class="detail"><thead><tr><th>状态</th><th>类型</th><th>名称</th>' +
      '<th>维度</th><th>单位</th><th>变化 / 值</th><th>max |Δ|</th><th>改动模式 / 说明</th>' +
      '<th>来源行号</th><th>操作</th></tr></thead><tbody>');
    pageRows.forEach(function (e) {
      s.push('<tr' + (o.detailId === e.id ? ' class="sel"' : '') + '><td>' + auditStatusBadge(e.status) +
        '</td><td>' + esc(e.typeLabel.replace(/ .*/, '')) + '</td><td title="' + esc(e.name) +
        '">' + esc(e.name) + (e.b && e.b.name !== e.name ? '<br><span class="hint">→ ' + esc(e.b.name) + '</span>' : '') +
        '</td><td>' + esc(e.dims) + '</td><td>' + esc(e.units || '—') + '</td><td>' +
        auditChangeCell(e) + '</td><td>' + (e.stats ? V.fmt(e.stats.maxAbs) : '—') +
        '</td><td>' + esc(e.patternLabel || (e.status === 'unchanged' ? '未变化' :
          (e.status === 'added' ? 'B 版新增' : (e.status === 'deleted' ? 'B 版删除' : '—')))) +
        (e.reason ? '<br><span class="hint">' + esc(e.reason) + '</span>' : '') +
        '</td><td class="hint">' + esc((e.srcA || '—') + ':' + (e.lineA || '—')) + '<br>' +
        esc((e.srcB || '—') + ':' + (e.lineB || '—')) + '</td><td>' +
        '<button class="mini" data-act="auditdetail" data-id="' + esc(e.id) + '" data-tip="看证据">证据</button> ' +
        (e.keyA && e.keyB ? '<button class="mini" data-act="auditadd" data-id="' + esc(e.id) + '" data-tip="加入对比清单">加入对比清单</button>' : '') +
        '</td></tr>');
    });
    s.push('</tbody></table></div>');
    s.push('<div class="row" style="align-items:center;gap:10px;margin:10px 0">' +
      '<button class="mini" data-cmd="auditFirst" data-tip="回第一页" data-tip-off="已在第一页"' + (o.page === 0 ? ' disabled' : '') + '>首页</button>' +
      '<button class="mini" data-cmd="auditPrev" data-tip="上一页" data-tip-off="已在第一页"' + (o.page === 0 ? ' disabled' : '') + '>上一页</button>' +
      '<span class="hint" style="margin:0">第 ' + (o.page + 1) + ' / ' + pages + ' 页 · 共 ' + rows.length + ' 条</span>' +
      '<button class="mini" data-cmd="auditNext" data-tip="下一页" data-tip-off="已在最后一页"' + (o.page >= pages - 1 ? ' disabled' : '') + '>下一页</button></div>');
    var detail = rows.filter(function (e) { return e.id === o.detailId; })[0];
    if (detail) s.push(auditDetailHtml(detail));
    return s.join('');
  }

  function scanHtml() {
    var rows = state.versionScan || [];
    var head = '<p class="hint">对两份 DCM 的全部同名对象逐格比对，只列有变化者。点「加入对比清单」可立刻查看该 MAP 的差异详情。</p>';
    if (!rows.length) {
      var canScan = state.datasets.length >= 2;
      return head + '<div class="panel-body" style="padding:18px">' +
        '<p class="hint" style="margin:0 0 12px">' + (canScan ?
          '尚未扫描，或两份数据完全相同（0 项变化）。扫描会把两份 DCM 里全部同名对象逐格比对，只列有变化者。' :
          '需要载入至少 2 份 DCM 才能做跨版本全量对比。') + '</p>' +
        '<button class="btn primary" data-cmd="doScan" data-tip="扫全量同名差异" data-tip-off="需 2 份以上 DCM"' + (canScan ? '' : ' disabled') + '>' +
        (canScan ? '开始全量版本对比' : '请先载入第 2 份 DCM') + '</button></div>';
    }
    return head + '<div class="scan-list">' + rows.slice(0, 500).map(function (v, k) {
      return '<div class="scan-row"><span style="color:#888780;width:32px">' + (k + 1) + '</span>' +
        '<span class="nm" title="' + esc(v.name) + '">' + esc(v.name) + '</span>' +
        '<span class="hint" style="margin:0">' + esc(v.funktion) + ' · ' + v.nx + '×' + v.ny + '</span>' +
        '<span class="num">' + v.changed + ' 格 · max ' + V.fmt(v.maxAbs) + '</span>' +
        '<button class="mini" data-act="scanadd" data-gi="' + k + '" data-tip="加入对比清单">加入对比清单</button></div>';
    }).join('') + '</div>' +
      (rows.length > 500 ? '<p class="hint">共 ' + rows.length + ' 项，界面列出前 500 项，报告会包含全部。</p>' : '');
  }

  function helpHtml() {
    return '<div class="help">' +
      '<p class="hint">完整操作手册见顶部「查看使用手册」按钮：含 10 章、界面地图、差异规则、3D 曲面 7 种模式、两种报告、评审批注与归档、分享 FAQ，可打印 / 存 PDF。本页是简要说明。</p>' +
      '<h3>这个工具做什么</h3><p>把若干张标定 MAP 放进对比清单，指定一张为基准，逐格算差异。既能比同一份 DCM 里同轴的一批驾驶模式表，也能比不同 DCM 版本里的同名对象。全部在本地浏览器里完成，不联网、不上传。</p>' +
      '<h3>三种「三维」都支持</h3><ul>' +
      '<li><b>3D 曲面</b>：X/Y/Z 立体显示，可拖动旋转、滚轮缩放。单对模式（差曲面 / 基准 / 对比 / 双曲面）看 1 基准 + 1 对比；<b>A 最大偏差包络</b>把 N 张对比合成一张曲面，Z 为每格 max|Δ| 的有符号值，可切「按来源表」看峰值由哪张表造成；<b>B 曲面小多图</b>给每张表一张小曲面、统一 Z 值域与色标；<b>C N 张叠加</b>可选「默认叠加」（同 Z 基准半透明）或「拉开距离」（沿第三维分层，间距可调、逐层可开关）。三轴均标注真实轴断点值与 Z 值域刻度，底板带刻度网格；用「定位轴 / 定位值」可把某个 X 或 Y 值对应的曲面带用橙色描边标出。</li>' +
      '<li><b>跨版本剖面</b>：选一个工况格（或在热力矩阵上直接点格子），画出它在对比清单各层上的取值曲线，带基准参考线；看得出「这个点逐版被抬高/压低了多少」。</li>' +
      '<li><b>三轴查找表</b>：解析器按可扩展块模型写，遇到未识别块不会静默丢弃，会列进自检告警并标注「格式未经实测」。是否含三轴表以「数据源与解析自检」章节的实际扫描结果为准，不写死在说明里。三轴表当前仅解析第一层，明确排除出对比，不伪装成完整三维结果。</li></ul>' +
      '<h3>差异规则（重要）</h3><ul>' +
      '<li>轴数值完全一致 → 逐格相减，这是默认且最可信的结果。</li>' +
      '<li>维度相同但轴刻度不同 → 双线性插值对齐到基准轴，界面与报告都会显著标记「已插值」，不要当成原始值。</li>' +
      '<li>维度不同 → 直接拒绝并说明原因，不硬凑。</li>' +
      '<li>相对差在基准值为 0 时降级为绝对差并标记；小于阈值的差视为未变化。</li></ul>' +
      '<h3>解析细节</h3><p>DAMOS <code>KONSERVIERUNG_FORMAT 2.0</code>，GB2312/GBK 解码。<code>GRUPPENKENNFELD name NX NY</code> 是 2D MAP；<code>ST/X</code>、<code>WERT</code> 会折行，按块头声明的维度收齐；每个 <code>ST/Y</code> 后的 <code>WERT</code> 是一整行数据。逐块校验点数，异常块报文件名与行号。轴是否相同按<b>轴数值数组</b>判断，不按 <code>*SSTX</code> 引用名——这份文件里轴引用名几乎一对一，按名字分组会把 60 张同轴表拆散。</p>' +
      '<h3>导出</h3><p>「导出 HTML 报告」生成一个自包含离线 HTML：数据源与解析自检、对比配置、跨版本变更清单、差异统计、热力矩阵、切面叠加、3D 曲面/剖面、逐格明细（含来源文件与 DCM 行号）。「全量变化报告」是另一份：按标定量类型分章，只列变化项（含新增 / 删除 / 被拒绝）与证据，未变化项只给计数，不给结论建议。两者都是内联 SVG、双击即开、可直接转发。</p>' +
      '<h3>全量变化清单</h3><p>对 2 份以上 DCM 的全部标定量（标量 / 数组 / 曲线 / MAP / <b>轴定义</b>）逐项同名配对，<b>只给出有哪些变化</b>：数值有变化、B 版新增、B 版删除、对比被拒绝，并做恒等式对账（每个对象恰好归属一条账目）。<b>轴定义是正式标定量</b>：按断点序列逐点比较，断点增删按整项变化计入并有两版序列对照表；<b>未变化项只做计数</b>，不列清单；<b>不做改名配对</b>，改名对象会分别出现在新增与删除清单里由人对照；<b>结论层不给放行/驳回建议</b>，只陈述事实。<b>体检按对象类型分派</b>：标量没有邻域与沿轴趋势，孤立突变点与趋势反转判定不适用，不能据此驳回；一维数组/曲线只看左右邻域与 X 方向趋势；二维 MAP 保留四邻域 + 双轴判定；轴定义是断点序列，改单个断点属正常标定，不套用孤立突变点判据，改后是否单调/有无重复断点才是指标。一维对象有专门的 Δ 剖面图，标量/一维/二维各有对应表头的证据表。</p>' +
      '<h3>变更体检</h3><p>统计区给出<b>孤立突变点</b>（变化格四邻域全没变，误改的最强信号）和沿 X/Y 的<b>趋势反转处</b>，风险等级 高 / 中 / 低。阈值可切「自动阈值」：连续量按量级 × 1e-6，整数枚举与开关量沿用 1e-9；相对差「基准为 0」的判定也随量纲走。轴断点非单调或存在重复断点时，插值对齐会被<b>明确拒绝</b>并列出原因，不给一个看着正常的错误结果。</p>' +
      '<h3>会话复现</h3><p>「保存会话」把数据源、对比清单、基准、阈值、当前视图、3D 视角与定位值存成 JSON；「载入会话」按文件名 + 名称重新绑定，找不到时按名称 + 轴指纹模糊绑定，仍找不到的<b>明确列为未绑定</b>，不静默丢弃。报告里也内嵌这份 JSON。</p>' +
      '<h3>改名对齐</h3><p>版本升级把表改名时，同名配对会漏报。改名对齐只在相邻两版之间找候选：先精确同名配对，再对仅出现在一版的对象按 维度 + 轴指纹 分桶，用名称相似度（忽略 <code>_V2</code> 一类版本后缀、按驼峰切词）与数值相似度综合打分，并做双向唯一约束。<b>只给候选，不自动合并</b>；同轴且数值完全相同的几十张模式表不会被乱配成对。默认过滤 1×1 标量以减少噪声，点「加入对比清单」确认后才参与对比。</p>' +
      '<h3>对比摘要</h3><p>统计区上方的对比摘要把差异翻译成可读的事实：改动模式（整体缩放 / 局部调整 / 单点修正 / 形状重构）、变化最密集的真实轴值区间、体检汇总。填「允许偏差」后列出所有超差工况区间（真实 X/Y 轴值），报告首段就是这段摘要。<b>它只供评审参考，不给出放行或驳回建议</b>——结论由评审人在批注里写。</p>' +
      '<h3>轴变更影响面</h3><p>按完整轴指纹（维度 + X + Y 数值）分桶，跨版本比较断点，报出变化类型与全部受影响表。只按 <code>*SSTX</code> 引用名反查只能查到 1 张表，会严重低估影响面；同名表消失会判为对象增删，不误报为轴变更。</p>' +
      '<h3>评审批注与归档</h3><p>结论卡下方可对每个对比项写结论、原因、需求号、责任人；「全量变化清单」页签点任一变化项的「证据」，<b>有变化 / 新增 / 删除 / 被拒绝</b>都能同样写评审，随会话 JSON 与 HTML 报告一起导出。报告里的批注<b>实时自动保存在本机浏览器</b>，重新打开同一份原报告会自动恢复、仍可继续编辑；<b>实时保存仅在本机生效</b>，要跨机器或转发就点「另存含批注的可编辑副本」另存一份含最新批注的可编辑 HTML。点「导出归档报告」会弹出中央手写签名板，手写签名确认后，签名图像、归档时间、报告 ID 写入输出报告；<b>归档版批注只读</b>，控件禁用、不再提供编辑与再次导出入口。签名是手写痕迹，不是数字签名，本版本不做防篡改。浏览器不能直接改写本地磁盘文件，全程离线不上传。</p>' +
      '<h3>自检</h3><p>点右上角「解析自检」会跑内置变异测试：构造一张已知改动一格的 MAP，要求工具精确定位到那一格；还原后必须报 0 格变化；维度不同必须被拒绝。任何一条不过都会明确报 FAIL。</p>' +
      '<h3>隐私</h3><p>不截屏、不录屏、不访问网络、不写系统目录。文件只通过浏览器的 File API 在内存里解析。</p>' +
      '</div>';
  }

  /* ---------- version scan ---------- */
  function runScan() {
    if (state.datasets.length < 2) { status('全量版本对比需要至少 2 份 DCM', true); return; }
    var groups = state.index.versionGroups;
    var res = [], p = 0;
    $('btnScan').disabled = true;
    function step() {
      var end = Math.min(p + 400, groups.length);
      for (; p < end; p++) {
        var items = groups[p].items;
        var a = items[0];
        var b = items.filter(function (m) { return m.id !== a.id; })[0];
        if (!b) continue;
        var d = C.computeDiff(a, b, { eps: effEps(a) });
        if (d.ok && d.stats.changed > 0) {
          res.push({ name: a.name, funktion: a.funktion, nx: a.nx, ny: a.ny,
            changed: d.stats.changed, maxAbs: d.stats.maxAbs,
            srcA: a.srcFile, lineA: a.startLine, srcB: b.srcFile, lineB: b.startLine,
            keyA: a.key, keyB: b.key });
        }
      }
      status('全量版本对比 ' + p + ' / ' + groups.length + ' · 发现 ' + res.length + ' 项变化');
      if (p < groups.length) setTimeout(step, 0);
      else {
        res.sort(function (x, y) { return y.changed - x.changed || y.maxAbs - x.maxAbs; });
        state.versionScan = res;
        state.versionScanFull = res;
        $('btnScan').disabled = false;
        state.view = 'scan';
        syncTabs();
        renderStage();
        status(res.length ? '扫描完成：' + res.length + ' 项有变化' : '扫描完成：两份数据无差异', !res.length);
      }
    }
    step();
  }

  /* ---------- self test ---------- */
  function selfTest() {
    var lines = [];
    function chk(c, m) { lines.push((c ? 'PASS  ' : 'FAIL  ') + m); return c; }
    var dcm = [
      'KONSERVIERUNG_FORMAT 2.0', '',
      'GRUPPENKENNFELD TEST_M 3 2',
      '   LANGNAME "self test map"',
      '   FUNKTION TEST',
      '   EINHEIT_X "rpm"', '   EINHEIT_Y "%"', '   EINHEIT_W "Nm"',
      '   ST/X   1.0   2.0   3.0',
      '   ST/Y   10.0', '   WERT   1.0   2.0   3.0',
      '   ST/Y   20.0', '   WERT   4.0   5.0   6.0',
      'END'
    ].join('\r\n');
    var ds = C.parseDcm(dcm, 'SELFTEST.DCM');
    var m = ds.maps[0];
    chk(ds.stats.invalid === 0, '构造样本解析无异常');
    chk(m && m.nx === 3 && m.ny === 2 && m.v[1][2] === 6, '折行 ST/X 与逐行 WERT 还原正确');
    if (m) {
      var mut = JSON.parse(JSON.stringify(m));
      mut.v[1][2] += 10;
      var d1 = C.computeDiff(m, mut);
      chk(d1.stats.changed === 1 && d1.stats.changedCells[0].i === 2 && d1.stats.changedCells[0].j === 1 &&
        d1.stats.changedCells[0].delta === 10, '变异测试：改 (3,5) 格必须精确定位 +10');
      chk(C.computeDiff(m, JSON.parse(JSON.stringify(m))).stats.changed === 0, '还原后必须报 0 格变化');
      var wide = JSON.parse(JSON.stringify(m)); wide.nx = 4; wide.v = [[1, 2, 3, 4], [4, 5, 6, 7]];
      chk(C.computeDiff(m, wide).ok === false, '维度不同必须拒绝');
      var shift = JSON.parse(JSON.stringify(m)); shift.x = shift.x.map(function (v) { return v + 1; });
      chk(C.alignMaps(m, shift).interpolated === true, '轴刻度偏移必须标记插值');
    }
    var badMap = C.parseDcm('GRUPPENKENNFELD BAD_M 3 2\n   ST/X 1 2 3\n   ST/Y 10\n   WERT 1 2\nEND', 'BAD.DCM');
    chk(badMap.stats.invalid === 1, '点数不足的坏块必须被判为异常');
    var pass = lines.every(function (l) { return l.indexOf('PASS') === 0; });
    var real = state.datasets.map(function (d) {
      return d.fileName + ': ' + d.stats.totalBlocks + ' 块 / ' + d.maps.length + ' 对象 / 异常 ' + d.stats.invalid +
        ' / 未识别行 ' + d.stats.unknownLines + ' / 编码 ' + d.encoding;
    }).join('<br>');
    $('stage').innerHTML = '<div class="' + (pass ? 'okbox' : 'warnbox') + '"><b>内置变异自检 ' +
      (pass ? '全部通过' : '存在失败项') + '</b></div><pre style="font-size:12px;line-height:1.8;white-space:pre-wrap">' +
      esc(lines.join('\n')) + '</pre><h3 style="font-size:12px;color:#0C447C">已载入文件的解析自检</h3><p class="hint">' +
      (real || '尚未载入 DCM 文件') + '</p>';
    status(pass ? '解析自检全部通过' : '解析自检存在 FAIL', !pass);
  }

  /* ---------- session store / restore ---------- */
  function stamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }

  function downloadText(text, filename, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  }

  /* 逐格明细导出：只导当前选中对比项，行范围跟随「只列变化格」 */
  function exportCsv() {
    var good = goodDiffs();
    if (!good.length) { status('没有可导出的对比', true); return; }
    var idx = Math.max(0, Math.min(Number(state.opts.tableIndex) || 0, good.length - 1));
    var d = good[idx];
    var csv = V.csvOf(d, { onlyChanged: state.opts.onlyChanged });
    if (!csv) { status('当前对比没有可导出的明细', true); return; }
    var nm = String(d.other.label || d.other.name).replace(/[\\/:*?"<>|]/g, '_');
    downloadText('\ufeff' + csv, 'DCM_MAP_逐格明细_' + nm + '_' + stamp() + '.csv', 'text/csv;charset=utf-8');
    var rows = csv.split('\r\n').length - 1;
    status('已导出 ' + rows + ' 行明细：' + nm + '（CSV 带 BOM，Excel 直接打开不乱码）');
  }

  function exportSession() {
    var baseIdx = 0;
    state.basket.forEach(function (m, k) { if (m.key === state.baseKey) baseIdx = k; });
    return JSON.stringify({
      format: 'DCM_MAP_SESSION', version: 1, toolVersion: state.toolVersion,
      createdAt: new Date().toISOString(),
      sources: state.datasets.map(function (ds) {
        return { fileName: ds.fileName, objects: ds.maps.length, blocks: ds.stats.totalBlocks };
      }),
      basket: state.basket.map(function (m) {
        return { name: m.name, srcFile: m.srcFile, axisSig: m.axisSig,
          nx: m.nx, ny: m.ny, label: m.label };
      }),
      baseIndex: baseIdx,
      config: {
        mode: state.mode, eps: state.eps, autoThreshold: state.autoThreshold,
        view: state.view, opts: state.opts, annotations: state.annotations,
        reportPageSize: state.reportPageSize,
        auditScope: {
          type: state.opts.audit.type, status: state.opts.audit.status,
          search: state.opts.audit.search, onlyRisk: state.opts.audit.onlyRisk
        }
      }
    }, null, 2);
  }

  function mergeOpts(base, over) {
    Object.keys(over || {}).forEach(function (k) {
      var v = over[k];
      if (v && typeof v === 'object' && !Array.isArray(v) &&
          base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        mergeOpts(base[k], v);
      } else base[k] = v;
    });
    return base;
  }

  function importSession(text) {
    var s;
    try { s = JSON.parse(text); } catch (e) { throw new Error('会话 JSON 解析失败: ' + e.message); }
    if (!s || s.format !== 'DCM_MAP_SESSION') throw new Error('不是本工具的会话文件（缺少 format 标记）');
    if (!state.index) throw new Error('请先载入对应的 DCM 文件，再载入会话');
    var bound = [], missing = [], fuzzy = [];
    (s.basket || []).forEach(function (item) {
      var m = state.index.all.filter(function (x) {
        return x.srcFile === item.srcFile && x.name === item.name;
      })[0];
      if (!m) {
        m = state.index.all.filter(function (x) {
          return x.name === item.name && x.axisSig === item.axisSig;
        })[0];
        if (m) fuzzy.push(item.name + ' ← ' + item.srcFile + ' → ' + m.srcFile);
      }
      if (!m) { missing.push(item.name + ' [' + item.srcFile + ']'); return; }
      if (!bound.some(function (x) { return x.key === m.key; })) bound.push(m);
    });
    state.basket = bound;
    var cfg = s.config || {};
    var baseIdx = Math.max(0, Math.min(s.baseIndex || 0, Math.max(0, bound.length - 1)));
    state.baseKey = bound.length ? bound[baseIdx].key : null;
    state.mode = cfg.mode === 'relative' ? 'relative' : 'absolute';
    state.eps = typeof cfg.eps === 'number' ? cfg.eps : 1e-9;
    state.autoThreshold = !!cfg.autoThreshold;
    state.view = cfg.view || 'heat';
    state.opts = mergeOpts(defaultOpts(), cfg.opts || {});
    state.annotations = cfg.annotations || {};
    state.reportPageSize = typeof cfg.reportPageSize === 'number' ? cfg.reportPageSize : 12;
    if (cfg.auditScope) {
      state.opts.audit.type = cfg.auditScope.type || 'all';
      state.opts.audit.status = cfg.auditScope.status || 'all';
      state.opts.audit.search = cfg.auditScope.search || '';
      state.opts.audit.onlyRisk = !!cfg.auditScope.onlyRisk;
    }
    state.versionScan = null;
    state.renameScan = null;
    state.axisScan = null;
    state.audit = null; state.auditSig = '';
    renderAll();
    return {
      bound: bound.length, missing: missing, fuzzy: fuzzy,
      sources: (s.sources || []).map(function (x) { return x.fileName; })
    };
  }

  window.DCMSession = { exportState: exportSession, importState: importSession };

  /* ---------- events ---------- */
  function syncTabs() {
    Array.prototype.forEach.call(document.querySelectorAll('#viewTabs button'), function (b) {
      b.className = b.dataset.view === state.view ? 'active' : '';
    });
  }

  function setOpt(path, value, type) {
    var parts = path.split('.'), o = state.opts;
    for (var i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    var v = type === 'number' ? Number(value) : (type === 'bool' ? !!value : value);
    if (path === 'heatIndex') {
      if (value === 'env') { state.opts.heatEnvelope = true; return; }
      state.opts.heatEnvelope = false;
      v = Number(value);
    }
    if (path === 'surfaceProbe.axis') state.opts.surfaceProbe.index = 0;
    if (path === 'surfaceProbe.index') v = Number(value);
    if (path.indexOf('audit.') === 0 && path !== 'audit.page' && path !== 'audit.detailId') {
      state.opts.audit.page = 0; // 筛选条件变了，不能停在第 17 页
    }
    o[parts[parts.length - 1]] = v;
  }

  /* 点按钮 / 拖放区时浏览器可能在文字节点里放一个折叠选区（闪烁插入符）。
     换成原生 button + CSS user-select:none 已根除；这里再清一次，兼容宿主差异与既有选区。 */
  function openPicker(inputId) {
    var s = window.getSelection();
    if (s && s.removeAllRanges) s.removeAllRanges();
    $(inputId).click();
  }

  /* 使用手册与更新记录共用一套遮罩开关：都是静态面板，开关不触碰 state，
     不影响差异计算与报告导出 */
  function showOverlay(id, on) {
    var ov = $(id);
    if (!ov) return;
    ov.hidden = !on;
    document.body.style.overflow = on ? 'hidden' : '';
    if (on) {
      var body = ov.querySelector('.manual-body');
      if (body) body.scrollTop = 0;
    }
  }
  function showManual(on) { showOverlay('manualOverlay', on); }
  function showChangelog(on) { showOverlay('changelogOverlay', on); }

  function bindManual() {
    $('btnManual').addEventListener('click', function () { showManual(true); });
    $('btnManualClose').addEventListener('click', function () { showManual(false); });
    $('manualOverlay').addEventListener('click', function (e) {
      if (e.target === $('manualOverlay')) showManual(false);
    });
    $('manualNav').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-target]') : null;
      if (!b) return;
      var sec = document.getElementById(b.getAttribute('data-target'));
      if (sec && sec.scrollIntoView) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('btnManualPrint').addEventListener('click', function () { window.print(); });
    $('btnVersion').addEventListener('click', function () { showChangelog(true); });
    $('btnChangelogClose').addEventListener('click', function () { showChangelog(false); });
    $('changelogOverlay').addEventListener('click', function (e) {
      if (e.target === $('changelogOverlay')) showChangelog(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (!$('manualOverlay').hidden) showManual(false);
      else if (!$('changelogOverlay').hidden) showChangelog(false);
    });
  }

  function bind() {
    bindManual();
    $('btnLoad').addEventListener('click', function () { openPicker('fileInput'); });
    $('btnLoadSession').addEventListener('click', function () { openPicker('sessionInput'); });
    $('fileInput').addEventListener('change', function (e) { loadFiles(e.target.files); e.target.value = ''; });
    $('dropzone').addEventListener('click', function () { openPicker('fileInput'); });
    ['dragenter', 'dragover'].forEach(function (ev) {
      $('dropzone').addEventListener(ev, function (e) { e.preventDefault(); $('dropzone').classList.add('hot'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      $('dropzone').addEventListener(ev, function (e) { e.preventDefault(); $('dropzone').classList.remove('hot'); });
    });
    $('dropzone').addEventListener('drop', function (e) { loadFiles(e.dataTransfer.files); });
    document.body.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.body.addEventListener('drop', function (e) { e.preventDefault(); });

    $('btnReport').addEventListener('click', function () {
      if (!state.datasets.length) { status('先载入 DCM', true); return; }
      computeResult();
      state.sessionJson = exportSession();
      var r = RP.download(state);
      status('报告已导出（' + Math.round(r.bytes / 1024) + ' KB，自包含离线 HTML，内含会话配置）');
    });
    $('btnAuditReport').addEventListener('click', function () {
      if (state.datasets.length < 2) { status('全量审查报告需要至少 2 份 DCM', true); return; }
      if (typeof RP.downloadAudit !== 'function') { status('全量审查报告模块未就绪', true); return; }
      try {
        var au = state.audit || buildAuditNow();
        state.sessionJson = exportSession();
        var r = RP.downloadAudit(state, au);
        status('全量变化报告已导出（' + Math.round(r.bytes / 1024) +
          ' KB，' + au.totals.total + ' 条账目，自包含离线 HTML）');
      } catch (err) { status('全量变化报告导出失败：' + err.message, true); }
    });
    $('inpReportPageSize').addEventListener('change', function (e) {
      var v = Number(e.target.value);
      state.reportPageSize = isFinite(v) ? Math.max(1, Math.min(200, Math.round(v))) : 12;
      e.target.value = state.reportPageSize;
      status('HTML 报告默认展开 ' + state.reportPageSize + ' 项，其余折叠为紧凑清单');
    });
    $('chkAutoEps').addEventListener('change', function (e) {
      state.autoThreshold = e.target.checked; renderAll();
    });
    $('conclusion').addEventListener('change', function (e) {
      var t = e.target;
      if (!t.dataset || t.dataset.opt !== 'allowDelta') return;
      var v = String(t.value || '').trim(), n = Number(v);
      state.opts.allowDelta = (v === '' || !isFinite(n)) ? null : n;
      renderAll();
    });
    ['input', 'change'].forEach(function (ev) {
      $('annotations').addEventListener(ev, function (e) { annEdit(e.target); });
      // 审查页签证据块里的批注控件在 #stage 内，用同一个写入逻辑，不重绘以免丢焦点
      $('stage').addEventListener(ev, function (e) { annEdit(e.target); });
    });
    $('btnSaveSession').addEventListener('click', function () {
      var json = exportSession();
      downloadText(json, 'DCM_MAP_会话_' + stamp() + '.json', 'application/json;charset=utf-8');
      status('会话已保存（' + state.basket.length + ' 张 MAP + 视角 / 定位 / 阈值配置）');
    });
    $('sessionInput').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      f.text().then(function (txt) {
        try {
          var r = importSession(txt);
          var msg = '会话已载入：绑定 ' + r.bound + ' 项';
          if (r.fuzzy.length) msg += '，轴指纹模糊绑定 ' + r.fuzzy.length + ' 项';
          if (r.missing.length) msg += '，未绑定 ' + r.missing.length + ' 项';
          status(msg, r.missing.length > 0);
          if (r.missing.length) {
            $('stage').insertAdjacentHTML('afterbegin',
              '<div class="warnbox"><b>会话有 ' + r.missing.length + ' 项未绑定（未静默丢弃）</b><br>' +
              r.missing.map(esc).join('<br>') + '</div>');
          }
        } catch (err) { status('载入会话失败：' + err.message, true); }
      });
      e.target.value = '';
    });
    $('btnScan').addEventListener('click', runScan);
    $('btnSelfTest').addEventListener('click', selfTest);
    $('dsList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act="dsdel"]');
      if (b) removeDataset(b.dataset.ds);
    });
    $('btnClear').addEventListener('click', function () {
      state.basket = []; state.baseKey = null; state.result = null; renderAll();
    });
    $('btnAutoPair').addEventListener('click', function () {
      if (!state.index) return;
      var g = state.index.versionGroups.filter(function (x) { return match(x.items[0]); })[0];
      if (!g) { status('没有可配对的多版本同名对象（需要 2 份以上 DCM）', true); return; }
      addMany(g.items, true);
    });
    $('selBase').addEventListener('change', function (e) { state.baseKey = e.target.value; renderAll(); });
    $('selMode').addEventListener('change', function (e) { state.mode = e.target.value; renderAll(); });
    $('inpEps').addEventListener('change', function (e) {
      var v = Number(e.target.value);
      state.eps = isFinite(v) && v >= 0 ? v : 1e-9; renderAll();
    });
    $('chkOnlyChanged').addEventListener('change', function (e) { state.opts.onlyChanged = e.target.checked; renderAll(); });
    $('chkValues').addEventListener('change', function (e) { state.opts.showValues = e.target.checked; renderStage(); });
    $('search').addEventListener('input', function (e) { state.search = e.target.value.trim(); renderTree(); });
    $('listTabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-list]'); if (!b) return;
      state.listMode = b.dataset.list;
      Array.prototype.forEach.call($('listTabs').children, function (x) { x.className = ''; });
      b.className = 'active'; renderTree();
    });
    $('viewTabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-view]'); if (!b) return;
      state.view = b.dataset.view; syncTabs(); renderStage();
    });

    $('tree').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var act = b.dataset.act;      if (act === 'toggle') { b.closest('.grp').classList.toggle('open'); return; }
      if (act === 'add') { addToBasket(findMap(b.dataset.key)); return; }
      if (act === 'group') { addMany(state.index.groups[Number(b.dataset.gi)].maps.filter(match), true); return; }
      if (act === 'vgroup') { addMany(state.index.versionGroups[Number(b.dataset.gi)].items, true); return; }
    });
    $('basket').addEventListener('click', function (e) {
      var del = e.target.closest('[data-act="del"]');
      if (del) {
        state.basket = state.basket.filter(function (m) { return m.key !== del.dataset.key; });
        if (state.baseKey === del.dataset.key) state.baseKey = state.basket.length ? state.basket[0].key : null;
        renderAll(); return;
      }
      var chip = e.target.closest('[data-act="setbase"]');
      if (chip) { state.baseKey = chip.dataset.key; renderAll(); }
    });

    $('stage').addEventListener('change', function (e) {
      var t = e.target;
      if (t.dataset.cmd === 'toggleLayer') {
        state.opts.stack.visible[Number(t.dataset.k)] = t.checked;
        renderStage(); return;
      }
      var opt = t.dataset.opt;
      if (!opt) return;
      setOpt(opt, t.type === 'checkbox' ? t.checked : t.value, t.type === 'checkbox' ? 'bool' : t.dataset.type);
      renderStage();
    });
    $('stage').addEventListener('input', function (e) {
      var t = e.target, opt = t.dataset.opt;
      if (!opt || t.tagName !== 'INPUT' || t.type !== 'number') return;
      if (opt.indexOf('renameOpts.') === 0) return; // 改名阈值只在 change（失焦/回车）时生效，避免输入中重绘丢焦点
      setOpt(opt, t.value, 'number'); renderStage();
    });
    $('stage').addEventListener('click', function (e) {
      /* 格子取点必须在按钮判定之前：热力图的格子没有 data-cmd/data-act，
         先取 b 再判空会把这条路径整体挡死（旧的立方取点就是这么失效的）。 */
      var cell = e.target.closest('[data-i]');
      if (cell && state.view === 'heat') {
        var cb = state.result && state.result.cube;
        var ci = Number(cell.dataset.i), cj = Number(cell.dataset.j);
        if (cb && cb.labels.length > 1 && isFinite(ci) && isFinite(cj)) {
          state.opts.profile.i = ci;
          state.opts.profile.j = cj;
          state.view = 'profile'; syncTabs(); renderStage();
          var bb = state.result.base;
          status('已定位剖面：X=' + V.fmt(bb.x[ci], 3) + '，Y=' + V.fmt(bb.y[cj], 3));
        } else {
          status('对比清单不足 2 项，没有跨版本剖面可看', true);
        }
        return;
      }
      var b = e.target.closest('[data-cmd], [data-act]'); if (!b) return;
      if (b.dataset.cmd === 'surfaceReset') {
        state.opts.surface = { yaw: 0.72, pitch: 0.86, zoom: 1 }; renderStage(); return;
      }
      if (b.dataset.cmd === 'doScan') { runScan(); return; }
      if (b.dataset.cmd === 'doRename') { runRename(); return; }
      if (b.dataset.cmd === 'doAxis') { runAxisScan(); return; }
      if (b.dataset.cmd === 'doAudit') { runAudit(); return; }
      if (b.dataset.cmd === 'csvExport') { exportCsv(); return; }
      if (b.dataset.cmd === 'profileMax') {
        var pc = state.result && state.result.cube;
        if (!pc || pc.labels.length < 2) { status('对比清单不足 2 项，没有可比较的层', true); return; }
        var bi = 0, bj = 0, bv = -1;
        for (var kk = 1; kk < pc.labels.length; kk++) {
          for (var jj = 0; jj < pc.ny; jj++) {
            for (var ii = 0; ii < pc.nx; ii++) {
              var dv = Math.abs(pc.layers[kk][jj][ii] - pc.layers[0][jj][ii]);
              if (dv > bv) { bv = dv; bi = ii; bj = jj; }
            }
          }
        }
        state.opts.profile.i = bi;
        state.opts.profile.j = bj;
        renderStage();
        status('已定位到差异最大的格：X=' + V.fmt(pc.x[bi], 3) + '，Y=' + V.fmt(pc.y[bj], 3) +
          '，|Δ| 最大 ' + V.fmt(bv));
        return;
      }
      if (b.dataset.cmd === 'doAuditReport') { $('btnAuditReport').click(); return; }
      if (b.dataset.cmd === 'auditFirst' || b.dataset.cmd === 'auditPrev' || b.dataset.cmd === 'auditNext') {
        var ap = state.opts.audit;
        if (b.dataset.cmd === 'auditFirst') ap.page = 0;
        else ap.page += (b.dataset.cmd === 'auditNext' ? 1 : -1);
        renderStage(); return;
      }
      if (b.dataset.act === 'auditdetail') {
        state.opts.audit.detailId = b.dataset.id; renderStage(); return;
      }
      if (b.dataset.act === 'auditadd') {
        var ae = state.audit && state.audit.entries.filter(function (x) { return x.id === b.dataset.id; })[0];
        if (ae && ae.keyA && ae.keyB) {
          state.view = 'heat'; syncTabs();
          addMany([findMap(ae.keyA), findMap(ae.keyB)].filter(Boolean), true);
          status('已把 ' + ae.name + ' 的 A / B 两版加入对比清单，基准为 A');
        }
        return;
      }
      if (b.dataset.act === 'axisadd') {
        var ar = state.axisScan;
        var ax = ar && ar.pairs[Number(b.dataset.pi)].changedAxes[Number(b.dataset.ai)];
        if (ax) {
          var maps = ax.affected.slice(0, 12).map(function (ref) { return findMap(ref.key); }).filter(Boolean);
          state.view = 'heat'; syncTabs();
          addMany(maps, true);
          status('已把 ' + maps.length + ' 张受影响表加入对比清单（上限 12）');
        }
        return;
      }
      if (b.dataset.act === 'renameadd') {
        var rr = state.renameScan;
        var cc = rr && rr.pairs[Number(b.dataset.pi)].candidates[Number(b.dataset.ci)];
        if (cc) {
          state.view = 'heat'; syncTabs();
          addMany([findMap(cc.a.key), findMap(cc.b.key)].filter(Boolean), true);
          status('已把改名候选 ' + cc.a.name + ' → ' + cc.b.name + ' 加入对比清单，基准为 A');
        }
        return;
      }
      if (b.dataset.act === 'scanadd') {
        var v = state.versionScan[Number(b.dataset.gi)];
        /* 必须先切视图再 addMany：addMany 内部会 renderAll，
           顺序反了就会出现「页签跳到热力矩阵、内容还留在变更清单」 */
        if (v) { state.view = 'heat'; syncTabs(); addMany([findMap(v.keyA), findMap(v.keyB)].filter(Boolean), true); }
        return;
      }
    });

    /* 3D drag & wheel */
    var drag = null, raf = 0;
    $('stage').addEventListener('mousedown', function (e) {
      if (state.view !== 'surface' || !e.target.closest('svg')) return;
      drag = { x: e.clientX, y: e.clientY, yaw: state.opts.surface.yaw, pitch: state.opts.surface.pitch };
      e.preventDefault();
    });
    /* 按钮提示：能用就说明用途，被禁用就说明为什么不可用。
       disabled 按钮不派发鼠标事件，e.target 会落到父元素上，所以只有它需要
       用 elementFromPoint 按坐标把按钮找回来；这一步只在没命中 data-tip 时才做。 */
    function tipTextFor(el) {
      if (!el) return '';
      if (el.hasAttribute('data-hi')) {
        return surfaceHoverText(Number(el.getAttribute('data-hi')), Number(el.getAttribute('data-hj')));
      }
      var off = el.getAttribute('data-tip-off');
      if (el.disabled && off) return off;
      return el.getAttribute('data-tip') || '';
    }

    function tipTarget(e) {
      var el = e.target && e.target.closest ?
        e.target.closest('[data-tip], polygon[data-hi]') : null;
      if (el || !document.elementFromPoint) return el;
      var at = document.elementFromPoint(e.clientX, e.clientY);
      return at && at.closest ? at.closest('[data-tip], polygon[data-hi]') : null;
    }

    window.addEventListener('mousemove', function (e) {
      if (drag) {
        state.opts.surface.yaw = drag.yaw + (e.clientX - drag.x) * 0.008;
        state.opts.surface.pitch = Math.max(0.08, Math.min(1.5, drag.pitch - (e.clientY - drag.y) * 0.006));
        /* 旋转时把提示关掉：它悬在原地不动，看着像图里多出来的一块 */
        $('tooltip').style.display = 'none';
        if (!raf) raf = requestAnimationFrame(function () { raf = 0; renderStage(); });
        return;
      }
      var tip = $('tooltip');
      var text = tipTextFor(tipTarget(e));
      if (text) {
        tip.textContent = text;
        tip.style.display = 'block';
        tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 340) + 'px';
        tip.style.top = Math.max(8, Math.min(e.clientY + 14, window.innerHeight - 56)) + 'px';
      } else tip.style.display = 'none';
    });
    window.addEventListener('mouseup', function () {
      if (!drag) return;
      drag = null;
      renderStage();
    });
    $('stage').addEventListener('wheel', function (e) {
      if (state.view !== 'surface' || !e.target.closest('svg')) return;
      e.preventDefault();
      state.opts.surface.zoom = Math.max(0.55, Math.min(2.4, state.opts.surface.zoom * (e.deltaY > 0 ? 0.94 : 1.06)));
      renderStage();
    }, { passive: false });
  }

  function renderAll() {
    computeResult();
    if (state.audit && state.auditSig !== auditSig()) buildAuditNow();
    renderDsList(); renderTree(); renderBasket(); renderConclusion(); renderAnnotations();
    renderStats(); renderStage();
    $('inpReportPageSize').value = state.reportPageSize;
    renderEpsHint(); syncTabs();
  }

  bind();
  window.DCMState = state;
})();
