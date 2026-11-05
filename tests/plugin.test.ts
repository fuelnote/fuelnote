// 数据源插件的契约（插件化设计第 4 节）：返回值的校验和整理、版本、错误、添加前的检查
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  addProblem, capabilityLine, cardShown, enabledCards, itemSwitch, parseDescribe, pluginItems, parseFuel, parseFuelPrices, parseService, refreshedRef, parseStatus, parseTrips, parseVehicles, parseVehicleStatus, PLUGIN_TIMEOUT_MS, pluginRef,
  pluginStateText, pluginSubtitle, setItem, sourceCaption, stateOfError, stateOfStatus, usedCapabilities,
} from "../common/plugin"
import { normalizeLedger } from "../common/ledger_file"
import { emptyLedger, PluginCapability, PluginRef } from "../common/types"

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
  assert.deepEqual(r, { ok: true, value: { id: "ejoy", name: "易捷", version: "0.1.0", capabilities: ["fuel"], cards: [] } })
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

test("添加前：没有提供数据、提供了车辆数据却没有车辆、id 和已添加的插件重复时不加；2.2 内置数据源的 id（volvo_cn）可以用", () => {
  const added: PluginRef[] = [{ script: "FuelNoteEjoy", id: "ejoy", name: "易捷", capabilities: ["fuel"] }]
  const info = (id: string, capabilities: PluginCapability[] = ["fuel"]) => ({ id, name: "示例", version: "1.0.0", capabilities, cards: [] })
  assert.equal(addProblem(info("example"), added), null)
  assert.equal(addProblem(info("example", []), added), "这个插件没有提供油记用得上的数据")
  assert.equal(addProblem(info("example", ["vehicles"]), added), "这个插件没有提供油记用得上的数据")
  assert.equal(addProblem(info("example", ["trips", "vehicle_status"]), added), "这个插件提供了行程、车况或养修，但没有提供车辆，关联不到车")
  assert.equal(addProblem(info("example", ["vehicles", "trips", "vehicle_status"]), added), null)
  assert.equal(addProblem(info("volvo_cn", ["vehicles", "trips", "vehicle_status", "service"]), added), null)
  assert.equal(addProblem(info("ejoy"), added), "「易捷」已经添加过了")
  assert.deepEqual(pluginRef("FuelNote 示例插件", info("example")), { script: "FuelNote 示例插件", id: "example", name: "示例", capabilities: ["fuel"], version: "1.0.0" })
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

test("vehicles：数字的 id 转成文字；没有名称时用 id；缺 id 的丢掉；items 不是数组是数据不对", () => {
  const r = parseVehicles({ ok: true, items: [{ id: 7, name: " 示例车 ", detail: "车架号 ••••••" }, { id: "v2" }, { name: "没有 id" }, null] })
  assert.ok(r.ok)
  assert.deepEqual(r.value, [{ id: "7", name: "示例车", detail: "车架号 ••••••" }, { id: "v2", name: "v2", detail: "" }])
  const bad = parseVehicles({ ok: true, items: {} })
  assert.ok(!bad.ok && bad.error.kind === "invalid")
  const expired = parseVehicles({ ok: false, error: "expired", message: "登录已过期" })
  assert.ok(!expired.ok && expired.error.kind === "expired" && expired.error.message === "登录已过期")
})

test("trips：按开始时间从早到晚；缺时间或熄火里程、结束早于开始的丢掉；坐标缺了或超出范围时位置为空", () => {
  const trip = (d: Record<string, unknown>) => ({
    id: "t", start_ts: T, end_ts: T + 600e3, start_odometer_km: 100, end_odometer_km: 108.5, distance_km: 8.5, fuel_l: 0.9,
    start: { lng: 121.4, lat: 31.2, address: "示例路 1 号", city: "上海市", district: "徐汇区" }, end: { lng: 121.5, lat: 31.3 }, ...d,
  })
  const r = parseTrips({ ok: true, items: [
    trip({ id: "late", start_ts: T + 3600e3, end_ts: T + 4200e3 }),
    trip({ id: 1 }),
    trip({ id: "no-km", end_odometer_km: null }),
    trip({ id: "back", end_ts: T - 1 }),
    trip({ id: "far", start: { lng: 200, lat: 31 }, end: null }),
  ] })
  assert.ok(r.ok)
  assert.deepEqual(r.value.map(t => t.id), ["1", "far", "late"])
  assert.deepEqual(r.value[0].end, { lng: 121.5, lat: 31.3, address: "", city: "", district: "" })
  assert.equal(r.value[1].start, null)
  assert.equal(r.value[1].end, null)
})

test("vehicle_status：数字照用，缺的为空；没有 status 是数据不对", () => {
  const r = parseVehicleStatus({ ok: true, status: { ts: T, fuel_l: 31.5, range_km: "420", odometer_km: 82912 } })
  assert.ok(r.ok)
  assert.deepEqual(r.value, { ts: T, fuel_l: 31.5, range_km: null, avg_consumption: null, odometer_km: 82912 })
  const bad = parseVehicleStatus({ ok: true })
  assert.ok(!bad.ok && bad.error.kind === "invalid")
  assert.equal(capabilityLine(["vehicles", "trips", "vehicle_status", "service"]), "车辆、行程、车况、养修")
})

test("service：已结算的进店，新的在前；缺字段或类型不对的进店、费用丢掉，第二笔以后的保养记录不用，一笔都不剩的进店丢掉；金额两位小数，文字去掉首尾空白；不对的提示丢掉；等 60 秒", () => {
  const exp = (d: Record<string, unknown> = {}) => ({
    ts: T, title: " 补漆 · 后保 ", remark: "划痕补漆X2", own: 300, maintenance: null,
    settlement: { lines: [{ label: "原价", amount: 2300 }, { label: "续保赠送油漆券", amount: -2000.004 }], note: " 结算备注 ", coupons: [{ name: "续保赠送油漆券", amount: 2000 }, { name: "延保", amount: null }] },
    perk_hints: [{ kind: "count", name: "油漆面", used: 2 }, { kind: "balance", origin: "insurance", amount: 1297 }, { kind: "other" }],
    ...d,
  })
  const maint = { items: [{ name: "机油 0W20", from: "原厂基础保养" }, { name: "" }], notes: ["检查空调不制冷", 3] }
  const r = parseService({
    ok: true, items: [
      { id: 7, arrive_ts: T - 1000, odometer: "x", title: "保修", dealer: null, expenses: [exp({ own: 0 })] },
      { id: "v2", arrive_ts: T, odometer: 79471, title: "保养 · 补漆", dealer: { name: "示例汽车销售服务有限公司", short: "示例汽车", lng: 121.4, lat: 91 },
        expenses: [exp({ maintenance: maint, title: "保养" }), exp({ maintenance: maint }), exp({ ts: "x" }), exp({ settlement: { lines: [{ label: "原价" }], coupons: [] } })] },
      { id: "v3", arrive_ts: T, title: "一笔都不能用", expenses: [exp({ own: -1 }), exp({ maintenance: "保养" })] },
      { arrive_ts: T, title: "没有 id", expenses: [exp()] },
    ],
  })
  assert.ok(r.ok)
  assert.deepEqual(r.value.map(v => v.id), ["v2", "7"])
  const v = r.value[0]
  assert.deepEqual([v.odometer, v.dealer], [79471, { name: "示例汽车销售服务有限公司", short: "示例汽车", lng: null, lat: null }])
  assert.deepEqual(v.expenses.map(e => [e.title, e.maintenance]), [["保养", { items: [{ name: "机油 0W20", from: "原厂基础保养" }], notes: ["检查空调不制冷"] }], ["补漆 · 后保", null]])
  assert.deepEqual(v.expenses[1].settlement, {
    lines: [{ label: "原价", amount: 2300 }, { label: "续保赠送油漆券", amount: -2000 }], note: "结算备注", coupons: [{ name: "续保赠送油漆券", amount: 2000 }, { name: "延保", amount: null }],
  })
  assert.deepEqual(v.expenses[1].perk_hints, [{ kind: "count", name: "油漆面", used: 2 }, { kind: "balance", origin: "insurance", amount: 1297 }])
  assert.deepEqual([r.value[1].odometer, r.value[1].dealer, r.value[1].expenses[0].own], [null, null, 0])
  const bad = parseService({ ok: true })
  assert.ok(!bad.ok && bad.error.kind === "invalid")
  assert.equal(PLUGIN_TIMEOUT_MS.service, 60000)
})

test("fuel_price（2.4）：地区、生效时间、各标号的挂牌价；不认识的标号、超出范围的价格丢掉，同一标号只留第一项，两位小数；等 10 秒", () => {
  const r = parseFuelPrices({
    ok: true, region: " 上海 ", effective: T,
    items: [{ grade: 92, price: 8.854 }, { grade: 95, price: 9.41 }, { grade: 95, price: 9.99 }, { grade: 97, price: 9.5 }, { grade: 98, price: 0 }, { grade: 0, price: 8.57 }, { grade: "98", price: 11.41 }, null],
  })
  assert.ok(r.ok)
  assert.deepEqual(r.value, { region: "上海", effective: T, items: [{ grade: 92, price: 8.85 }, { grade: 95, price: 9.41 }, { grade: 0, price: 8.57 }] })
  const noDate = parseFuelPrices({ ok: true, region: "上海", effective: "10/29", items: [{ grade: 95, price: 9.41 }] })
  assert.ok(noDate.ok && noDate.value.effective === null)
  for (const bad of [{ ok: true, items: [{ grade: 95, price: 9.41 }] }, { ok: true, region: "上海", items: {} }, { ok: true, region: "上海", items: [{ grade: 97, price: 9 }] }]) {
    const x = parseFuelPrices(bad)
    assert.ok(!x.ok && x.error.kind === "invalid")
  }
  const err = parseFuelPrices({ ok: false, error: "network", message: "连不上" })
  assert.ok(!err.ok && err.error.kind === "network")
  assert.equal(PLUGIN_TIMEOUT_MS.fuel_price, 10000)
  const d = parseDescribe({ ok: true, contract: 1, id: "ejoy", name: "易捷", version: "0.3.0", capabilities: ["fuel", "fuel_price"] })
  assert.ok(d.ok && d.value.capabilities.includes("fuel_price"))
  assert.equal(capabilityLine(["fuel", "fuel_price"]), "加油交易、油价")
})

test("插件更新后（2.4）：版本变了重新 describe，名称、提供的数据、版本跟着更新；id 变了或不合规时保留原来的", () => {
  const old: PluginRef = { script: "FuelNoteEjoy", id: "ejoy", name: "易捷", capabilities: ["fuel"] }
  assert.deepEqual(refreshedRef(old, { id: "ejoy", name: "易捷", version: "0.3.0", capabilities: ["fuel", "fuel_price"], cards: [] }, [old]),
    { script: "FuelNoteEjoy", id: "ejoy", name: "易捷", capabilities: ["fuel", "fuel_price"], version: "0.3.0" })
  assert.equal(refreshedRef(old, { id: "other", name: "别的", version: "1.0", capabilities: ["fuel"], cards: [] }, [old]), null)
  assert.equal(refreshedRef(old, { id: "ejoy", name: "易捷", version: "0.3.0", capabilities: ["trips"], cards: [] }, [old]), null)
  const same = { ...old, version: "0.3.0", capabilities: ["fuel", "fuel_price"] as PluginCapability[] }
  assert.equal(refreshedRef(same, { id: "ejoy", name: "易捷", version: "0.3.0", capabilities: ["fuel", "fuel_price"], cards: [] }, [same]), null)
})

// ---------- 2.7 逐项启用和版本号（插件化设计 5.1、5.2 节） ----------

const EXAMPLE: PluginRef = {
  script: "FuelNote 示例插件", id: "example", name: "示例", version: "1.4.0",
  capabilities: ["fuel", "vehicles", "trips", "vehicle_status", "service", "fuel_price", "info"],
  cards: [{ id: "sample", title: "示例卡片" }, { id: "notice", title: "示例公告" }],
}
const VOLVO: PluginRef = { script: "FuelNoteVolvo", id: "volvo_cn", name: "沃尔沃", version: "0.2.0", capabilities: ["vehicles", "trips", "vehicle_status", "service"] }
const EJOY: PluginRef = { script: "FuelNoteEjoy", id: "ejoy", name: "易捷", version: "0.4.2", capabilities: ["fuel", "fuel_price", "info"], cards: [{ id: "discounts", title: "今天的优惠" }] }
const keys = (ref: PluginRef) => pluginItems(ref).map(i => i.key).join()

test("每一项：能力按顺序；声明了卡片时「信息」换成每张卡片（card:<id>，名称是卡片的标题）；没声明卡片时一行「信息」", () => {
  assert.equal(keys(EXAMPLE), "fuel,vehicles,trips,vehicle_status,service,fuel_price,card:sample,card:notice")
  assert.deepEqual(pluginItems(EJOY).map(i => i.title), ["加油交易", "油价", "今天的优惠"])
  assert.deepEqual(pluginItems({ ...EJOY, cards: [] }).map(i => [i.key, i.title]), [["fuel", "加油交易"], ["fuel_price", "油价"], ["info", "信息"]])
  assert.equal(pluginItems(EJOY)[2].cap, "info")
})

test("用到的项：提供的去掉停用的；卡片都停用时不算用到「信息」；没停用时就是提供的", () => {
  assert.deepEqual(usedCapabilities(EXAMPLE), EXAMPLE.capabilities)
  assert.deepEqual(usedCapabilities({ ...EXAMPLE, off: ["card:notice", "fuel_price"] }), ["fuel", "vehicles", "trips", "vehicle_status", "service", "info"])
  assert.deepEqual(usedCapabilities({ ...EXAMPLE, off: ["card:notice", "card:sample"] }), ["fuel", "vehicles", "trips", "vehicle_status", "service", "fuel_price"])
  assert.deepEqual(usedCapabilities({ ...EJOY, cards: [], off: ["info"] }), ["fuel", "fuel_price"])
})

test("开-11：启用的卡片（请求时交给插件）；没声明卡片时 null（不传）", () => {
  assert.deepEqual(enabledCards({ ...EXAMPLE, off: ["card:notice"] })?.map(c => c.id), ["sample"])
  assert.deepEqual(enabledCards(EXAMPLE)?.map(c => c.id), ["sample", "notice"])
  assert.equal(enabledCards({ ...EJOY, cards: [] }), null)
  assert.equal(cardShown({ ...EXAMPLE, off: ["card:notice"] }, "notice"), false)
  assert.equal(cardShown(EXAMPLE, "other"), false, "声明了卡片时，没声明的不显示")
  assert.equal(cardShown({ ...EJOY, cards: [] }, "anything"), true, "没声明卡片时都显示")
})

test("开-8：行程、车况、养修都停用了，「车辆」也不算用到", () => {
  assert.deepEqual(usedCapabilities({ ...EXAMPLE, off: ["trips", "vehicle_status", "service"] }), ["fuel", "fuel_price", "info"])
  assert.deepEqual(usedCapabilities({ ...VOLVO, off: ["trips", "service"] }), ["vehicles", "vehicle_status"])
})

test("开-7：车辆不能单独停用（fixed）；仅剩一项启用时它带锁（locked）；卡片也算一项", () => {
  assert.equal(itemSwitch(VOLVO, "vehicles"), "fixed")
  assert.equal(itemSwitch(VOLVO, "trips"), "on")
  const one = { ...VOLVO, off: ["trips", "service"] }
  assert.equal(itemSwitch(one, "vehicle_status"), "locked")
  assert.equal(itemSwitch(one, "trips"), "off")
  assert.equal(itemSwitch({ ...EJOY, off: ["fuel", "fuel_price"] }, "card:discounts"), "locked")
  assert.equal(itemSwitch({ ...EJOY, off: ["fuel", "card:discounts"] }, "fuel_price"), "locked")
  assert.equal(itemSwitch({ script: "s", id: "p", name: "只有油价", capabilities: ["fuel_price"] }, "fuel_price"), "locked")
})

test("启用、停用：停用写进 off（按项的顺序），启用从 off 去掉，off 空了不留这个键；车辆和仅剩的一项不变", () => {
  const off = setItem(EXAMPLE, "card:notice", false)
  assert.deepEqual(off.off, ["card:notice"])
  assert.deepEqual(setItem(off, "fuel_price", false).off, ["fuel_price", "card:notice"])
  assert.ok(!("off" in setItem(off, "card:notice", true)))
  assert.equal(setItem(VOLVO, "vehicles", false), VOLVO)
  const one = { ...VOLVO, off: ["trips", "service"] }
  assert.equal(setItem(one, "vehicle_status", false), one)
  assert.equal(setItem(EXAMPLE, "card:sample", true), EXAMPLE)
})

test("开-9：插件升级多了一项（能力或卡片）时新的启用；没有了的项从 off 里去掉", () => {
  const old: PluginRef = { script: "FuelNoteEjoy", id: "ejoy", name: "易捷", version: "0.4.2", capabilities: ["fuel", "fuel_price", "info"], cards: [{ id: "discounts", title: "今天的优惠" }], off: ["fuel_price"] }
  const more = refreshedRef(old, { id: "ejoy", name: "易捷", version: "0.4.3", capabilities: ["fuel", "fuel_price", "info"], cards: [{ id: "discounts", title: "今天的优惠" }, { id: "points", title: "积分" }] }, [old])
  assert.ok(more && more.off?.join() === "fuel_price" && enabledCards(more)?.map(c => c.id).join() === "discounts,points")
  const less = refreshedRef(old, { id: "ejoy", name: "易捷", version: "0.4.3", capabilities: ["fuel", "info"], cards: [{ id: "discounts", title: "今天的优惠" }] }, [old])
  assert.ok(less && !("off" in less))
  // 以前没声明卡片、停用了「信息」，升级后声明了卡片：「信息」这一项没有了，卡片是新的项，启用
  const plain: PluginRef = { script: "s", id: "p", name: "插件", version: "1", capabilities: ["fuel", "info"], off: ["info"] }
  const carded = refreshedRef(plain, { id: "p", name: "插件", version: "2", capabilities: ["fuel", "info"], cards: [{ id: "a", title: "甲" }] }, [plain])
  assert.ok(carded && !("off" in carded) && usedCapabilities(carded).includes("info"))
})

test("版本号（5.1 节）：设置列表那一行写版本和启用的几项（卡片写名称）；插件详情的副标题写版本和脚本名；读不到版本时不写这一段", () => {
  assert.equal(sourceCaption(EJOY, "0.4.2"), "版本 0.4.2 · 加油交易、油价、今天的优惠")
  assert.equal(sourceCaption({ ...EXAMPLE, off: ["card:notice"] }, "1.4.0"), "版本 1.4.0 · 加油交易、车辆、行程、车况、养修、油价、示例卡片")
  assert.equal(sourceCaption(VOLVO, ""), "车辆、行程、车况、养修")
  assert.equal(sourceCaption({ ...VOLVO, off: ["trips", "vehicle_status"] }, "0.2.0"), "版本 0.2.0 · 车辆、养修")
  assert.equal(pluginSubtitle(VOLVO, "0.2.0"), "版本 0.2.0 · 脚本 FuelNoteVolvo")
  assert.equal(pluginSubtitle(VOLVO, ""), "脚本 FuelNoteVolvo")
})

test("账本的设置：插件停用的几项原样保留（跟着备份）", () => {
  const l = normalizeLedger({ ...emptyLedger(), settings: { plugins: [{ ...EJOY, off: ["card:discounts"] }] } } as unknown as Record<string, unknown>)
  assert.deepEqual(l.settings.plugins[0].off, ["card:discounts"])
})
