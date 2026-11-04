/* Demo 层：用浏览器模拟后端（账号、权限、操作记录）。正式版这些都在服务器上。 */
(function(){
const K='payroll-demo-v3',SK='payroll-demo-session',PW='1234';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtN=n=>Number(n||0).toLocaleString('en-US',{maximumFractionDigits:0});
const fmtT=t=>{const d=new Date(t),p=x=>String(x).padStart(2,'0');return `${d.getMonth()+1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`};
const mask=a=>{a=String(a||'');return a.length>12?a.slice(0,5)+'…'+a.slice(-4):(a||'（空白）')};
const ROLES={'管理员':{jobs:[1,2,3],back:'full'},'排程':{jobs:[1],back:'none'},'请款':{jobs:[2],back:'none'},'打款':{jobs:[3],back:'none'},'查核':{jobs:[],back:'read'}};
const JOBN={1:'作业一 排程',2:'作业二 请款',3:'作业三 打款'};
const BACKN={full:'管理',read:'只读',none:'无'};

function seed(){return {users:[{acc:'1234',name:'管理员',role:'管理员',jobs:[1,2,3],scope:[],scopeB:[],back:'full',on:true,fails:0,last:0}],logs:[],org:{}}}
let db;function load(){try{db=JSON.parse(localStorage.getItem(K)||'null')}catch(_){db=null}if(!db||!db.users)db=seed();db.org=db.org||{};db.users.forEach(u=>{u.scope=(u.scope||[]);u.scopeB=u.scopeB||[]});save()}
function save(){try{localStorage.setItem(K,JSON.stringify(db))}catch(_){}}
let me=null;
/* 范围：scope=整个事业群，scopeB=单独的事业处（存成「事业群|事业处」）；两者都空=全部 */
const hasScope=u=>!!((u.scope||[]).length||(u.scopeB||[]).length);
const scopeText=u=>hasScope(u)?[...(u.scope||[]),...(u.scopeB||[]).map(k=>{const [g,b]=k.split('|');return `${g} / ${b}`})].join('、'):'全部';
const inScope=(u,g,b)=>!hasScope(u)||(u.scope||[]).includes(g)||(u.scopeB||[]).includes(g+'|'+b);
function ssGet(){try{return sessionStorage.getItem(SK)}catch(_){return null}}
function ssSet(v){try{v?sessionStorage.setItem(SK,v):sessionStorage.removeItem(SK)}catch(_){}}
function log(cat,act,det,risk,who){const w=who||me||{acc:'-',name:'-'};db.logs.unshift({t:Date.now(),u:w.acc,n:w.name,cat,act,det:det||'',risk:risk||''});if(db.logs.length>2000)db.logs.length=2000;save();if(!$('dmAdmin').hidden)renderAdmin()}
let toastT;function toast(t){const x=$('dmToast');x.textContent=t;x.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>x.hidden=true,3800)}
async function sha(data){try{const buf=await new Blob([data]).arrayBuffer(),h=await crypto.subtle.digest('SHA-256',buf);return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,12)}catch(_){return ''}}

/* ---------- 画面骨架 ---------- */
const bar=document.createElement('div');bar.id='dmBar';bar.hidden=true;document.body.insertBefore(bar,document.body.firstChild);
['dmLogin','dmAdmin','dmToast'].forEach(id=>{const d=document.createElement('div');d.id=id;d.hidden=true;document.body.appendChild(d)});

