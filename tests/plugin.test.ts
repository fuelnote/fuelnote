// 数据源插件的契约（插件化设计第 4 节）：返回值的校验和整理、版本、错误、添加前的检查
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  addProblem, capabilityLine, parseDescribe, parseFuel, parseStatus, PLUGIN_TIMEOUT_MS, pluginRef, pluginStateText, stateOfError, stateOfStatus,
} from "../common/plugin"
import { normalizeLedger } from "../common/ledger_file"
import { emptyLedger, PluginRef } from "../common/types"

const T = Date.UTC(2026, 9, 12, 6, 3)

function txn(d: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "t1", ts: T, liters: 42.684, price: 7.82, amount: 333.79, paid: 318.79, grade: 95,
    station: { code: "33010001", name: " 示例加油站 ", address: "示例路 1 号", province: "上海市", city: "上海市", district: "", lng: 121.5, lat: 31.2 },
    channel: "油卡", plate: null, ...d,
  }
}

test("describe：契约版本、id、名称、版本、提供的数据；不认识的数据丢掉", () => {
  const r = parseDescribe({ ok: true, contract: 1, id: "ejoy", name: "易捷", version: "0.1.0", capabilities: ["fuel", "weather"] })
  assert.deepEqual(r, { ok: true, value: { id: "ejoy", name: "易捷", version: "0.1.0", capabilities: ["fuel"] } })
  const noName = parseDescribe({ ok: true, contract: 1, id: "ejoy", capabilities: ["fuel"] })
  assert.ok(noName.ok && noName.value.name === "ejoy" && noName.value.version === "")
})

test("describe：版本不是 1 时「插件版本不兼容」；没有 id 是数据不对；null 是插件不可用", () => {
  const v2 = parseDescribe({ ok: true, contract: 2, id: "ejoy", capabilities: ["fuel"] })
  assert.ok(!v2.ok && v2.error.kind === "incompatible" && v2.error.message === "插件版本不兼容")
  const noId = parseDescribe({ ok: true, contract: 1, id: "  ", capabilities: ["fuel"] })
  assert.ok(!noId.ok && noId.error.kind === "invalid")
  const none = parseDescribe(null)
  assert.ok(!none.ok && none.error.kind === "unavailable")
  const text = parseDescribe("ok")
  assert.ok(!text.ok && text.error.kind === "invalid")
})

test("插件给的错误：认识的种类照用，message 直接给用户看；不认识的算读取失败；没写 message 时用默认的说法", () => {
  const e = parseStatus({ ok: false, error: "expired", message: "易捷的凭据已过期，请打开一次油卡 App" })
  assert.ok(!e.ok && e.error.kind === "expired" && e.error.message === "易捷的凭据已过期，请打开一次油卡 App")
  const odd = parseStatus({ ok: false, error: "boom", message: "" })
  assert.ok(!odd.ok && odd.error.kind === "failed" && odd.error.message === "读取失败")
  const net = parseFuel({ ok: false, error: "network" })
  assert.ok(!net.ok && net.error.kind === "network" && net.error.message === "网络错误，请稍后再试")
  const noOk = parseStatus({ connected: true })
  assert.ok(!noOk.ok && noOk.error.kind === "invalid")
})

test("status：已连接、已过期、打码的账号", () => {
  assert.deepEqual(parseStatus({ ok: true, connected: true, expired: false, account: "138****0000" }),
    { ok: true, value: { connected: true, expired: false, account: "138****0000" } })
  assert.deepEqual(parseStatus({ ok: true, connected: "yes" }), { ok: true, value: { connected: false, expired: false, account: null } })
})

test("fuel：金额、升数取两位小数；文字去掉首尾空白、空串当 null；站码是数字时转成文字", () => {
  const r = parseFuel({ ok: true, items: [txn({ station: { code: 33010001, name: " 示例加油站 ", address: "", lng: 121.5, lat: 31.2 } })] })
  assert.ok(r.ok)
  const t = r.value[0]
  assert.equal(t.liters, 42.68)
  assert.deepEqual(t.station, { code: "33010001", name: "示例加油站", address: null, province: null, city: null, district: null, lng: 121.5, lat: 31.2 })
  assert.equal(t.grade, 95)
  assert.equal(t.channel, "油卡")
})

