# HiPay 商户批量下发 API 接口文档

版本：v0.8 对接草案 | 更新日期：2026-11-05

> 本文为对接草案，不代表接口已上线。接入地址及开放时间以对接通知为准。

## 1. 接入与签名

- 使用 HTTPS，以下路径相对于接入地址。
- 调用前需开通发起账号邮箱、商户密钥及来源 IP 白名单，并提供商户整批反查地址。
- 申请和查询均使用 `POST`，请求及响应为 `application/json; charset=UTF-8`。
- 平台根据 `email` 识别商户。申请及查询请求不传 `merchant` 或密钥。
- 商户密钥由商户安全保存，本文公式以 `withdrawKey` 表示，不随任何请求或响应传输。

所有签名统一使用 MD5，输出 32 位大写十六进制字符串。申请及查询请求头必须携带 `X-Sign`：

```text
rawJson = 实际发送的原始 JSON 请求体字符串
X-Sign = UPPER_HEX(MD5(UTF8(rawJson + withdrawKey)))
```

`UPPER_HEX` 为大写十六进制；上式 `+` 表示字符串拼接，先在 `rawJson` 末尾直接追加密钥，再将整个字符串按 UTF-8 编码计算 MD5，不加分隔符、字段名或 `key=`。现有 MD5 密钥可直接按原字符串复用，不先做十六进制解码或再次哈希。先序列化得到 `rawJson`，签名后将同一份 JSON 原文按 UTF-8 发送，不得修改空格、换行、字段顺序或内容；验签时使用收到的 JSON 原文，不解析后重新序列化。不接受重复 JSON 键或未声明的请求字段。整批反查及结果签名的字段拼接顺序分别见第 3、5 节。

## 2. 批量下发申请

`POST /gateway/withdraw/batch/apply`

### 请求参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `batchNo` | string | 是 | 商户批次号，同一商户内唯一，重试沿用原值 |
| `email` | string | 是 | 已开通的发起账号邮箱 |
| `currency` | string | 是 | `USDT` 或 `TRX` |
| `drawBankId` | string | 否 | 协议标识，省略时默认 `TRON`；不接受空字符串、`null` 或非字符串 |
| `usdtAddress` | string | 是 | 已授权的出款钱包地址，不是收款地址 |
| `noticeUrl` | string | 是 | 商户接收单笔结果的公网 HTTPS 地址，整批共用 |
| `remark` | string | 否 | 批次备注 |
| `details` | array | 是 | 非空明细数组，字段见下表 |

| 明细参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `withdrawId` | string | 是 | 商户订单号，同一商户内唯一，不得跨批次复用 |
| `receiveAccount` | string | 是 | 收款地址 |
| `amount` | string | 是 | 正数十进制金额字符串 |
| `remark` | string | 否 | 明细备注 |

批次笔数和金额合计由系统根据 `details` 自动计算，金额合计不含手续费，无需另传汇总字段。

一批只能使用一种币种和协议。金额精度、笔数及可用协议以开通额度和渠道规则为准。省略 `drawBankId` 时，按不含该字段的原始请求体签名。

### 请求示例

`${...}` 为待替换的示例值。

```http
POST /gateway/withdraw/batch/apply
Content-Type: application/json; charset=UTF-8
X-Sign: ${SIGN_OF_EXACT_BODY}
```

```json
{
  "batchNo": "BATCH202611050001",
  "email": "operator@example.com",
  "currency": "USDT",
  "drawBankId": "TRON",
  "usdtAddress": "${PAYER_ADDRESS}",
  "noticeUrl": "https://merchant.example.com/withdraw/notice",
  "details": [
    {
      "withdrawId": "WD202611050001",
      "receiveAccount": "${PAYEE_ADDRESS}",
      "amount": "10.00"
    }
  ]
}
```

### 申请响应

申请接口仅返回申请成功或申请失败，`data` 固定为 `null`。

申请成功：

```json
{
  "success": true,
  "code": "SUCCESS",
  "message": "申请成功",
  "data": null
}
```

申请失败示例：

```json
{
  "success": false,
  "code": "INVALID_PARAMETER",
  "message": "申请失败",
  "data": null
}
```

成功使用 `code="SUCCESS"`；失败使用第 6 节的错误码。申请成功仅表示已受理，不代表付款成功；每笔付款结果以单笔查询或结果通知为准。

**重复提交：** 同一 `batchNo`、相同业务内容的已受理申请仍返回“申请成功”，不重复下发，也不随之后的付款结果改变申请响应；修改内容（包括 `email`、`noticeUrl` 或明细）返回冲突。省略 `drawBankId` 与显式传入 `TRON` 视为相同协议。

## 3. 商户整批反查