/* ---------- 登录 ---------- */
function renderLogin(err,acc){
  const L=$('dmLogin');L.hidden=false;document.body.classList.add('dm-out');bar.hidden=true;$('dmAdmin').hidden=true;
  L.innerHTML=`<div class="dm-lhead"><span class="dm-tag">DEMO</span><h1>发薪分配工具</h1><p>这是示范版：账号和操作记录只存在这个浏览器，没有真的后端，所以不算安全防护。导入的 Excel 只在这个浏览器里读取，不会上传到任何地方，请只在自己的电脑上使用。</p></div>
  <div class="dm-lgrid"><div class="dm-card" id="dmLF"><h2>登录</h2>
    <label class="dm-f">账号<input class="dm-in" id="dmU" value="${esc(acc||'')}" autocomplete="off"></label>
    <label class="dm-f">密码<input class="dm-in" id="dmP" type="password" autocomplete="off"></label>
    <p class="dm-err" id="dmE" role="alert">${esc(err||'')}</p><button class="dm-btn pri" style="width:100%" type="button" id="dmGo">登录</button>
    <p class="dm-note" style="margin-top:12px">连续输错 5 次密码，账号会被锁定，要由管理员解除。</p></div></div>`;
  /* 不用 form submit：在沙盒预览（没有 allow-forms）里 submit 事件不会触发 */
  const go=()=>doLogin($('dmU').value.trim(),$('dmP').value);$('dmGo').addEventListener('click',go);$('dmLF').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();go()}});
}
function doLogin(acc,pw){const u=db.users.find(x=>x.acc===acc);
  if(!acc){return renderLogin('请输入账号。')}
  if(!u){log('登录','登录失败','账号不存在','warn',{acc,name:'（未知账号）'});return renderLogin('账号或密码不对。',acc)}
  if(!u.on){log('登录','登录被拒','账号已停用','warn',u);return renderLogin('这个账号已停用，请找管理员。',acc)}
  if(u.fails>=5){log('登录','登录被拒','账号已锁定','warn',u);return renderLogin('这个账号已锁定，请找管理员解除。',acc)}
  if(pw!==PW){u.fails=(u.fails||0)+1;const locked=u.fails>=5;log('登录',locked?'账号被锁定':'登录失败',`密码错误（第 ${u.fails} 次）`,locked?'high':'warn',u);return renderLogin(locked?'连续输错 5 次，账号已锁定，请找管理员解除。':`账号或密码不对。再错 ${5-u.fails} 次会锁定。`,acc)}
  u.fails=0;u.last=Date.now();me=u;ssSet(u.acc);log('登录','登录成功','');enter()}
function logout(){log('登录','登出','');ssSet(null);me=null;try{location.reload()}catch(_){renderLogin()}}

/* ---------- 登录后：套用权限 ---------- */
function curJob(){const b=document.querySelector('nav.jobs .job.on');return b?Number(b.dataset.job):1}
function applyPerm(){document.querySelectorAll('nav.jobs [data-job]').forEach(b=>b.classList.toggle('dm-lock',!me.jobs.includes(Number(b.dataset.job))));
  document.body.classList.toggle('dm-nojob',!me.jobs.length);
  if(me.jobs.length&&!me.jobs.includes(curJob())){const b=document.querySelector(`nav.jobs [data-job="${me.jobs[0]}"]`);if(b)b.click()}}
function renderBar(){bar.hidden=false;const sc=hasScope(me);
  bar.innerHTML=`<span class="dm-tag">DEMO</span><span class="dm-who"><b>${esc(me.name)}</b><small>${esc(me.role)}${sc?` · 只看 ${esc(scopeText(me))}`:''}</small></span><span class="dm-sp"></span>${me.back!=='none'?'<button class="dm-btn" id="dmOpenA">后台</button>':''}<button class="dm-btn" id="dmOut">登出</button>`;
  $('dmOut').onclick=logout;if($('dmOpenA'))$('dmOpenA').onclick=()=>openAdmin();}
function enter(){window.__payUser=me.name;$('dmLogin').hidden=true;document.body.classList.remove('dm-out');applyPerm();renderBar();if(!me.jobs.length)openAdmin();else $('dmAdmin').hidden=true}

/* ---------- 记录：导入 ---------- */
const IMP={file:['导入本月月度薪资表','curBox'],prevFile1:['导入上个月打款名单','prevBox'],batchFile:['导入当天核准名单','batBox'],progFile:['导入请款单','progBox']};
let pend=null,parsed=null;
function patchXlsx(){if(!window.XLSX||!XLSX.utils||XLSX.utils.__dm)return;const raw=XLSX.utils.sheet_to_json;
  XLSX.utils.sheet_to_json=function(ws,o){let rows=raw.call(this,ws,o);if(o&&o.header)return rows;
    if(pend&&!parsed&&rows.length&&typeof rows[0]==='object'){const kG=Object.keys(rows[0]).find(k=>k.includes('事业群')),kB=Object.keys(rows[0]).find(k=>k.includes('事业处')),txt=(r,k)=>k?String(r[k]??'').trim():'',kA=Object.keys(rows[0]).find(k=>/实发工资\s*PHP/i.test(k))||Object.keys(rows[0]).find(k=>k.includes('实发工资'));
      if(kG){const o=pend.id==='file'?{}:(db.org||{});rows.forEach(r=>{const g=txt(r,kG),b=txt(r,kB);if(!g)return;const a=o[g]=o[g]||[];if(b&&!a.includes(b))a.push(b)});db.org=o;save()}
      const all=rows.length;if(kG&&me&&hasScope(me))rows=rows.filter(r=>inScope(me,txt(r,kG),txt(r,kB)));
      parsed={all,kept:rows.length,sum:kA?rows.reduce((a,r)=>a+(Number(String(r[kA]).replace(/[^0-9.\-]/g,''))||0),0):null};clearTimeout(pend.tm);pend.tm=setTimeout(finishImport,200)}
    return rows};XLSX.utils.__dm=true}
