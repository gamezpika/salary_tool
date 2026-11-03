'use strict';
/* 只有这份白名单上的设定会存到服务器。明细（批次、已发名单、序号、地址状态）和 API Key 都不在内。
   jobs：哪些作业的人可以读写。 */
const PFX = 'payroll-allocator-';
const SETTINGS = {
  [PFX + 'capdefault-v1']: { jobs: [1], label: '每天预计拨款' },
  [PFX + 'pickmode-v1']: { jobs: [1], label: '排程方式' },
  [PFX + 'rules-v1']: { jobs: [1], label: '排程条件' },
  [PFX + 'holdgroups-v1']: { jobs: [1], readJobs: [1, 3], label: '暂缓分组' },
  [PFX + 'wallets-v1']: { jobs: [2, 3], label: '出款钱包', wallets: true },
  [PFX + 'wcap-v1']: { jobs: [2, 3], label: '每个钱包上限' },
  [PFX + 'wcfg-v1']: { jobs: [2, 3], label: '分钱包条件', wcfg: true },
  [PFX + 'wrules-v1']: { jobs: [2, 3], label: '分钱包规则' },
  [PFX + 'trxparams-v2']: { jobs: [2, 3], label: '矿工费与第一次补助' },
  [PFX + 'lasttrxw-v1']: { jobs: [2, 3], label: '上次打 TRX 的钱包', silent: true },
  [PFX + 'lastpayrate']: { jobs: [3], label: '上次打款汇率', silent: true },
};
const canRead = (user, key) => !!SETTINGS[key] && (SETTINGS[key].readJobs || SETTINGS[key].jobs).some(j => user.jobs.includes(j));
const canUse = (user, key) => !!SETTINGS[key] && SETTINGS[key].jobs.some(j => user.jobs.includes(j));
const mask = a => { a = String(a || ''); return a.length > 12 ? `${a.slice(0, 5)}…${a.slice(-4)}` : (a || '（空白）'); };
const RULE = { serial: '序号连续', amount: '金额平均', heads: '人数平均', dept: '部门尽量不拆开' };
const names = o => (o.length ? o.map(k => RULE[k] || k).join('、') : '预设');
const parse = s => { try { return JSON.parse(s); } catch (_) { return null; } };

/* 钱包只有地址或打款人员变动才算设定变更；链上余额更新不进记录 */
function walletChanges(before, after) {
  const a = Array.isArray(parse(before)) ? parse(before) : [], b = Array.isArray(parse(after)) ? parse(after) : [];
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || {}, y = b[i] || {};
    if ((x.addr || '') !== (y.addr || '')) out.push({ act: '更改出款钱包地址', det: `钱包 ${i + 1}：${mask(x.addr)} → ${mask(y.addr)}`, risk: 'high' });
    const defaultName = !x.payer && /^钱包 \d+$/.test(y.payer || '');
    if ((x.payer || '') !== (y.payer || '') && !defaultName) out.push({ act: '更改钱包打款人员', det: `钱包 ${i + 1}：${x.payer || '（空白）'} → ${y.payer || '（空白）'}`, risk: '' });
  }
  return out;
}
function describeChange(key, before, after) {
  const s = SETTINGS[key];
  if (s.silent) return [];
  if (s.wallets) return walletChanges(before, after);
  if (s.wcfg) {
    const o = v => { const x = parse(v); return Array.isArray(x?.urules) ? x.urules : []; }, a = o(before), b = o(after);
    if (a.join() !== b.join() && b.length) return [{ act: '更改 USDT 分配规则', det: `${names(a)} → ${names(b)}`, risk: '' }];
  }
  const short = v => v == null || (String(v).length <= 80 && !/^[[{]/.test(String(v)));
  return [{ act: `更改${s.label}`, det: short(before) && short(after) ? `${before ?? '（空白）'} → ${after}` : '内容已更新', risk: '' }];
}
module.exports = { SETTINGS, canUse, canRead, describeChange };