test("fuel：缺字段或类型不对的项丢掉；标号认不出时 null；坐标超出范围时丢掉坐标；items 不是数组是数据不对", () => {
  const r = parseFuel({
    ok: true,
    items: [
      txn({ id: "ok" }),
      txn({ id: "no-ts", ts: "昨天" }),
      txn({ id: "no-liters", liters: null }),
      txn({ id: "negative", paid: -1 }),
      txn({ id: "zero-paid", paid: 0, grade: 93 }),
      txn({ id: "far", station: { name: "示例", lng: 200, lat: 31.2 } }),
      txn({ id: "no-station", station: "示例" }),
      "垃圾",
    ],
  })
  assert.ok(r.ok)
  assert.deepEqual(r.value.map(t => t.id), ["ok", "zero-paid", "far", "no-station"])
  assert.equal(r.value[1].grade, null)
  assert.equal(r.value[1].paid, 0)
  assert.deepEqual([r.value[2].station?.lng, r.value[2].station?.lat], [null, null])
  assert.equal(r.value[3].station, null)
  const bad = parseFuel({ ok: true, items: { t1: txn() } })
  assert.ok(!bad.ok && bad.error.kind === "invalid")
})

test("添加前：没有提供数据、id 和内置的数据源或已添加的插件重复时不加", () => {
  const added: PluginRef[] = [{ script: "FuelNoteEjoy", id: "ejoy", name: "易捷", capabilities: ["fuel"] }]
  const info = (id: string, capabilities: Array<"fuel"> = ["fuel"]) => ({ id, name: "示例", version: "1.0.0", capabilities })
  assert.equal(addProblem(info("example"), added, ["volvo_cn"]), null)
  assert.equal(addProblem(info("example", []), added, ["volvo_cn"]), "这个插件没有提供油记用得上的数据")
  assert.equal(addProblem(info("volvo_cn"), added, ["volvo_cn"]), "插件的 id「volvo_cn」和内置的数据源重复")
  assert.equal(addProblem(info("ejoy"), added, ["volvo_cn"]), "「易捷」已经添加过了")
  assert.deepEqual(pluginRef("FuelNote 示例插件", info("example")), { script: "FuelNote 示例插件", id: "example", name: "示例", capabilities: ["fuel"] })
})

test("显示：提供的数据、连接状态；上次调用的结果", () => {
  assert.equal(capabilityLine(["fuel", "trips"]), "加油交易、行程")
  assert.equal(stateOfStatus({ connected: true, expired: false, account: null }), "connected")
  assert.equal(stateOfStatus({ connected: true, expired: true, account: null }), "expired")
  assert.equal(stateOfStatus({ connected: false, expired: false, account: null }), "not_connected")
  assert.equal(stateOfError({ kind: "expired", message: "" }), "expired")
  assert.equal(stateOfError({ kind: "not_connected", message: "" }), "not_connected")
  assert.equal(stateOfError({ kind: "network", message: "" }), null, "网络错误不改上次的状态")
  assert.equal(pluginStateText("expired"), "已过期")
  assert.equal(PLUGIN_TIMEOUT_MS.connect, null)
  assert.equal(PLUGIN_TIMEOUT_MS.fuel, 20000)
})

test("账本的设置：没有插件列表时补上空的，不是数组时也当空的", () => {
  const raw = JSON.parse(JSON.stringify(emptyLedger())) as Record<string, any>
  delete raw.settings.plugins
  assert.deepEqual(normalizeLedger(raw).settings.plugins, [])
  raw.settings.plugins = "ejoy"
  assert.deepEqual(normalizeLedger(raw).settings.plugins, [])
})