商户须在申请前保存批次信息及全部明细。平台使用 `batchNo` 反查整批，不逐笔反查；整批校验通过后才受理，失败不部分提交。

平台向接入时提供的商户 HTTPS 反查地址发送 `POST` 表单，类型为 `application/x-www-form-urlencoded; charset=UTF-8`：

| 参数 | 说明 |
| --- | --- |
| `batchNo` | 申请时的商户批次号 |
| `sign` | 按下式计算的反查请求签名 |

```text
sign = UPPER_HEX(MD5(UTF8(batchNo + withdrawKey)))
```

商户验签后按 `batchNo` 查询本地已保存批次，返回与第 2 节申请参数相同结构的完整 JSON：

```json
{
  "batchNo": "BATCH202611050001",
  "email": "operator@example.com",
  "currency": "USDT",
  "drawBankId": "TRON",
  "usdtAddress": "${PAYER_ADDRESS}",
  "noticeUrl": "https://merchant.example.com/withdraw/notice",
  "details": [
    {
      "withdrawId": "WD202611050001",
      "receiveAccount": "${PAYEE_ADDRESS}",
      "amount": "10.00"
    }
  ]
}
```

也支持将完整批次对象放在 `data` 中。申请有备注时，返回相应批次或明细 `remark`。每次返回整批全部明细，不分页。

- 批次信息须与申请一致；系统根据申请与反查返回的 `details` 分别计算并核对笔数和金额合计，商户无需返回汇总字段。金额按十进制数值比较，省略 `drawBankId` 与 `TRON` 等价。
- 按 `withdrawId` 对应核对全部明细，返回顺序可不同；不得缺单、多单、重复订单号或更改地址、金额、备注。
- 批次不存在、字段缺失或不匹配、空响应、只返回总额或通用成功标识均不能通过反查。须从本地已保存批次取数，不得固定返回成功。
- 反查可能重试，同一批次应支持重复读取，不因反查删除或消费批次。

## 4. 单笔查询

`POST /gateway/withdraw/batch/singleQuery`

使用第 1 节的 `X-Sign` 签名。仅查询当前商户有权限访问的批量 API 明细，不触发下单或补发通知。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `email` | string | 是 | 已开通的账号邮箱 |
| `withdrawId` | string | 是 | 申请时的商户订单号 |

```json
{
  "email": "operator@example.com",
  "withdrawId": "WD202611050001"
}
```

成功响应示例：

```json
{
  "success": true,
  "code": "SUCCESS",
  "message": "查询成功",
  "data": {
    "batchNo": "BATCH202611050001",
    "merchant": "MERCHANT_DEMO",
    "withdrawId": "WD202611050001",
    "serialId": "PLATFORM_WITHDRAW_ID",
    "status": "2",
    "amount": "10.0000",
    "currencyType": "USDT",
    "recordDate": "20261105143000",
    "accountBankName": "${BANK_OR_PROTOCOL_NAME}",
    "accountName": "",
    "accountNo": "${PAYEE_ADDRESS}",
    "state": "",
    "city": "",
    "accountBranchBankName": "",
    "minerFee": "0.0000",
    "transactionTime": "",
    "txHash": "${TX_HASH}",
    "failedMsg": "",
    "sign": "${RESULT_SIGN}"
  }
}
```

`success=true` 仅表示查询成功，`status` 才是单笔付款状态。`batchNo` 为原申请的商户批次号，其他结果字段及验签规则见第 5 节。

已受理但尚未形成最终结果的订单返回 `status="0"`、`serialId=""`。下发前已明确失败的订单返回 `status="3"`、`serialId=""`。未找到订单返回 `ORDER_NOT_FOUND`；申请结果未知时，不得据此更换单号重新下单。

## 5. 单笔结果通知与验签

平台向申请中的 `noticeUrl` 发送 `POST`，类型为 `application/x-www-form-urlencoded; charset=UTF-8`，**不是 JSON**。每笔最终结果独立通知，明确的下发前失败也发送失败通知。

### 结果字段

查询 `data` 与通知共用下列结果字段，值均为字符串。通知不携带查询中的 `batchNo`。

