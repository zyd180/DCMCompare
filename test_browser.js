/* Headless Edge DOM assertions. No screenshots, no screen capture, no network. */
'use strict';
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
var BUNDLE = path.join(__dirname, 'DCM_MAP_对比工具.html');
var PORT = 9200 + Math.floor(Math.random() * 500);
var TMP = path.join(os.tmpdir(), 'dcm_headless_' + Date.now());
var fileUrl = encodeURI('file:///' + BUNDLE.replace(/\\/g, '/'));

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function waitPort() {
  for (var i = 0; i < 40; i++) {
    try { var r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) return; } catch (e) {}
    await sleep(250);
  }
  throw new Error('Edge CDP 端口未就绪');
}

var DCM1 = [
  'KONSERVIERUNG_FORMAT 2.0', '',
  'FUNKTIONEN', '   FKT TESTF "x" "y"', 'END', '',
  'GRUPPENKENNFELD TQ_Map_M 3 2',
  '   LANGNAME "torque map"', '   FUNKTION TESTF',
  '   EINHEIT_X "rpm"', '   EINHEIT_Y "%"', '   EINHEIT_W "Nm"',
  '   ST/X   1000.0   2000.0   3000.0',
  '   ST/Y   10.0', '   WERT   10.0   20.0   30.0',
  '   ST/Y   20.0', '   WERT   40.0   50.0   60.0', 'END', '',
  'GRUPPENKENNLINIE TQ_Curve_T 3',
  '   LANGNAME "curve"', '   FUNKTION TESTF', '   EINHEIT_X "V"', '   EINHEIT_W "%"',
  '   ST/X   0.0   1.0   2.0', '   WERT   1.0   2.0   3.0', 'END', '',
  'FESTWERT TQ_Enable_C', '   LANGNAME "enable"', '   FUNKTION TESTF',
  '   EINHEIT_W ""', '   WERT 1.0', 'END', ''
].join('\r\n');
var DCM2 = DCM1.replace('WERT   40.0   50.0   60.0', 'WERT   40.0   55.0   60.0')
  .replace('WERT 1.0', 'WERT 0.0');

