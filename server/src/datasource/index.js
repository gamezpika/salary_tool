'use strict';
/* 资料来源接口。
   现在：excel —— 明细留在使用者的浏览器，后端读不到。
   之后：oa —— 后端向 OA 读取，先按账号范围过滤才回传给浏览器，不写进资料库。

   每个来源要提供：
     async listPayroll({ month, kind }) → [{ code, name, g, b, d, php, rmb, rate, addr, way, month, first, ... }]
     kind：'monthly' 月度薪资（作业一）｜'approved' 当天核准名单（作业二） */
const { createOaSource } = require('./oa');

class SourceNotAvailable extends Error {}

function createSource(config) {
  if (config.dataSource === 'oa') return { name: 'oa', ...createOaSource(config.oa) };
  return { name: 'excel', async listPayroll() { throw new SourceNotAvailable('目前的资料来源是 Excel'); } };
}
function inScope(user, g, b) {
  if (!user.scope.length && !user.scopeB.length) return true;
  return user.scope.includes(g) || user.scopeB.includes(`${g}|${b}`);
}
module.exports = { createSource, inScope, SourceNotAvailable };
