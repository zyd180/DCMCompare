/* Self-contained offline HTML report. */
(function (root, factory) {
  var core = root.DCMCore || (typeof require === 'function' ? require('./core.js') : null);
  var views = root.DCMViews || (typeof require === 'function' ? require('./views.js') : null);
  var api = factory(core, views);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DCMReport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C, V) {
  'use strict';

  var esc = V.esc, fmt = C.fmt;

  /* 报告要能追溯到是哪一版工具生成的：不同版本的章节结构与口径会变 */
  function toolVer(state) {
    var v = state && state.toolVersion;
    return v ? ' · 工具 ' + v : '';
  }

  function annSelect(cur) {
    return [['pending', '待确认'], ['approve', '通过'], ['reject', '驳回']].map(function (o) {
      return '<option value="' + o[0] + '"' + (cur === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');
  }

  /* 报告自带的批注逻辑：把控件当前值写回 DOM 属性（否则 outerHTML 会丢运行时值）。
     批注实时存本机并自动恢复；归档导出先弹中央手写签名板，确认后基于 DOM 克隆
     生成只读版（控件 disabled、移除再次导出入口、内嵌签名 PNG 与归档时间）。
     签名图像只是手写痕迹，不是数字签名；本版本不做防篡改，也不声称具备防篡改能力。 */
  function annotationJs(filePrefix) {
    var fname = filePrefix || 'DCM_MAP_评审报告_';
    return [
      'window.DCM_ANNOTATIONS = JSON.parse(document.getElementById("dcm-ann-data").textContent || "{}");',
      'window.DCM_REPORT_ID = document.documentElement.getAttribute("data-dcm-report-id") || document.title;',
      'function dcmStoreKey(){return "DCM_ANNOTATIONS:"+window.DCM_REPORT_ID;}',
      'function dcmIsArchived(){return document.documentElement.getAttribute("data-dcm-archived")==="1";}',
      'function dcmPersist(){',
      '  try{ localStorage.setItem(dcmStoreKey(), JSON.stringify(window.DCM_ANNOTATIONS)); }catch(e){}',
      '  var badge=document.getElementById("dcm-save-state");',
      '  if(badge) badge.textContent="批注已保存到本机 · "+new Date().toLocaleTimeString();',
      '}',
      'function dcmLoadLocal(){',
      '  if(dcmIsArchived()) return;',
      '  try{',
      '    var raw=localStorage.getItem(dcmStoreKey());',
      '    if(!raw) return;',
      '    var saved=JSON.parse(raw);',
      '    Object.keys(saved).forEach(function(k){',
      '      if(!window.DCM_ANNOTATIONS[k]) window.DCM_ANNOTATIONS[k]={};',
      '      Object.keys(saved[k]).forEach(function(f){ window.DCM_ANNOTATIONS[k][f]=saved[k][f]; });',
      '    });',
      '    document.querySelectorAll("[data-ann]").forEach(function(el){',
      '      var k=el.getAttribute("data-ann"), f=el.getAttribute("data-field");',
      '      var rec=window.DCM_ANNOTATIONS[k];',
      '      if(rec && rec[f]!==undefined && rec[f]!==null){',
      '        el.value=rec[f];',
      '        if(el.tagName==="SELECT"){',
      '          Array.prototype.forEach.call(el.options,function(o){',
      '            if(o.value===String(rec[f])) o.setAttribute("selected","selected"); else o.removeAttribute("selected");',
      '          });',
      '        } else {',
      '          el.setAttribute("value",rec[f]);',
      '          if(el.tagName==="TEXTAREA") el.textContent=rec[f];',
      '        }',
      '      }',
      '    });',
      '    document.getElementById("dcm-ann-data").textContent=JSON.stringify(window.DCM_ANNOTATIONS).split("<").join("\\\\u003c");',
      '    var badge=document.getElementById("dcm-save-state");',
      '    if(badge) badge.textContent="已从本机恢复批注";',
      '  }catch(e){}',
      '}',
      'function dcmBindAutoSave(){',
      '  if(dcmIsArchived()) return;',
      '  document.querySelectorAll("[data-ann]").forEach(function(el){',
      '    el.addEventListener("input", dcmSyncAnnotations);',
      '    el.addEventListener("change", dcmSyncAnnotations);',
      '  });',
      '}',
      'function dcmSyncAnnotations(){',
      '  if(dcmIsArchived()) return;',
      '  document.querySelectorAll("[data-ann]").forEach(function(el){',
      '    var k=el.getAttribute("data-ann"), f=el.getAttribute("data-field");',
      '    if(!window.DCM_ANNOTATIONS[k]) window.DCM_ANNOTATIONS[k]={};',
      '    window.DCM_ANNOTATIONS[k][f]=el.value;',
      '    if(el.tagName==="SELECT"){',
      '      Array.prototype.forEach.call(el.options,function(o){',
      '        if(o.selected) o.setAttribute("selected","selected"); else o.removeAttribute("selected");',
      '      });',
      '    } else {',
      '      el.setAttribute("value", el.value);',
      '      if(el.tagName==="TEXTAREA") el.textContent=el.value;',
      '    }',
      '  });',
      '  document.getElementById("dcm-ann-data").textContent = JSON.stringify(window.DCM_ANNOTATIONS).split("<").join("\\\\u003c");',
      '  dcmPersist();',
      '}',
      'function dcmFreezeClone(clone,signature){',
      '  clone.setAttribute("data-dcm-archived","1");',
      '  clone.setAttribute("data-dcm-signed", signature && signature.indexOf("data:image/")===0 ? "1" : "0");',
      '  clone.querySelectorAll("[data-ann]").forEach(function(el){',
      '    el.setAttribute("disabled","disabled");',
      '    if(el.tagName==="TEXTAREA"||el.tagName==="INPUT") el.setAttribute("readonly","readonly");',
      '  });',
      '  clone.querySelectorAll(".ann-export").forEach(function(el){',
      '    el.innerHTML="<span class=\\"hint\\">本报告已归档：批注只读，不能继续修改或再次导出。如需继续评审，请回到原始报告或工具。</span>";',
      '  });',
      '  var h=clone.querySelector(".rhead h1");',
      '  if(h){',
      '    var tag=document.createElement("span");',
      '    tag.className="archived-badge";',
      '    tag.textContent="已归档 · 批注只读";',
      '    h.appendChild(tag);',
      '  }',
      '  var head=clone.querySelector(".rhead");',
      '  if(head){',
      '    var seal=document.createElement("div");',
      '    seal.className="archive-seal";',
      '    var lab=document.createElement("span");',
      '    lab.className="seal-label";',
      '    lab.textContent="审核人手写签名";',
      '    seal.appendChild(lab);',
      '    if(signature && signature.indexOf("data:image/")===0){',
      '      var img=document.createElement("img");',
      '      img.className="sign-img"; img.setAttribute("alt","审核人手写签名");',
      '      img.setAttribute("src", signature);',
      '      seal.appendChild(img);',
      '    } else {',
      '      var none=document.createElement("span");',
      '      none.className="hint"; none.textContent="（未签名）";',
      '      seal.appendChild(none);',
      '    }',
      '    var meta=document.createElement("span");',
      '    meta.className="seal-meta";',
      '    meta.textContent="归档时间："+new Date().toLocaleString()+"　报告 ID："+window.DCM_REPORT_ID;',
      '    seal.appendChild(meta);',
      '    head.appendChild(seal);',
      '  }',
      '}',
      'function dcmAnnotatedHtml(signature,freeze){',
      '  dcmSyncAnnotations();',
      '  var clone=document.documentElement.cloneNode(true);',
      '  var mask=clone.querySelector(".sign-mask"); if(mask) mask.remove();',
      '  if(freeze!==false) dcmFreezeClone(clone, signature||"");',
      '  return "<!DOCTYPE html>\\n" + clone.outerHTML;',
      '}',
      'function dcmDownload(html,name){',
      '  var blob=new Blob([html],{type:"text/html;charset=utf-8"});',
      '  var url=URL.createObjectURL(blob);',
      '  var a=document.createElement("a");',
      '  a.href=url; a.download=name;',
      '  document.body.appendChild(a); a.click(); document.body.removeChild(a);',
      '  setTimeout(function(){URL.revokeObjectURL(url);},3000);',
      '}',
      'function dcmExportEditable(){',
      '  if(dcmIsArchived()){ alert("本报告已归档，请回到原始报告或工具继续编辑。"); return; }',
      '  var html=dcmAnnotatedHtml("",false);',
      '  dcmDownload(html, "DCM_MAP_原报告_含批注_"+new Date().toISOString().slice(0,10)+".html");',
      '}',
      'function dcmSignPadRemove(){',
      '  var old=document.querySelector(".sign-mask"); if(old) old.remove();',
      '}',
      'function dcmOpenSignaturePad(){',
      '  if(dcmIsArchived()){ alert("本报告已归档，批注只读，不能再次导出。"); return; }',
      '  dcmSignPadRemove();',
      '  var mask=document.createElement("div"); mask.className="sign-mask";',
      '  var box=document.createElement("div"); box.className="sign-box";',
      '  var title=document.createElement("h3"); title.textContent="审核人手写签名"; box.appendChild(title);',
      '  var tip=document.createElement("p"); tip.className="sign-tip";',
      '  tip.textContent="请在下方框内手写签名。确认后签名写入归档报告，归档版批注只读、不可再修改。"; box.appendChild(tip);',
      '  var cv=document.createElement("canvas");',
      '  cv.className="sign-canvas"; cv.width=420; cv.height=160;',
      '  cv.setAttribute("data-role","signature"); box.appendChild(cv);',
      '  var ctx=cv.getContext("2d");',
      '  ctx.fillStyle="#FFFFFF"; ctx.fillRect(0,0,cv.width,cv.height);',
      '  ctx.lineWidth=2.4; ctx.lineCap="round"; ctx.lineJoin="round"; ctx.strokeStyle="#2C2C2A";',
      '  var drawing=false, hasInk=false, last=null;',
      '  function pos(e){ var r=cv.getBoundingClientRect(); return {x:e.clientX-r.left, y:e.clientY-r.top}; }',
      '  cv.addEventListener("pointerdown",function(e){ drawing=true; last=pos(e); e.preventDefault(); });',
      '  cv.addEventListener("pointermove",function(e){',
      '    if(!drawing) return;',
      '    var p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke();',
      '    last=p; hasInk=true; e.preventDefault();',
      '  });',
      '  function stop(){ drawing=false; last=null; }',
      '  cv.addEventListener("pointerup",stop); cv.addEventListener("pointerleave",stop);',
      '  var row=document.createElement("div"); row.className="sign-actions";',
      '  var clear=document.createElement("button");',
      '  clear.type="button"; clear.className="ghost"; clear.textContent="清空"; clear.title="清空重写";',
      '  clear.setAttribute("data-role","sign-clear");',
      '  clear.onclick=function(){ ctx.fillStyle="#FFFFFF"; ctx.fillRect(0,0,cv.width,cv.height); hasInk=false; };',
      '  var cancel=document.createElement("button");',
      '  cancel.type="button"; cancel.className="ghost"; cancel.textContent="取消"; cancel.title="放弃导出";',
      '  cancel.setAttribute("data-role","sign-cancel");',
      '  cancel.onclick=function(){ dcmSignPadRemove(); };',
      '  var ok=document.createElement("button");',
      '  ok.type="button"; ok.textContent="确认签名并导出"; ok.title="签名写入报告并冻结批注";',
      '  ok.setAttribute("data-role","sign-confirm");',
      '  ok.onclick=function(){',
      '    if(!hasInk){ alert("请先手写签名。"); return; }',
      '    var sig=cv.toDataURL("image/png");',
      '    dcmSignPadRemove();',
      '    dcmArchiveWith(sig);',
      '  };',
      '  row.appendChild(clear); row.appendChild(cancel); row.appendChild(ok); box.appendChild(row);',
      '  mask.appendChild(box); document.body.appendChild(mask);',
      '}',
      'function dcmArchiveWith(signature){',
      '  var html=dcmAnnotatedHtml(signature);',
      '  dcmDownload(html, "' + fname + '"+new Date().toISOString().slice(0,10)+".html");',
      '}',
      'function dcmExportAnnotated(){ dcmOpenSignaturePad(); }',
      'dcmLoadLocal();',
      'dcmBindAutoSave();'
    ].join('\n');
  }

  function card(label, value, tone) {
    return '<div class="card"><div class="card-l">' + esc(label) + '</div><div class="card-v ' +
      (tone || '') + '">' + esc(value) + '</div></div>';
  }

  /* 报告顶部工具条：另存 / 归档两个按钮在最上方一行，所有说明放在按钮下方且各自成行。
     整条用 .ann-export 作容器，归档冻结时这段 innerHTML 会被整体替换为只读提示。 */
  function annTopbar(kind) {
    var note = kind === 'audit' ?
      '各证据块（含新增 / 删除 / 被拒绝项）都能写结论 / 意见 / 需求号 / 责任人；' +
      '归档时弹窗手写签名，签名写入报告，批注只读。全程离线。' :
      '归档时弹窗手写签名，签名写入报告；归档版批注只读、不可再修改。全程离线、不上传。';
    return '<div class="ann-export ann-topbar">' +
      '<div class="ann-actions">' +
        '<button class="ghost" onclick="dcmExportEditable()" title="另存含最新批注、仍可编辑的 HTML">另存含批注的可编辑副本</button>' +
        '<button onclick="dcmExportAnnotated()" title="手写签名后导出只读归档版">导出归档报告</button>' +
      '</div>' +
      '<div class="ann-notes">' +
        '<span class="hint">实时保存仅在本机生效</span>' +
        '<span id="dcm-save-state" class="hint">重新打开本报告自动恢复批注</span>' +
        '<span class="hint">' + note + '</span>' +
      '</div>' +
    '</div>';
  }

  function build(state) {
    var now = new Date();
    var stamp = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' +
      pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
    var R = state.result || {};
    var base = R.base, others = R.others || [], all = R.all || { diffs: [], envelope: null };
    var opts = state.opts || {};
    var good = all.diffs.filter(function (d) { return d.ok; });
    var bad = all.diffs.filter(function (d) { return !d.ok; });
    var out = [];

    // 报告唯一标识：批注按报告隔离地持久化在本机，重新打开自动恢复
    var reportId = stamp.replace(/\D/g, '') + '-' + Math.random().toString(36).slice(2, 9);
    out.push('<!DOCTYPE html><html lang="zh-CN" data-dcm-report-id="' + esc(reportId) +
      '"><head><meta charset="utf-8">');
    out.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
    out.push('<title>DCM MAP 对比报告 ' + stamp + '</title>');
    out.push('<style>' + css() + '</style></head><body>');
    out.push('<header class="rhead"><h1>DCM MAP 对比报告</h1><p>生成时间 ' + stamp +
      ' · 自包含离线文件，无外部依赖 · 数据全部来自本地 DCM，未上传' +
      ' · 作者 Henry · 供标定评审使用' + toolVer(state) + '</p></header>');
    out.push('<main>');
    out.push(annTopbar('compare'));

    out.push('<section><h2>1. 数据源与解析自检</h2>');
    out.push('<table class="tbl"><thead><tr><th>文件</th><th>编码</th><th>行数</th><th>块数</th>' +
      '<th>可比对象</th><th>异常块</th><th>未识别行</th></tr></thead><tbody>');
    (state.datasets || []).forEach(function (ds) {
      out.push('<tr><td>' + esc(ds.fileName) + '</td><td>' + esc(ds.encoding) + '</td><td>' + ds.lineCount +
        '</td><td>' + ds.stats.totalBlocks + '</td><td>' + ds.maps.length + '</td><td class="' +
        (ds.stats.invalid ? 'up' : '') + '">' + ds.stats.invalid + '</td><td>' + ds.stats.unknownLines + '</td></tr>');
    });
    out.push('</tbody></table>');
    var kindRows = [];
    (state.datasets || []).forEach(function (ds) {
      Object.keys(ds.stats.byKind).sort().forEach(function (k) {
        kindRows.push('<tr><td>' + esc(k) + '</td><td>' + ds.stats.byKind[k] + '</td></tr>');
      });
    });
    out.push('<details><summary>块类型清单（全量扫描，含声明类型）</summary><table class="tbl"><thead><tr><th>块类型</th><th>数量</th></tr></thead><tbody>' +
      kindRows.join('') + '</tbody></table></details>');
    var warns = [];
    (state.datasets || []).forEach(function (ds) {
      ds.warnings.forEach(function (w) { warns.push(esc(ds.fileName) + ' · ' + esc(w)); });
      ds.unknowns.slice(0, 20).forEach(function (u) { warns.push(esc(ds.fileName) + ':' + u.line + ' 未识别: ' + esc(u.text)); });
    });
    if (warns.length) out.push('<div class="warn"><b>解析告警 ' + warns.length + ' 条</b><ul><li>' + warns.join('</li><li>') + '</li></ul></div>');
    else out.push('<p class="ok">解析自检通过：所有块的声明维度与 ST/X、ST/Y、WERT 实际点数一致，无异常块，无未识别顶层关键字。</p>');
    var threeD = (state.datasets || []).some(function (ds) {
      return Object.keys(ds.stats.byKind).some(function (k) { return /3D$/.test(k) && ds.stats.byKind[k] > 0; });
    });
    out.push('<p class="hint">三轴查找表说明（依据本次数据源顶层块类型的全量扫描，不是写死的结论）：' +
      (threeD ? '<b>检出三轴表块</b>。该格式未经实测，当前仅解析第一层二维数据，已在审查账本中明确排除出对比，不伪装成完整三维结果。' :
        '未检出三轴表块。') +
      '解析器按可扩展块模型保留未知类型，遇到未识别块会在此告警，不会静默丢弃。</p>');
    var provItems = [base].concat(others).filter(function (m) { return m && m.provisional; });
    if (provItems.length) {
      out.push('<div class="warn"><b>本次对比含 ' + provItems.length + ' 张三轴表，只按第一层二维数据参与计算</b>' +
        '<ul><li>' + provItems.map(function (m) {
          return esc(m.label || m.name) + ' · ' + m.nx + '×' + m.ny + '（仅第一层）';
        }).join('</li><li>') + '</li></ul>' +
        '本章及后续图表中该表的数值只代表它的第一层，<b>不是完整三维曲面</b>；' +
        '涉及三维的差异请勿据此下结论。全量变化账本对三轴表一律判「对比被拒绝」，与本报告口径一致。</div>');
    }
    out.push('</section>');

    out.push('<section><h2>2. 对比配置</h2>');
    out.push('<table class="tbl"><tbody>');
    out.push('<tr><th>基准</th><td>' + esc(base ? (base.label || base.name) : '未设置') +
      (base ? ' · ' + base.srcFile + ':' + base.startLine + ' · ' + base.nx + '×' + base.ny : '') + '</td></tr>');
    var effEps = typeof state.effectiveEps === 'number' ? state.effectiveEps : state.eps;
    var epsDesc = state.autoThreshold ?
      ('自动阈值 ' + fmt(effEps, 3) + (base ? '（' + C.suggestEps(base).basis + '）' : '')) :
      ('手动阈值 ' + fmt(effEps, 3));
    out.push('<tr><th>差异模式</th><td>' + (state.mode === 'relative' ? '相对差 %' : '绝对差') + ' · ' + esc(epsDesc) + '</td></tr>');
    out.push('<tr><th>对比项 (' + others.length + ')</th><td>' + (others.length ?
      others.map(function (o) {
        return esc(o.label || o.name) + ' [' + esc(o.srcFile) + ':' + o.startLine + ']' +
          (o.provisional ? ' <b>（三轴表 · 仅第一层）</b>' : '');
      }).join('<br>') : '无') + '</td></tr>');
    out.push('</tbody></table></section>');

    /* 统一章节计数器：新增章节只需 ++sec，不会再出现编号重复 */
    var sec = 2;
    var allowDelta = (state.opts && typeof state.opts.allowDelta === 'number') ?
      state.opts.allowDelta : null;
    var summary = good.length ? C.summarizeDiff(good, { eps: effEps, allowDelta: allowDelta }) : null;
    var DIR = { increase: '整体抬高', decrease: '整体压低', mixed: '有升有降', flat: '无变化' };
    if (summary && summary.ok) {
      out.push('<section><h2>' + (++sec) + '. 对比摘要</h2>');
      out.push('<p class="hint">本节由差异自动汇总，只陈述改动模式、变化工况区间、体检结果与超差区间，' +
        '<b>供评审参考，不构成放行 / 驳回建议</b>。结论请在评审批注里由人给出。</p>');
      out.push('<div class="cards">' +
        card('主导模式', summary.patternLabel) +
        card('累计变化格', summary.totalChanged) +
        card('最大 |Δ|', fmt(summary.maxAbs), 'up') + '</div>');
      out.push('<ul>' + summary.lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>');
      out.push('<h3>逐项改动模式</h3>');
      out.push('<table class="tbl"><thead><tr><th>对比项</th><th>模式</th><th>方向</th><th>变化格</th>' +
        '<th>孤立点</th><th>趋势反转</th></tr></thead><tbody>');
      summary.per.forEach(function (p) {
        out.push('<tr><td>' + esc(p.label) + '</td><td>' + esc(p.patternLabel) + '</td><td>' +
          esc(DIR[p.direction] || p.direction) + '</td><td>' + p.changed + ' / ' + p.total +
          '</td><td>' + p.isolated + '</td><td>' + p.monotonic + '</td></tr>');
      });
      out.push('</tbody></table>');
      if (summary.allowDelta !== null && summary.exceedRegions.length) {
        out.push('<h3>超差工况区间（|Δ| &gt; ' + fmt(summary.allowDelta, 3) + '）</h3>');
        out.push('<table class="tbl"><thead><tr><th>对比项</th><th>X 区间</th><th>Y 区间</th>' +
          '<th>格数</th><th>max |Δ|</th></tr></thead><tbody>');
        summary.exceedRegions.forEach(function (e) {
          out.push('<tr><td>' + esc(e.label) + '</td><td>' + fmt(e.xFrom, 2) + ' ~ ' + fmt(e.xTo, 2) +
            ' ' + esc(e.units.x || '') + '</td><td>' + fmt(e.yFrom, 2) + ' ~ ' + fmt(e.yTo, 2) +
            ' ' + esc(e.units.y || '') + '</td><td>' + e.count + '</td><td>' + fmt(e.maxAbs) + '</td></tr>');
        });
        out.push('</tbody></table>');
      }
      var annObj = state.annotations || {};
      out.push('<h3>评审批注（可在本报告里直接编辑）</h3>');
      out.push('<p class="hint">另存 / 归档按钮与操作说明在报告顶部；下面的批注控件可逐项填写结论、意见、需求号、责任人。</p>');
      out.push('<div class="ann-list">');
      good.forEach(function (d) {
        var k = 'cmp:' + d.other.key, a = annObj[k] || {};
        out.push('<div class="ann-row"><span class="ann-name">' + esc(d.other.label || d.other.name) + '</span>' +
          '<select data-ann="' + esc(k) + '" data-field="verdict">' + annSelect(a.verdict || 'pending') + '</select>' +
          '<input data-ann="' + esc(k) + '" data-field="reason" placeholder="评审意见" value="' + esc(a.reason || '') + '">' +
          '<input data-ann="' + esc(k) + '" data-field="req" placeholder="需求号" value="' + esc(a.req || '') + '">' +
          '<input data-ann="' + esc(k) + '" data-field="owner" placeholder="责任人" value="' + esc(a.owner || '') + '">' +
          '</div>');
      });
      out.push('</div>');
      out.push('</section>');
    }

    if (state.versionScan && state.versionScan.length) {
      out.push('<section><h2>' + (++sec) + '. 跨版本全量变更清单</h2>');
      out.push('<p>同名对象逐格比对，仅列出有变化者；按变化格数降序。</p>');
      out.push('<table class="tbl"><thead><tr><th>#</th><th>名称</th><th>功能</th><th>维度</th><th>变化格</th><th>最大 |Δ|</th><th>来源行号</th></tr></thead><tbody>');
      state.versionScan.slice(0, 500).forEach(function (v, k) {
        out.push('<tr><td>' + (k + 1) + '</td><td>' + esc(v.name) + '</td><td>' + esc(v.funktion) + '</td><td>' +
          v.nx + '×' + v.ny + '</td><td>' + v.changed + '</td><td>' + fmt(v.maxAbs) + '</td><td>' +
          esc(v.srcA) + ':' + v.lineA + ' → ' + esc(v.srcB) + ':' + v.lineB + '</td></tr>');
      });
      out.push('</tbody></table>');
      if (state.versionScan.length > 500) out.push('<p class="hint">共 ' + state.versionScan.length + ' 项有变化，报告列出前 500 项。</p>');
      out.push('</section>');
    }

    if (good.length) {
      var pageSize = state.reportPageSize || 12;
      var fullList = good.slice(0, pageSize);
      var restList = good.slice(pageSize);
      out.push('<section><h2>' + (++sec) + '. 差异统计</h2>');
      if (restList.length) {
        out.push('<div class="warn"><b>报告规模</b>：共 ' + good.length + ' 项对比，前 ' + pageSize +
          ' 项完整展开，其余 ' + restList.length +
          ' 项以紧凑清单收录，避免单文件膨胀到几十 MB。用附录的会话 JSON 可在工具里复现任意一项的完整视图。</div>');
      }
      out.push('<div class="cards">');
      fullList.forEach(function (d) {
        out.push(card((d.other.label || d.other.name) + ' · 变化格', d.stats.changed + ' / ' + d.stats.total));
        out.push(card('变化占比', (d.stats.ratio * 100).toFixed(1) + '%'));
        out.push(card('最大 |Δ|', fmt(d.stats.maxAbs), 'up'));
        out.push(card('平均 |Δ|', fmt(d.stats.meanAbs)));
      });
      if (restList.length) {
        out.push(card('其余 ' + restList.length + ' 项变化格合计',
          restList.reduce(function (a, d) { return a + d.stats.changed; }, 0)));
      }
      out.push('</div>');
      if (good.some(function (d) { return d.interpolated; })) {
        out.push('<div class="warn"><b>注意：部分对比的轴刻度不一致，数值经双线性插值对齐到基准轴</b>，' +
          '这些结果不是原始逐格值，已在明细中标注。</div>');
      }
      out.push('</section>');

      out.push('<section><h2>' + (++sec) + '. 标定变更体检</h2>');
      out.push('<p class="hint">孤立突变点 = 变化格四邻域全未变，是误改的最强信号；趋势反转 = 对比项在相邻轴点之间把基准的递增/递减方向改反了。判定依据：' + esc(epsDesc) + '。</p>');
      fullList.forEach(function (d, k) {
        var ins = C.inspectDiff(d, { eps: effEps });
        var riskText = { high: '高', medium: '中', low: '低', none: '无变化' }[ins.risk] || ins.risk;
        out.push('<h3>' + (k + 1) + '. ' + esc(d.other.label || d.other.name) + ' · 风险 ' + riskText + '</h3>');
        out.push('<div class="cards">' +
          card('孤立突变点', ins.isolated.length, ins.isolated.length ? 'up' : '') +
          card('趋势反转 X / Y', ins.monoX.length + ' / ' + ins.monoY.length, ins.monotonic.length ? 'up' : '') +
          card('变化格', ins.changed) + '</div>');
        if (ins.isolated.length) {
          out.push('<table class="tbl"><thead><tr><th>Y 轴值</th><th>X 轴值</th><th>基准原值</th><th>对比原值</th><th>Δ</th></tr></thead><tbody>');
          ins.isolated.slice(0, 50).forEach(function (p) {
            out.push('<tr><td>' + fmt(p.y, 4) + '</td><td>' + fmt(p.x, 4) + '</td><td>' + fmt(p.a) +
              '</td><td>' + fmt(p.b) + '</td><td class="up">' + fmt(p.delta) + '</td></tr>');
          });
          out.push('</tbody></table>');
          if (ins.isolated.length > 50) out.push('<p class="hint">孤立点共 ' + ins.isolated.length + ' 个，列出前 50 个。</p>');
        }
        if (ins.monotonic.length) {
          out.push('<table class="tbl"><thead><tr><th>轴</th><th>固定值</th><th>反转区间</th><th>基准步长</th><th>对比步长</th></tr></thead><tbody>');
          ins.monotonic.slice(0, 50).forEach(function (p) {
            out.push('<tr><td>' + p.axis + '</td><td>' + fmt(p.fixedValue, 3) + '</td><td>' +
              fmt(p.from, 3) + ' → ' + fmt(p.to, 3) + '</td><td>' + fmt(p.baseStep) +
              '</td><td class="up">' + fmt(p.otherStep) + '</td></tr>');
          });
          out.push('</tbody></table>');
          if (ins.monotonic.length > 50) out.push('<p class="hint">趋势反转共 ' + ins.monotonic.length + ' 处，列出前 50 处。</p>');
        }
        if (!ins.isolated.length && !ins.monotonic.length) {
          out.push('<p class="ok">未发现孤立突变点或趋势反转。</p>');
        }
      });
      if (restList.length) {
        out.push('<h3>其余 ' + restList.length + ' 项体检摘要</h3>');
        out.push('<table class="tbl"><thead><tr><th>#</th><th>对比项</th><th>变化格</th><th>孤立点</th><th>趋势反转</th><th>风险</th></tr></thead><tbody>');
        restList.forEach(function (d, k) {
          var q = C.inspectDiff(d, { eps: effEps });
          out.push('<tr><td>' + (pageSize + k + 1) + '</td><td>' + esc(d.other.label || d.other.name) +
            '</td><td>' + q.changed + '</td><td>' + q.isolated.length + '</td><td>' + q.monotonic.length +
            '</td><td>' + esc({ high: '高', medium: '中', low: '低', none: '无变化' }[q.risk] || q.risk) + '</td></tr>');
        });
        out.push('</tbody></table>');
      }
      out.push('</section>');

      out.push('<section><h2>' + (++sec) + '. 差异热力矩阵与切面曲线</h2>');
      fullList.forEach(function (d, k) {
        out.push('<h3>' + (k + 1) + '. ' + esc(d.other.label || d.other.name) + ' vs 基准' +
          (d.interpolated ? '（已插值）' : '') +
          (d.other.provisional ? '（三轴表 · 仅第一层）' : '') + '</h3>');
        out.push(V.svgHeat(d, { mode: state.mode, eps: effEps,
          title: '差异热力矩阵 · ' + (d.other.label || d.other.name), onlyChanged: opts.onlyChanged }));
        out.push('<p class="hint">X ' + esc(d.base.units.x) + ' · Y ' + esc(d.base.units.y) + ' · Z ' + esc(d.base.units.w) +
          ' · 变化区域 ' + (d.stats.bbox ? 'X[' + d.stats.bbox.minI + '..' + d.stats.bbox.maxI + '] Y[' +
            d.stats.bbox.minJ + '..' + d.stats.bbox.maxJ + ']' : '无') + '</p>');
      });
      if (restList.length) {
        out.push('<details><summary>其余 ' + restList.length + ' 项对比 · 紧凑清单（点击展开）</summary>');
        out.push('<table class="tbl"><thead><tr><th>#</th><th>对比项</th><th>变化格</th><th>最大 |Δ|</th><th>孤立点</th><th>风险</th></tr></thead><tbody>');
        restList.forEach(function (d, k) {
          var q = C.inspectDiff(d, { eps: effEps });
          out.push('<tr><td>' + (pageSize + k + 1) + '</td><td>' + esc(d.other.label || d.other.name) +
            '</td><td>' + d.stats.changed + ' / ' + d.stats.total + '</td><td>' + fmt(d.stats.maxAbs) +
            '</td><td>' + q.isolated.length + '</td><td>' +
            esc({ high: '高', medium: '中', low: '低', none: '无变化' }[q.risk] || q.risk) + '</td></tr>');
        });
        out.push('</tbody></table><p class="hint">这 ' + restList.length +
          ' 项不展开完整热力图与逐格明细，用附录会话 JSON 在工具里可复现任意一项。</p></details>');
      }
      out.push('<h3>切面曲线叠加（基准 + 前 ' + fullList.length + ' 项对比）</h3>');
      out.push(V.svgCurves(base, fullList, { axis: (opts.curve || {}).axis, index: (opts.curve || {}).index }));
      out.push('</section>');

      out.push('<section><h2>' + (++sec) + '. 3D 曲面（单对 + N 张批量）</h2>');
      out.push('<p class="hint">三轴均标注真实数值刻度：X / Y 为 DCM 里的轴断点值与单位，Z 为值域刻度（差曲面与包络曲面为 Δ）。底板浅色网格对应 X / Y 刻度，悬停面片显示该格坐标、原值与来源。</p>');
      /* 不传 scale：让视图按投影范围自适应，写死数值会把顶/底切掉 */
      var so = { yaw: 0.72, pitch: 0.86 };
      var first = good[0];
      out.push('<h3>单对 · 差曲面 (Z = Δ)</h3>');
      out.push(V.svgSurface(first, Object.assign({}, so, { surfaceMode: 'diff' })));
      out.push('<h3>单对 · 基准 + 对比曲面叠加</h3>');
      out.push(V.svgSurface(first, Object.assign({}, so, { surfaceMode: 'both' })));
      out.push('<h3>A · 最大偏差包络曲面（Z = 各对比 max|Δ| 的有符号值）</h3>');
      out.push(V.svgEnvelopeSurface(good, Object.assign({}, so, { colorBy: 'delta' })));
      out.push('<p class="hint">右侧列出各表成为「峰值来源」的格数；下图改按来源表着色。</p>');
      out.push('<h3>A · 包络曲面按来源表着色</h3>');
      out.push(V.svgEnvelopeSurface(good, Object.assign({}, so, { colorBy: 'source' })));
      out.push('<h3>B · 曲面小多图（统一 Z 值域与色标）</h3>');
      out.push(V.svgSurfaceGrid(good, Object.assign({}, so, { limit: Math.min(9, good.length + 1) })));
      if (good.length + 1 > 9) {
        out.push('<p class="hint">共 ' + (good.length + 1) + ' 张，本图仅画前 9 张；其余 ' +
          (good.length + 1 - 9) + ' 张请在工具界面调「张数」查看，或用上面的 A 包络曲面看全局峰值。</p>');
      }
      out.push('<h3>C · N 张曲面叠加 · 拉开距离</h3>');
      out.push(V.svgSurfaceStack(good, Object.assign({}, so, { layout: 'spaced', gap: 0.45, maxSurfaces: 6 })));
      if (good.length + 1 > 6) {
        out.push('<p class="hint">共 ' + (good.length + 1) + ' 层，本图仅叠加前 6 层；其余请在工具界面调「张数」或逐层查看。</p>');
      }
      out.push('<h3>C · N 张曲面叠加 · 默认叠加</h3>');
      out.push(V.svgSurfaceStack(good, Object.assign({}, so, { layout: 'overlay', opacity: 0.5, maxSurfaces: 6 })));
      var probeI = Math.floor(first.nx / 2);
      out.push('<h3>定位示例 · X = ' + fmt(first.x[probeI], 3) + ' ' + esc(first.base.units.x || '') + ' 的切面高亮</h3>');
      out.push('<p class="hint">橙色描边为该 X 值对应的曲面带，用于直观对比「某一个轴在某一个值时」的差异。</p>');
      out.push(V.svgEnvelopeSurface(good, Object.assign({}, so, {
        highlight: { axis: 'x', i: probeI, j: 0 }
      })));
      out.push('</section>');

      out.push('<section><h2>' + (++sec) + '. 跨版本剖面</h2>');
      if (R.cube && R.cube.labels.length > 1) {
        var prof = opts.profile || {};
        out.push('<p class="hint">取一个工况格，画出它在对比清单各层（同名表的不同版本 / 同轴多模式表）上的取值。' +
          '虚线为基准层的值，曲线整体在虚线上方就是这一列被抬高了。</p>');
        out.push(V.svgProfile(R.cube, prof.i || 0, prof.j || 0, { units: base.units }));
        out.push('<table class="tbl"><thead><tr><th>层</th><th>MAP</th><th>来源</th></tr></thead><tbody>');
        R.cube.labels.forEach(function (l, k) {
          var m = k === 0 ? base : (others.filter(function (o) { return (o.label || o.name) === l; })[0] || {});
          out.push('<tr><td>L' + (k + 1) + (k === 0 ? ' 基准' : '') + '</td><td>' + esc(l) + '</td><td>' +
            esc(m.srcFile || '') + ':' + (m.startLine || '-') + '</td></tr>');
        });
        out.push('</tbody></table>');
        out.push('<p class="hint">第三维 = 对比清单中的 MAP 顺序（同轴多模式表或不同 DCM 版本的同名表）。</p>');
      } else out.push('<p class="hint">对比清单不足 2 层，未生成剖面。</p>');
      out.push('</section>');

      out.push('<section><h2>' + (++sec) + '. 逐格明细（证据）</h2>');
      fullList.forEach(function (d, k) {
        out.push('<h3>' + (k + 1) + '. ' + esc(d.other.label || d.other.name) + '</h3>');
        out.push(V.tableHtml(d, { onlyChanged: opts.onlyChanged !== false, limit: 1500 }));
      });
      if (restList.length) {
        out.push('<p class="hint">其余 ' + restList.length +
          ' 项的逐格明细未展开（见上节紧凑清单）；用附录会话 JSON 在工具里查看任意一项的完整明细。</p>');
      }
      out.push('</section>');
    } else {
      out.push('<section><h2>' + (++sec) + '. 结果</h2><p>对比清单中没有可执行的对比，或全部被拒绝。</p></section>');
    }

    if (bad.length) {
      out.push('<section><h2>被拒绝的对比</h2><ul>');
      bad.forEach(function (d) { out.push('<li>' + esc(d.other.label || d.other.name) + '：' + esc(d.reason) + '</li>'); });
      out.push('</ul></section>');
    }

    if (R.cube && R.cube.skipped && R.cube.skipped.length) {
      out.push('<section><h2>未纳入第三维的对象</h2><ul>');
      R.cube.skipped.forEach(function (s) { out.push('<li>' + esc(s.name) + '：' + esc(s.reason) + '</li>'); });
      out.push('</ul></section>');
    }

    var session = state.sessionJson || (function () {
      try {
        return JSON.stringify({
          format: 'DCM_MAP_SESSION', version: 1, toolVersion: state.toolVersion || '',
          sources: (state.datasets || []).map(function (d) {
            return { fileName: d.fileName, objects: d.maps.length, blocks: d.stats.totalBlocks };
          }),
          basket: (state.result ? [state.result.base].concat(state.result.others) : []).map(function (m) {
            return { name: m.name, srcFile: m.srcFile, axisSig: m.axisSig, nx: m.nx, ny: m.ny };
          }),
          baseIndex: 0,
          config: {
            mode: state.mode, eps: state.eps, autoThreshold: !!state.autoThreshold,
            effectiveEps: effEps,
            view: state.view, opts: state.opts || {}
          }
        }, null, 2);
      } catch (e) { return '{}'; }
    })();
    if (state.axisScan && state.axisScan.ok && state.axisScan.total) {
      out.push('<section><h2>附录：轴变更影响面</h2>');
      out.push('<p class="hint">按完整轴指纹（维度 + X + Y 数值）分桶，用两版引用表名称重合度配对。改一根轴会影响同组的全部表，不是只影响显式写了 <code>*SSTX</code> 的那一张。</p>');
      state.axisScan.pairs.forEach(function (p) {
        out.push('<h3>' + esc(p.fileA) + ' → ' + esc(p.fileB) + ' · ' + p.changedAxes.length + ' 根轴变化</h3>');
        if (!p.changedAxes.length) { out.push('<p class="hint">未发现轴断点变化。</p>'); return; }
        out.push('<table class="tbl"><thead><tr><th>轴</th><th>维度</th><th>变化类型</th><th>说明</th>' +
          '<th>风险</th><th>受影响表数</th></tr></thead><tbody>');
        p.changedAxes.forEach(function (a) {
          out.push('<tr><td>' + a.axis + '</td><td>' + esc(a.dims) + '</td><td>' + esc(a.changeType) +
            '</td><td>' + esc(a.detail) + '</td><td>' + (a.risk === 'high' ? '高' : '中') +
            '</td><td class="up">' + a.affected.length + '</td></tr>');
        });
        out.push('</tbody></table>');
        p.changedAxes.forEach(function (a) {
          out.push('<details><summary>' + a.axis + ' 轴 · ' + esc(a.changeType) + ' · 受影响表清单（' +
            a.affected.length + ' 张）</summary><table class="tbl"><thead><tr><th>名称</th><th>来源</th>' +
            '<th>维度</th><th>功能</th></tr></thead><tbody>');
          a.affected.forEach(function (m) {
            out.push('<tr><td>' + esc(m.name) + '</td><td>' + esc(m.srcFile) + ':' + m.startLine +
              '</td><td>' + m.nx + '×' + m.ny + '</td><td>' + esc(m.funktion || '') + '</td></tr>');
          });
          out.push('</tbody></table></details>');
        });
      });
      out.push('</section>');
    }
    if (state.renameScan && state.renameScan.ok && state.renameScan.total) {
      var rs = state.renameScan.settings || {};
      out.push('<section><h2>附录：改名对齐候选</h2>');
      out.push('<p class="hint">跨版本重命名检测：只给候选，<b>不自动合并</b>，需人工确认后纳入对比。阈值 最低总分 ' +
        fmt(rs.minScore || 0.72, 2) + ' / 最低相同格率 ' + fmt(rs.minValueSim || 0.75, 2) +
        ' / 最低名称相似度 ' + fmt(rs.minNameSim || 0.25, 2) + '。</p>');
      state.renameScan.pairs.forEach(function (p) {
        out.push('<h3>' + esc(p.fileA) + ' → ' + esc(p.fileB) + ' · 精确同名 ' + p.exact +
          ' 组 / 仅 A ' + p.onlyA + ' 项 / 仅 B ' + p.onlyB + ' 项 / 候选 ' + p.candidates.length + ' 组</h3>');
        if (!p.candidates.length) { out.push('<p class="hint">该版本对未发现改名候选。</p>'); return; }
        out.push('<table class="tbl"><thead><tr><th>A 名称</th><th>B 名称</th><th>维度</th><th>相同格率</th>' +
          '<th>名称相似</th><th>总分</th><th>置信度</th><th>判定依据</th></tr></thead><tbody>');
        p.candidates.forEach(function (c) {
          out.push('<tr><td>' + esc(c.a.name) + '</td><td>' + esc(c.b.name) + '</td><td>' + c.a.nx + '×' + c.a.ny +
            '</td><td>' + (c.valueSim * 100).toFixed(1) + '%</td><td>' + c.nameSim.toFixed(3) +
            '</td><td>' + c.score.toFixed(3) + '</td><td>' +
            esc({ high: '高', medium: '中', low: '低' }[c.confidence] || c.confidence) +
            '</td><td>' + c.reasons.map(esc).join('<br>') + '</td></tr>');
        });
        out.push('</tbody></table>');
      });
      out.push('</section>');
    }
    out.push('<section><h2>附录：会话配置 JSON</h2>');
    out.push('<p class="hint">复制下面内容存为 .json，用工具的「载入会话」即可复现本次对比清单、基准、阈值与视角。也可直接点工具右上角「保存会话」。</p>');
    out.push('<details><summary>展开 / 收起会话 JSON</summary><pre style="font-size:11px;line-height:1.5;overflow:auto;background:#F1EFE8;padding:12px;border-radius:8px">' +
      esc(session) + '</pre></details></section>');
    out.push('<footer><span class="foot-attr">本报告由 Henry 开发的 DCM MAP 对比工具生成，供标定评审使用；请保留署名，未经许可请勿转售或二次分发。</span>' +
      '<span class="foot-meta">所有图表为内联 SVG 矢量，可缩放、可复制。' +
      '差异规则：轴完全一致逐格相减；同维度但轴刻度不同则双线性插值并显式标记；维度不同直接拒绝。</span></footer>');
    var annJson = JSON.stringify(state.annotations || {}).replace(/</g, '\\u003c');
    out.push('<script id="dcm-ann-data" type="application/json">' + annJson + '</script>');
    out.push('<script>' + annotationJs() + '</script>');
    out.push('</main></body></html>');
    return out.join('\n');
  }

  /* ---------- 全量变化清单报告 ---------- */
  function auditBadge(st) {
    var tone = (st === 'changed' || st === 'added') ? 'up' :
      ((st === 'rejected' || st === 'deleted') ? 'warn' : '');
    return '<span class="badge ' + tone + '">' + esc(C.STATUS_LABEL[st] || st) + '</span>';
  }

  function auditAnnRow(e, annObj) {
    var k = e.id, a = annObj[k] || {};
    return '<div class="ann-row"><span class="ann-name">' + esc(e.name) +
      ' <span class="hint" style="margin:0">' + esc(e.typeLabel) + '</span></span>' +
      '<select data-ann="' + esc(k) + '" data-field="verdict">' + annSelect(a.verdict || 'pending') + '</select>' +
      '<input data-ann="' + esc(k) + '" data-field="reason" placeholder="评审意见" value="' + esc(a.reason || '') + '">' +
      '<input data-ann="' + esc(k) + '" data-field="req" placeholder="需求号" value="' + esc(a.req || '') + '">' +
      '<input data-ann="' + esc(k) + '" data-field="owner" placeholder="责任人" value="' + esc(a.owner || '') + '">' +
      '</div>';
  }

  /* 变化项的证据：按对象类型出图 / 出表，不把标量塞进二维表头。 */
  function auditEvidence(e, state, annObj, withReview, extraHtml) {
    var review = withReview !== false;
    var s = ['<div class="evd"><h4>' + esc(e.name) + ' · ' + esc(e.typeLabel) +
      ' · ' + esc(e.dims) + '</h4>'];
    if (extraHtml) s.push(extraHtml);
    s.push('<p class="hint">A ' + esc(e.srcA || '—') + ':' + (e.lineA || '—') +
      ' → B ' + esc(e.srcB || '—') + ':' + (e.lineB || '—') +
      '　单位 ' + esc(e.units || '（空）') +
      (e.stats && e.stats.interpolated ? '　<b>已插值对齐</b>' : '') + '</p>');
    if (e.inspect && e.inspect.note) {
      s.push('<p class="hint"><b>判定口径</b>：' + esc(e.inspect.note) + '</p>');
    }
    if (e.analysis) {
      s.push('<p class="hint">改动模式 <b>' + esc(e.analysis.patternLabel) + '</b>' +
        ' · 孤立点 ' + (e.inspect ? e.inspect.isolated.length : 0) +
        ' · 趋势反转 ' + (e.inspect ? e.inspect.monotonic.length : 0) +
        ' · max|Δ| ' + fmt(e.stats ? e.stats.maxAbs : 0) + '</p>');
    }
    if (e.axisSeries) {
      s.push('<p class="hint">两版轴断点序列对照（' + esc(e.axisSeries.kind) + '）：</p>');
      var au = e.units ? ' <span class="unit">(' + esc(e.units) + ')</span>' : '';
      s.push('<div class="tbl-wrap"><div class="dcm-tbl-cap"><b>断点序列</b> · A ' +
        e.axisSeries.a.length + ' 个 → B ' + e.axisSeries.b.length + ' 个</div>' +
        '<table class="detail dcm-tbl"><thead><tr><th class="num">断点序号</th>' +
        '<th class="num">A 版断点值' + au + '</th><th class="num">B 版断点值' + au +
        '</th><th class="num">Δ</th></tr></thead><tbody>');
      var sn = Math.max(e.axisSeries.a.length, e.axisSeries.b.length);
      for (var sk = 0; sk < sn; sk++) {
        var hasA = sk < e.axisSeries.a.length, hasB = sk < e.axisSeries.b.length;
        var aS = hasA ? fmt(e.axisSeries.a[sk]) : '—';
        var bS = hasB ? fmt(e.axisSeries.b[sk]) : '—';
        var dlt = (hasA && hasB) ? (e.axisSeries.b[sk] - e.axisSeries.a[sk]) : null;
        var changed = !(hasA && hasB) || Math.abs(dlt) > 1e-9;
        var tone = dlt !== null && changed ? (dlt > 0 ? 'up' : 'down') : '';
        s.push('<tr class="' + (changed ? 'chg' : 'eq') + '"><td class="num">' + sk +
          '</td><td class="num">' + esc(aS) + '</td><td class="num">' + esc(bS) +
          '</td><td class="' + (tone ? 'num ' + tone : 'num') + '">' +
          (dlt === null ? '—' : esc(fmt(dlt))) + '</td></tr>');
      }
      s.push('</tbody></table></div>');
    }
    if (e.diff) {
      var eps = e.eps || state.effectiveEps || state.eps;
      if (e.type === 'array' || e.type === 'curve' || e.type === 'axis') {
        // 标题按类型分开：类型分章里的数组/曲线不该带「断点/序列」这种轴定义专用字样
        var pTitle = e.type === 'axis' ? '断点/序列 Δ 剖面' :
          (e.type === 'curve' ? 'X 轴 Δ 剖面' : '元素序列 Δ 剖面');
        s.push(V.svgDeltaProfile(e.diff, { title: e.name + ' · ' + pTitle }));
      } else if (e.type === 'map2d') {
        s.push(V.svgHeat(e.diff, { mode: state.mode, eps: eps,
          title: e.name + ' · 差异热力矩阵' }));
      }
      s.push(V.tableHtmlTyped(e.diff, { onlyChanged: false, eps: eps, limit: 400 }));
    } else if (e.reason) {
      s.push('<div class="warn">' + esc(e.reason) + '</div>');
    }
    // 证据与评审框在同一起输出：每个账目 id 恰好一组控件，不跨章节重复。
    // withReview=false 仅作扩展位保留，不再输出过时的「评审见某章」跨章节指引。
    if (review) s.push(auditAnnRow(e, annObj));
    s.push('</div>');
    return s.join('');
  }

  /* 新增 / 删除 / 被拒绝项与数值变更一样可评审：给出单侧数据摘要 + 同一套批注控件。 */
  function auditSpecialReview(e, annObj) {
    var s = ['<div class="evd"><h4>' + auditBadge(e.status) + ' ' + esc(e.name) +
      ' · ' + esc(e.typeLabel) + ' · ' + esc(e.dims) + '</h4>'];
    s.push('<p class="hint">' + esc(e.reason || '') +
      '　A ' + esc(e.srcA || '—') + ':' + (e.lineA || '—') +
      ' → B ' + esc(e.srcB || '—') + ':' + (e.lineB || '—') + '</p>');
    var side = e.a || e.b;
    if (side) {
      var desc;
      if (side.value !== null && side.value !== undefined && isFinite(side.value)) {
        desc = '单值 ' + fmt(side.value) + ' ' + esc(e.units || '');
      } else if (side.values && side.values.length) {
        desc = '单侧数据（前 ' + Math.min(8, side.values.length) + ' 点）：' +
          side.values.slice(0, 8).map(function (v) { return fmt(v); }).join(', ') +
          (side.values.length > 8 ? ' …' : '');
      } else {
        desc = '维度 ' + esc(e.dims) + '，单位 ' + esc(e.units || '（空）');
      }
      s.push('<p class="hint">' + desc + '　功能 ' + esc(e.funktion || '—') + '</p>');
    }
    s.push('<p class="hint">未做改名配对；若这是版本升级改名，请在「B 版删除」与「B 版新增」两侧分别写明结论。</p>');
    s.push(auditAnnRow(e, annObj));
    s.push('</div>');
    return s.join('');
  }

  /* 未变化项不列清单：只保留计数与完整性对账，报告体积和阅读负担都靠这条控制。 */
  function buildAudit(state, audit) {
    var now = new Date();
    var stamp = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' +
      pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
    var out = [];
    // 报告唯一标识：批注按报告隔离地持久化在本机，重新打开自动恢复
    var reportId = stamp.replace(/\D/g, '') + '-' + Math.random().toString(36).slice(2, 9);
    out.push('<!DOCTYPE html><html lang="zh-CN" data-dcm-report-id="' + esc(reportId) +
      '"><head><meta charset="utf-8">');
    out.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
    out.push('<title>DCM 全量变化清单报告 ' + stamp + '</title>');
    out.push('<style>' + css() + '</style></head><body>');
    out.push('<header class="rhead"><h1>DCM 全量变化清单报告</h1><p>生成时间 ' + stamp +
      ' · 自包含离线文件，无外部依赖 · 对账全部标定量，只输出变化项 · 数据未上传' +
      ' · 作者 Henry · 供标定评审使用' + toolVer(state) + '</p></header>');
    out.push('<main>');
    if (!audit || !audit.ok) {
      out.push('<section><h2>清单不可用</h2><div class="warn">' +
        esc((audit && audit.reason) || '未生成账本') + '</div></section></main></body></html>');
      return out.join('\n');
    }
    out.push(annTopbar('audit'));
    var t = audit.totals, c = t.counts, annObj = state.annotations || {};
    var sec = 0;

    /* 1. 数据源与解析自检 */
    sec++;
    out.push('<section><h2>' + sec + '. 数据源与解析自检</h2>');
    out.push('<table class="tbl"><thead><tr><th>文件</th><th>编码</th><th>块数</th>' +
      '<th>数值标定量</th><th>轴定义（计入账本）</th><th>账目对象合计</th><th>异常块</th></tr></thead><tbody>');
    (state.datasets || []).forEach(function (ds) {
      var nAxis = (ds.axisDefs || []).length;
      out.push('<tr><td>' + esc(ds.fileName) + '</td><td>' + esc(ds.encoding || '') + '</td><td>' +
        ds.stats.totalBlocks + '</td><td>' + ds.maps.length + '</td><td>' + nAxis + '</td><td><b>' +
        (ds.maps.length + nAxis) + '</b></td><td class="' + (ds.stats.invalid ? 'up' : '') + '">' +
        ds.stats.invalid + '</td></tr>');
    });
    out.push('</tbody></table>');
    out.push('<p class="hint">轴定义与数值标定量一样进入账本、参与完整性恒等式与变化清单；' +
      '上表「账目对象合计」= 数值标定量 + 轴定义，等于每个版本侧的覆盖数。</p>');
    var kinds = {};
    (state.datasets || []).forEach(function (ds) {
      Object.keys(ds.stats.byKind).forEach(function (k) { kinds[k] = (kinds[k] || 0) + ds.stats.byKind[k]; });
    });
    out.push('<details><summary>顶层块类型清单（全量扫描结果，不是写死的结论）</summary>' +
      '<table class="tbl"><thead><tr><th>块类型</th><th>数量</th></tr></thead><tbody>' +
      Object.keys(kinds).sort().map(function (k) {
        return '<tr><td>' + esc(k) + '</td><td>' + kinds[k] + '</td></tr>';
      }).join('') + '</tbody></table></details>');
    var warns = [];
    (state.datasets || []).forEach(function (ds) {
      ds.warnings.forEach(function (w) { warns.push(esc(ds.fileName) + ' · ' + esc(w)); });
      ds.unknowns.slice(0, 20).forEach(function (u) {
        warns.push(esc(ds.fileName) + ':' + u.line + ' 未识别: ' + esc(u.text));
      });
    });
    if (warns.length) {
      out.push('<div class="warn"><b>解析告警 ' + warns.length + ' 条</b><ul><li>' +
        warns.join('</li><li>') + '</li></ul></div>');
    } else {
      out.push('<p class="ok">解析自检通过：所有块的声明维度与 ST/X、ST/Y、WERT 实际点数一致，无异常块，无未识别顶层关键字。</p>');
    }
    var has3d = Object.keys(kinds).some(function (k) { return /3D$/.test(k) && kinds[k] > 0; });
    out.push('<p class="hint">三轴查找表（依据上表全量扫描）：' +
      (has3d ? '<b>检出三轴表块</b>，该格式未经实测，仅解析第一层二维数据，已明确排除出对比账本。' :
        '本次数据源未检出三轴表块。') +
      ' 轴定义已作为正式标定量计入账本与变化清单，不是附录、不单独排除。</p>');
    out.push('</section>');

    /* 2. 完整性对账 + 全量变化摘要：先给数字，再给逐版本证据。
       两节原本分开，读者要先翻一页才看到「到底变了什么」；合并后一屏内完成
       「核对过每一项」与「变了哪些」两件事。 */
    sec++;
    out.push('<section><h2>' + sec + '. 完整性对账与全量变化摘要</h2>');
    out.push('<h3>完整性对账</h3>');
    out.push('<p class="hint">每个 A 版对象与每个 B 版对象都必须恰好归属一条账目。' +
      '恒等式：有变化 + 未变化 + B 版新增 + B 版删除 + 被拒绝 = 账目总数；' +
      '且 A 侧覆盖数 = A 对象数、B 侧覆盖数 = B 对象数。未变化项只在此计数，不列清单。</p>');
    out.push('<div class="cards">' +
      card('账目总数', t.total) + card('有变化', c.changed, c.changed ? 'up' : '') +
      card('B 版新增', c.added, c.added ? 'up' : '') +
      card('B 版删除', c.deleted, c.deleted ? 'up' : '') +
      card('被拒绝', c.rejected, c.rejected ? 'up' : '') +
      card('未变化（仅计数）', c.unchanged) +
      card('累计变化数据点', t.changedCells) +
      card('最大 |Δ|', fmt(t.maxAbs), 'up') +
      card('完整性校验', audit.identity.ok ? '通过' : '未通过', audit.identity.ok ? '' : 'up') +
      '</div>');
    out.push('<h3>全量变化摘要</h3>');
    out.push('<ul>' + audit.summary.lines.map(function (l) {
      return '<li>' + esc(l) + '</li>';
    }).join('') + '</ul>');
    out.push('<p class="hint">本页只陈述「有哪些变化」，<b>不生成放行、驳回或处置建议</b>。' +
      '体检按对象类型分派：标量无邻域与沿轴趋势，孤立突变点与趋势反转判据不适用；' +
      '一维数值对象只看左右邻域与 X 方向趋势；二维 MAP 保留四邻域与双轴判定；' +
      '轴定义是断点序列，按逐点 Δ + 改后单调性判定，不套用孤立突变点判据。' +
      '未做改名配对，改名对象分别列在 B 版新增与 B 版删除中。</p>');
    out.push('<h3>逐版本对账证据</h3>');
    out.push('<table class="tbl"><thead><tr><th>版本对</th><th>A 对象</th><th>B 对象</th><th>账目</th>' +
      '<th>状态分项之和</th><th>A 覆盖</th><th>B 覆盖</th><th>校验</th></tr></thead><tbody>');
    audit.pairs.forEach(function (p) {
      var sum = 0;
      Object.keys(p.counts).forEach(function (k) { sum += p.counts[k]; });
      out.push('<tr><td>' + esc(p.fileA) + ' → ' + esc(p.fileB) + '</td><td>' + p.aTotal +
        '</td><td>' + p.bTotal + '</td><td>' + p.entries.length + '</td><td>' + sum +
        '</td><td>' + p.identity.aCovered + '/' + p.identity.aTotal + '</td><td>' +
        p.identity.bCovered + '/' + p.identity.bTotal + '</td><td class="' +
        (p.identity.ok ? '' : 'up') + '">' + (p.identity.ok ? '通过' : '未通过') + '</td></tr>');
    });
    out.push('</tbody></table>');
    out.push('<p class="hint">' + esc(audit.identity.detail) + '</p>');
    if (!audit.identity.ok) {
      out.push('<div class="warn"><b>完整性校验未通过：账本存在缺口，本清单不覆盖全部对象。</b></div>');
    }
    out.push('</section>');

    /* 3. 按对象类型分章 + 变化项证据 */
    sec++;
    out.push('<section><h2>' + sec + '. 按对象类型分章与变化证据</h2>');
    out.push('<table class="tbl"><thead><tr><th>类型</th><th>账目数</th><th>有变化</th>' +
      '<th>B 版新增</th><th>B 版删除</th><th>被拒绝</th><th>max |Δ|</th></tr></thead><tbody>');
    Object.keys(t.byType).forEach(function (k) {
      var g = t.byType[k];
      out.push('<tr><td>' + esc(g.label) + '</td><td>' + g.total + '</td><td>' + g.changed +
        '</td><td>' + g.added + '</td><td>' + g.deleted + '</td><td>' + g.rejected +
        '</td><td>' + fmt(g.maxAbs) + '</td></tr>');
    });
    out.push('</tbody></table>');
    out.push('<p class="hint">上表是全部类型的总览对账（含轴定义）。' +
      '<b>轴定义的分章统计、断点变化类型、完整证据与评审批注统一放在「轴定义断点变化类型」一节</b>，' +
      '本章只展开数值标定量（标量 / 数组 / 曲线 / MAP）。</p>');
    var maxEvidence = 12, evidenceCount = 0;
    ['scalar', 'array', 'curve', 'map2d', 'map3d'].forEach(function (ty) {
      var g = t.byType[ty];
      if (!g) return;
      var list = audit.entries.filter(function (e) { return e.type === ty; });
      // 断点增删没有逐点 diff 矩阵，但有 axisSeries 序列对照；不能因为 diff 为 null 就把变化项漏掉
      var changed = list.filter(function (e) { return e.hasChange && (e.diff || e.axisSeries); });
      var added = list.filter(function (e) { return e.status === 'added'; });
      var deleted = list.filter(function (e) { return e.status === 'deleted'; });
      var rejected = list.filter(function (e) { return e.status === 'rejected'; });
      out.push('<h3>' + esc(g.label) + ' · ' + g.total + ' 项（变化 ' + g.changed +
        '，新增 ' + added.length + '，删除 ' + deleted.length +
        '，被拒绝 ' + rejected.length +
        '，未变化 ' + (g.total - g.changed - added.length - deleted.length - rejected.length) +
        '（仅计数））</h3>');
      if (ty === 'scalar') {
        out.push('<p class="hint">标量是单值，没有工况区间与邻域：证据表给出 A 值 / B 值 / Δ / 相对差，' +
          '不画 3D 曲面，也不判孤立突变点。相对差在基准为 0 时显示「基准为 0」。</p>');
      } else if (ty === 'array' || ty === 'curve') {
        out.push('<p class="hint">一维对象用「Δ 沿 ' +
          (ty === 'curve' ? '真实 X 轴' : '元素索引') + '」剖面图 + 按类型表头的证据表；' +
          '横轴标真实数值，不是网格索引（数组本身无真实轴时为索引）。</p>');
      }
      if (!changed.length) {
        out.push('<p class="ok">该类型没有数值变化项；所有对象均已在账本中核对。</p>');
        return;
      }
      changed.slice(0, maxEvidence).forEach(function (e) {
        evidenceCount++;
        out.push(auditEvidence(e, state, annObj));
      });
      if (changed.length > maxEvidence) {
        out.push('<details class="audit-fold"><summary>其余 ' + (changed.length - maxEvidence) +
          ' 项变化（紧凑清单，点击展开）</summary><table class="tbl"><thead><tr><th>名称</th>' +
          '<th>状态</th><th>变化</th><th>max |Δ|</th><th>改动模式</th><th>来源行号</th></tr></thead><tbody>');
        changed.slice(maxEvidence, maxEvidence + 500).forEach(function (e) {
          out.push('<tr><td>' + esc(e.name) + '</td><td>' + auditBadge(e.status) +
            '</td><td>' + (e.stats ? e.stats.changed + ' / ' + e.stats.total : '—') +
            '</td><td>' + fmt(e.stats ? e.stats.maxAbs : 0) + '</td><td>' +
            esc(e.patternLabel || '—') + '</td><td class="hint">' +
            esc((e.srcA || '—') + ':' + (e.lineA || '—')) + ' → ' +
            esc((e.srcB || '—') + ':' + (e.lineB || '—')) + '</td></tr>');
        });
        out.push('</tbody></table></details>');
      }
    });
    out.push('<p class="hint">为避免报告膨胀，共展开 ' + evidenceCount +
      ' 项完整证据；其余变化项以紧凑清单给出名称、变化量与来源行号，可在工具里点「加入对比清单」逐项复现完整视图。</p>');
    out.push('</section>');

    /* 5. 新增 / 删除 / 被拒绝：显式列出，不做改名配对 */
    sec++;
    out.push('<section><h2>' + sec + '. 新增 / 删除 / 被拒绝对象</h2>');
    out.push('<p class="hint">方向以 <b>A 版 → B 版</b> 为准：<b>B 版新增</b>是只在 B 版出现的对象，' +
      '<b>B 版删除</b>是只在 A 版出现的对象。<b>未做改名配对</b>——版本升级把对象改名时，' +
      '旧名会出现在删除清单、新名出现在新增清单，请在这里人工对照。</p>');
    var special = audit.entries.filter(function (e) {
      return e.status === 'added' || e.status === 'deleted' || e.status === 'rejected';
    });
    if (!special.length) {
      out.push('<p class="ok">所有对象均成功同名配对，没有新增、删除或被拒绝项。</p>');
    } else {
      out.push('<div class="cards">' + card('B 版新增', c.added, c.added ? 'up' : '') +
        card('B 版删除', c.deleted, c.deleted ? 'up' : '') +
        card('被拒绝', c.rejected, c.rejected ? 'up' : '') + '</div>');
      out.push('<table class="tbl"><thead><tr><th>状态</th><th>A 名称</th><th>B 名称</th>' +
        '<th>类型</th><th>维度</th><th>原因 / 说明</th><th>来源行号</th></tr></thead><tbody>');
      special.slice(0, 500).forEach(function (e) {
        out.push('<tr><td>' + auditBadge(e.status) + '</td><td>' + esc(e.a ? e.a.name : '—') +
          '</td><td>' + esc(e.b ? e.b.name : '—') + '</td><td>' + esc(e.typeLabel) +
          '</td><td>' + esc(e.dims) + '</td><td>' + esc(e.reason || '—') + '</td><td class="hint">' +
          esc((e.srcA || '—') + ':' + (e.lineA || '—')) + ' → ' +
          esc((e.srcB || '—') + ':' + (e.lineB || '—')) + '</td></tr>');
      });
      out.push('</tbody></table>');
      if (special.length > 500) {
        out.push('<p class="hint">共 ' + special.length + ' 项，报告列出前 500 项；完整清单可在工具「全量变化清单」页签筛选查看。</p>');
      }
      out.push('<p class="hint">「被拒绝」给出可追溯原因（维度不同 / 轴断点不健康 / 三轴表未实测），不静默丢弃。</p>');
    }
    // 轴定义的新增/删除仍在上面的清单表里列出，但评审框集中到第 6 章，避免同一账目 id 出现两组控件
    var specialReviewList = special.filter(function (e) { return e.type !== 'axis'; });
    if (specialReviewList.length) {
      out.push('<h3>新增 / 删除 / 被拒绝对象评审</h3>');
      out.push('<p class="hint">这些项与数值变更一样需要评审：逐项写结论、意见、需求号、责任人，' +
        '随「导出归档报告」写入只读归档版；工具「全量变化清单」页签点「证据」也可填写。' +
        '<b>轴定义的新增 / 删除评审批注在「轴定义断点变化类型」一节集中填写</b>，本章只列清单。</p>');
      var maxReview = 24;
      specialReviewList.slice(0, maxReview).forEach(function (e) {
        out.push(auditSpecialReview(e, annObj));
      });
      if (specialReviewList.length > maxReview) {
        out.push('<p class="hint">共 ' + specialReviewList.length + ' 项，报告展开前 ' + maxReview +
          ' 项评审框；其余见上表，可在工具里逐项填写。</p>');
      }
    }
    out.push('</section>');

    /* 6. 轴定义断点变化类型（已计入账本，此处是分类明细，不是另外一份账） */
    sec++;
    out.push('<section><h2>' + sec + '. 轴定义断点变化类型</h2>');
    var axStat = t.byType.axis;
    if (axStat) {
      var axUnchanged = axStat.total - axStat.changed - axStat.added - axStat.deleted - axStat.rejected;
      out.push('<h3>' + esc(axStat.label) + ' · ' + axStat.total + ' 项（变化 ' + axStat.changed +
        '，新增 ' + axStat.added + '，删除 ' + axStat.deleted +
        '，被拒绝 ' + axStat.rejected + '，未变化 ' + axUnchanged + '（仅计数））</h3>');
    }
    out.push('<p class="hint">轴定义已作为正式标定量计入「完整性对账与全量变化摘要」的恒等式、' +
      '「按对象类型分章与变化证据」的类型总览表与「新增 / 删除 / 被拒绝对象」清单。' +
      '本章<b>集中承载轴定义的分章统计、断点变化类型分类、完整证据与评审批注</b>：' +
      '分类（刻度平移 / 断点增删 / 顺序改变 / 局部扰动）、断点序列对照、Δ 剖面图与逐点表，' +
      '以及数值变化、断点增删、B 版新增、B 版删除的逐项评审。类型分章不再展开轴定义、' +
      '新增/删除章节只列清单，避免同一账目 id 出现两组批注控件。此处不重复计数。</p>');
    out.push('<p class="hint">轴定义按断点序列逐点比较：证据表给出每个断点的 A 值 / B 值 / Δ，' +
      '并配一维 Δ 剖面图。<b>改单个断点是正常标定，不套用孤立突变点 / 趋势反转判据</b>；' +
      '改后断点是否仍单调、有无重复才是体检指标。断点数变化时给出两版序列对照表，按整项变化计入。</p>');
    audit.pairs.forEach(function (p) {
      var ap = p.axisAppendix;
      out.push('<h3>' + esc(p.fileA) + ' → ' + esc(p.fileB) + ' · A ' + ap.countA +
        ' 个 / B ' + ap.countB + ' 个 · 同名轴断点变化 ' + ap.changed.length + ' 根</h3>');
      if (!ap.changed.length) {
        out.push('<p class="hint">两版同名轴定义的断点数组完全一致。</p>');
      } else {
        out.push('<table class="tbl"><thead><tr><th>轴名称</th><th>变化类型</th><th>说明</th>' +
          '<th>断点数 A→B</th><th>行号 A / B</th></tr></thead><tbody>');
        ap.changed.forEach(function (a) {
          out.push('<tr><td>' + esc(a.name) + '</td><td>' + esc(a.changeType) + '</td><td>' +
            esc(a.detail) + '</td><td>' + a.countA + ' → ' + a.countB + '</td><td>' +
            (a.lineA || '—') + ' / ' + (a.lineB || '—') + '</td></tr>');
        });
        out.push('</tbody></table>');
      }
      // B 版新增 / A 版独有的轴定义：axisAppendix 只按 A 版名字扫，必须从这里补齐，
      // 否则「新增轴」在类型分类里凭空消失（新增/删除章节里有，但这里读者看不到）。
      var axisOnly = p.entries.filter(function (e) {
        return e.type === 'axis' && (e.status === 'added' || e.status === 'deleted');
      });
      if (axisOnly.length) {
        out.push('<p class="hint">只在一版存在的轴定义（已计入「新增 / 删除 / 被拒绝对象」清单）：</p>');
        out.push('<table class="tbl"><thead><tr><th>状态</th><th>轴名称</th><th>断点数</th>' +
          '<th>来源行号</th></tr></thead><tbody>');
        axisOnly.forEach(function (e) {
          out.push('<tr><td>' + auditBadge(e.status) + '</td><td>' + esc(e.name) +
            '</td><td>' + esc(e.dims) + '</td><td class="hint">' +
            esc((e.srcA || e.srcB || '—') + ':' + (e.lineA || e.lineB || '—')) + '</td></tr>');
        });
        out.push('</tbody></table>');
      }

      /* 本章集中评审：每个轴变化账目恰好一组批注控件，不与第 4 / 5 章重复 */
      var axisReview = p.entries.filter(function (e) {
        return e.type === 'axis' && e.status !== 'unchanged';
      });
      if (axisReview.length) {
        var typeByName = {};
        ap.changed.forEach(function (a) { typeByName[a.name] = a.changeType; });
        out.push('<h3>轴定义变化评审批注 · ' + axisReview.length + ' 项</h3>');
        out.push('<p class="hint">下面每项写结论 / 意见 / 需求号 / 责任人，' +
          '随「导出归档报告」写入只读归档版；工具「全量变化清单」页签点「证据」也可填写。</p>');
        axisReview.forEach(function (e) {
          var kind = e.axisSeries ? e.axisSeries.kind : (typeByName[e.name] ||
            (e.status === 'added' ? 'B 版新增' : (e.status === 'deleted' ? 'B 版删除' : '断点数值变化')));
          var extra = '<p class="hint">' + auditBadge(e.status) + ' · ' + esc(kind) +
            '　A ' + esc(e.srcA || '—') + ':' + (e.lineA || '—') +
            ' → B ' + esc(e.srcB || '—') + ':' + (e.lineB || '—') +
            '　单位 ' + esc(e.units || '（空）') + '</p>';
          if (e.reason) extra += '<p class="hint">' + esc(e.reason) + '</p>';
          var side = e.a || e.b;
          if (side && side.values && side.values.length) {
            extra += '<p class="hint">单侧断点值（前 ' + Math.min(8, side.values.length) + ' 点）：' +
              side.values.slice(0, 8).map(function (v) { return fmt(v); }).join(', ') +
              (side.values.length > 8 ? ' …' : '') + '</p>';
          }
          // 复用变化证据块：Δ 剖面图 / 序列对照表 / 逐点表 / 判定口径 / 评审框一次给全，
          // 且每个账目 id 只生成一组 data-ann 控件
          out.push(auditEvidence(e, state, annObj, true, extra));
        });
      } else {
        out.push('<p class="ok">该版本对没有轴定义变化，无需评审。</p>');
      }
    });
    out.push('<p class="hint">若需看「改一根轴波及多少张表」，用工具的「轴变更影响面」页签。</p>');
    out.push('</section>');

    /* 7. 范围与边界（未变化项只在此说明计数，不列清单） */
    /* 用户要求：未变化项完整清单不需要列出；全量审查只给变化项。 */
    sec++;
    out.push('<section><h2>' + sec + '. 清单范围与边界说明</h2>');
    out.push('<table class="tbl"><tbody>');
    var s = audit.settings;
    out.push('<tr><th>差异模式 / 阈值</th><td>' + (s.mode === 'relative' ? '相对差 %' : '绝对差') +
      ' · ' + (s.autoEps ? '按量纲自动阈值' : '手动阈值 ' + fmt(s.eps, 3)) + '</td></tr>');
    out.push('<tr><th>允许偏差</th><td>' + (s.allowDelta === null ? '未设置（不生成超差区间）' :
      fmt(s.allowDelta, 3)) + '</td></tr>');
    out.push('<tr><th>输出范围</th><td>只列有变化 / 新增 / 删除 / 被拒绝；<b>未变化 ' +
      c.unchanged + ' 项仅计数与完整性核对，不列清单</b></td></tr>');
    out.push('<tr><th>改名配对</th><td><b>未启用</b>：改名对象分别列在「B 版新增」与「B 版删除」，工具不猜测对应关系</td></tr>');
    out.push('<tr><th>结论建议</th><td><b>不生成</b>：本清单只陈述变化事实，不给放行 / 驳回 / 处置建议</td></tr>');
    out.push('<tr><th>版本比较方式</th><td>相邻版本两两比，共 ' + audit.pairs.length + ' 组；不做版本时间轴</td></tr>');
    out.push('<tr><th>轴定义</th><td><b>已作为正式标定量计入账本</b>：逐点比较断点值，断点增删按整项变化计入，' +
      '参与完整性恒等式与变化清单；轴定义断点变化章节只做变化类型分类，不重复计数</td></tr>');
    out.push('</tbody></table>');
    if (audit.warnings.length) {
      out.push('<div class="warn"><b>边界与告警</b><ul><li>' +
        audit.warnings.map(esc).join('</li><li>') + '</li></ul></div>');
    }
    out.push('<p class="hint">本报告不引入外部格式、不猜测三轴表结构、不联网、不写系统目录；' +
      '所有图表为内联 SVG 矢量。需要复现某一项的 3D 曲面 / 剖面等完整视图，用工具载入会话 JSON 后点「加入对比清单」。</p>');
    out.push('</section>');

    /* 会话配置 JSON */
    var session = state.sessionJson || (function () {
      try {
        return JSON.stringify({
          format: 'DCM_MAP_SESSION', version: 1, toolVersion: state.toolVersion || '',
          sources: (state.datasets || []).map(function (d) {
            return { fileName: d.fileName, objects: d.maps.length, blocks: d.stats.totalBlocks };
          }),
          basket: [], baseIndex: 0,
          config: { mode: state.mode, eps: state.eps, autoThreshold: !!state.autoThreshold,
            view: 'audit', opts: state.opts || {}, reportPageSize: state.reportPageSize }
        }, null, 2);
      } catch (e) { return '{}'; }
    })();
    out.push('<section><h2>附录：会话配置 JSON</h2>');
    out.push('<p class="hint">复制存为 .json，用工具「载入会话」可复现本次清单配置与筛选范围（需先载入相同 DCM）。</p>');
    out.push('<details><summary>展开 / 收起会话 JSON</summary><pre style="font-size:11px;line-height:1.5;overflow:auto;background:#F1EFE8;padding:12px;border-radius:8px">' +
      esc(session) + '</pre></details></section>');
    out.push('<footer><span class="foot-attr">本报告由 Henry 开发的 DCM MAP 对比工具生成，供标定评审使用；请保留署名，未经许可请勿转售或二次分发。</span>' +
      '<span class="foot-meta">DCM 全量变化清单报告 · 自包含离线 HTML · 全部标定量已对账，只输出变化项 · 未截屏未录屏</span></footer>');
    var annJson = JSON.stringify(state.annotations || {}).replace(/</g, '\\u003c');
    out.push('<script id="dcm-ann-data" type="application/json">' + annJson + '</script>');
    out.push('<script>' + annotationJs('DCM_MAP_全量变化_评审_') + '</script>');
    out.push('</main></body></html>');
    return out.join('\n');
  }

  function pad(n) { return ('0' + n).slice(-2); }

  function css() {
    return [
      '*{box-sizing:border-box}',
      'body{margin:0;background:#F1EFE8;color:#2C2C2A;font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}',
      'main{max-width:1080px;margin:0 auto;padding:24px 28px 60px}',
      '.rhead{background:#FFFFFF;border-bottom:1px solid #D3D1C7;padding:22px 28px}',
      '.rhead h1{margin:0 0 6px;font-size:22px;font-weight:500}',
      '.rhead p{margin:0;color:#5F5E5A;font-size:12px}',
      'section{background:#FFFFFF;border:1px solid #D3D1C7;border-radius:12px;padding:20px 24px;margin:18px 0}',
      'h2{font-size:17px;font-weight:500;margin:0 0 14px;padding-bottom:8px;border-bottom:1px solid #E8E6DF}',
      'h3{font-size:14px;font-weight:500;margin:22px 0 8px;color:#185FA5}',
      'svg{display:block;max-width:100%;height:auto;border:1px solid #E8E6DF;border-radius:8px;margin:8px 0}',
      '.tbl{border-collapse:collapse;width:100%;font-size:12px;margin:0 0 12px}',
      '.tbl th,.tbl td{border:1px solid #E8E6DF;padding:6px 9px;text-align:left;vertical-align:top}',
      '.tbl th{background:#F7F6F2;font-weight:500;color:#5F5E5A}',
      '.tbl tbody tr:nth-child(even){background:#FCFCFA}',
      '.tbl-wrap{max-height:520px;overflow:auto;border:1px solid #E8E6DF;border-radius:8px}',
      '.detail{border-collapse:collapse;width:100%;font-size:12px;font-variant-numeric:tabular-nums}',
      '.detail th,.detail td{border:1px solid #E8E6DF;padding:6px 10px;text-align:left;white-space:nowrap}',
      '.detail th{background:#F7F6F2;color:#5F5E5A;font-weight:500;position:sticky;top:0;z-index:1}',
      '.detail tbody tr:nth-child(even){background:#FCFCFA}',
      '.detail td.up{color:#A32D2D}.detail td.down{color:#185FA5}',
      '.dcm-tbl-cap{font-size:11px;color:#5F5E5A;background:#F7F6F2;padding:7px 10px;border-bottom:1px solid #E8E6DF;position:sticky;top:0;z-index:2}',
      '.dcm-tbl th.num,.dcm-tbl td.num{text-align:right}',
      '.dcm-tbl tr.chg{background:#FFF6E8}',
      '.dcm-tbl tr.chg td{font-weight:500}',
      '.dcm-tbl tr.chg td:first-child{box-shadow:inset 3px 0 0 #D85A30}',
      '.dcm-tbl td.up,.dcm-tbl td.down{font-weight:500}',
      '.unit{color:#888780;font-weight:400;font-size:10px}',
      '.up{color:#A32D2D}.down{color:#185FA5}',
      '.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:0 0 16px}',
      '.card{background:#F1EFE8;border-radius:8px;padding:12px 14px}',
      '.card-l{font-size:12px;color:#5F5E5A}.card-v{font-size:21px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.warn{background:#FAECE7;border:1px solid #F5C4B3;border-radius:8px;padding:10px 14px;font-size:12px;margin:10px 0}',
      '.warn ul{margin:6px 0 0;padding-left:20px}',
      '.ok{background:#E1F5EE;border-radius:8px;padding:10px 14px;font-size:12px;color:#0F6E56}',
      '.hint{font-size:11px;color:#888780;margin:8px 0}',
      'details{margin:10px 0;font-size:12px}summary{cursor:pointer;color:#185FA5}',
      'footer{font-size:11px;color:#888780;text-align:center;padding:16px}',
      '.foot-attr,.foot-meta{display:block}',
      '.foot-attr{color:#5F5E5A}',
      '.foot-meta{margin-top:5px}',
      '.ann-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:5px 0;border-bottom:1px dotted #E8E6DF}',
      '.ann-name{flex:1;min-width:170px;font-size:12px}',
      '.ann-row select,.ann-row input{border:1px solid #D3D1C7;border-radius:6px;padding:4px 6px;font-size:12px}',
      '.ann-row input{width:150px}',
      '.ann-export{margin:8px 0}',
      '.ann-topbar{background:#FFFFFF;border:1px solid #D3D1C7;border-radius:12px;padding:14px 18px;margin:0 0 18px}',
      '.ann-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
      '.ann-notes{display:flex;flex-direction:column;gap:3px;margin-top:11px;padding-top:10px;border-top:1px solid #E8E6DF}',
      '.ann-notes .hint{margin:0}',
      '.ann-export button{background:#185FA5;color:#FFF;border:1px solid #185FA5;border-radius:7px;padding:6px 13px;font-size:12px;cursor:pointer}',
      '.ann-export button.ghost{background:#FFF;color:#185FA5}',
      '#dcm-save-state{color:#0F6E56}',
      '.archived-badge{display:inline-block;margin-left:12px;padding:2px 9px;border-radius:10px;background:#F1EFE8;border:1px solid #D3D1C7;font-size:12px;font-weight:400;color:#5F5E5A;vertical-align:middle}',
      '.archive-seal{margin:10px 0 0;display:flex;flex-wrap:wrap;align-items:center;gap:12px}',
      '.seal-label{font-size:12px;color:#5F5E5A}',
      '.sign-img{height:70px;border:1px solid #E8E6DF;border-radius:6px;background:#FFF}',
      '.seal-meta{font-size:11px;color:#888780}',
      '.sign-mask{position:fixed;inset:0;background:rgba(44,44,42,.45);display:flex;align-items:center;justify-content:center;z-index:9999}',
      '.sign-box{background:#FFF;border:1px solid #D3D1C7;border-radius:12px;padding:18px 20px;width:460px;max-width:94vw;box-shadow:0 8px 30px rgba(0,0,0,.18)}',
      '.sign-box h3{margin:0 0 6px;font-size:15px;font-weight:500}',
      '.sign-tip{font-size:11px;color:#888780;margin:0 0 10px;line-height:1.6}',
      '.sign-canvas{display:block;width:420px;height:160px;max-width:100%;border:1px solid #D3D1C7;border-radius:8px;background:#FFF;touch-action:none;cursor:crosshair}',
      '.sign-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}',
      '.sign-actions button{background:#185FA5;color:#FFF;border:1px solid #185FA5;border-radius:7px;padding:6px 13px;font-size:12px;cursor:pointer}',
      '.sign-actions button.ghost{background:#FFF;color:#5F5E5A;border-color:#D3D1C7}',
      '.ann-row select[disabled],.ann-row input[disabled]{background:#F7F6F2;color:#5F5E5A;opacity:1;cursor:default}',
      '.badge{display:inline-block;background:#F1EFE8;border-radius:4px;padding:1px 6px;font-size:10px;white-space:nowrap}',
      '.badge.up{background:#FAECE7;color:#A32D2D}.badge.warn{background:#FFF4E0;color:#8A5A12}',
      '.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
      '.audit-fold{margin:10px 0;border:1px solid #E8E6DF;border-radius:8px;padding:8px 12px}',
      '.evd{border-left:3px solid #185FA5;padding-left:14px;margin:18px 0}',
      '.evd h4{font-size:13px;font-weight:500;margin:0 0 6px;color:#0C447C}',
      '@media print{body{background:#FFF}section{break-inside:avoid;box-shadow:none}.tbl-wrap{max-height:none}}'
    ].join('');
  }

  function download(state) {
    var html = build(state);
    var blob = new Blob(['\ufeff' + html], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var d = new Date();
    a.href = url;
    a.download = 'DCM_MAP_对比报告_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
      '_' + pad(d.getHours()) + pad(d.getMinutes()) + '.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
    return { bytes: blob.size, html: html };
  }

  function downloadAudit(state, audit) {
    var html = buildAudit(state, audit);
    var blob = new Blob(['\ufeff' + html], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var d = new Date();
    a.href = url;
    a.download = 'DCM_MAP_全量变化报告_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
      '_' + pad(d.getHours()) + pad(d.getMinutes()) + '.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
    return { bytes: blob.size, html: html };
  }

  return {
    build: build, download: download, css: css,
    buildAudit: buildAudit, downloadAudit: downloadAudit
  };
});
