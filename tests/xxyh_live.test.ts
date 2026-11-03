// 在线（只读）：小熊账号与最新云备份。要 LIVE=1 和抓包里的 token。
import { test } from "node:test"
import assert from "node:assert/strict"
import { accountInfo, downloadBackup } from "../sync/xxyh/api"
import { LIVE, readOnlyHttp, xxyhTokenFromHar } from "./helpers"

test("在线（只读）：小熊账号与最新云备份", { skip: LIVE && xxyhTokenFromHar() ? false : "需要 LIVE=1 和抓包里的 token" }, async () => {
  const token = xxyhTokenFromHar()!
  const acct = await accountInfo(readOnlyHttp, token)
  assert.ok(acct.version && acct.version > 0)
  const doc = await downloadBackup(readOnlyHttp, token, acct.version!)
  console.log(`  云端 v${acct.version}：${doc.cars.length} 辆车，${doc.cars[0].fuelRecords?.length} 条加油`)
  assert.ok(doc.cars.length >= 1)
})