async function main() {
  if (!fs.existsSync(EDGE)) throw new Error('未找到 Edge: ' + EDGE);
  var edge = cp.spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-sync',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + TMP,
    '--allow-file-access-from-files', '--window-size=1280,900', fileUrl
  ], { stdio: 'ignore', windowsHide: true });
  var ws, pending = new Map(), seq = 0, errors = [];
  function cmd(method, params) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending.set(id, { resolve: resolve, reject: reject });
      ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
  }
  async function evaluate(expr) {
    var r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
    return r.result.value;
  }
  function record(lines) {
    lines.forEach(function (l) { console.log('  ' + l); });
    return lines.filter(function (l) { return l.indexOf('FAIL') === 0; });
  }
  try {
    await waitPort();
    var targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
    var page = targets.filter(function (t) { return t.type === 'page' && t.url.indexOf('DCM_MAP') >= 0; })[0] || targets[0];
    if (!page) throw new Error('未找到页面 target');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(function (res, rej) { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = function (ev) {
      var m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        var p = pending.get(m.id); pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        errors.push('exceptionThrown: ' + (m.params.exceptionDetails.exception || {}).value ||
          m.params.exceptionDetails.text);
      } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        errors.push('console.error: ' + m.params.entry.text);
      }
    };
    await cmd('Runtime.enable');
    await cmd('Log.enable');
    var domReady = false;
    for (var w = 0; w < 40; w++) {
      var rr = await cmd('Runtime.evaluate', {
        expression: 'document.readyState + "|" + !!document.getElementById("stage")',
        returnByValue: true
      });
      if (rr && rr.result && rr.result.value === 'complete|true') { domReady = true; break; }
      await sleep(150);
    }
    if (!domReady) throw new Error('页面 DOM 未就绪（等待超时）');

    var fails = [];
    console.log('== 1. 页面初始化 ==');
    fails = fails.concat(record(await evaluate(`(function(){
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      a(!!window.DCMCore,'DCMCore 已挂载');
      a(!!window.DCMViews,'DCMViews 已挂载');
      a(!!window.DCMReport,'DCMReport 已挂载');
      a(!!window.DCMState,'DCMState 已暴露');
      a(document.getElementById('stage').innerHTML.length>50,'初始 stage 已渲染');
      a(document.querySelectorAll('#viewTabs button').length===10,'10 个视图页签');
      a(!!document.querySelector('#viewTabs button[data-view="audit"]'),'全量标定量审查页签存在');
      ['btnSaveSession','sessionInput','chkAutoEps','epsHint','conclusion','annotations',
        'btnAuditReport','inpReportPageSize'].forEach(function(id){
        a(!!document.getElementById(id),'UI 元素 '+id+' 存在');
      });
      return L;
    })()`)));

    /* 真实鼠标事件：点按钮文字中间，不能留下闪烁插入符（原来是 label 文本节点里的 Caret） */
    console.log('== 1b. 载入按钮点击后不留文本插入符（真实鼠标事件） ==');
    var pickBefore = await evaluate(`(function(){
      var b=document.getElementById('btnLoad'), ls=document.getElementById('btnLoadSession');
      var inp=document.getElementById('fileInput');
      window.__pickerCalls=0; inp.click=function(){window.__pickerCalls++;};
      var L=[], a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      a(!!b && b.tagName==='BUTTON','载入 DCM 是原生 BUTTON，不是可选中文本的 LABEL');
      a(!!ls && ls.tagName==='BUTTON','载入会话是原生 BUTTON');
      a(getComputedStyle(b).cursor==='pointer','按钮光标为 pointer（不再是文本 I 形）');
      a(getComputedStyle(b).userSelect==='none','按钮文字不可选中');
      a(getComputedStyle(document.getElementById('dropzone')).userSelect==='none',
        '拖放区文字不可选中（同一根因）');
      var r=b.getBoundingClientRect();
      return {L:L, x:r.x+r.width/2, y:r.y+r.height/2};
    })()`);
    await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: pickBefore.x,
      y: pickBefore.y, button: 'left', clickCount: 1 });
    await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pickBefore.x,
      y: pickBefore.y, button: 'left', clickCount: 1 });
    await sleep(150);
    var pickAfter = await evaluate(`(function(){
      var s=window.getSelection();
      var anchor=s.anchorNode?String(s.anchorNode.textContent||'').trim():'';
      var calls=window.__pickerCalls||0;
      delete document.getElementById('fileInput').click;
      var L=[], a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      a(calls===1,'点击按钮确实触发文件选择器（调用 '+calls+' 次）');
      a(String(s.type)!=='Caret' || anchor!=='载入 DCM',
        'revert-to-fail：按钮文字中没有残留闪烁插入符（selection='+String(s.type)+
        ' anchor='+anchor.slice(0,12)+'）');
      return L;
    })()`);
    fails = fails.concat(record(pickBefore.L.concat(pickAfter)));

    console.log('== 1c. 内嵌使用手册（顶部入口 / 开关 / 目录 / 不影响功能） ==');
    fails = fails.concat(record(await evaluate(`(function(){
      var L=[], a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var btn=document.getElementById('btnManual'), ov=document.getElementById('manualOverlay');
      var nav=document.getElementById('manualNav');
      a(!!btn && !!document.querySelector('.top-actions #btnManual'),'顶部按钮区含「查看使用手册」入口');
      a(!!ov && ov.hidden===true,'手册初始为隐藏');
      a(!!ov && getComputedStyle(ov).display==='none','隐藏态 display:none 生效');
      a(!!document.getElementById('btnManualPrint') && !!document.getElementById('btnManualClose'),
        '手册含打印与关闭按钮');
      a(!!nav && nav.querySelectorAll('[data-target]').length===10,'目录含 10 个跳转按钮');
      if(!btn||!ov) return L;
      btn.click();
      a(ov.hidden===false && getComputedStyle(ov).display!=='none','点击顶部按钮打开手册');
      /* 头部两个按钮必须等高、顶边对齐：直接量实际布局，不看类名 */
      var pr=document.getElementById('btnManualPrint'), cl=document.getElementById('btnManualClose');
      function mbox(e){var r=e.getBoundingClientRect(),s=getComputedStyle(e);
        return {h:+r.height.toFixed(1),top:+r.top.toFixed(1),fs:s.fontSize,pad:s.paddingTop,rad:s.borderTopLeftRadius};}
      if(pr&&cl){
        var bp=mbox(pr), bc=mbox(cl);
        a(bp.h>0&&bc.h>0,'手册打开态可量到两个按钮的实际尺寸（'+bp.h+'px / '+bc.h+'px）');
        a(Math.abs(bp.h-bc.h)<0.5,'打印与关闭按钮等高（'+bp.h+'px / '+bc.h+'px）');
        a(Math.abs(bp.top-bc.top)<0.5,'打印与关闭按钮顶边对齐（'+bp.top+' / '+bc.top+'）');
        a(bp.fs===bc.fs&&bp.pad===bc.pad&&bp.rad===bc.rad,'两按钮字号 / 内边距 / 圆角一致');
        /* revert-to-fail：换回旧的 mini 样式，如果高度差检测不出来，说明上面是废断言 */
        var saved=pr.className; pr.className='mini'; var bm=mbox(pr); pr.className=saved;
        a(Math.abs(bm.h-bc.h)>3,'revert-to-fail：旧 mini 样式明显更矮（'+bm.h+'px vs '+bc.h+'px），检测器有区分力');
      }
      a(document.body.style.overflow==='hidden','打开时锁定背景滚动');
      var secs=ov.querySelectorAll('.manual-body section');
      a(secs.length===10,'手册正文含 10 个章节（实际 '+secs.length+'）');
      var navBtn=nav&&nav.querySelector('[data-target="m-review"]');
      if(navBtn){ navBtn.click(); a(!!document.getElementById('m-review'),'目录跳转到评审与归档章节'); }
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      a(ov.hidden===true,'Esc 关闭手册');
      a(document.body.style.overflow==='','关闭后恢复背景滚动');
      btn.click();
      document.getElementById('btnManualClose').click();
      a(ov.hidden===true,'关闭按钮关闭手册');
      btn.click();
      ov.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      a(ov.hidden===true,'点遮罩关闭手册');
      a(!!window.DCMCore && !!window.DCMState && !window.DCMState.result,
        '手册开关不影响工具状态（未载入数据时 result 仍为空）');
      return L;
    })()`)));

    console.log('== 1d. 按钮悬停提示：可用说功能，禁用说原因 ==');
    /* disabled 按钮不派发鼠标事件，所以「禁用原因」必须靠 elementFromPoint 命中测试，
       不能指望 e.target。这条同时验证了“提示真的能弹出来”和“禁用态也能弹”。 */
    fails = fails.concat(record(await evaluate(`(function(){
      var L=[], a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var tip=document.getElementById('tooltip');
      function hover(el){
        var r=el.getBoundingClientRect();
        document.body.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,
          clientX:Math.round(r.x+r.width/2), clientY:Math.round(r.y+r.height/2)}));
      }
      var tops=[].slice.call(document.querySelectorAll('.top-actions button'));
      a(tops.length>=8,'顶部按钮 '+tops.length+' 个');
      a(tops.every(function(b){return !!b.getAttribute('data-tip');}),'顶部每个按钮都有功能提示');
      var dis=tops.filter(function(b){return b.disabled;});
      a(dis.length>=3,'初始有 '+dis.length+' 个禁用按钮');
      a(dis.every(function(b){return !!b.getAttribute('data-tip-off');}),'每个禁用按钮都写明不可用原因');
      var rep=document.getElementById('btnReport');
      hover(rep);
      a(tip.style.display==='block','悬停禁用按钮也弹出提示（disabled 不派发事件，靠坐标命中）');
      a(tip.textContent===rep.getAttribute('data-tip-off'),'禁用时给的是原因：「'+tip.textContent+'」');
      var load=document.getElementById('btnLoad');
      hover(load);
      a(tip.style.display==='block' && tip.textContent===load.getAttribute('data-tip'),
        '可用时给的是功能：「'+tip.textContent+'」');
      document.body.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:3,clientY:3}));
      a(tip.style.display==='none','移到空白处提示立即消失');
      var all=[].slice.call(document.querySelectorAll('button'));
      var miss=all.filter(function(b){return !b.getAttribute('data-tip');});
      a(miss.length===0,'页面上 '+all.length+' 个按钮全部有提示（缺 '+miss.length+' 个）');
      var long=all.map(function(b){return b.getAttribute('data-tip');}).filter(function(t){return t.length>16;});
      a(long.length===0,'提示都控制在 16 字以内（超长 '+long.length+' 个）');
      return L;
    })()`)));

    console.log('== 1e. 页头作者 / 手册按钮灰色 / 页签下沿 ==');
    fails = fails.concat(record(await evaluate(`(function(){
      var L=[], a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var au=document.querySelector('.brand .author');
      a(!!au && au.textContent.indexOf('Henry')>=0,'页头显示作者 Henry');
      var m=document.getElementById('btnManual');
      a(m.className.indexOf('gray')>=0,'查看使用手册使用 gray 类');
      var bg=getComputedStyle(m).backgroundColor;
      a(bg!=='rgba(0, 0, 0, 0)' && bg!=='rgb(255, 255, 255)','按钮背景为灰色而非透明/白底（'+bg+'）');
      var vt=document.getElementById('viewTabs');
      var cs=getComputedStyle(vt);
      a(parseFloat(cs.paddingBottom)>0,'页签行有下内边距，不再贴边裁切（'+cs.paddingBottom+'）');
      a(parseFloat(cs.borderBottomWidth)>0,'页签行有下边框，与内容区分开');
      var ab=vt.querySelector('button.active');
      var acs=getComputedStyle(ab);
      a(parseFloat(acs.borderBottomWidth)>0,'当前页签四条边都闭合，下沿不再被吞');
      return L;
    })()`)));

    console.log('== 1f. 版本号与更新记录弹框 ==');
    fails = fails.concat(record(await evaluate(`(function(){
      var L=[], a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var v=document.getElementById('btnVersion');
      var ov=document.getElementById('changelogOverlay');
      var mo=document.getElementById('manualOverlay');
      a(!!v && /^v\\d+\\.\\d+\\.\\d+$/.test(v.textContent.trim()),
        '页头版本号格式为 vX.Y.Z（'+(v?v.textContent.trim():'无')+'）');
      a(!!ov && ov.hidden===true,'更新记录初始隐藏');
      v.click();
      a(ov.hidden===false,'点版本号打开更新记录');
      a(ov.querySelectorAll('.log-item').length>=1,'弹框含版本条目');
      a(ov.textContent.indexOf(v.textContent.trim())>=0,'弹框显示当前版本号');
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      a(ov.hidden===true,'Esc 关闭更新记录');
      v.click();
      ov.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      a(ov.hidden===true,'点遮罩关闭更新记录');
      document.getElementById('btnManual').click();
      a(mo.hidden===false && ov.hidden===true,'手册与更新记录互不干扰');
      document.getElementById('btnManualClose').click();
      a(document.body.style.overflow==='','关闭后恢复页面滚动');
      return L;
    })()`)));

    console.log('== 2. 内置变异自检按钮 ==');
    fails = fails.concat(record(await evaluate(`(function(){
      document.getElementById('btnSelfTest').click();
      var t=document.getElementById('stage').innerText;
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      a(t.indexOf('全部通过')>=0,'自检显示全部通过');
      a(t.indexOf('FAIL')<0,'自检无 FAIL 项');
      a(t.indexOf('变异测试')>=0,'含变异测试断言');
      return L;
    })()`)));

    console.log('== 3. 真实 File API 路径载入两份 DCM ==');
    var loadExpr = `(async function(){
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var wait=function(fn,ms){return new Promise(function(res,rej){var t0=Date.now();
        (function p(){ if(fn()) return res(true); if(Date.now()-t0>ms) return rej(new Error('timeout'));
          setTimeout(p,40); })();});};
      var dt=new DataTransfer();
      dt.items.add(new File([${JSON.stringify(DCM1)}],'V1.DCM'));
      dt.items.add(new File([${JSON.stringify(DCM2)}],'V2.DCM'));
      var inp=document.getElementById('fileInput'); inp.files=dt.files;
      inp.dispatchEvent(new Event('change'));
      await wait(function(){return window.DCMState.datasets.length===2;},6000);
      var S=window.DCMState;
      a(S.datasets.length===2,'两份 DCM 均载入');
      a(S.datasets[0].stats.invalid===0 && S.datasets[1].stats.invalid===0,'两份均无异常块');
      a(S.index.all.length===6,'可比对象 6 个 (2 MAP + 2 曲线 + 2 标量)');
      a(S.index.versionGroups.length===3,'跨版本同名组 3 组');
      a(document.getElementById('dsCount').textContent.indexOf('2')>=0,'数据源面板显示 2 个文件');
      a(document.getElementById('tree').innerHTML.indexOf('整组加入')>=0,'同轴组列表渲染');
      a(!document.getElementById('btnScan').disabled,'全量版本对比按钮已启用');
      return L;
    })()`;
    fails = fails.concat(record(await evaluate(loadExpr)));

    console.log('== 4. 整组加入 + 七个视图逐个渲染 ==');
    var viewExpr = `(function(){
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      document.querySelector('[data-act="group"]').click();
      var S=window.DCMState;
      a(S.basket.length>=2,'对比清单自动加入 '+S.basket.length+' 项');
      a(!!S.baseKey,'已自动指定基准');
      var views=['heat','curve','surface','profile','table','scan','help'];
      views.forEach(function(v){
        document.querySelector('#viewTabs button[data-view="'+v+'"]').click();
        var h=document.getElementById('stage').innerHTML;
        a(h.length>150,'视图 '+v+' 有内容 ('+h.length+' 字符)');
        a(!/NaN|undefined|Infinity/.test(h),'视图 '+v+' 无脏值');
        if(v==='heat'||v==='curve'||v==='surface') a(h.indexOf('<svg')>=0,'视图 '+v+' 输出 SVG');
      });
      a(S.view==='help','页签状态同步');
      var ch=function(){return new Event('change',{bubbles:true});};
      var modes=['diff','both','base','other','envelope','grid','stack'];
      var expectCls={diff:'surface-svg',both:'surface-svg',base:'surface-svg',other:'surface-svg',
        envelope:'envelope-svg',grid:'grid-svg',stack:'stack-svg'};
      modes.forEach(function(mode){
        document.querySelector('#viewTabs button[data-view="surface"]').click();
        var s=document.querySelector('[data-opt="surfaceMode"]');
        a(!!s,'曲面模式下拉存在 ('+mode+')');
        if(!s) return;
        s.value=mode; s.dispatchEvent(ch());
        a(S.opts.surfaceMode===mode,'模式状态真的切到 '+mode);
        var h=document.getElementById('stage').innerHTML;
        a(h.indexOf('<svg')>=0,'曲面模式 '+mode+' 输出 SVG');
        a(h.indexOf(expectCls[mode])>=0,'曲面模式 '+mode+' 渲染对应类型 '+expectCls[mode]);
        a(!/NaN|undefined|Infinity/.test(h),'曲面模式 '+mode+' 无脏值');
      });
      document.querySelector('#viewTabs button[data-view="surface"]').click();
      var sm0=document.querySelector('[data-opt="surfaceMode"]');
      sm0.value='envelope'; sm0.dispatchEvent(ch());
      var eh=document.getElementById('stage').innerHTML;
      a((eh.match(/<line/g)||[]).length>=15,'三轴刻度线与底板网格已绘制');
      a(eh.indexOf('#E8E6DF')>=0,'底板刻度网格存在');
      a(eh.indexOf('Δ ')>=0,'Z 轴标注 Δ 刻度语义');
      var pa=document.querySelector('[data-opt="surfaceProbe.axis"]');
      a(!!pa,'定位轴控件存在');
      if(pa){
        pa.value='x'; pa.dispatchEvent(ch());
        a(S.opts.surfaceProbe.axis==='x','定位轴切到 X');
        var pv=document.querySelector('[data-opt="surfaceProbe.index"]');
        a(!!pv,'定位值下拉存在');
        if(pv){
          pv.value='2'; pv.dispatchEvent(ch());
          a(S.opts.surfaceProbe.index===2,'定位值索引生效');
          var ph=document.getElementById('stage').innerHTML;
          a(ph.indexOf('stroke-width="1.8"')>=0,'橙色描边高亮曲面带');
          a(ph.indexOf('X = ')>=0,'图上标出定位轴值');
          a(ph.indexOf('已定位')>=0,'提示文字说明当前定位值');
        }
        var pa2=document.querySelector('[data-opt="surfaceProbe.axis"]');
        pa2.value='none'; pa2.dispatchEvent(ch());
        a(S.opts.surfaceProbe.axis==='none','定位状态已取消');
        a(document.getElementById('stage').innerHTML.indexOf('stroke-width="1.8"')<0,
          '取消定位后高亮描边消失');
      }
      document.querySelector('#viewTabs button[data-view="surface"]').click();
      var sm=document.querySelector('[data-opt="surfaceMode"]');
      sm.value='stack'; sm.dispatchEvent(ch());
      var gapEl=document.querySelector('[data-opt="stack.gap"]');
      a(!!gapEl,'拉开距离模式提供间距控件');
      if(gapEl){ gapEl.value='0.8'; gapEl.dispatchEvent(ch());
        a(S.opts.stack.gap===0.8,'层间距可调到 0.8'); }
      var lay=document.querySelector('[data-opt="stack.layout"]');
      if(lay){ lay.value='overlay'; lay.dispatchEvent(ch());
        a(S.opts.stack.layout==='overlay','可切回默认叠加');
        a(document.getElementById('stage').innerHTML.indexOf('默认叠加')>=0,'默认叠加视图渲染'); }
      var lay2=document.querySelector('[data-opt="stack.layout"]');
      if(lay2){ lay2.value='spaced'; lay2.dispatchEvent(ch()); }
      var cb=document.querySelector('[data-cmd="toggleLayer"]');
      a(!!cb,'层显隐复选框存在');
      if(cb){ cb.checked=false; cb.dispatchEvent(ch());
        a(S.opts.stack.visible[0]===false,'第 1 层可单独隐藏');
        a(document.getElementById('stage').innerHTML.indexOf('L1')>=0,'隐藏后其余层仍有标签'); }
      return L;
    })()`;
    fails = fails.concat(record(await evaluate(viewExpr)));

    console.log('== 4a2. 三轴表在列表与对比清单里必须标注「仅第一层」 ==');
    /* 三轴表只解析第一层。旧版界面上看不出来，用户会当完整三维用。
       这里把一张真实表标成 provisional，验证列表项、chip 与 title 都带出这个口径。 */
    var provExpr = `(function(){
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var S=window.DCMState;
      var before=S.basket.length;
      var p=JSON.parse(JSON.stringify(S.basket[0]));
      p.key=p.key+'#PROV3D'; p.name='PROV3D_M'; p.label='PROV3D_M'; p.provisional=true;
      var g0=S.index.groups[0];
      g0.maps.push(p);
      document.querySelector('#listTabs button[data-list="groups"]').click();
      var th=document.getElementById('tree').innerHTML;
      a(th.indexOf('PROV3D_M')>=0,'测试前置：三轴表已进入同轴组列表');
      a(th.indexOf('3D·仅第一层')>=0,'revert-to-fail：列表项标注「3D·仅第一层」');
      g0.maps.pop();
      S.basket.push(p);
      document.getElementById('chkOnlyChanged').click();
      var bh=document.getElementById('basket').innerHTML;
      a(bh.indexOf('PROV3D_M')>=0,'测试前置：三轴表已进入对比清单');
      a(bh.indexOf('3D·仅第一层')>=0,'revert-to-fail：对比清单 chip 标注「3D·仅第一层」');
      a(bh.indexOf('仅第一层参与对比')>=0,'chip title 说明仅第一层参与对比');
      S.basket.pop();
      document.getElementById('chkOnlyChanged').click();
      a(S.basket.length===before,'测试后对比清单已还原');
      a(document.getElementById('basket').innerHTML.indexOf('3D·仅第一层')<0,'还原后角标消失');
      return L;
    })()`;
    fails = fails.concat(record(await evaluate(provExpr)));

    console.log('== 4b. 会话复现 / 自动阈值 / 体检风险卡 ==');
    var sessExpr = `(function(){
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var S=window.DCMState;
      var json=window.DCMSession.exportState();
      var parsed=JSON.parse(json);
      a(parsed.format==='DCM_MAP_SESSION','导出会话格式正确');
      a(parsed.basket.length===S.basket.length,'会话含完整对比清单 '+parsed.basket.length+' 项');
      a(!!parsed.config.opts.surfaceProbe,'会话含定位配置');
      a(!!parsed.config.opts.stack,'会话含 3D 叠加配置');
      var n0=S.basket.length, yaw0=S.opts.surface.yaw, base0=S.baseKey;
      S.opts.surface.yaw=1.234; S.basket=[]; S.baseKey=null;
      var r=window.DCMSession.importState(json);
      a(r.bound===n0 && S.basket.length===n0,'清空后载入会话恢复 '+n0+' 项');
      a(S.baseKey===base0,'基准恢复');
      a(Math.abs(S.opts.surface.yaw-yaw0)<1e-9,'3D 视角恢复');
      a(r.missing.length===0,'无未绑定项');
      var bad=JSON.parse(json);
      bad.basket[0].srcFile='NOT_EXIST.DCM'; bad.basket[0].axisSig='bogus-sig';
      var r2=window.DCMSession.importState(JSON.stringify(bad));
      a(r2.missing.length===1,'故意改名后明确报 1 项未绑定');
      a(r2.bound===n0-1,'未绑定项未静默混入对比清单');
      window.DCMSession.importState(json);
      var cb=document.getElementById('chkAutoEps');
      cb.checked=true; cb.dispatchEvent(new Event('change',{bubbles:true}));
      a(S.autoThreshold===true,'自动阈值开关生效');
      a(document.getElementById('epsHint').textContent.indexOf('自动')>=0,'阈值提示显示自动依据');
      a(document.getElementById('inpEps').disabled===true,'自动阈值下手动输入框禁用');
      cb.checked=false; cb.dispatchEvent(new Event('change',{bubbles:true}));
      a(S.autoThreshold===false,'可切回手动阈值');
      var st=document.getElementById('stats').innerHTML;
      a(st.indexOf('孤立突变点')>=0 && st.indexOf('趋势反转处')>=0 && st.indexOf('高风险对比')>=0,'统计区出现体检风险卡');
      return L;
    })()`;
    fails = fails.concat(record(await evaluate(sessExpr)));

    console.log('== 4c. 改名对齐扫描与确认 ==');
    var renExpr = `(async function(){
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var wait=function(fn,ms){return new Promise(function(res,rej){var t0=Date.now();
        (function p(){ if(fn()) return res(true); if(Date.now()-t0>ms) return rej(new Error('timeout'));
          setTimeout(p,40); })();});};
      var S=window.DCMState;
      a(!!document.querySelector('#viewTabs button[data-view="rename"]'),'改名对齐页签存在');
      var target=S.datasets[1].maps.filter(function(m){return m.type==='map2d';})[0];
      a(!!target,'B 版存在 2D MAP 可供改名');
      var orig=target.name;
      target.name=orig+'_V2';
      document.querySelector('#viewTabs button[data-view="rename"]').click();
      a(document.getElementById('stage').innerHTML.indexOf('扫描改名候选')>=0,'改名视图渲染扫描入口');
      document.querySelector('[data-cmd="doRename"]').click();
      await wait(function(){return S.renameScan!==null;},6000);
      a(S.renameScan.ok,'扫描成功');
      a(S.renameScan.total>=1,'检出改名候选 '+S.renameScan.total+' 组');
      var cand=S.renameScan.pairs[0].candidates[0];
      a(!!cand && cand.b.name===orig+'_V2','候选 B 名称为改名后的 '+orig+'_V2');
      a(!!cand && cand.a.name===orig,'候选 A 名称为原名');
      a(!!cand && ['high','medium','low'].indexOf(cand.confidence)>=0,'候选带合法置信度 '+(cand?cand.confidence:'-'));
      var h=document.getElementById('stage').innerHTML;
      a(h.indexOf('加入对比清单')>=0 && h.indexOf('_V2')>=0,'候选表含确认按钮与改名对象');
      var rr=window.DCMReport.build(S);
      a(rr.indexOf('附录：改名对齐候选')>=0,'报告含改名候选章节');
      var btn=document.querySelector('[data-act="renameadd"]');
      a(!!btn,'候选行含「加入对比清单」按钮');
      if(btn){
        btn.click();
        a(S.view==='heat','确认后切到差异热力视图');
        a(S.basket.length===2 && S.basket.some(function(m){return m.name===orig+'_V2';}),'改名候选两张表都进对比清单');
      }
      target.name=orig;
      return L;
    })()`;
    fails = fails.concat(record(await evaluate(renExpr)));

    console.log('== 4d. 对比摘要与允许偏差 ==');
    var conclExpr = `(function(){
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var S=window.DCMState;
      var el=document.getElementById('conclusion');
      a(el.innerHTML.indexOf('对比摘要')>=0,'对比摘要渲染');
      a(el.innerHTML.indexOf('结论摘要')<0,'revert-to-fail：标题已不叫结论摘要');
      a(el.innerHTML.indexOf('供评审参考')>=0,'摘要声明只供评审参考');
      a(el.innerHTML.indexOf('可放行')<0 && el.innerHTML.indexOf('建议驳回')<0,
        'revert-to-fail：摘要不给放行/驳回建议');
      a(el.innerHTML.indexOf('主导改动模式')>=0,'摘要含改动模式');
      a(el.innerHTML.indexOf('未设置允许偏差')>=0,'默认未设允许偏差');
      var inp=el.querySelector('[data-opt="allowDelta"]');
      a(!!inp,'允许偏差输入框存在');
      if(inp){
        inp.value='1'; inp.dispatchEvent(new Event('change',{bubbles:true}));
        a(S.opts.allowDelta===1,'允许偏差写入 state');
        var h=document.getElementById('conclusion').innerHTML;
        a(h.indexOf('X 区间')>=0,'摘要出现超差区间表');
      }
      var r=window.DCMReport.build(S);
      a(r.indexOf('对比摘要')>=0,'报告含对比摘要章节');
      a(r.indexOf('逐项改动模式')>=0,'报告含逐项模式表');
      a(r.indexOf('可放行')<0 && r.indexOf('建议驳回')<0,'报告同样不给放行/驳回建议');
      a(/工具 v\\d+\\.\\d+\\.\\d+/.test(r),'报告页头带生成它的工具版本');
      return L;
    })()`;
    fails = fails.concat(record(await evaluate(conclExpr)));

    console.log('== 4e. 轴变更影响面 ==');
    var axisExpr = `(async function(){
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var wait=function(fn,ms){return new Promise(function(res,rej){var t0=Date.now();
        (function p(){ if(fn()) return res(true); if(Date.now()-t0>ms) return rej(new Error('timeout'));
          setTimeout(p,40); })();});};
      var S=window.DCMState;
      a(!!document.querySelector('#viewTabs button[data-view="axis"]'),'轴影响面页签存在');
      var target=S.datasets[1].maps.filter(function(m){return m.type==='map2d';})[0];
      a(!!target,'B 版存在 2D MAP 可供改轴');
      var origX=target.x.slice();
      target.x=[0,1,4];
      document.querySelector('#viewTabs button[data-view="axis"]').click();
      a(document.getElementById('stage').innerHTML.indexOf('扫描轴变更')>=0,'轴视图渲染扫描入口');
      document.querySelector('[data-cmd="doAxis"]').click();
      await wait(function(){return S.axisScan!==null;},6000);
      a(S.axisScan.ok,'扫描成功');
      a(S.axisScan.total>=1,'检出 '+S.axisScan.total+' 根变化轴');
      var big=S.axisScan.pairs[0].changedAxes.slice().sort(function(x,y){return y.affected.length-x.affected.length;})[0];
      a(!!big && big.affected.length>=1,'变化轴带受影响表清单 ('+(big?big.affected.length:0)+' 张)');
      var h=document.getElementById('stage').innerHTML;
      a(h.indexOf('受影响表')>=0 || h.indexOf('张表')>=0,'结果含影响面清单');
      var btn=document.querySelector('[data-act="axisadd"]');
      a(!!btn,'含「加入对比清单」按钮');
      if(btn){ btn.click(); a(S.view==='heat','确认后切回热力视图'); }
      var r=window.DCMReport.build(S);
      a(r.indexOf('附录：轴变更影响面')>=0,'报告含轴影响面章节');
      target.x=origX;
      return L;
    })()`;
    fails = fails.concat(record(await evaluate(axisExpr)));

    console.log('== 4f. 报告内批注签核 round-trip ==');
    var annExpr = `(async function(){
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var S=window.DCMState;
      var key='cmp:'+S.result.others[0].key;
      S.annotations[key]={verdict:'reject',reason:'工具内意见A',req:'REQ-1',owner:'Henry'};
      var rep=window.DCMReport.build(S);
      a(rep.indexOf('工具内意见A')>=0,'工具批注进入报告');
      a(rep.indexOf('dcmAnnotatedHtml')>=0 && rep.indexOf('dcm-ann-data')>=0,'报告自带再导出逻辑');
      a(!/(src|href)=["']https?:/i.test(rep),'带批注报告仍零外部资源');
      var f=document.createElement('iframe');
      f.style.display='none'; document.body.appendChild(f);
      f.srcdoc=rep;
      await new Promise(function(r){ f.onload=r; setTimeout(r,2500); });
      var w=f.contentWindow, d=w.document;
      a(!!w && !!w.dcmAnnotatedHtml,'报告页提供 dcmAnnotatedHtml');
      var inp=d.querySelector('[data-ann][data-field="reason"]');
      a(!!inp,'报告内含可编辑批注控件');
      var fa=d.querySelector('.foot-attr'), fm=d.querySelector('.foot-meta');
      a(!!fa && !!fm,'页脚含署名行与说明行（几何在 7e 的有布局 iframe 里量）');
      var SIG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
      if(inp && w.dcmAnnotatedHtml){
        inp.value='报告内改写意见B';
        var out=w.dcmAnnotatedHtml(SIG);
        a(out.indexOf('报告内改写意见B')>=0,'报告内编辑后再导出含改后文本');
        a(out.indexOf('value="工具内意见A"')<0,'再导出不残留旧批注值');
        a(out.indexOf('<!DOCTYPE html>')>=0,'再导出是完整 HTML 文档');
        a(out.indexOf('data-dcm-archived="1"')>=0,'再导出标记为归档只读版');
        a(out.indexOf('data-dcm-signed="1"')>=0 && out.indexOf('sign-img')>=0 && out.indexOf(SIG)>=0,
          '手写签名 PNG 写入归档报告');
        a(out.indexOf('审核人手写签名')>=0 && out.indexOf('归档时间：')>=0 && out.indexOf('报告 ID：')>=0,
          '归档报告显示签名标签、归档时间与报告 ID');
        a(out.indexOf('data-dcm-reviewer')<0 && out.indexOf('审核人：')<0,
          'revert-to-fail：归档报告不采集审核人姓名');
        a(out.indexOf('disabled="disabled"')>=0,'归档版批注控件 disabled');
        a(out.indexOf('导出归档报告</button>')<0,'归档版移除再次编辑/导出入口');
        var clicked=0;
        w.HTMLAnchorElement.prototype.click=function(){clicked++;};
        w.alert=function(){};
        w.dcmExportAnnotated();
        a(!!d.querySelector('.sign-mask'),'点「导出归档报告」弹出中央签名板');
        var cv=d.querySelector('[data-role="signature"]');
        a(!!cv,'签名板含手写 canvas');
        d.querySelector('[data-role="sign-confirm"]').click();
        a(clicked===0,'未手写签名时确认不导出');
        d.querySelector('[data-role="sign-cancel"]').click();
        a(!d.querySelector('.sign-mask'),'取消后签名板关闭');
        a(clicked===0,'取消不导出');
        w.dcmExportAnnotated();
        cv=d.querySelector('[data-role="signature"]');
        var pe=function(type,x,y){
          cv.dispatchEvent(new w.PointerEvent(type,{bubbles:true,clientX:x,clientY:y,pointerId:1}));
        };
        pe('pointerdown',20,20); pe('pointermove',90,70); pe('pointerup',90,70);
        d.querySelector('[data-role="sign-confirm"]').click();
        a(clicked===1,'手写签名确认后触发一次归档导出');
        a(!d.querySelector('.sign-mask'),'确认后签名板关闭，不会带进归档报告');
        w.dcmExportAnnotated();
        var cbtn=d.querySelector('[data-role="sign-clear"]');
        a(!!cbtn,'签名板提供清空按钮');
        if(cbtn){
          cbtn.click(); d.querySelector('[data-role="sign-confirm"]').click();
          a(clicked===1,'清空后未签名不导出');
        }
        d.querySelector('[data-role="sign-cancel"]').click();
      }
      return L;
    })()`;
    fails = fails.concat(record(await evaluate(annExpr)));

    console.log('== 4g. 全量变化清单页签（类型分派 / 恒等式 / 只列变化 / 证据） ==');
    var auditExpr = `(async function(){
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var wait=function(fn,ms){return new Promise(function(res,rej){var t0=Date.now();
        (function p(){ if(fn()) return res(true); if(Date.now()-t0>ms) return rej(new Error('timeout'));
          setTimeout(p,40); })();});};
      document.querySelector('#viewTabs button[data-view="audit"]').click();
      a(document.getElementById('stage').innerHTML.indexOf('开始生成全量变化清单')>=0,'变化清单引导页出现');
      a(!document.getElementById('btnAuditReport').disabled,'全量变化报告按钮已启用');
      document.querySelector('[data-cmd="doAudit"]').click();
      await wait(function(){return !!window.DCMState.audit;},8000);
      var S=window.DCMState, A=S.audit;
      a(A.ok && A.identity.ok,'账本生成且完整性恒等式通过');
      a(A.totals.total===3,'两份小样本共 3 个同名对象全部入账');
      a(A.totals.counts.unchanged>=1,'未变化项仍入账，只做计数');
      a(S.opts.audit.status==='changes','默认筛选为「全部变化」');
      a(A.totals.counts.renamed===undefined && A.settings.renameMatching===false,'不做改名配对');
      var h=document.getElementById('stage').innerHTML;
      a(h.indexOf('完整性校验')>=0,'统计卡显示完整性校验结果');
      a(h.indexOf('对象类型')>=0,'按对象类型对账表存在');
      a(h.indexOf('筛选命中')>=0,'筛选与分页工具存在');
      a(h.indexOf('全量变化摘要')>=0,'结论区改为变化摘要');
      a(h.indexOf('建议驳回')<0 && h.indexOf('可放行')<0,'revert-to-fail：全量结论不给建议');
      a(h.indexOf('含标量改名')<0,'界面不再提供改名配对开关');
      a(h.indexOf('未变化（仅计数）')>=0,'未变化项只显示计数，不列清单');
      a(h.indexOf('TQ_Curve_T')<0,'默认列表不含未变化对象名');
      var ssel2=document.querySelector('[data-opt="audit.status"]');
      a(!!ssel2 && ssel2.innerHTML.indexOf('B 版新增')>=0 && ssel2.innerHTML.indexOf('B 版删除')>=0,
        '状态筛选提供 B 版新增 / B 版删除');
      var sc=A.entries.filter(function(e){return e.type==='scalar'&&e.hasChange;})[0];
      a(!!sc && sc.inspect.applicable===false,'标量体检明确标记二维判据不适用');
      a(!!sc && sc.inspect.isolated.length===0,'标量改值不得报孤立突变点');
      a(!!sc && sc.verdict!=='reject','标量改值不得建议驳回');
      var tsel=document.querySelector('[data-opt="audit.type"]');
      a(!!tsel,'类型筛选控件存在');
      if(tsel){
        tsel.value='scalar'; tsel.dispatchEvent(new Event('change',{bubbles:true}));
        a(S.opts.audit.type==='scalar','类型筛选状态真的改变（不是只重绘）');
        var t2=document.querySelector('[data-opt="audit.type"]');
        t2.value='all'; t2.dispatchEvent(new Event('change',{bubbles:true}));
      }
      var ssel=document.querySelector('[data-opt="audit.status"]');
      if(ssel){
        ssel.value='unchanged'; ssel.dispatchEvent(new Event('change',{bubbles:true}));
        a(S.opts.audit.status==='unchanged','状态筛选生效');
        var s2=document.querySelector('[data-opt="audit.status"]');
        s2.value='changes'; s2.dispatchEvent(new Event('change',{bubbles:true}));
      }
      var q=document.querySelector('[data-opt="audit.search"]');
      if(q){
        q.value='TQ_Curve'; q.dispatchEvent(new Event('change',{bubbles:true}));
        a(S.opts.audit.search==='TQ_Curve','检索条件写入状态');
        var q2=document.querySelector('[data-opt="audit.search"]');
        q2.value=''; q2.dispatchEvent(new Event('change',{bubbles:true}));
      }
      var rps=document.getElementById('inpReportPageSize');
      a(!!rps,'报告展开项设置入口存在');
      if(rps){
        rps.value='3'; rps.dispatchEvent(new Event('change',{bubbles:true}));
        a(S.reportPageSize===3,'报告展开项设置写入状态并供报告使用');
        rps.value='12'; rps.dispatchEvent(new Event('change',{bubbles:true}));
        a(S.reportPageSize===12,'恢复默认展开项，避免污染后续对照测试');
      }
      var det=document.querySelector('[data-act="auditdetail"]');
      a(!!det,'证据按钮存在');
      if(det){
        det.click();
        var h2=document.getElementById('stage').innerHTML;
        a(h2.indexOf('证据 ·')>=0,'证据块展开');
        a(h2.indexOf('判定口径')>=0,'证据块写明按类型分派的判定口径');
        a(h2.indexOf('data-ann="audit:')>=0,'工具证据块也提供评审批注控件');
        var ai=document.querySelector('#stage [data-ann][data-field="reason"]');
        if(ai){
          ai.value='工具内审查意见';
          ai.dispatchEvent(new Event('input',{bubbles:true}));
          var ak=ai.getAttribute('data-ann');
          a(!!S.annotations[ak] && S.annotations[ak].reason==='工具内审查意见',
            '工具内审查批注写入 state，随会话与报告导出');
        }
      }
      var add=document.querySelector('[data-act="auditadd"]');
      a(!!add,'加入对比清单按钮存在');
      if(add){
        var eid=add.getAttribute('data-id');
        var ee=S.audit.entries.filter(function(x){return x.id===eid;})[0];
        add.click();
        a(S.view==='heat','加入后切到热力视图');
        a(!!ee && S.basket.some(function(x){return x.key===ee.keyA;}),'该标定量的 A 版确实在对比清单里');
        a(!!ee && S.basket.some(function(x){return x.key===ee.keyB;}),'该标定量的 B 版确实在对比清单里');
        document.querySelector('#viewTabs button[data-view="audit"]').click();
      }
      a(!/NaN|undefined|Infinity/.test(document.getElementById('stage').innerHTML),'审计视图无脏值');
      return L;
    })()`;
    fails = fails.concat(record(await evaluate(auditExpr)));

    console.log('== 4g2. 「仅风险项」筛选必须覆盖 risk=review ==');
    /* 旧判据只看 verdict==='review'，而三轴表 / 轴断点增删 / 对比被拒绝三类是
       risk==='review' 且 verdict 为空 —— 最该筛出来的项全被漏掉。这里注入 4 条可控账目，
       直接对渲染结果打断言：改回旧判据时 RISK_REVIEW 那一条会消失，断言变红。 */
    var riskFilterExpr = `(function(){
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var S=window.DCMState;
      if(!S.audit) return ['FAIL  前置条件不满足：账本未生成'];
      var orig=S.audit;
      var clone=JSON.parse(JSON.stringify(orig));
      function mk(id,name,risk,verdict,status,hasChange){
        var e=JSON.parse(JSON.stringify(orig.entries[0]));
        e.id=id; e.name=name; e.risk=risk; e.verdict=verdict; e.status=status;
        e.hasChange=hasChange; e.diff=null; e.stats=null; e.axisSeries=null;
        e.reason=''; e.patternLabel=''; e.b=null; e.keyA=''; e.keyB='';
        e.inspect=null; e.analysis=null;
        return e;
      }
      clone.entries=[
        mk('rf1','RISK_HIGH','high','','changed',true),
        mk('rf2','RISK_REVIEW','review','','changed',true),
        mk('rf3','PLAIN_OK','low','pass','changed',true),
        mk('rf4','UNCHANGED_ONE','none','pass','unchanged',false)
      ];
      clone.totals.total=4;
      clone.totals.counts={changed:3,unchanged:1,rejected:0,added:0,deleted:0};
      S.audit=clone;
      S.opts.audit.onlyRisk=true; S.opts.audit.status='all';
      S.opts.audit.type='all'; S.opts.audit.search=''; S.opts.audit.page=0;
      document.querySelector('#viewTabs button[data-view="audit"]').click();
      var h=document.getElementById('stage').innerHTML;
      a(h.indexOf('RISK_REVIEW')>=0,'revert-to-fail：risk=review 必须被「仅风险项」筛出');
      a(h.indexOf('RISK_HIGH')>=0,'risk=high 仍被筛出');
      a(h.indexOf('PLAIN_OK')<0,'低风险已变化项被筛掉');
      a(h.indexOf('UNCHANGED_ONE')<0,'未变化项被筛掉');
      a(h.indexOf('筛选命中 2 条')>=0,'命中条数 = 2（high + review），不是 1 也不是 0');
      S.audit=orig; S.opts.audit.onlyRisk=false; S.opts.audit.status='changes';
      document.querySelector('#viewTabs button[data-view="audit"]').click();
      a(S.audit===orig,'测试后账本已还原，不污染后续用例');
      return L;
    })()`;
    fails = fails.concat(record(await evaluate(riskFilterExpr)));
    // 单独造一份含新增/删除的报告，用于验证这两类也有评审框且能随归档导出
    var auditHtmlForNav = await evaluate(`(function(){
      var C=window.DCMCore;
      var tA=['FESTWERT SC',' WERT 5','END','FESTWERT ONLY_A',' WERT 7','END',
        'GRUPPENKENNFELD MP 3 2',' ST/X 1 2 3',' ST/Y 10',' WERT 1 2 3',
        ' ST/Y 20',' WERT 4 5 6','END'].join('\\n');
      var tB=['FESTWERT SC',' WERT 9','END','FESTWERT ONLY_B',' WERT 7','END',
        'GRUPPENKENNFELD MP 3 2',' ST/X 1 2 3',' ST/Y 10',' WERT 1 2 3',
        ' ST/Y 20',' WERT 4 5 6','END'].join('\\n');
      var dA=C.parseDcm(tA,'A.DCM'); dA.encoding='gbk';
      var dB=C.parseDcm(tB,'B.DCM'); dB.encoding='gbk';
      var au2=C.buildFullAudit([dA,dB],{eps:1e-9});
      var st2={datasets:[dA,dB],mode:'absolute',eps:1e-9,effectiveEps:1e-9,
        opts:{},annotations:{},reportPageSize:12};
      return window.DCMReport.buildAudit(st2,au2);
    })()`);
    fails = fails.concat(record([
      (auditHtmlForNav.indexOf('完整性对账') >= 0 ? 'PASS  ' : 'FAIL  ') + '浏览器内生成全量变化报告',
      (auditHtmlForNav.indexOf('未变化项完整清单') < 0 && auditHtmlForNav.indexOf('dcmAuditSearch') < 0 ?
        'PASS  ' : 'FAIL  ') + '生成的报告不含未变化清单与检索脚本',
      (auditHtmlForNav.indexOf('新增 / 删除 / 被拒绝对象') >= 0 ? 'PASS  ' : 'FAIL  ') +
        '生成的报告含新增 / 删除章节',
      (auditHtmlForNav.indexOf('改名候选') < 0 ? 'PASS  ' : 'FAIL  ') + '生成的报告不做改名配对'
    ]));
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(path.join(TMP, 'audit_report.html'), '\ufeff' + auditHtmlForNav, 'utf8');

    console.log('== 5. 全量版本对比（异步分块） ==');
    var scanExpr = `(async function(){
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var wait=function(fn,ms){return new Promise(function(res,rej){var t0=Date.now();
        (function p(){ if(fn()) return res(true); if(Date.now()-t0>ms) return rej(new Error('timeout'));
          setTimeout(p,40); })();});};
      document.getElementById('btnScan').click();
      await wait(function(){return window.DCMState.versionScan!==null;},8000);
      var S=window.DCMState;
      a(S.versionScan.length===2,'检出 2 项变化 (MAP 改 1 格 + 标量改值)');
      a(S.view==='scan','自动切到变更清单视图');
      a(document.getElementById('stage').innerHTML.indexOf('TQ_Map_M')>=0,'清单含变化的 MAP 名');
      a(document.getElementById('stage').innerHTML.indexOf('加入对比清单')>=0,'清单可一键加入对比清单');
      /* 点「加入对比清单」后必须连内容一起切过去：曾经只切了页签高亮，正文还留在清单里 */
      var bk=S.basket.slice(), keyBak=S.baseKey, before=S.basket.length;
      var e0=S.versionScan[0];
      var addBtn=[].slice.call(document.querySelectorAll('[data-act="scanadd"]'))[0];
      a(!!addBtn,'变更清单行内有加入按钮');
      if(addBtn){
        addBtn.click();
        a(S.view==='heat','点加入后 state.view 切到热力矩阵');
        var act=document.querySelector('#viewTabs button.active');
        a(!!act && act.getAttribute('data-view')==='heat','激活页签是差异热力矩阵');
        a(!!document.querySelector('#stage svg.heat-svg'),
          'revert-to-fail：正文真的渲染成热力图，不只是页签高亮');
        a(document.getElementById('stage').innerHTML.indexOf('对两份 DCM 的全部同名对象逐格比对')<0,
          '旧的变更清单正文已被替换');
        /* 这一对可能在前序用例里已入清单，断言「在清单里」而不是「数量增加」 */
        a(S.basket.some(function(m){return m.key===e0.keyA;}) &&
          S.basket.some(function(m){return m.key===e0.keyB;}),'点中的 A / B 两版都在对比清单里');
        a(S.baseKey===e0.keyA,'基准被设为该对的 A 版');
      }
      S.basket=bk.slice(); S.baseKey=keyBak;
      var ck=document.getElementById('chkOnlyChanged');
      ck.checked=ck.checked; ck.dispatchEvent(new Event('change',{bubbles:true}));
      a(S.basket.length===before,'变更清单用例后对比清单已还原');
      return L;
    })()`;
    fails = fails.concat(record(await evaluate(scanExpr)));

    console.log('== 6. 报告与 3D 交互 ==');
    var repExpr = `(async function(){
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var S=window.DCMState;
      var r=window.DCMReport.build(S);
      a(r.length>15000,'浏览器内生成报告 ('+Math.round(r.length/1024)+' KB)');
      a((r.match(/<svg /g)||[]).length>=5,'报告含多个内联 SVG');
      a(!/(src|href)=["']https?:/i.test(r),'报告无外部资源');
      document.querySelector('#viewTabs button[data-view="surface"]').click();
      var svg=document.querySelector('#stage svg');
      a(!!svg,'3D 曲面 SVG 存在');
      var y0=S.opts.surface.yaw;
      var n0=svg.querySelectorAll('polygon').length;
      a(n0>=1,'曲面有面片可测（'+n0+' 个）');
      svg.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:100,clientY:100}));
      window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:180,clientY:130}));
      await new Promise(function(res){ setTimeout(res,80); });
      var svgMid=document.querySelector('#stage svg');
      var n1=svgMid?svgMid.querySelectorAll('polygon').length:-1;
      a(n1===n0,'revert-to-fail：拖动中网格密度与静止一致（'+n0+' → '+n1+'）');
      a(document.getElementById('tooltip').style.display==='none','拖动时隐藏悬停提示，不留在图上');
      window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
      await new Promise(function(res){ setTimeout(res,80); });
      var svgEnd=document.querySelector('#stage svg');
      var n2=svgEnd?svgEnd.querySelectorAll('polygon').length:-1;
      a(n2===n0,'松手后网格密度不变（'+n2+'），不再跳变');
      a(S.opts.surface.yaw!==y0,'拖拽改变了 3D 视角 yaw');
      var poly=document.querySelector('#stage polygon[data-hi]');
      a(!!poly,'3D 面片带坐标属性');
      a(!document.querySelector('#stage polygon title'),'工具视图不写逐面片 title');
      if(poly){
        poly.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:320,clientY:320}));
        var tt=document.getElementById('tooltip');
        a(tt.style.display==='block' && tt.textContent.indexOf('基准')>=0,'hover 按需生成含基准值的 tooltip');
      }
      var r0=S.result;
      document.getElementById('selBase').dispatchEvent(new Event('change',{bubbles:true}));
      a(S.result===r0,'配置未变时命中 diff 缓存');
      a(!/NaN|undefined/.test(document.getElementById('stage').innerHTML),'重绘后无脏值');
      return L;
    })()`;
    fails = fails.concat(record(await evaluate(repExpr)));

    console.log('== 6b. 跨版本剖面（取代立方） ==');
    var profExpr = `(function(){
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var S=window.DCMState;
      a(!!document.querySelector('#viewTabs button[data-view="profile"]'),'存在「跨版本剖面」页签');
      a(!document.querySelector('#viewTabs button[data-view="cube"]'),'revert-to-fail：旧「3D 立方」页签已移除');
      document.querySelector('#viewTabs button[data-view="profile"]').click();
      a(!!document.querySelector('#stage svg.profile-svg'),'剖面图渲染');
      a(document.getElementById('stage').innerHTML.indexOf('跨版本剖面')>=0,'页面标题写明跨版本剖面');
      a(!!document.querySelector('[data-cmd="profileMax"]'),'有「变化最大的格」按钮');
      document.querySelector('#viewTabs button[data-view="heat"]').click();
      var cells=[].slice.call(document.querySelectorAll('#stage svg.heat-svg rect[data-i]'));
      /* 必须点一个非 (0,0) 的格子：默认 profile 就是 0,0，点 0,0 等于什么都没验证 */
      var rect=cells.filter(function(r){return (+r.getAttribute('data-i'))>0 || (+r.getAttribute('data-j'))>0;})[0];
      a(!!rect,'热力矩阵格子可点（取非原点格）');
      if(rect){
        var wi=+rect.getAttribute('data-i'), wj=+rect.getAttribute('data-j');
        S.opts.profile.i=0; S.opts.profile.j=0;
        rect.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        a(S.view==='profile','点格子后切到剖面页');
        a(S.opts.profile.i===wi && S.opts.profile.j===wj && (wi>0 || wj>0),
          '剖面定位到被点的格子（'+S.opts.profile.i+','+S.opts.profile.j+'）');
      }
      var btn=document.querySelector('[data-cmd="profileMax"]');
      if(btn){
        var c=S.result.cube, bi=0,bj=0,bv=-1;
        for(var k=1;k<c.labels.length;k++){
          for(var j=0;j<c.ny;j++){
            for(var i=0;i<c.nx;i++){
              var d=Math.abs(c.layers[k][j][i]-c.layers[0][j][i]);
              if(d>bv){bv=d;bi=i;bj=j;}
            }
          }
        }
        btn.click();
        a(S.opts.profile.i===bi && S.opts.profile.j===bj,'按钮定位到全局 |Δ| 最大的格（'+bi+','+bj+'）');
        a(!!document.querySelector('#stage svg.profile-svg'),'重绘后剖面图仍在');
      }
      document.querySelector('#viewTabs button[data-view="heat"]').click();
      return L;
    })()`;
    fails = fails.concat(record(await evaluate(profExpr)));

    console.log('== 7. 真实 ALL.DCM (7.7 MB) 载入浏览器 ==');
    try {
      var REAL = 'E:\\Project\\DCM\\ALL.DCM';
      if (!fs.existsSync(REAL)) {
        console.log('  SKIP  未找到真实文件 ' + REAL);
      } else {
        var REAL2 = path.join(TMP, 'ALL_V2.DCM');
        fs.copyFileSync(REAL, REAL2);
        var doc = await cmd('DOM.getDocument', { depth: 1 });
        var q = await cmd('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#fileInput' });
        await cmd('DOM.setFileInputFiles', { files: [REAL, REAL2], nodeId: q.nodeId });
        var realExpr = `(async function(){
          var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
          var wait=function(fn,ms){return new Promise(function(res,rej){var t0=Date.now();
            (function p(){ if(fn()) return res(true); if(Date.now()-t0>ms) return rej(new Error('timeout'));
              setTimeout(p,60); })();});};
          var t0=Date.now();
          document.getElementById('fileInput').dispatchEvent(new Event('change'));
          await wait(function(){return window.DCMState.datasets.length===4;},30000);
          L.push('PASS  浏览器内解析 2×7.7MB 耗时 '+(Date.now()-t0)+' ms');
          var S=window.DCMState, d3=S.datasets[2], d4=S.datasets[3];
          a(d3.stats.totalBlocks===22813 && d4.stats.totalBlocks===22813,'两份真实文件各 22813 块');
          a(d3.maps.length===21090 && d4.maps.length===21090,'各 21090 个可比对象');
          a(d3.stats.invalid===0 && d4.stats.invalid===0,'维度校验 0 异常');
          a(d3.encoding==='gbk' || d3.encoding==='gb18030','GB2312/GBK 解码生效 ('+d3.encoding+')');
          var ng=S.index.groups.filter(function(g){return g.kind==='map2d';}).length;
          a(ng>=159,'2D 同轴组 '+ng+' 个（真实文件 159 + 小样本额外组）');
          a(S.index.groups[0].maps.length>=60,'最大同轴组两版本共 '+S.index.groups[0].maps.length+' 张');
          a(document.getElementById('tree').innerHTML.indexOf('整组加入')>=0,'同轴组树正常渲染');
          document.querySelector('[data-act="group"]').click();
          a(S.basket.length>=60,'整组加入后对比清单 '+S.basket.length+' 项');
          var baseMap=S.basket.filter(function(m){return m.key===S.baseKey;})[0];
          a(baseMap && baseMap.nx===S.index.groups[0].nx,'基准自动切到该同轴组，维度一致');
          var gd=S.result.all.diffs.filter(function(d){return d.ok;}).length;
          a(gd>=50,'可执行对比 '+gd+' 项，未被维度拒绝');
          ['heat','surface','profile'].forEach(function(v){
            document.querySelector('#viewTabs button[data-view="'+v+'"]').click();
            a(document.getElementById('stage').innerHTML.indexOf('<svg')>=0,'大数据集视图 '+v+' 输出 SVG');
          });
          /* 真实 15×11 数据上量拖动前后的面片数：必须一模一样，否则松手会跳 */
          document.querySelector('#viewTabs button[data-view="surface"]').click();
          var sEl=document.querySelector('#stage svg');
          var q0=sEl?sEl.querySelectorAll('polygon').length:0;
          a(q0>20,'真实数据曲面面片数 '+q0+'（足以观察密度变化）');
          if(sEl){
            sEl.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:200,clientY:200}));
            window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:260,clientY:230}));
            await new Promise(function(res){ setTimeout(res,80); });
            var q1=document.querySelector('#stage svg').querySelectorAll('polygon').length;
            window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
            await new Promise(function(res){ setTimeout(res,80); });
            a(q1===q0,'revert-to-fail：真实数据拖动中面片数不变（'+q0+' → '+q1+'）');
          }
          document.querySelector('#viewTabs button[data-view="table"]').click();
          a(document.getElementById('stage').innerHTML.indexOf('<table')>=0,'大数据集逐格明细表渲染');
          return L;
        })()`;
        fails = fails.concat(record(await evaluate(realExpr)));
      }
    } catch (e) {
      console.log('  SKIP  真实大文件浏览器验证未完成: ' + e.message);
    }

    console.log('== 7b. 轴断点不健康必须明确拒绝 ==');
    var axisExpr = `(function(){
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var S=window.DCMState;
      var b=S.basket.filter(function(x){return x.key===S.baseKey;})[0] || S.basket[0];
      var m=JSON.parse(JSON.stringify(b));
      m.x=[m.x[0],m.x[2],m.x[1]].concat(m.x.slice(3));
      m.key='__BAD_AXIS__'; m.name='BAD_AXIS_M'; m.label='BAD_AXIS_M';
      S.basket.push(m);
      document.getElementById('selBase').dispatchEvent(new Event('change',{bubbles:true}));
      var h=document.getElementById('stage').innerHTML;
      a(h.indexOf('轴断点不健康')>=0,'轴不安全出现红色告警');
      a(h.indexOf('拒绝')>=0,'告警写明已拒绝');
      S.basket.pop();
      document.getElementById('selBase').dispatchEvent(new Event('change',{bubbles:true}));
      a(document.getElementById('stage').innerHTML.indexOf('轴断点不健康')<0,'移除坏对象后告警消失');
      return L;
    })()`;
    fails = fails.concat(record(await evaluate(axisExpr)));

    console.log('== 7c. 大量对比下的报告分页 ==');
    var pageExpr = `(function(){
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var S=window.DCMState;
      var good=S.result.all.diffs.filter(function(d){return d.ok;}).length;
      a(good>20,'当前 '+good+' 项对比，具备分页条件');
      var full=window.DCMReport.build(Object.assign({}, S, {reportPageSize:200}));
      var paged=window.DCMReport.build(Object.assign({}, S, {reportPageSize:3}));
      a(paged.indexOf('报告规模')>=0,'大量对比时报告给出规模说明');
      a((paged.match(/class="heat-svg"/g)||[]).length===3,'只展开 3 张完整热力矩阵');
      a(paged.indexOf('紧凑清单')>=0,'其余对比折叠为紧凑清单');
      a(paged.length < full.length*0.75,'分页后报告明显变小 ('+Math.round(paged.length/1024)+' KB < '+Math.round(full.length/1024)+' KB，3D 章节为固定开销)');
      a(paged.indexOf('附录：会话配置 JSON')>=0,'分页报告仍可复现');
      return L;
    })()`;
    fails = fails.concat(record(await evaluate(pageExpr)));

    console.log('== 7d. 全量变化报告内容约束与批注再导出 ==');
    var reportFile = path.join(TMP, 'audit_report.html');
    if (!fs.existsSync(reportFile)) {
      console.log('  SKIP  未生成全量变化报告');
    } else {
      var repUrl = encodeURI('file:///' + reportFile.replace(/\\/g, '/'));
      await cmd('Page.navigate', { url: repUrl });
      await cmd('Runtime.enable');
      await cmd('Log.enable');
      var navReady = false;
      for (var w2 = 0; w2 < 40; w2++) {
        var rr2 = await cmd('Runtime.evaluate', {
          expression: 'document.readyState + "|" + !!document.getElementById("dcm-ann-data")',
          returnByValue: true
        });
        if (rr2 && rr2.result && rr2.result.value === 'complete|true') { navReady = true; break; }
        await sleep(150);
      }
      fails = fails.concat(record([(navReady ? 'PASS  ' : 'FAIL  ') + '全量变化报告页面 DOM 就绪']));
      if (navReady) {
        var repExpr2 = `(function(){
          var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
          var body=document.documentElement.outerHTML;
          var tb=document.querySelector('.ann-topbar');
          var main=document.querySelector('main');
          var firstSec=main?main.querySelector('section'):null;
          a(!!tb && !!main && main.firstElementChild===tb,'顶部工具条是 main 的第一个子元素（报告最上方）');
          a(!!firstSec && !!tb && ((tb.compareDocumentPosition(firstSec)&4)!==0),'工具条位于所有章节之前');
          var acts=tb?tb.querySelector('.ann-actions'):null;
          var notes=tb?tb.querySelector('.ann-notes'):null;
          a(!!acts && acts.querySelectorAll('button').length===2,'按钮行含另存 / 归档两个按钮');
          a(!!notes && notes.querySelectorAll('.hint').length===3,'说明块含三段各自成行的说明');
          a(!!acts && !!notes && ((acts.compareDocumentPosition(notes)&4)!==0),'说明块在按钮行下方');
          // 报告内 detail 表格必须有真实边框/表头背景，不能只有 font-variant-numeric 退化成散乱文本
          var dt=document.querySelector('table.detail');
          if(dt){
            var dth=dt.querySelector('th'), dtd=dt.querySelector('td');
            var sth=dth?getComputedStyle(dth):null, std=dtd?getComputedStyle(dtd):null;
            a(!!sth && sth.backgroundColor!=='rgba(0, 0, 0, 0)' && sth.backgroundColor!=='transparent',
              '报告表格表头有背景色（computed style）');
            a(!!std && std.borderTopWidth!=='0px' && std.borderTopStyle!=='none',
              '报告表格单元格有边框线（computed style）');
          } else {
            a(body.indexOf('table class="detail')<0,'报告未生成 detail 表格时断言一致');
          }
          a(typeof dcmAuditSearch==='undefined' && !document.getElementById('audit-q'),
            'revert-to-fail：报告不再带未变化清单检索控件/脚本');
          a(body.indexOf('未变化项完整清单')<0 && body.indexOf('audit-unchanged-data')<0,
            'revert-to-fail：报告不含未变化项清单与内嵌 JSON');
          a(body.indexOf('改名候选')<0 && body.indexOf('未启用改名配对')>=0,
            '报告不做改名配对并明示边界');
          a(body.indexOf('全量变化摘要')>=0 && body.indexOf('新增 / 删除 / 被拒绝对象')>=0,
            '报告含变化摘要与新增/删除章节');
          a(body.indexOf('card-l">建议')<0 && body.indexOf('建议驳回')<0,
            'revert-to-fail：报告不给建议');
          a(typeof dcmAnnotatedHtml==='function','报告自带归档导出能力');
          a(body.indexOf('新增 / 删除 / 被拒绝对象评审')>=0,'报告含新增/删除评审小节');
          var reasons=document.querySelectorAll('[data-ann][data-field="reason"]');
          a(reasons.length>=3,'报告含变更 / 新增 / 删除多项评审框 ('+reasons.length+')');
          var inp=null;
          for(var q=0;q<reasons.length;q++){
            var id=reasons[q].getAttribute('data-ann');
            if(/::added|::deleted/.test(id)){ inp=reasons[q]; break; }
          }
          a(!!inp,'新增 / 删除项也有与变更项一致的可编辑批注框');
          if(inp){
            inp.value='新增删除评审意见B';
            var h=dcmAnnotatedHtml('data:image/png;base64,AAAA');
            a(h.indexOf('value="新增删除评审意见B"')>=0,'新增/删除批注写入归档报告（不是只进 JSON）');
            a(h.indexOf('data-dcm-signed="1"')>=0 && h.indexOf('sign-img')>=0,
              '手写签名写入归档报告');
            a(h.indexOf('审核人：')<0 && h.indexOf('填写审核人')<0,'归档报告不采集可造假的姓名');
            a(h.indexOf('data-dcm-archived="1"')>=0,'归档报告标记只读');
            a(h.indexOf('disabled="disabled"')>=0,'归档报告所有批注控件 disabled');
            a(h.indexOf('导出归档报告</button>')<0,'归档报告不再提供编辑/导出入口');
            a(h.indexOf('<!DOCTYPE html>')===0,'再导出仍是完整自包含 HTML');
            a(h.indexOf('完整性对账')>=0,'再导出保留全部章节');
            inp.value='';
            var h2=dcmAnnotatedHtml();
            a(h2.indexOf('新增删除评审意见B')<0,'revert-to-fail：清空批注后再导出不含旧文本');
          }
          a(!/(src|href)=["']https?:/i.test(document.documentElement.outerHTML),'报告零外部资源');
          return L;
        })()`;
        fails = fails.concat(record(await evaluate(repExpr2)));
      }
    }

    console.log('== 7e. 归档报告真实只读性（新窗口打开再验证） ==');
    var archiveExpr = `(async function(){
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var h=dcmAnnotatedHtml('data:image/png;base64,AAAA');
      var f=document.createElement('iframe');
      /* 离屏但参与布局：display:none 时 getBoundingClientRect 全为 0，量不出页脚是否两行 */
      f.style.position='absolute'; f.style.left='-9999px'; f.style.top='0';
      f.style.width='1080px'; f.style.height='900px'; f.style.border='0';
      document.body.appendChild(f);
      f.srcdoc=h;
      await new Promise(function(r){ f.onload=r; setTimeout(r,2500); });
      var w=f.contentWindow, d=w.document;
      a(!!w && typeof w.dcmIsArchived==='function','归档页加载内联脚本');
      a(w.dcmIsArchived()===true,'归档页标记为已归档');
      a(d.documentElement.getAttribute('data-dcm-signed')==='1','归档报告带手写签名标记');
      a(d.body.textContent.indexOf('审核人手写签名')>=0,'手写签名标签在正文中可见');
      a(!!d.querySelector('.sign-img'),'归档报告含签名图像');
      a(d.body.textContent.indexOf('归档时间：')>=0 && d.body.textContent.indexOf('报告 ID：')>=0,
        '归档时间与报告 ID 写入正文');
      a(d.body.textContent.indexOf('审核人：')<0,'正文不含可造假的姓名');
      a(d.body.textContent.indexOf('已归档 · 批注只读')>=0,'正文标注批注只读');
      /* 冻结是克隆整棵 DOM 再改属性，署名与使用声明必须跟着进归档版 */
      a(d.body.textContent.indexOf('作者 Henry · 供标定评审使用')>=0,
        '归档报告头部仍带作者与用途');
      a(d.body.textContent.indexOf('未经许可请勿转售或二次分发')>=0,
        '归档报告页脚仍带使用声明');
      /* 这个 iframe 是离屏但有布局的（left:-9999px），rect 才量得出来；
         display:none 的 iframe 里 rect 恒为 0，那样的断言是空的 */
      var fa=d.querySelector('.foot-attr'), fm=d.querySelector('.foot-meta');
      var ga=fa?fa.getBoundingClientRect():null, gm=fm?fm.getBoundingClientRect():null;
      a(!!ga && !!gm && ga.height>0 && gm.height>0,'页脚两行都有实际高度（不是空盒）');
      if(ga && gm){
        a(gm.top>=ga.bottom-1,'页脚署名与说明分成两行（署名底 '+ga.bottom.toFixed(1)+
          ' ≤ 说明顶 '+gm.top.toFixed(1)+'）');
      }
      var ctrls=d.querySelectorAll('[data-ann]');
      a(ctrls.length>0,'归档页仍保留批注内容供查阅');
      var allDisabled=true;
      ctrls.forEach(function(el){ if(!el.disabled) allDisabled=false; });
      a(allDisabled,'revert-to-fail：归档页所有批注控件 disabled，无法再修改');
      a(!d.querySelector('.ann-export button'),'归档页移除导出按钮');
      var atb=d.querySelector('.ann-topbar');
      a(!!atb && atb.textContent.indexOf('已归档')>=0,'归档版顶部工具条替换为只读提示');
      a(!!atb && atb.textContent.indexOf('实时保存仅在本机生效')<0,
        '归档版顶部不再残留「实时保存仅在本机生效」等失效说明');
      var before=d.getElementById('dcm-ann-data').textContent;
      var ainp=d.querySelector('[data-ann][data-field="reason"]');
      if(ainp) ainp.value='尝试篡改归档批注';
      w.dcmSyncAnnotations();
      a(d.getElementById('dcm-ann-data').textContent===before,'归档页同步逻辑不改写批注数据');
      var clicked=0;
      w.HTMLAnchorElement.prototype.click=function(){clicked++;};
      w.alert=function(){};
      w.dcmExportAnnotated();
      a(clicked===0,'归档页拦截再次导出');
      a(!/(src|href)=["']https?:/i.test(d.documentElement.outerHTML),'归档页零外部资源');
      return L;
    })()`;
    fails = fails.concat(record(await evaluate(archiveExpr)));

    console.log('== 7f. 批注持久化到原报告与可编辑版另存 ==');
    var persistExpr = `(async function(){
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      a(typeof dcmLoadLocal==='function' && typeof dcmExportEditable==='function',
        '原报告提供本机恢复与可编辑版另存');
      a(!!document.querySelector('.ann-export button.ghost'),'原报告有「另存含批注的可编辑副本」按钮');
      var pi=document.querySelector('[data-ann][data-field="reason"]');
      a(!!pi,'原报告存在可编辑批注控件');
      if(!pi) return L;
      pi.value='持久化批注验证A';
      pi.dispatchEvent(new Event('input',{bubbles:true}));
      var saved=null, lsOk=true;
      try{ saved=localStorage.getItem(dcmStoreKey()); }catch(e){ lsOk=false; }
      a(lsOk && !!saved && saved.indexOf('持久化批注验证A')>=0,'编辑批注实时写入本机存储');
      a(document.getElementById('dcm-save-state').textContent.indexOf('批注已保存')>=0,
        '页面显示批注已保存状态');
      var editable=dcmAnnotatedHtml('',false);
      a(editable.indexOf('value="持久化批注验证A"')>=0,'可编辑版含最新批注');
      a(editable.indexOf('data-dcm-archived="1"')<0 && editable.indexOf('disabled="disabled"')<0,
        'revert-to-fail：可编辑版不冻结批注');
      a(editable.indexOf('另存含批注的可编辑副本')>=0,'可编辑版仍可继续编辑与导出');
      var archived=dcmAnnotatedHtml('data:image/png;base64,AAAA');
      a(archived.indexOf('data-dcm-archived="1"')>=0 && archived.indexOf('disabled="disabled"')>=0,
        '归档版仍然只读（未被持久化改动破坏）');
      var f=document.createElement('iframe');
      f.style.display='none'; document.body.appendChild(f);
      f.srcdoc=editable;
      await new Promise(function(r){ f.onload=r; setTimeout(r,2500); });
      var w=f.contentWindow, d=w.document;
      var ri=d.querySelector('[data-ann][data-field="reason"]');
      a(!!ri && ri.value==='持久化批注验证A','重新打开原报告自动恢复已保存的批注');
      a(!!ri && !ri.disabled,'恢复后的原报告批注仍可编辑');
      a(!!w.dcmExportAnnotated && !!w.dcmExportEditable,'恢复后的原报告仍可导出归档/可编辑版');
      var clicked=0;
      w.HTMLAnchorElement.prototype.click=function(){clicked++;};
      w.dcmExportEditable();
      a(clicked===1,'「另存含批注的可编辑副本」触发一次下载');
      return L;
    })()`;
    fails = fails.concat(record(await evaluate(persistExpr)));

    console.log('== 7g. 轴定义计入标定变化（真实 DOM / 加入对比清单不再静默失败） ==');
    // 7d~7f 已把页面导航到报告文件，这里回到工具页上下文（否则 window.DCMCore 不存在）
    await cmd('Page.navigate', { url: fileUrl });
    await cmd('Runtime.enable');
    await cmd('Log.enable');
    var axReady = false;
    for (var w3 = 0; w3 < 40; w3++) {
      var rr3 = await cmd('Runtime.evaluate', {
        expression: 'document.readyState + "|" + !!window.DCMCore + "|" + !!document.getElementById("stage")',
        returnByValue: true
      });
      if (rr3 && rr3.result && rr3.result.value === 'complete|true|true') { axReady = true; break; }
      await sleep(150);
    }
    fails = fails.concat(record([(axReady ? 'PASS  ' : 'FAIL  ') + '轴定义验证前工具页重新就绪']));
    var axisUiExpr = `(async function(){
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var wait=function(fn,ms){return new Promise(function(res,rej){var t0=Date.now();
        (function p(){ if(fn()) return res(true); if(Date.now()-t0>ms) return rej(new Error('timeout'));
          setTimeout(p,60); })();});};
      var C=window.DCMCore, S=window.DCMState;
      function mk(points,file){
        return C.parseDcm(['FESTWERT SC',' WERT 5','END',
          'GRUPPENKENNFELD MP 3 2',' ST/X 1 2 3',' ST/Y 10',' WERT 1 2 3',
          ' ST/Y 20',' WERT 4 5 6','END',
          'STUETZSTELLENVERTEILUNG AX1 '+points.length,' EINHEIT_X "V"',
          ' ST/X '+points.join(' '),'END'].join('\\n'),file);
      }
      var d1=mk([0,1.1,4,5],'AX_A.DCM'), d2=mk([0,1.2,4,5],'AX_B.DCM');
      d1.encoding='gbk'; d2.encoding='gbk';
      S.datasets=[d1,d2]; S.index=C.buildIndex([d1,d2]);
      S.audit=null; S.basket=[]; S.baseKey=null; S.result=null;
      S.opts.audit.status='changes'; S.opts.audit.type='all'; S.opts.audit.detailId='';
      document.querySelector('#viewTabs button[data-view="audit"]').click();
      var go=document.querySelector('[data-cmd="doAudit"]');
      a(!!go,'含轴定义数据集下变化清单按钮可用');
      if(!go) return L;
      go.click();
      await wait(function(){return !!S.audit;},8000);
      a(S.audit.ok && S.audit.identity.ok,'轴定义场景账本恒等式通过');
      a(!!S.audit.totals.byType.axis && S.audit.totals.byType.axis.total===1,
        'byType 含 1 个轴定义标定量');
      a(S.audit.totals.total===3,'账目 = 2 数值对象 + 1 轴定义');
      var axE=S.audit.entries.filter(function(e){return e.type==='axis';})[0];
      a(!!axE && axE.status==='changed','轴断点变化计入 changed');
      a(!!axE && axE.inspect.isolated.length===0,'轴断点变化不误判孤立突变点');
      var h=document.getElementById('stage').innerHTML;
      a(h.indexOf('轴定义')>=0 && h.indexOf('已作为正式标定量计入上表')>=0,
        '变化清单页明确轴定义已计入账本');
      a(h.indexOf('轴定义（附录，不计入标定量）')<0,'revert-to-fail：不再有附录不计入的旧行');
      var tsel=document.querySelector('[data-opt="audit.type"]');
      a(!!tsel && tsel.innerHTML.indexOf('轴定义')>=0,'类型筛选下拉含轴定义选项');
      if(tsel){
        tsel.value='axis'; tsel.dispatchEvent(new Event('change',{bubbles:true}));
        a(S.opts.audit.type==='axis','可单独筛选轴定义类型');
        var t2=document.querySelector('[data-opt="audit.type"]');
        t2.value='all'; t2.dispatchEvent(new Event('change',{bubbles:true}));
      }
      // 关键回归：轴定义不在 index.all，findMap 必须现场包装，否则「加入对比清单」静默失败
      var add=document.querySelector('[data-act="auditadd"][data-id="'+axE.id+'"]');
      a(!!add,'轴定义变化项提供「加入对比清单」按钮');
      if(add){
        add.click();
        a(S.basket.some(function(m){return m.isAxisDef && m.type==='axis';}),
          'revert-to-fail：轴定义对象确实进入对比清单（findMap 现场包装生效）');
        a(!!S.result && S.result.base,'加入后对比结果可用');
        document.querySelector('#viewTabs button[data-view="audit"]').click();
      }
      // 证据块：轴定义出 Δ 剖面图与断点专用表头
      var det=document.querySelector('[data-act="auditdetail"][data-id="'+axE.id+'"]');
      if(det){
        det.click();
        var h2=document.getElementById('stage').innerHTML;
        a(h2.indexOf('delta-profile-svg')>=0,'轴定义证据含一维 Δ 剖面图');
        a(h2.indexOf('A 版断点值')>=0 && h2.indexOf('B 版断点值')>=0,
          '轴定义证据表用断点专用表头');
        var axTable=document.querySelector('#stage table.dcm-tbl');
        if(axTable){
          var axThs=axTable.querySelectorAll('thead th');
          a(axThs.length===5,'轴定义证据表 5 列（重复序号列已合并），实际 '+axThs.length);
          a(axTable.querySelectorAll('tbody tr.chg').length===1,'只有变化的那 1 行高亮');
          var chgRow=axTable.querySelector('tbody tr.chg');
          a(!!chgRow && getComputedStyle(chgRow).backgroundColor!=='rgba(0, 0, 0, 0)',
            '变化行有真实背景高亮（computed style）');
          var numTd=axTable.querySelector('td.num');
          a(!!numTd && getComputedStyle(numTd).textAlign==='right','数值列右对齐');
          a(axTable.querySelector('thead .unit')!==null,'单位标注在表头');
        } else { a(false,'轴定义证据表未渲染'); }
      }
      a(!/NaN|undefined|Infinity/.test(document.getElementById('stage').innerHTML),
        '轴定义视图无脏值');

      // 报告里轴定义评审批注必须集中在「轴定义断点变化类型」一节，且每个账目 id 全报告恰好一组控件
      var repHtml=window.DCMReport.buildAudit(
        {datasets:S.datasets,mode:'absolute',eps:1e-9,effectiveEps:1e-9,
         opts:{},annotations:{},reportPageSize:12}, S.audit);
      var fr=document.createElement('iframe');
      // 离屏但参与布局：display:none 时 getBoundingClientRect 全为 0，量不出真实间距
      fr.style.position='absolute'; fr.style.left='-9999px'; fr.style.top='0';
      fr.style.width='1080px'; fr.style.height='900px'; fr.style.border='0';
      document.body.appendChild(fr);
      fr.srcdoc=repHtml;
      await new Promise(function(r){ fr.onload=r; setTimeout(r,2500); });
      var rd=fr.contentDocument;
      /* 卡片区与紧随元素不能零间距贴合（修复前实测 gap=0px）。
         对账与摘要合并后，卡片后面跟的不一定是表格，所以按「任意后继元素」量，
         并单独守住 .cards 的下外边距本身。 */
      var cardGaps=[], tightGaps=0, cardMbMin=999;
      if(rd) rd.querySelectorAll('.cards').forEach(function(c){
        var mb=parseFloat(getComputedStyle(c).marginBottom)||0;
        if(mb<cardMbMin) cardMbMin=mb;
        var n=c.nextElementSibling;
        if(n){
          var gp=n.getBoundingClientRect().top-c.getBoundingClientRect().bottom;
          cardGaps.push(+gp.toFixed(1));
          if(gp<12) tightGaps++;
        }
      });
      a(cardGaps.length>=1,'报告存在卡片区（'+cardGaps.length+' 处后继元素可量间距）');
      a(tightGaps===0,'revert-to-fail：卡片区与后继元素间距均 ≥12px（实测 '+cardGaps.join(' / ')+' px）');
      a(cardMbMin>=12,'revert-to-fail：.cards 下外边距 ≥12px（实测 '+cardMbMin+'px）');
      var secs=rd?rd.querySelectorAll('section'):[];
      var sec6=null;
      secs.forEach(function(sc){ var hh=sc.querySelector('h2');
        if(hh && hh.textContent.indexOf('轴定义断点变化类型')>=0) sec6=sc; });
      a(!!sec6,'报告存在「轴定义断点变化类型」一节');
      if(sec6){
        a(sec6.textContent.indexOf('轴定义变化评审批注')>=0,'「轴定义断点变化类型」一节含集中评审小节');
        // 轴定义分章统计行与完整证据也必须在「轴定义断点变化类型」一节 section 内（真实 DOM，不是只查字符串）
        // 注意：本段整个表达式是模板字符串，正则里的 \d 必须写成 \\d，否则反斜杠会被吞掉
        var statHead=null;
        sec6.querySelectorAll('h3').forEach(function(h){
          if(/轴定义 STUETZSTELLENVERTEILUNG · \\d+ 项/.test(h.textContent)) statHead=h;
        });
        a(!!statHead && /未变化 \\d+（仅计数）/.test(statHead.textContent),
          '「轴定义断点变化类型」一节 section 内含轴定义分章统计行（含未变化仅计数）');
        a(!!sec6.querySelector('.delta-profile-svg'),'「轴定义断点变化类型」一节含轴定义 Δ 剖面证据图');
        var sec4=null;
        secs.forEach(function(sc){ var hh=sc.querySelector('h2');
          if(hh && hh.textContent.indexOf('按对象类型分章')>=0) sec4=sc; });
        // 第 4 章仍会有数组/曲线的一维 Δ 剖面，判据必须用轴定义专用标题，不能笼统查 svg；
        // 模板字符串里正则的数字量词要双写反斜杠
        a(!!sec4 && !/轴定义 STUETZSTELLENVERTEILUNG · \\d+ 项/.test(sec4.textContent) &&
          sec4.textContent.indexOf('断点/序列 Δ 剖面') < 0,
          'revert-to-fail：第 4 章不再展开轴定义统计与证据');
        var inSec6=sec6.querySelectorAll('[data-ann][data-field="verdict"]');
        var allVer=rd.querySelectorAll('[data-ann][data-field="verdict"]');
        a(inSec6.length===1,'「轴定义断点变化类型」一节恰好 1 组轴变化评审控件 ('+inSec6.length+')');
        if(inSec6.length){
          var key=inSec6[0].getAttribute('data-ann');
          var dup=0; allVer.forEach(function(el){ if(el.getAttribute('data-ann')===key) dup++; });
          a(dup===1,'revert-to-fail：轴变化账目结论控件全报告恰好 1 个 ('+dup+')');
        }
        // 归档后这些控件仍要只读
        var archived=fr.contentWindow.dcmAnnotatedHtml('data:image/png;base64,AAAA');
        a(archived.indexOf('data-dcm-archived="1"')>=0 && archived.indexOf('disabled="disabled"')>=0,
          '「轴定义断点变化类型」一节评审控件随归档一起冻结为只读');
      }
      document.body.removeChild(fr);
      return L;
    })()`;
    fails = fails.concat(record(await evaluate(axisUiExpr)));

    console.log('== 7h. 载入失败不能留下半死界面 ==');
    /* 旧实现只在「最后一个文件成功」时重建索引。这里故意把坏文件排在最后：
       旧代码 done 只在成功分支等到 list.length，索引永不重建，好文件白读。 */
    var failExpr = `(async function(){
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var S=window.DCMState;
      var wait=function(fn,ms){return new Promise(function(res,rej){var t0=Date.now();
        (function p(){ if(fn()) return res(true); if(Date.now()-t0>ms) return rej(new Error('timeout'));
          setTimeout(p,40); })();});};
      var before=S.datasets.length;
      var good='GRUPPENKENNFELD NEW_M 2 2\\n ST/X 1 2\\n ST/Y 3\\n WERT 1 2\\n ST/Y 4\\n WERT 3 4\\nEND';
      var dt=new DataTransfer();
      dt.items.add(new File([good],'GOOD_EXTRA.DCM',{type:'text/plain'}));
      dt.items.add(new File(['x'],'BROKEN.DCM',{type:'text/plain'}));
      var inp=document.getElementById('fileInput');
      var orig=File.prototype.arrayBuffer;
      File.prototype.arrayBuffer=function(){
        if(this.name==='BROKEN.DCM') return Promise.reject(new Error('模拟读取失败'));
        return orig.apply(this,arguments);
      };
      inp.files=dt.files;
      inp.dispatchEvent(new Event('change',{bubbles:true}));
      await wait(function(){return S.datasets.length===before+1;},6000);
      a(S.datasets.length===before+1,'好文件仍然被载入，不因同批失败而丢弃');
      a(!!S.index && S.index.all.some(function(x){return x.name==='NEW_M';}),
        'revert-to-fail：索引已重建（旧实现在最后一个文件失败时不重建）');
      var sh=document.getElementById('stage').innerHTML;
      a(sh.indexOf('载入失败')>=0,'界面明确提示有文件载入失败');
      a(sh.indexOf('BROKEN.DCM')>=0,'失败原因带文件名，不是静默跳过');
      a(document.getElementById('statusText').textContent.indexOf('失败 1 个')>=0,'状态栏统计失败数');
      File.prototype.arrayBuffer=orig;
      inp.files=null;
      S.datasets.pop();
      S.index=window.DCMCore.buildIndex(S.datasets);
      a(S.datasets.length===before,'测试后数据源已还原，不污染后续用例');
      return L;
    })()`;
    fails = fails.concat(record(await evaluate(failExpr)));

    console.log('== 7i. 数据源删除入口 ==');
    /* 用合成数据源验证，不动真实载入的两份文件。重点覆盖「同名文件载入两次」：
       按文件名过滤会把另一份的清单条目一起删掉，必须按数据源 id 过滤。 */
    fails = fails.concat(record(await evaluate(`(function(){
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var S=window.DCMState;
      var ds0=S.datasets.slice(), bk0=S.basket.slice(), base0=S.baseKey;
      var before=ds0.length;
      var fake=window.DCMCore.parseDcm('FESTWERT ZZ_FAKE\\n WERT 1\\nEND','FAKE_DS.DCM');
      fake.encoding='gbk';
      S.datasets.push(fake);
      S.index=window.DCMCore.buildIndex(S.datasets);
      document.getElementById('chkOnlyChanged').click();
      var btns=[].slice.call(document.querySelectorAll('#dsList [data-act="dsdel"]'));
      a(btns.length===before+1,'每个数据源都有删除入口（'+btns.length+' 个）');
      var target=btns.filter(function(b){return b.getAttribute('data-ds')===fake.id;})[0];
      a(!!target,'删除按钮按数据源 id 绑定，不靠行序号');
      if(target){
        target.click();
        a(S.datasets.length===before,'删除后数据源数量回退');
        a(S.basket.length===bk0.length,'删除别的数据源不影响对比清单');
        a(!S.index || !S.index.all.some(function(x){return x.srcFile==='FAKE_DS.DCM';}),
          '索引已重建，不含被删文件');
        a(document.getElementById('dsList').innerHTML.indexOf('FAKE_DS.DCM')<0,'列表不再显示已删文件');
      }
      var d1=window.DCMCore.parseDcm('FESTWERT DUP_X\\n WERT 1\\nEND','SAME.DCM');
      var d2=window.DCMCore.parseDcm('FESTWERT DUP_X\\n WERT 2\\nEND','SAME.DCM');
      S.datasets.push(d1,d2);
      var idx2=window.DCMCore.buildIndex(S.datasets);
      var mA=idx2.all.filter(function(x){return x.id===d1.id;})[0];
      var mB=idx2.all.filter(function(x){return x.id===d2.id;})[0];
      S.basket.push(mA,mB);
      S.index=idx2;
      document.getElementById('chkOnlyChanged').click();
      var btn2=[].slice.call(document.querySelectorAll('#dsList [data-act="dsdel"]'))
        .filter(function(b){return b.getAttribute('data-ds')===d1.id;})[0];
      a(!!btn2,'同名文件的其中一份也能被精确定位');
      if(btn2){
        btn2.click();
        a(S.basket.some(function(m){return m.id===d2.id;}),'revert-to-fail：同名文件的另一份清单条目仍在（按 id 而非文件名过滤）');
        a(!S.basket.some(function(m){return m.id===d1.id;}),'被删那份的清单条目已移除');
        a(S.datasets.length===before+1,'只删掉一份，同名的另一份保留');
      }
      S.datasets=ds0.slice(); S.basket=bk0.slice(); S.baseKey=base0;
      S.index=ds0.length?window.DCMCore.buildIndex(S.datasets):null;
      document.getElementById('chkOnlyChanged').click();
      a(S.datasets.length===before && S.basket.length===bk0.length,'测试后数据源与对比清单已还原');
      return L;
    })()`)));

    console.log('== 7j. 阈值同源 / 载入顺序 / CSV 导出 ==');
    var batchExpr = `(async function(){
      var L=[]; var a=function(c,m){L.push((c?'PASS  ':'FAIL  ')+m);};
      var S=window.DCMState, C=window.DCMCore;
      var wait=function(fn,ms){return new Promise(function(res,rej){var t0=Date.now();
        (function p(){ if(fn()) return res(true); if(Date.now()-t0>ms) return rej(new Error('timeout'));
          setTimeout(p,40); })();});};

      // 1) 自动阈值：图与统计必须同源
      var dsA=C.parseDcm('GRUPPENKENNFELD EPS_M 2 2\\n ST/X 1 2\\n ST/Y 10\\n WERT 1234.5 1234.5\\n ST/Y 20\\n WERT 1234.5 1234.5\\nEND','EPS_A.DCM');
      var m0=dsA.maps[0], m1=JSON.parse(JSON.stringify(m0));
      m1.v[0][0]=1234.5001; m1.label='EPS_OTHER'; m1.srcFile='EPS_B.DCM';
      var bBak=S.basket.slice(), keyBak=S.baseKey, autoBak=S.autoThreshold,
          ocBak=S.opts.onlyChanged, ck=document.getElementById('chkOnlyChanged');
      S.basket=[m0,m1]; S.baseKey=m0.key; S.autoThreshold=true;
      /* 显式设值，不要用 click() 取反：前序用例可能已把 onlyChanged 留成 true */
      ck.checked=true; ck.dispatchEvent(new Event('change',{bubbles:true}));
      document.querySelector('#viewTabs button[data-view="heat"]').click();
      var heat=document.querySelector('#stage svg.heat-svg');
      var masked=heat?(heat.innerHTML.match(/fill="#FAFAF8"/g)||[]).length:0;
      a(S.effectiveEps>1e-6,'自动阈值确实生效（effectiveEps='+S.effectiveEps.toExponential(2)+'）');
      a(S.result.all.diffs[0].stats.changed===0,'阈值以下的微小差统计为 0 格变化');
      a(masked===4,'revert-to-fail：热力图按同源阈值遮住全部 4 格（实际 '+masked+'）');
      S.basket=bBak; S.baseKey=keyBak; S.autoThreshold=autoBak;
      ck.checked=ocBak; ck.dispatchEvent(new Event('change',{bubbles:true}));
      a(S.opts.onlyChanged===ocBak,'阈值用例后状态已还原');

      // 2) 载入顺序不能由读取快慢决定
      var before=S.datasets.length;
      var origAB=File.prototype.arrayBuffer;
      File.prototype.arrayBuffer=function(){
        var nm=this.name, p=origAB.apply(this,arguments);
        if(nm!=='SLOW_FIRST.DCM') return p;
        return new Promise(function(res){ setTimeout(function(){ res(p); },700); });
      };
      var dt=new DataTransfer();
      dt.items.add(new File(['FESTWERT SLOW_A\\n WERT 1\\nEND'],'SLOW_FIRST.DCM',{type:'text/plain'}));
      dt.items.add(new File(['FESTWERT FAST_B\\n WERT 2\\nEND'],'FAST_SECOND.DCM',{type:'text/plain'}));
      var inp=document.getElementById('fileInput');
      inp.files=dt.files;
      inp.dispatchEvent(new Event('change',{bubbles:true}));
      await wait(function(){return S.datasets.length===before+2;},6000);
      File.prototype.arrayBuffer=origAB;
      inp.files=null;
      var tail=S.datasets.slice(-2).map(function(d){return d.fileName;}).join('|');
      a(tail==='SLOW_FIRST.DCM|FAST_SECOND.DCM',
        'revert-to-fail：数据集顺序 = 选择顺序，与读取快慢无关（实际 '+tail+'）');
      S.datasets.length=before;
      S.index=C.buildIndex(S.datasets);
      document.getElementById('chkOnlyChanged').click();
      a(S.datasets.length===before,'载入顺序用例后数据源已还原');

      // 3) CSV 导出
      document.querySelector('#viewTabs button[data-view="table"]').click();
      var btn=document.querySelector('[data-cmd="csvExport"]');
      a(!!btn,'逐格明细提供导出 CSV 按钮');
      if(btn){
        var cap=null, oc=HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click=function(){ cap={name:this.download, href:this.href}; };
        btn.click();
        HTMLAnchorElement.prototype.click=oc;
        a(!!cap && /\\.csv$/.test(cap.name||''),'导出文件名以 .csv 结尾（'+(cap?cap.name:'无')+'）');
        if(cap && cap.href){
          /* fetch().text() 会按规范剥掉 BOM，只能看原始字节 */
          var bytes=await fetch(cap.href).then(function(r){return r.arrayBuffer();});
          var u8=new Uint8Array(bytes);
          a(u8[0]===0xEF && u8[1]===0xBB && u8[2]===0xBF,'CSV 带 UTF-8 BOM（EF BB BF），Excel 打开不乱码');
          var txt=new TextDecoder().decode(u8);
          a(txt.indexOf('表名')>=0 && txt.indexOf('Y 轴值')>=0,'CSV 首行是表头');
          a(txt.split('\\r\\n').length-1>=1,'CSV 至少一行数据');
        }
      }
      document.querySelector('#viewTabs button[data-view="heat"]').click();
      return L;
    })()`;
    fails = fails.concat(record(await evaluate(batchExpr)));

    console.log('== 8. 运行时异常 ==');
    await sleep(300);
    fails = fails.concat(record([errors.length ? 'FAIL  捕获到 ' + errors.length + ' 个运行时错误: ' + errors.slice(0, 3).join(' | ') :
      'PASS  无 console.error / 未捕获异常']));

    console.log('');
    if (fails.length) { console.log('FAILED ' + fails.length + ' 项'); process.exitCode = 1; }
    else console.log('ALL PASS (headless DOM, 无截屏无录屏)');
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    try { edge.kill(); } catch (e) {}
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  }
}
main().catch(function (e) { console.error('测试失败: ' + e.message); process.exit(1); });