function finishImport(){const p=pend;if(!p)return;pend=null;const r=parsed;parsed=null;const box=$(IMP[p.id][1]),bad=box&&box.classList.contains('bad')||(p.id==='file'&&$('importMsg').classList.contains('err'));
  p.hash.then(h=>{const bits=[p.name];if(r){bits.push(r.kept===r.all?`${r.kept} 人`:`${r.kept}／${r.all} 人（按范围过滤）`);if(r.sum!=null)bits.push('PHP '+fmtN(r.sum))}if(h)bits.push('指纹 '+h);
    let risk=bad?'warn':'',act=IMP[p.id][0];
    if(bad)act+='（失败）';
    if(p.id==='progFile'&&!bad&&h){const ex=db.logs.find(l=>l.cat==='导出'&&l.hash===h);if(ex)bits.unshift(`版本比对通过：与${ex.n} ${fmtT(ex.t)} 导出的文件相同`);else{bits.unshift('找不到这份文件的导出记录，可能被改过或不是系统产生的');risk='high';toast('注意：这份请款单没有导出记录，可能被改过。')}}
    log('导入',act,bits.join(' · '),risk);
    if(r&&r.kept!==r.all)toast(`已按你的范围过滤：显示 ${r.kept}／${r.all} 人`)})}
document.addEventListener('change',e=>{const t=e.target;if(t.type==='file'&&IMP[t.id]&&t.files&&t.files[0]&&me){patchXlsx();const f=t.files[0];parsed=null;pend={id:t.id,name:f.name,hash:sha(f),tm:setTimeout(finishImport,3000)}}},true);

/* ---------- 记录：导出 ---------- */
function exportAct(n){return /UC打款/.test(n)?['下载 UC 打款文件','high']:/暂缓名单/.test(n)?['导出暂缓名单','high']:/请款单/.test(n)?['导出请款单','']:/打款单/.test(n)?['导出打款单','']:/送审/.test(n)?['导出发薪日送审总名单','']:['导出文件','']}
window.__DS=function(DL,o){const p=DL.save(o),data=o.data;Promise.resolve(p).then(()=>'ok',()=>'no').then(async s=>{const h=await sha(data),[a,r]=exportAct(o.filename||'');if(!me)return;log('导出',s==='ok'?a:a+'（未保存）',`${o.filename||''}${h?' · 指纹 '+h:''}`,s==='ok'?r:'');if(s==='ok'&&h){db.logs[0].hash=h;save()}});return p};

/* ---------- 记录：按钮操作 ---------- */
const CLICK={autoAll:['操作','作业一 自动排'],reset:['操作','作业一 全部清空'],wAuto:['操作','作业二 自动排'],wClear:['操作','作业二 全部清空'],chainBal:['操作','查询链上余额'],chainFirst:['操作','上链查询第一次发薪地址'],rAdd:['设定','新增排程条件'],wsAdd:['设定','新增出款钱包'],expCopy:['导出','复制模版名单到剪贴簿'],reqCopy:['导出','复制请款单到剪贴簿'],revCopy:['导出','复制送审总名单到剪贴簿'],copySum:['导出','复制总结到剪贴簿'],copyHold:['导出','复制暂缓表到剪贴簿'],copyOther:['导出','复制其他发放方式到剪贴簿'],whoCopy:['导出','复制名单到剪贴簿']};
document.addEventListener('click',e=>{if(!me)return;const jb=e.target.closest&&e.target.closest('nav.jobs [data-job]');
  if(jb){const j=Number(jb.dataset.job);if(!me.jobs.includes(j)){e.preventDefault();e.stopImmediatePropagation();log('权限','尝试进入没有权限的作业',JOBN[j],'warn');toast(`你的账号没有「${JOBN[j]}」的权限。`);return}setTimeout(renderBar,0);return}
  const b=e.target.closest&&e.target.closest('button');if(b&&CLICK[b.id]&&!b.disabled)log(CLICK[b.id][0],CLICK[b.id][1],'')},true);
