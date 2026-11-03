'use strict';
/* OA 串接样板。拿到 OA 的 API 文件后，只需要改 ENDPOINT 和 FIELD_MAP。
   认证方式、分页、栏位名称目前都是假设，尚未对过真实 OA。 */
const ENDPOINT = { monthly: '/payroll/monthly', approved: '/payroll/approved' };
const FIELD_MAP = {
  code: '工号', name: '姓名', g: '事业群', b: '事业处', d: '部门', way: '工资发放方式',
  php: '实发工资PHP', rmb: '实发工资RMB', rate: '汇率Peso', addr: '充值地址', month: '薪资年月', first: '第一次打款', seq: '序号',
};
const toRow = raw => Object.fromEntries(Object.entries(FIELD_MAP).map(([k, src]) => [k, raw[src] ?? '']));

function createOaSource({ baseUrl, token }) {
  return {
    async listPayroll({ month, kind }) {
      if (!baseUrl) throw new Error('还没有设定 OA_BASE_URL');
      const u = new URL(ENDPOINT[kind], baseUrl);
      if (month) u.searchParams.set('month', month);
      const r = await fetch(u, { headers: { accept: 'application/json', authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`OA 回应 HTTP ${r.status}`);
      const j = await r.json();
      const rows = Array.isArray(j) ? j : j.data;
      if (!Array.isArray(rows)) throw new Error('OA 回应的格式不对');
      return rows.map(toRow);
    },
  };
}
module.exports = { createOaSource };