| 字段 | 说明 | 参与结果签名 |
| --- | --- | --- |
| `merchant` | 商户号，仅由平台返回，不是申请或查询入参 | 是 |
| `withdrawId` | 原始商户订单号 | 是 |
| `serialId` | 平台下发流水号，未下发时为空 | 是 |
| `status` | 单笔状态，见下表 | 是 |
| `amount` | 金额，不含手续费，固定四位小数，如 `"10.0000"` | 是 |
| `currencyType` | 币种，通常为 `USDT` 或 `TRX`，可能为空 | 是 |
| `recordDate` | 结果时间，格式 `yyyyMMddHHmmss`；未完成时可为空 | 是 |
| `accountBankName` | 银行或协议名称，不保证等于 `drawBankId` | 是 |
| `accountName` | 收款户名，可能为空 | 是 |
| `accountNo` | 收款地址，对应 `receiveAccount` | 是 |
| `state` | 省份，可为空 | 是 |
| `city` | 城市，可为空 | 是 |
| `accountBranchBankName` | 支行名称，可为空 | 否 |
| `minerFee` | 矿工费，可为空 | 否 |
| `transactionTime` | 交易时间，可为空或缺省 | 否 |
| `txHash` | 交易哈希，可为空或缺省 | 否 |
| `failedMsg` | 失败提示，成功时为空 | 否 |
| `sign` | 结果签名，不拼接自身 | 否 |

| 单笔 `status`（字符串） | 含义 |
| --- | --- |
| `"0"` | 等待或处理中，非最终结果 |
| `"2"` | 下发成功 |
| `"3"` | 最终失败 |

仅 `"2"`、`"3"` 发送最终结果通知，其他未知状态不得判为成功或最终失败。

### 结果验签

查询的 `data.sign` 与通知的 `sign` 使用相同公式，不使用 `X-Sign`：

```text
sign = UPPER_HEX(MD5(UTF8(
  merchant + withdrawId + serialId + status + amount +
  currencyType + recordDate + accountBankName + accountName +
  accountNo + state + city + withdrawKey
)))
```

按固定顺序直接拼接字段值，不排序，不加分隔符、字段名或 `key=`。通知先按 UTF-8 解码表单，再对字段值验签。使用收到的原始字符串，空值按 `""` 拼接，不使用 `"null"`，不改写金额格式或补全空币种。

未参与签名的字段仅供参考，不作为已验签的资金依据；查询额外返回的 `batchNo` 也不参与此签名。

### 通知应答

- 验签并核对商户号、订单号、金额及收款地址；本地结果保存成功后应答。
- 返回 **HTTP 200**，类型为 `text/plain`，正文精确为大写 `SUCCESS`，不得带引号、JSON 包装、空格或换行。
- 通知可能重复、延迟或先于申请响应到达；按 `(merchant, withdrawId)` 幂等处理，不只依赖可能为空的 `serialId`。已处理的相同结果仍返回 `SUCCESS`，不得重复入账或用冲突通知直接覆盖终态。
- 验签或处理失败不得返回 `SUCCESS`。平台对未确认的通知重试，不承诺固定次数或周期；未收到通知时使用单笔查询核对。
- 通知失败不代表付款失败，不得因此重新下单。

## 6. 错误与重试

```json
{
  "success": false,
  "code": "INVALID_PARAMETER",
  "message": "申请失败",
  "data": null
}
```

申请失败的 `message` 固定为“申请失败”，`data` 固定为 `null`，按 `code` 判断错误类型。查询失败沿用相同结构，`message` 为“查询失败”。

| HTTP | 错误码 | 说明 |
| --- | --- | --- |
| `400` | `INVALID_PARAMETER` | 参数缺失、类型或格式错误、明细为空或金额不合法 |
| `401` | `INVALID_SIGNATURE` | 签名缺失或无效 |
| `403` | `ACCESS_DENIED` | 账号、商户权限或来源 IP 不允许 |
| `404` | `ORDER_NOT_FOUND` | 未找到可访问的单笔订单 |
| `409` | `BATCH_NO_CONFLICT` | 同批次号提交了不同内容 |
| `409` | `DETAIL_ORDER_CONFLICT` | 明细单号重复或被其他批次占用 |
| `422` | `BATCH_LIMIT_EXCEEDED` | 超出单批笔数限制 |
| `422` | `BUSINESS_VALIDATION_FAILED` | 币种、协议、钱包、余额或费用等条件不满足 |
| `422` | `VERIFICATION_NOT_CONFIGURED` | 商户反查服务尚未开通 |
| `422` | `MERCHANT_VERIFICATION_FAILED` | 商户整批反查未通过 |
| `502` | `MERCHANT_VERIFICATION_UNAVAILABLE` | 商户反查服务暂不可用 |
| `503` | `SUBMISSION_RESULT_UNKNOWN` | 提交结果暂不确定，沿用原批次核对或重试 |
| `500` | `INTERNAL_ERROR` | 服务异常，沿用原批次核对或重试 |

**申请超时、连接中断或结果未知时，必须使用原 `batchNo`、原明细订单号和相同业务内容重试，并按实际请求体重新签名。不得换号重发，以免重复付款。**

`success=false` 表示本次调用未返回申请成功，不保证此前请求一定未受理；尤其收到 `SUBMISSION_RESULT_UNKNOWN`、`INTERNAL_ERROR` 时，仍须遵守上述重试规则。