document.addEventListener('change',e=>{if(!me||e.target.dataset?.wrule===undefined)return;setTimeout(()=>log('设定','更改 USDT 分配规则',[...document.querySelectorAll('#wOrderChips input:checked')].map(x=>x.parentElement.textContent).join('、')),0)});

/* ---------- 记录：设定变更（改动前 → 改动后） ---------- */
document.addEventListener('focusin',e=>{const t=e.target;if(t&&t.matches&&t.matches('input,select'))t.__dmB=t.tagName==='SELECT'?(t.options[t.selectedIndex]||{}).text:t.value},true);
const TRX={feeU:'转 USDT 矿工费',feeOld:'转 TRX 矿工费（旧地址）',feeNew:'转 TRX 矿工费（新地址）',perNew:'第一次补助 TRX'};
const IDS={capDefault:'每天预计拨款',planDays:'预计分几天发完',wcap:'每个钱包上限'};
document.addEventListener('change',e=>{if(!me)return;const t=e.target,D=t.dataset||{},b=t.__dmB??'',v=t.tagName==='SELECT'?(t.options[t.selectedIndex]||{}).text:t.value,arrow=(x,y)=>`${x===''?'（空白）':x} → ${y===''?'（空白）':y}`;let act='',det='',risk='';
  if(IDS[t.id]){act=IDS[t.id];det=arrow(b,v)}
  else if(t.id==='chainKey'){act='更改 TronScan API Key';det='内容不记录';risk='high'}
  else if(D.trx){act=TRX[D.trx]||D.trx;det=arrow(b,v)}
  else if(D.brate!==undefined){act='打款汇率';det=arrow(b,v);risk='high'}
  else if(D.wset!==undefined&&D.k==='both'){act='更改钱包打款人员';det=`钱包 ${Number(D.wset)+1}：`+arrow(b,v)}
  else if(D.wset!==undefined){act='更改出款钱包地址';det=`钱包 ${Number(D.wset)+1}：`+arrow(mask(b),mask(v));risk='high'}
  else if(D.ddate!==undefined){act='更改发放日期';det=`第 ${Number(D.ddate)+1} 天：`+arrow(b,v)}
  else if(D.dcap!==undefined){act='更改当天拨款上限';det=`第 ${Number(D.dcap)+1} 天：`+arrow(b,v)}
  else if(D.move!==undefined||D.movegroup!==undefined){act='调整部门发放日';det=`${(D.move||D.movegroup).replace(/\|/g,'、')}：`+arrow(b,v)}
  else if(D.cfgtrx!==undefined){act='固定打 TRX 的钱包';det=`钱包 ${Number(D.cfgtrx)+1}：${t.checked?'勾选':'取消'}`}
  else if(D.cfgusdt!==undefined){act='本次打 USDT 的钱包';det=`钱包 ${Number(D.cfgusdt)+1}：${t.checked?'勾选':'取消'}`}
  else if(D.hgskip!==undefined){act='暂缓员工「特例不发」';det=`${t.checked?'勾选':'取消'}（${D.hgskip.split('|').slice(1,2).join('')||'员工'}）`;risk='high'}
  else if(D.newck!==undefined){act='手动更改第一次打款判定';det=`工号 ${D.newck}：${t.checked?'是':'否'}`;risk='high'}
  if(act)log('设定',act,det,risk);t.__dmB=undefined},true);

