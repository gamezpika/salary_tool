/* 登录、权限、后台、操作记录。所有判断以后端为准；这里只负责画面。 */
(function () {
  'use strict';
  const PFX = 'payroll-allocator-', LAST = 'payroll-last-user';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const fmtT = t => { const d = new Date(t), p = x => String(x).padStart(2, '0'); return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
  const JOBN = { 1: '作业一 排程', 2: '作业二 请款', 3: '作业三 打款' }, BACKN = { full: '管理', read: '只读', none: '无' };
  const hasScope = u => !!(u.scope.length || u.scopeB.length);
  const scopeText = u => (hasScope(u) ? [...u.scope, ...u.scopeB.map(k => { const [g, b] = k.split('|'); return `${g} / ${b}`; })].join('、') : '全部');
  const inScope = (u, g, b) => !hasScope(u) || u.scope.includes(g) || u.scopeB.includes(`${g}|${b}`);
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } }, keys: () => { try { return Object.keys(localStorage); } catch (_) { return []; } } };
  let me = null, toolStarted = false;

  /* ---------- 画面骨架 ---------- */
  const bar = document.createElement('div'); bar.id = 'dmBar'; bar.hidden = true; document.body.insertBefore(bar, document.body.firstChild);
  ['dmLogin', 'dmAdmin', 'dmToast'].forEach(id => { const d = document.createElement('div'); d.id = id; d.hidden = true; document.body.appendChild(d); });
  document.body.classList.add('dm-out');
  let toastT; const toast = t => { const x = $('dmToast'); x.textContent = t; x.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { x.hidden = true; }, 4500); };

  /* ---------- API ---------- */
  class ApiError extends Error { constructor(status, body) { super(body?.error || `HTTP ${status}`); this.status = status; this.body = body; } }
  async function api(method, url, body, opts = {}) {
    let r;
    try {
      r = await fetch(url, { method, credentials: 'same-origin', keepalive: !!opts.keepalive, headers: { 'x-requested-with': 'payroll', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (_) { throw new ApiError(0, { error: '连不上服务器，请检查网络。' }); }
    let j = null; try { j = await r.json(); } catch (_) { /* 没有内容 */ }
    if (!r.ok) {
      if (r.status === 401 && !opts.noRedirect && me) sessionLost();
      if (r.status === 403 && j?.code === 'must_change' && me) renderPassword(true);
      throw new ApiError(r.status, j);
    }
    return j;
  }
  function sessionLost() { renderLogin('登录已过期，请重新登录。', me?.acc); }
  const log = (cat, act, det, risk, fileHash) => { if (me) api('POST', '/api/audit', { cat, act, det: det || '', risk: risk || '', fileHash: fileHash || '' }).catch(e => { if (e.status !== 401) toast('操作记录送不出去：' + e.message); }); };
  async function sha(data) { try { const buf = await new Blob([data]).arrayBuffer(), h = await crypto.subtle.digest('SHA-256', buf); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join(''); } catch (_) { return ''; } }

  /* ---------- 登录 ---------- */
  function shell(title, inner) {
    const L = $('dmLogin'); L.hidden = false; document.body.classList.add('dm-out'); bar.hidden = true; $('dmAdmin').hidden = true;
    L.innerHTML = `<div class="dm-lhead"><h1>发薪分配工具</h1></div><div class="dm-lgrid"><div class="dm-card" id="dmLF"><h2>${esc(title)}</h2>${inner}</div></div>`;
  }
  function renderLogin(err, acc) {
    shell('登录', `<label class="dm-f">账号<input class="dm-in" id="dmU" value="${esc(acc || '')}" autocomplete="username"></label>
      <label class="dm-f">密码<input class="dm-in" id="dmP" type="password" autocomplete="current-password"></label>
      <p class="dm-err" id="dmE" role="alert">${esc(err || '')}</p><button class="dm-btn pri" style="width:100%" type="button" id="dmGo">登录</button>
      <p class="dm-note" style="margin-top:12px">连续输错 5 次密码，账号会被锁定，要由管理员解除。</p>`);
    let busy = false;
    const go = async () => {
      if (busy) return; busy = true; $('dmGo').disabled = true; $('dmE').textContent = '';
      const acc2 = $('dmU').value.trim();
      try { const { user } = await api('POST', '/api/login', { acc: acc2, password: $('dmP').value }, { noRedirect: true }); $('dmP').value = ''; me = user; if (user.mustChange) renderPassword(true); else await enter(); } catch (e) { $('dmE').textContent = e.message; $('dmP').value = ''; }
      busy = false; if ($('dmGo')) $('dmGo').disabled = false;
    };
    $('dmGo').addEventListener('click', go);
    $('dmLF').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    ($('dmU').value ? $('dmP') : $('dmU')).focus();
  }
  function renderPassword(forced) {
    shell(forced ? '第一次登录，请设定自己的密码' : '修改密码', `<label class="dm-f">目前的密码<input class="dm-in" id="dmCur" type="password" autocomplete="current-password"></label>
      <label class="dm-f">新密码（至少 10 个字符）<input class="dm-in" id="dmNew" type="password" autocomplete="new-password"></label>
      <label class="dm-f">再输入一次新密码<input class="dm-in" id="dmNew2" type="password" autocomplete="new-password"></label>
      <p class="dm-err" id="dmE" role="alert"></p><div class="dm-add"><button class="dm-btn pri" type="button" id="dmGo">保存新密码</button>${forced ? '<button class="dm-btn" type="button" id="dmOut">登出</button>' : '<button class="dm-btn" type="button" id="dmCancel">取消</button>'}</div>`);
    const go = async () => {
      if ($('dmNew').value !== $('dmNew2').value) { $('dmE').textContent = '两次输入的新密码不一样。'; return; }
      try { const { user } = await api('POST', '/api/password', { current: $('dmCur').value, next: $('dmNew').value }); me = user; toast('密码已更新。'); await enter(); } catch (e) { $('dmE').textContent = e.message; }
    };
    $('dmGo').addEventListener('click', go);
    $('dmLF').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    if ($('dmOut')) $('dmOut').addEventListener('click', logout);
    if ($('dmCancel')) $('dmCancel').addEventListener('click', () => enter());
    $('dmCur').focus();
  }
  async function logout() { flushAll(); try { await api('POST', '/api/logout', {}, { noRedirect: true }); } catch (_) { /* 仍然回登录页 */ } me = null; location.reload(); }

  /* ---------- 共享设定：白名单上的设定和服务器同步，其余（明细）只留在浏览器 ---------- */
  const set0 = Storage.prototype.setItem, versions = {}, writable = new Set(), timers = {}, pendingVal = {};
  let applying = false, startQuiet = false, restoring = false;
  function pushSetting(key) {
    delete timers[key];
    const value = pendingVal[key]; delete pendingVal[key];
    if (value === undefined) return Promise.resolve();
    return api('PUT', `/api/settings/${encodeURIComponent(key)}`, { value, version: versions[key] || 0 }, { keepalive: value.length < 60000 }).then(r => { versions[key] = r.version; }).catch(e => {
      if (e.status === 409 && e.body?.current) {
        versions[key] = e.body.current.version; applying = true; try { set0.call(localStorage, key, e.body.current.value); } catch (_) { /* 忽略 */ }
        applying = false; toast(`这项设定刚被 ${e.body.updatedBy} 改过，已载入最新版本。请重新整理页面后再改。`);
      } else if (e.status !== 401) toast('设定没有存到服务器：' + e.message);
    });
  }
  function flushAll() { Object.keys(timers).forEach(k => { clearTimeout(timers[k]); pushSetting(k); }); }
  Storage.prototype.setItem = function (k, v) {
    set0.call(this, k, v);
    if (this === localStorage && !applying && !startQuiet && !restoring && me && writable.has(k)) { pendingVal[k] = String(v); clearTimeout(timers[k]); timers[k] = setTimeout(() => pushSetting(k), 500); }
  };
  addEventListener('pagehide', flushAll);
  async function loadSettings() {
    const r = await api('GET', '/api/settings');
    writable.clear(); r.writable.forEach(k => writable.add(k));
    applying = true;
    try {
      // 换了账号：上一个人留下的资料（包含明细）不能带过来
      if (ls.get(LAST) !== me.acc) ls.keys().filter(k => k.startsWith(PFX)).forEach(k => localStorage.removeItem(k));
      set0.call(localStorage, LAST, me.acc);
      r.writable.forEach(k => { const v = r.values[k]; versions[k] = v?.version || 0; if (!v) localStorage.removeItem(k); });
      Object.entries(r.values).forEach(([k, v]) => set0.call(localStorage, k, v.value));
    } catch (_) { /* 浏览器不给存，就只用这次的预设 */ }
    applying = false;
  }

  /* ---------- 进入工具：套用权限 ---------- */
  const curJob = () => { const b = document.querySelector('nav.jobs .job.on'); return b ? Number(b.dataset.job) : 1; };
  function applyPerm() {
    document.querySelectorAll('nav.jobs [data-job]').forEach(b => b.classList.toggle('dm-lock', !me.jobs.includes(Number(b.dataset.job))));
    document.body.classList.toggle('dm-nojob', !me.jobs.length);
    if (me.jobs.length && !me.jobs.includes(curJob())) document.querySelector(`nav.jobs [data-job="${me.jobs[0]}"]`)?.click();
  }
  function renderBar() {
    bar.hidden = false; const sc = hasScope(me);
    bar.innerHTML = `<span class="dm-who"><b>${esc(me.name)}</b><small>${esc(me.role)}${sc ? ` · 只看 ${esc(scopeText(me))}` : ''}</small></span><span class="dm-sp"></span>${me.back !== 'none' ? '<button class="dm-btn" id="dmOpenA">后台</button>' : ''}<button class="dm-btn" id="dmPw">修改密码</button><button class="dm-btn" id="dmOut">登出</button>`;
    $('dmOut').onclick = logout; $('dmPw').onclick = () => renderPassword(false); if ($('dmOpenA')) $('dmOpenA').onclick = openAdmin;
  }
  async function enter() {
    window.__payUser = me.name;
    if (toolStarted && ls.get(LAST) !== me.acc) { location.reload(); return; }
    try { await loadSettings(); } catch (e) { if (e.status === 403) return; renderLogin(e.message); return; }
    $('dmLogin').hidden = true; document.body.classList.remove('dm-out');
    $('dmLogin').innerHTML = '';
    startQuiet = true;
    if (!toolStarted) { toolStarted = true; patchXlsx(); if (window.__startTool) window.__startTool(); }
    applyPerm(); startQuiet = false; renderBar();
    if (!me.jobs.length) openAdmin(); else $('dmAdmin').hidden = true;
  }

  /* ---------- 记录：导入。Excel 只在浏览器读取，后端只收到单位名称和人数、总额 ---------- */
  const IMP = { file: ['导入本月月度薪资表', 'curBox'], prevFile1: ['导入上个月打款名单', 'prevBox'], batchFile: ['导入当天核准名单', 'batBox'], progFile: ['导入请款单', 'progBox'] };
  let pend = null, parsed = null;
  function patchXlsx() {
    if (!window.XLSX?.utils || XLSX.utils.__dm) return; const raw = XLSX.utils.sheet_to_json;
    XLSX.utils.sheet_to_json = function (ws, o) {
      let rows = raw.call(this, ws, o);
      if (o && o.header) { if (pend && !parsed) { clearTimeout(pend.tm); pend.tm = setTimeout(finishImport, 200); } return rows; }
      if (pend && !parsed && rows.length && typeof rows[0] === 'object') {
        const ks = Object.keys(rows[0]), kG = ks.find(k => k.includes('事业群')), kB = ks.find(k => k.includes('事业处')), kA = ks.find(k => /实发工资\s*PHP/i.test(k)) || ks.find(k => k.includes('实发工资'));
        const txt = (r, k) => (k ? String(r[k] ?? '').trim() : '');
        if (kG && pend.id !== 'progFile') {
          const seen = new Map(); rows.forEach(r => { const g = txt(r, kG), b = txt(r, kB); if (g) seen.set(`${g}|${b}`, { g, b }); });
          api('POST', '/api/org', { mode: pend.id === 'file' ? 'replace' : 'merge', items: [...seen.values()] }).catch(() => {});
        }
        const all = rows.length; if (kG && me && hasScope(me)) rows = rows.filter(r => inScope(me, txt(r, kG), txt(r, kB)));
        parsed = { all, kept: rows.length, sum: kA ? rows.reduce((a, r) => a + (Number(String(r[kA]).replace(/[^0-9.\-]/g, '')) || 0), 0) : null };
        clearTimeout(pend.tm); pend.tm = setTimeout(finishImport, 200);
      }
      return rows;
    };
    XLSX.utils.__dm = true;
  }
  async function finishImport() {
    const p = pend; if (!p) return; pend = null; const r = parsed; parsed = null; restoring = false;
    const box = $(IMP[p.id][1]), bad = box?.classList.contains('bad') || (p.id === 'file' && $('importMsg').classList.contains('err'));
    const h = await p.hash, bits = [p.name];
    if (r) { bits.push(r.kept === r.all ? `${r.kept} 人` : `${r.kept}／${r.all} 人（按范围过滤）`); if (r.sum != null) bits.push('PHP ' + fmtN(r.sum)); }
    if (h) bits.push('指纹 ' + h.slice(0, 12));
    let risk = bad ? 'warn' : '', act = IMP[p.id][0] + (bad ? '（失败）' : '');
    if (p.id === 'progFile' && !bad && h) {
      try {
        const c = await api('POST', '/api/export-check', { hash: h });
        if (c.found) bits.unshift(`版本比对通过：与${c.name} ${fmtT(c.t)} 导出的文件相同`);
        else { bits.unshift('找不到这份文件的导出记录，可能被改过或不是系统产生的'); risk = 'high'; toast('注意：这份请款单没有导出记录，可能被改过。'); }
      } catch (_) { /* 比对失败不挡导入 */ }
    }
    log('导入', act, bits.join(' · '), risk, h);
    if (r && r.kept !== r.all) toast(`已按你的范围过滤：显示 ${r.kept}／${r.all} 人`);
  }
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.type === 'file' && IMP[t.id] && t.files?.[0] && me) { patchXlsx(); if (pend) { clearTimeout(pend.tm); finishImport(); } const f = t.files[0]; parsed = null; restoring = t.id === 'progFile'; pend = { id: t.id, name: f.name, hash: sha(f), tm: setTimeout(finishImport, 3000) }; }
  }, true);

  /* ---------- 记录：导出 ---------- */
  addEventListener('payroll:audit', e => { const d = e.detail || {}; log(d.cat, d.act, d.det, d.risk); });
  const exportAct = n => (/UC打款/.test(n) ? ['下载 UC 打款文件', 'high'] : /作业三暂缓表/.test(n) ? ['导出作业三暂缓表', 'high'] : /请款单/.test(n) ? ['导出请款单', ''] : /打款单/.test(n) ? ['导出打款单', ''] : /送审/.test(n) ? ['导出发薪日送审总名单', ''] : ['导出文件', '']);
  window.__DS = function (DL, o) {
    const p = DL.save(o), data = o.data;
    Promise.resolve(p).then(() => 'ok', () => 'no').then(async s => { const h = await sha(data), [a, r] = exportAct(o.filename || ''); log('导出', s === 'ok' ? a : a + '（未保存）', `${o.filename || ''}${h ? ' · 指纹 ' + h.slice(0, 12) : ''}`, s === 'ok' ? r : '', s === 'ok' ? h : ''); });
    return p;
  };

  /* ---------- 记录：按钮和没有同步到服务器的调整 ---------- */
  const CLICK = { autoAll: ['操作', '作业一 自动排'], reset: ['操作', '作业一 全部清空'], wAuto: ['操作', '作业二 自动排'], wClear: ['操作', '作业二 全部清空'], chainBal: ['操作', '查询链上余额'], chainFirst: ['操作', '上链查询第一次发薪地址'], expCopy: ['导出', '复制模版名单到剪贴簿'], reqCopy: ['导出', '复制请款单到剪贴簿'], revCopy: ['导出', '复制送审总名单到剪贴簿'], copySum: ['导出', '复制总结到剪贴簿'], copyHold: ['导出', '复制暂缓表到剪贴簿'], copyOther: ['导出', '复制其他发放方式到剪贴簿'], whoCopy: ['导出', '复制名单到剪贴簿'] };
  document.addEventListener('click', e => {
    if (!me || !e.target.closest) return; const jb = e.target.closest('nav.jobs [data-job]');
    if (jb) { const j = Number(jb.dataset.job); if (!me.jobs.includes(j)) { e.preventDefault(); e.stopImmediatePropagation(); log('权限', '尝试进入没有权限的作业', JOBN[j], 'warn'); toast(`你的账号没有「${JOBN[j]}」的权限。`); } return; }
    const b = e.target.closest('button'); if (b && CLICK[b.id] && !b.disabled) log(CLICK[b.id][0], CLICK[b.id][1], '');
  }, true);
  const textOf = t => (t.tagName === 'SELECT' ? (t.options[t.selectedIndex] || {}).text : t.value);
  document.addEventListener('focusin', e => { const t = e.target; if (t?.matches?.('input,select')) t.__dmB = textOf(t); }, true);
  document.addEventListener('change', e => {
    if (!me) return; const t = e.target, D = t.dataset || {}, b = t.__dmB ?? '', v = textOf(t), arrow = (x, y) => `${x === '' ? '（空白）' : x} → ${y === '' ? '（空白）' : y}`; let act = '', det = '', risk = '';
    if (t.id === 'planDays') { act = '预计分几天发完'; det = arrow(b, v); }
    else if (D.brate !== undefined) { act = '打款汇率'; det = arrow(b, v); risk = 'high'; }
    else if (D.ddate !== undefined) { act = '更改发放日期'; det = `第 ${Number(D.ddate) + 1} 天：` + arrow(b, v); }
    else if (D.dcap !== undefined) { act = '更改当天拨款上限'; det = `第 ${Number(D.dcap) + 1} 天：` + arrow(b, v); }
    else if (D.move !== undefined || D.movegroup !== undefined) { act = '调整部门发放日'; det = `${(D.move || D.movegroup).replace(/\|/g, '、')}：` + arrow(b, v); }
    else if (D.hgskip !== undefined) { act = '暂缓员工「特例不发」'; det = `${t.checked ? '勾选' : '取消'}（${D.hgskip.split('|').slice(1, 2).join('') || '员工'}）`; risk = 'high'; }
    else if (D.newck !== undefined) { act = '手动更改第一次打款判定'; det = `工号 ${D.newck}：${t.checked ? '是' : '否'}`; risk = 'high'; }
    if (act) log('设定', act, det, risk); t.__dmB = undefined;
  }, true);

  /* ---------- 后台 ---------- */
  let aTab = 'home', F = { u: '', c: '', risk: false, q: '' }, scopeOpen = null, tempShow = null;
  const S = { overview: null, audit: null, users: null, org: {}, roles: [], verify: null };
  const openAdmin = () => { if (!me || me.back === 'none') return; $('dmAdmin').hidden = false; log('权限', '进入后台', ''); refresh(); };
  async function refresh() {
    try {
      if (aTab === 'home') S.overview = await api('GET', '/api/overview');
      if (aTab === 'logs') {
        const p = new URLSearchParams({ limit: '300' }); if (F.u) p.set('u', F.u); if (F.c) p.set('c', F.c); if (F.risk) p.set('risk', '1'); if (F.q.trim()) p.set('q', F.q.trim());
        const [a, v] = await Promise.all([api('GET', `/api/audit?${p}`), api('GET', '/api/audit/verify')]); S.audit = a; S.verify = v;
      }
      if (aTab === 'users') { const r = await api('GET', '/api/users'); S.users = r.users; S.roles = r.roles; S.org = {}; r.org.forEach(({ g, b }) => { (S.org[g] = S.org[g] || []); if (b) S.org[g].push(b); }); }
      renderAdmin();
    } catch (e) { if (e.status !== 401) toast(e.message); }
  }
  const riskPill = r => (r === 'high' ? '<span class="dm-pill high">高风险</span>' : r === 'warn' ? '<span class="dm-pill warn">留意</span>' : '');
  const logRow = l => `<tr><td class="nw">${esc(fmtT(l.t))}</td><td class="nw">${esc(l.name)}<small>${esc(l.acc)}</small></td><td class="nw"><span class="dm-pill">${esc(l.cat)}</span></td><td>${esc(l.act)} ${riskPill(l.risk)}</td><td>${esc(l.det)}</td></tr>`;
  const LH = '<thead><tr><th>时间</th><th>人员</th><th>类别</th><th>操作</th><th>内容</th></tr></thead>';
  function scopeRow(u, ro) {
    const dis = ro ? 'disabled' : '', org = {}; Object.entries(S.org).forEach(([g, bs]) => { org[g] = bs.slice(); });
    const stale = new Set(); u.scope.forEach(g => { if (!org[g]) { org[g] = []; stale.add(g); } }); u.scopeB.forEach(k => { const [g, b] = k.split('|'); if (!org[g]) { org[g] = []; stale.add(g); } if (!org[g].includes(b)) { org[g].push(b); stale.add(k); } });
    const old = '<small class="dm-stale">不在最新名单</small>', gs = Object.keys(org);
    const tree = gs.length ? gs.map(g => { const on = u.scope.includes(g); return `<div class="dm-sg"><label class="dm-sgn"><input type="checkbox" data-dmsg="${u.id}" data-g="${esc(g)}" ${on ? 'checked' : ''} ${dis}><b>${esc(g)}</b>${stale.has(g) ? old : ''}</label><div class="dm-sbs">${org[g].length ? org[g].map(b => { const k = `${g}|${b}`; return `<label><input type="checkbox" data-dmsb="${u.id}" data-k="${esc(k)}" ${on || u.scopeB.includes(k) ? 'checked' : ''} ${on ? 'disabled' : dis}>${esc(b)}${stale.has(k) ? old : ''}</label>`; }).join('') : (stale.has(g) ? '' : '<small class="dm-none">这个事业群没有事业处</small>')}</div></div>`; }).join('') : '<p class="dm-note">还没有可选的范围。请先到作业一导入月度薪资表（或作业二导入核准名单），这里就会列出 Excel 里的事业群和事业处。</p>';
    return `<tr class="dm-scrow"><td colspan="9"><div class="dm-sch"><b>${esc(u.name)} 的可看范围</b><span class="dm-note">勾事业群＝整个事业群，也可以只勾其中几个事业处。</span>${ro ? '' : `<button class="dm-btn" data-dmsall="${u.id}" ${hasScope(u) ? '' : 'disabled'}>改回全部</button>`}<button class="dm-btn" data-dmscl>收起</button></div>${tree}</td></tr>`;
  }
  function renderAdmin() {
    const A = $('dmAdmin'), act = document.activeElement, keep = act?.id && A.contains(act) ? { id: act.id, s: act.selectionStart } : null, sy = A.scrollTop, ro = me.back !== 'full';
    const head = `<div class="dm-ahead"><h1>后台</h1><span class="dm-note">${esc(me.name)} · 权限：${BACKN[me.back]}</span><span style="flex:1"></span><button class="dm-btn" id="dmPw2">修改密码</button>${me.jobs.length ? '<button class="dm-btn" id="dmBack">回到工具</button>' : ''}<button class="dm-btn" id="dmOut2">登出</button></div>
      <div class="dm-tabs" role="tablist">${[['home', '总览'], ['logs', '操作记录'], ['users', '账号与权限']].map(([k, n]) => `<button class="dm-tab ${aTab === k ? 'on' : ''}" role="tab" aria-selected="${aTab === k}" data-dmtab="${k}">${n}</button>`).join('')}</div>`;
    let body = '<p class="dm-note">载入中…</p>';
    if (aTab === 'home' && S.overview) {
      const o = S.overview, t = o.today;
      body = `<div class="dm-stats"><div class="dm-stat"><b>${t.ops}</b><span>今天的操作</span></div><div class="dm-stat"><b>${t.people}</b><span>今天登录人数</span></div><div class="dm-stat ${t.high ? 'alert' : ''}"><b>${t.high}</b><span>今天高风险操作</span></div><div class="dm-stat ${t.loginIssues ? 'alert' : ''}"><b>${t.loginIssues}</b><span>今天登录异常</span></div></div>
      <div class="dm-two"><div style="min-width:0"><h2 class="dm-sec">需要留意</h2><div class="dm-tw"><table class="dm-t">${LH}<tbody>${o.attention.map(logRow).join('') || '<tr><td colspan="5">目前没有需要留意的操作。</td></tr>'}</tbody></table></div></div>
      <div style="min-width:0"><h2 class="dm-sec">每个人的最近动作</h2><div class="dm-tw"><table class="dm-t"><thead><tr><th>人员</th><th>最后登录</th><th>最近操作</th></tr></thead><tbody>${o.people.map(u => `<tr><td class="nw">${esc(u.name)}<small>${esc(u.role)}</small></td><td class="nw">${u.lastLogin ? esc(fmtT(u.lastLogin)) : '—'}</td><td>${esc(u.lastAct) || '—'}</td></tr>`).join('')}</tbody></table></div></div></div>`;
    }
    if (aTab === 'logs' && S.audit) {
      const a = S.audit, v = S.verify;
      body = `<div class="dm-filter"><select class="dm-in" id="dmFu" aria-label="人员"><option value="">全部人员</option>${a.people.map(p => `<option value="${esc(p.acc)}" ${F.u === p.acc ? 'selected' : ''}>${esc(p.name)}（${esc(p.acc)}）</option>`).join('')}</select><select class="dm-in" id="dmFc" aria-label="类别"><option value="">全部类别</option>${a.cats.map(c => `<option ${F.c === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select><input class="dm-in" id="dmFq" placeholder="搜寻操作、文件名、指纹" value="${esc(F.q)}" aria-label="搜寻"><label><input type="checkbox" id="dmFr" ${F.risk ? 'checked' : ''}>只看需要留意的</label><span style="flex:1"></span><span class="dm-note">${a.total} 笔${a.total > a.rows.length ? `，显示最新 ${a.rows.length} 笔` : ''}</span><button class="dm-btn" id="dmCopyLog">复制，贴到 Excel</button></div>
      <div class="dm-tw"><table class="dm-t" style="min-width:780px">${LH}<tbody>${a.rows.map(logRow).join('') || '<tr><td colspan="5">没有符合条件的记录。</td></tr>'}</tbody></table></div>
      <p class="dm-note">${v?.ok ? `<span class="dm-ok">记录完整性检查通过（${v.checked} 笔）</span>。` : `<span class="dm-bad">记录完整性检查没通过：第 ${esc(v?.badId)} 笔之后的记录可能被改过，请通知 IT。</span> `}记录只能新增，不能修改或删除。内容不含员工姓名。一般只有文件名、人数、总额和文件指纹；中途暂缓会记工号和金额。</p>`;
    }
    if (aTab === 'users' && S.users) {
      const dis = ro ? 'disabled' : '';
      const temp = tempShow ? `<div class="dm-temp" role="status"><span><b>${esc(tempShow.name)}</b>（${esc(tempShow.acc)}）的临时密码：</span><code id="dmTempPw">${esc(tempShow.pw)}</code><span class="dm-note">只显示这一次，请私下交给本人。第一次登录时必须修改。</span><button class="dm-btn" id="dmTempClose">我记下了</button></div>` : '';
      body = `${temp}${ro ? '<p class="dm-note">你的后台权限是只读，不能修改账号。</p>' : `<div class="dm-add"><input class="dm-in" id="dmNA" placeholder="账号" aria-label="账号"><input class="dm-in" id="dmNN" placeholder="姓名" aria-label="姓名"><select class="dm-in" id="dmNR" aria-label="角色">${S.roles.map(r => `<option>${esc(r)}</option>`).join('')}</select><button class="dm-btn pri" id="dmNAdd">新增账号</button></div>`}
      <div class="dm-tw"><table class="dm-t" style="min-width:1180px"><thead><tr><th>姓名</th><th>账号</th><th>角色</th><th>可用作业</th><th>可看范围</th><th>后台</th><th>状态</th><th>最后登录</th><th></th></tr></thead><tbody>${S.users.map(u => {
        const self = u.id === me.id;
        return `<tr><td><input class="dm-in" data-dmname="${u.id}" value="${esc(u.name)}" ${dis} style="width:110px" aria-label="${esc(u.name)} 姓名"></td><td><input class="dm-in" data-dmacc="${u.id}" value="${esc(u.acc)}" ${dis} style="width:120px" aria-label="${esc(u.name)} 账号"></td><td><select class="dm-in" data-dmrole="${u.id}" ${dis || (self ? 'disabled' : '')} aria-label="${esc(u.name)} 角色">${[...new Set([...S.roles, u.role])].map(r => `<option ${u.role === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></td><td><span class="dm-jobs">${[1, 2, 3].map(j => `<label><input type="checkbox" data-dmj="${u.id}" value="${j}" ${u.jobs.includes(j) ? 'checked' : ''} ${dis} aria-label="${esc(u.name)} ${JOBN[j]}">${'一二三'[j - 1]}</label>`).join('')}</span></td><td><button class="dm-btn dm-scb" data-dmsco="${u.id}" aria-expanded="${scopeOpen === u.id}">${esc(scopeText(u))}</button></td><td><select class="dm-in" data-dmb="${u.id}" ${dis || (self ? 'disabled' : '')} aria-label="${esc(u.name)} 后台权限">${Object.entries(BACKN).map(([k, n]) => `<option value="${k}" ${u.back === k ? 'selected' : ''}>${n}</option>`).join('')}</select></td><td class="nw">${u.locked ? '<span class="dm-pill high">已锁定</span>' : u.enabled ? '<span class="dm-pill ok">启用</span>' : '<span class="dm-pill">已停用</span>'}</td><td class="nw">${u.lastLogin ? esc(fmtT(u.lastLogin)) : '—'}</td><td class="nw">${ro || self ? '' : `${u.locked ? `<button class="dm-btn" data-dmun="${u.id}">解除锁定</button> ` : ''}<button class="dm-btn" data-dmrst="${u.id}">重设密码</button> <button class="dm-btn ${u.enabled ? 'dang' : ''}" data-dmtog="${u.id}">${u.enabled ? '停用' : '启用'}</button>`}</td></tr>${scopeOpen === u.id ? scopeRow(u, ro) : ''}`;
      }).join('')}</tbody></table></div>
      <p class="dm-note">改角色时，可用作业和后台权限会照新角色重新带入，之后还可以个别调整。权限改动下一个动作就生效。自己的角色、后台权限和启用状态不能自己改。可看范围的选项来自最新导入的 Excel。目前资料来源是 Excel，范围只是过滤画面，真正的管控要靠每个人在 OA 只导出自己范围的名单；串接 OA 后会改由服务器过滤。</p>`;
    }
    A.innerHTML = `<div class="dm-ain">${head}${body}</div>`; A.scrollTop = sy;
    if (keep && $(keep.id)) { const k = $(keep.id); k.focus(); try { k.setSelectionRange(keep.s, keep.s); } catch (_) { /* 不是文字栏位 */ } }
  }
  const findU = id => S.users.find(x => x.id === Number(id));
  async function patchUser(id, body) {
    try { await api('PATCH', `/api/users/${id}`, body); if (Number(id) === me.id) { me = (await api('GET', '/api/me')).user; applyPerm(); renderBar(); } } catch (e) { toast(e.message); }
    await refresh();
  }
  document.addEventListener('click', async e => {
    const A = $('dmAdmin'); if (!e.target.closest || !A.contains(e.target)) return; const t = e.target.closest('button'); if (!t) return; const d = t.dataset;
    if (t.id === 'dmBack') { A.hidden = true; return; }
    if (t.id === 'dmOut2') return logout();
    if (t.id === 'dmPw2') return renderPassword(false);
    if (d.dmtab) { aTab = d.dmtab; renderAdmin(); return refresh(); }
    if (d.dmsco) { const id = Number(d.dmsco); scopeOpen = scopeOpen === id ? null : id; return renderAdmin(); }
    if (d.dmscl !== undefined) { scopeOpen = null; return renderAdmin(); }
    if (t.id === 'dmTempClose') { tempShow = null; return renderAdmin(); }
    if (t.id === 'dmCopyLog') { const rows = S.audit?.rows || [], txt = ['时间\t账号\t姓名\t类别\t操作\t内容', ...rows.map(l => [fmtT(l.t), l.acc, l.name, l.cat, l.act, l.det].join('\t'))].join('\n'); try { navigator.clipboard.writeText(txt).then(() => toast('已复制，可以贴到 Excel。'), () => toast('浏览器不允许自动复制。')); } catch (_) { toast('浏览器不允许自动复制。'); } log('导出', '复制操作记录', `${rows.length} 笔`); return; }
    if (me.back !== 'full') return;
    try {
      if (t.id === 'dmNAdd') { const acc = $('dmNA').value.trim(), name = $('dmNN').value.trim(); if (!acc || !name) return toast('账号和姓名都要填。'); const r = await api('POST', '/api/users', { acc, name, role: $('dmNR').value }); tempShow = { name, acc, pw: r.tempPassword }; return refresh(); }
      if (d.dmun) { await api('POST', `/api/users/${d.dmun}/unlock`, {}); return refresh(); }
      if (d.dmrst) { const u = findU(d.dmrst), r = await api('POST', `/api/users/${d.dmrst}/reset-password`, {}); tempShow = { name: u.name, acc: u.acc, pw: r.tempPassword }; return refresh(); }
      if (d.dmtog) return patchUser(d.dmtog, { enabled: !findU(d.dmtog).enabled });
      if (d.dmsall) return patchUser(d.dmsall, { scope: [], scopeB: [] });
    } catch (err) { toast(err.message); refresh(); }
  });
  document.addEventListener('change', e => {
    const A = $('dmAdmin'), t = e.target, d = t.dataset || {}; if (!A.contains(t)) return;
    if (t.id === 'dmFu') { F.u = t.value; return refresh(); } if (t.id === 'dmFc') { F.c = t.value; return refresh(); } if (t.id === 'dmFr') { F.risk = t.checked; return refresh(); }
    if (me.back !== 'full') return;
    if (d.dmname) { const u = findU(d.dmname), v = t.value.trim(); if (v !== u.name) return patchUser(u.id, { name: v }); return; }
    if (d.dmacc) { const u = findU(d.dmacc), v = t.value.trim(); if (v !== u.acc) return patchUser(u.id, { acc: v }).then(() => { if (u.id === me.id) { try { set0.call(localStorage, LAST, v); } catch (_) { /* 忽略 */ } } }); return; }
    if (d.dmrole) return patchUser(d.dmrole, { role: t.value });
    if (d.dmb) return patchUser(d.dmb, { back: t.value });
    if (d.dmj) { const u = findU(d.dmj), j = Number(t.value); return patchUser(u.id, { jobs: t.checked ? [...u.jobs, j] : u.jobs.filter(x => x !== j) }); }
    if (d.dmsg) { const u = findU(d.dmsg), g = d.g; return patchUser(u.id, { scope: t.checked ? [...u.scope, g] : u.scope.filter(x => x !== g), scopeB: t.checked ? u.scopeB.filter(k => k.split('|')[0] !== g) : u.scopeB }); }
    if (d.dmsb) { const u = findU(d.dmsb), k = d.k; return patchUser(u.id, { scopeB: t.checked ? [...u.scopeB, k] : u.scopeB.filter(x => x !== k) }); }
  });
  let qT; document.addEventListener('input', e => { if (e.target.id === 'dmFq') { F.q = e.target.value; clearTimeout(qT); qT = setTimeout(refresh, 300); } });

  /* 使用中保持登录：闲置超过时间才过期 */
  let active = false; ['click', 'keydown', 'scroll'].forEach(n => addEventListener(n, () => { active = true; }, { passive: true, capture: true }));
  setInterval(() => { if (active && me && $('dmLogin').hidden) { active = false; api('GET', '/api/me').catch(() => {}); } }, 5 * 60e3);

  /* ---------- 启动 ---------- */
  (async () => {
    try { const { user } = await api('GET', '/api/me', undefined, { noRedirect: true }); me = user; if (me.mustChange) renderPassword(true); else await enter(); } catch (e) { renderLogin(e.status === 401 ? '' : e.message); }
  })();
})();