addEventListener('payroll:audit',e=>{if(!me)return;const d=e.detail||{};log(d.cat,d.act,d.det,d.risk)});
/* ---------- 后台 ---------- */
let aTab='home',F={u:'',c:'',risk:false,q:''};
function openAdmin(){if(!me||me.back==='none')return;$('dmAdmin').hidden=false;renderAdmin();log('权限','进入后台','')}
const riskPill=r=>r==='high'?'<span class="dm-pill high">高风险</span>':r==='warn'?'<span class="dm-pill warn">留意</span>':'';
const logRow=l=>`<tr><td class="nw">${esc(fmtT(l.t))}</td><td class="nw">${esc(l.n)}<small>${esc(l.u)}</small></td><td class="nw"><span class="dm-pill">${esc(l.cat)}</span></td><td>${esc(l.act)} ${riskPill(l.risk)}</td><td>${esc(l.det)}</td></tr>`;
const LH='<thead><tr><th>时间</th><th>人员</th><th>类别</th><th>操作</th><th>内容</th></tr></thead>';
function filtered(){const q=F.q.trim().toLowerCase();return db.logs.filter(l=>(!F.u||l.u===F.u)&&(!F.c||l.cat===F.c)&&(!F.risk||l.risk)&&(!q||(l.act+' '+l.det+' '+l.n+' '+l.u).toLowerCase().includes(q)))}
function renderAdmin(){const A=$('dmAdmin'),act=document.activeElement,keep=act&&act.id&&A.contains(act)?{id:act.id,s:act.selectionStart}:null,sy=A.scrollTop;const ro=me.back!=='full';
  const head=`<div class="dm-ahead"><span class="dm-tag">DEMO</span><h1>后台</h1><span class="dm-note">${esc(me.name)} · 权限：${BACKN[me.back]}</span><span style="flex:1"></span>${me.jobs.length?'<button class="dm-btn" id="dmBack">回到工具</button>':''}<button class="dm-btn" id="dmOut2">登出</button></div>
  <div class="dm-tabs" role="tablist">${[['home','总览'],['logs','操作记录'],['users','账号与权限']].map(([k,n])=>`<button class="dm-tab ${aTab===k?'on':''}" role="tab" aria-selected="${aTab===k}" data-dmtab="${k}">${n}</button>`).join('')}</div>`;
  let body='';
  if(aTab==='home'){const d0=new Date();d0.setHours(0,0,0,0);const td=db.logs.filter(l=>l.t>=d0.getTime()),who=new Set(td.filter(l=>l.act==='登录成功').map(l=>l.u)),fail=td.filter(l=>l.cat==='登录'&&l.risk).length,high=td.filter(l=>l.risk==='high');
    const lastAct=u=>db.logs.find(l=>l.u===u.acc&&l.cat!=='登录');
    body=`<div class="dm-stats"><div class="dm-stat"><b>${td.length}</b><span>今天的操作</span></div><div class="dm-stat"><b>${who.size}</b><span>今天登录人数</span></div><div class="dm-stat ${high.length?'alert':''}"><b>${high.length}</b><span>今天高风险操作</span></div><div class="dm-stat ${fail?'alert':''}"><b>${fail}</b><span>今天登录异常</span></div></div>
    <div class="dm-two"><div style="min-width:0"><h2 class="dm-sec">需要留意</h2><div class="dm-tw"><table class="dm-t">${LH}<tbody>${db.logs.filter(l=>l.risk).slice(0,8).map(logRow).join('')||'<tr><td colspan="5">目前没有需要留意的操作。</td></tr>'}</tbody></table></div></div>
    <div style="min-width:0"><h2 class="dm-sec">每个人的最近动作</h2><div class="dm-tw"><table class="dm-t"><thead><tr><th>人员</th><th>最后登录</th><th>最近操作</th></tr></thead><tbody>${db.users.map(u=>{const a=lastAct(u);return `<tr><td class="nw">${esc(u.name)}<small>${esc(u.role)}</small></td><td class="nw">${u.last?esc(fmtT(u.last)):'—'}</td><td>${a?esc(a.act):'—'}</td></tr>`}).join('')}</tbody></table></div></div></div>`}
  if(aTab==='logs'){const list=filtered(),cats=[...new Set(db.logs.map(l=>l.cat))],ppl=[...new Map(db.logs.map(l=>[l.u,l.n])).entries()];
    body=`<div class="dm-filter"><select class="dm-in" id="dmFu" aria-label="人员"><option value="">全部人员</option>${ppl.map(([u,n])=>`<option value="${esc(u)}" ${F.u===u?'selected':''}>${esc(n)}（${esc(u)}）</option>`).join('')}</select><select class="dm-in" id="dmFc" aria-label="类别"><option value="">全部类别</option>${cats.map(c=>`<option ${F.c===c?'selected':''}>${esc(c)}</option>`).join('')}</select><input class="dm-in" id="dmFq" placeholder="搜寻操作、文件名、指纹" value="${esc(F.q)}" aria-label="搜寻"><label><input type="checkbox" id="dmFr" ${F.risk?'checked':''}>只看需要留意的</label><span style="flex:1"></span><span class="dm-note">${list.length} 笔</span><button class="dm-btn" id="dmCopyLog">复制，贴到 Excel</button></div>
    <div class="dm-tw"><table class="dm-t" style="min-width:780px">${LH}<tbody>${list.slice(0,300).map(logRow).join('')||'<tr><td colspan="5">没有符合条件的记录。</td></tr>'}</tbody></table></div>
    <p class="dm-note">记录只能新增，后台没有修改或删除的功能。内容只有文件名、人数、总额和文件指纹，不含员工姓名和个人金额。文件指纹用来确认作业三导入的请款单，就是作业二导出的那一份。</p>`}
  if(aTab==='users'){const dis=ro?'disabled':'';
    body=`${ro?'<p class="dm-note">你的后台权限是只读，不能修改账号。</p>':`<div class="dm-add"><input class="dm-in" id="dmNA" placeholder="账号" aria-label="账号"><input class="dm-in" id="dmNN" placeholder="姓名" aria-label="姓名"><select class="dm-in" id="dmNR" aria-label="角色">${Object.keys(ROLES).map(r=>`<option>${r}</option>`).join('')}</select><button class="dm-btn pri" id="dmNAdd">新增账号</button><span class="dm-note" id="dmNE"></span></div>`}
    <div class="dm-tw"><table class="dm-t" style="min-width:1120px"><thead><tr><th>姓名</th><th>账号</th><th>角色</th><th>可用作业</th><th>可看范围</th><th>后台</th><th>状态</th><th>最后登录</th><th></th></tr></thead><tbody>${db.users.map(u=>{const lock=u.fails>=5,self=u.acc===me.acc;return `<tr><td><input class="dm-in" data-dmname="${esc(u.acc)}" value="${esc(u.name)}" ${dis} style="width:110px" aria-label="${esc(u.name)} 姓名"></td><td><input class="dm-in" data-dmacc="${esc(u.acc)}" value="${esc(u.acc)}" ${dis} style="width:120px" aria-label="${esc(u.name)} 账号"></td><td><select class="dm-in" data-dmrole="${esc(u.acc)}" ${dis||(self?'disabled':'')} aria-label="${esc(u.name)} 角色">${Object.keys(ROLES).map(r=>`<option ${u.role===r?'selected':''}>${r}</option>`).join('')}</select></td><td><span class="dm-jobs">${[1,2,3].map(j=>`<label><input type="checkbox" data-dmj="${esc(u.acc)}" value="${j}" ${u.jobs.includes(j)?'checked':''} ${dis} aria-label="${esc(u.name)} ${JOBN[j]}">${'一二三'[j-1]}</label>`).join('')}</span></td><td><button class="dm-btn dm-scb" data-dmsco="${esc(u.acc)}" aria-expanded="${scopeOpen===u.acc}">${esc(scopeText(u))}</button></td><td><select class="dm-in" data-dmb="${esc(u.acc)}" ${dis||(self?'disabled':'')} aria-label="${esc(u.name)} 后台权限">${Object.entries(BACKN).map(([k,n])=>`<option value="${k}" ${u.back===k?'selected':''}>${n}</option>`).join('')}</select></td><td class="nw">${lock?'<span class="dm-pill high">已锁定</span>':u.on?'<span class="dm-pill ok">启用</span>':'<span class="dm-pill">已停用</span>'}</td><td class="nw">${u.last?esc(fmtT(u.last)):'—'}</td><td class="nw">${ro?'':lock?`<button class="dm-btn" data-dmun="${esc(u.acc)}">解除锁定</button>`:self?'':`<button class="dm-btn ${u.on?'dang':''}" data-dmtog="${esc(u.acc)}">${u.on?'停用':'启用'}</button>`}</td></tr>${scopeOpen===u.acc?scopeRow(u,ro):''}`}).join('')}</tbody></table></div>
    <p class="dm-note">所有账号的密码目前都是 1234。改角色时，可用作业和后台权限会照新角色重新带入，之后还可以个别调整。旧记录保留当时的账号和姓名。自己的角色和后台权限不能自己改。可看范围的选项来自最新导入的 Excel：每次导入月度薪资表都会更新，核准名单和打款名单只会补上新的单位。什么都不勾代表全部。按照目前的方案，后端不存明细，所以范围只是过滤画面，真正的管控要靠每个人在 OA 只导出自己范围的名单。</p>`}
  A.innerHTML=`<div class="dm-ain">${head}${body}</div>`;A.scrollTop=sy;
  if(keep&&$(keep.id)){const k=$(keep.id);k.focus();try{k.setSelectionRange(keep.s,keep.s)}catch(_){}}}
let scopeOpen=null;
function scopeRow(u,ro){const dis=ro?'disabled':'',org={};Object.entries(db.org||{}).forEach(([g,bs])=>org[g]=bs.slice());
  const stale=new Set();(u.scope||[]).forEach(g=>{if(!org[g]){org[g]=[];stale.add(g)}});(u.scopeB||[]).forEach(k=>{const [g,b]=k.split('|');if(!org[g]){org[g]=[];stale.add(g)}if(!org[g].includes(b)){org[g].push(b);stale.add(k)}});
  const gs=Object.keys(org);const old=t=>`<small class="dm-stale">不在最新名单</small>`;
  const a=esc(u.acc);
  const tree=gs.length?gs.map(g=>{const on=(u.scope||[]).includes(g);return `<div class="dm-sg"><label class="dm-sgn"><input type="checkbox" data-dmsg="${a}" data-g="${esc(g)}" ${on?'checked':''} ${dis}><b>${esc(g)}</b>${stale.has(g)?old():''}</label><div class="dm-sbs">${org[g].length?org[g].map(b=>{const k=g+'|'+b;return `<label><input type="checkbox" data-dmsb="${a}" data-k="${esc(k)}" ${on||(u.scopeB||[]).includes(k)?'checked':''} ${on?'disabled':dis}>${esc(b)}${stale.has(k)?old():''}</label>`}).join(''):(stale.has(g)?'':'<small class="dm-none">这个事业群没有事业处</small>')}</div></div>`}).join(''):'<p class="dm-note">还没有可选的范围。请先到作业一导入月度薪资表（或作业二导入核准名单），这里就会列出 Excel 里的事业群和事业处。</p>';
  return `<tr class="dm-scrow"><td colspan="9"><div class="dm-sch"><b>${esc(u.name)} 的可看范围</b><span class="dm-note">勾事业群＝整个事业群，也可以只勾其中几个事业处。</span>${ro?'':`<button class="dm-btn" data-dmsall="${a}" ${hasScope(u)?'':'disabled'}>改回全部</button>`}<button class="dm-btn" data-dmscl>收起</button></div>${tree}</td></tr>`}
const chg=(act,det)=>log('权限',act,det,'high');
document.addEventListener('click',e=>{const A=$('dmAdmin');if(!e.target.closest||!A.contains(e.target))return;const t=e.target.closest('button');if(!t)return;
  if(t.id==='dmBack'){A.hidden=true;return}
  if(t.dataset.dmsco){scopeOpen=scopeOpen===t.dataset.dmsco?null:t.dataset.dmsco;return renderAdmin()}
  if(t.dataset.dmscl!==undefined){scopeOpen=null;return renderAdmin()}
  if(t.id==='dmOut2')return logout();
  if(t.dataset.dmtab){aTab=t.dataset.dmtab;return renderAdmin()}
  if(t.id==='dmCopyLog'){const txt=['时间\t账号\t姓名\t类别\t操作\t内容',...filtered().map(l=>[fmtT(l.t),l.u,l.n,l.cat,l.act,l.det].join('\t'))].join('\n');const ok=()=>toast('已复制，可以贴到 Excel。');try{navigator.clipboard.writeText(txt).then(ok,()=>toast('浏览器不允许自动复制。'))}catch(_){toast('浏览器不允许自动复制。')}log('导出','复制操作记录',`${filtered().length} 笔`);return}
  if(me.back!=='full')return;
  if(t.id==='dmNAdd'){const a=$('dmNA').value.trim(),n=$('dmNN').value.trim(),r=$('dmNR').value;if(!a||!n){$('dmNE').textContent='账号和姓名都要填。';return}if(db.users.some(u=>u.acc===a)){$('dmNE').textContent='这个账号已经有了。';return}const p=ROLES[r];db.users.push({acc:a,name:n,role:r,jobs:p.jobs.slice(),scope:[],back:p.back,on:true,fails:0,last:0});chg('新增账号',`${n}（${a}）· 角色 ${r}`);return}
  if(t.dataset.dmsall){const u=db.users.find(x=>x.acc===t.dataset.dmsall),b=scopeText(u);u.scope=[];u.scopeB=[];chg('更改可看范围',`${u.name}：${b} → 全部`);if(u===me)renderBar();return}
  if(t.dataset.dmun){const u=db.users.find(x=>x.acc===t.dataset.dmun);u.fails=0;chg('解除账号锁定',`${u.name}（${u.acc}）`);return}
  if(t.dataset.dmtog){const u=db.users.find(x=>x.acc===t.dataset.dmtog);u.on=!u.on;chg(u.on?'启用账号':'停用账号',`${u.name}（${u.acc}）`);return}
});
document.addEventListener('change',e=>{const A=$('dmAdmin'),t=e.target;if(!A.contains(t))return;
  if(t.id==='dmFu'){F.u=t.value;return renderAdmin()}if(t.id==='dmFc'){F.c=t.value;return renderAdmin()}if(t.id==='dmFr'){F.risk=t.checked;return renderAdmin()}
  if(me.back!=='full')return;
  if(t.dataset.dmname){const u=db.users.find(x=>x.acc===t.dataset.dmname),v=t.value.trim(),b=u.name;if(!v){toast('姓名不能空白。');return renderAdmin()}if(v===b)return;u.name=v;chg('更改姓名',`${u.acc}：${b} → ${v}`);if(u===me)renderBar();return}
  if(t.dataset.dmacc){const u=db.users.find(x=>x.acc===t.dataset.dmacc),v=t.value.trim(),b=u.acc;if(!v){toast('账号不能空白。');return renderAdmin()}if(v===b)return;if(db.users.some(x=>x.acc===v)){toast(`账号「${v}」已经有人用了。`);return renderAdmin()}u.acc=v;if(scopeOpen===b)scopeOpen=v;if(u===me)ssSet(v);chg('更改账号',`${u.name}：${b} → ${v}`);return}
  if(t.dataset.dmrole){const u=db.users.find(x=>x.acc===t.dataset.dmrole),b=u.role,p=ROLES[t.value];u.role=t.value;u.jobs=p.jobs.slice();u.back=p.back;chg('更改角色',`${u.name}：${b} → ${u.role}（作业和后台权限已照新角色带入）`);return}
  if(t.dataset.dmj){const u=db.users.find(x=>x.acc===t.dataset.dmj),j=Number(t.value),b=u.jobs.map(x=>JOBN[x]).join('、')||'无';u.jobs=t.checked?[...new Set([...u.jobs,j])].sort():u.jobs.filter(x=>x!==j);chg('更改可用作业',`${u.name}：${b} → ${u.jobs.map(x=>JOBN[x]).join('、')||'无'}`);if(u===me)applyPerm(),renderBar();return}
  if(t.dataset.dmsg||t.dataset.dmsb){const u=db.users.find(x=>x.acc===(t.dataset.dmsg||t.dataset.dmsb)),b=scopeText(u);
    if(t.dataset.dmsg){const g=t.dataset.g;u.scope=t.checked?[...new Set([...u.scope,g])]:u.scope.filter(x=>x!==g);if(t.checked)u.scopeB=u.scopeB.filter(k=>k.split('|')[0]!==g)}
    else{const k=t.dataset.k;u.scopeB=t.checked?[...new Set([...u.scopeB,k])]:u.scopeB.filter(x=>x!==k)}
    chg('更改可看范围',`${u.name}：${b} → ${scopeText(u)}`);if(u===me)renderBar();return}
  if(t.dataset.dmb){const u=db.users.find(x=>x.acc===t.dataset.dmb),b=BACKN[u.back];u.back=t.value;chg('更改后台权限',`${u.name}：${b} → ${BACKN[u.back]}`);return}
});
document.addEventListener('input',e=>{if(e.target.id==='dmFq'){F.q=e.target.value;renderAdmin()}});

/* ---------- 启动 ---------- */
load();patchXlsx();
{const a=ssGet(),u=a&&db.users.find(x=>x.acc===a&&x.on&&x.fails<5);if(u){me=u;enter()}else renderLogin()}
})();
