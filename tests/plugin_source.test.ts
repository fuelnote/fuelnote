// 调用数据源插件（插件化设计 4.1、5 节；docs/plugins.md 第 4 节）：按月缓存加油交易、出错不缓存、下拉刷新、相同的请求共用、同一插件排队、超时、重新连接清缓存、上次的状态
import { test } from "node:test"
import assert from "node:assert/strict"
import { createPluginSource, monthOf, monthsBetween, OLD_MONTH_TTL_MS, PluginCacheFile, RECENT_MONTH_TTL_MS } from "../common/plugin_source"
import { PluginAction } from "../common/plugin"
import { PluginRef } from "../common/types"

const MIN = 60e3
const DAY = 86400e3
/** 北京时间 */
const bj = (s: string) => Date.parse(`${s}+08:00`)
const NOW = bj("2026-10-12T14:03:00")
const REF: PluginRef = { script: "FuelNote 示例插件", id: "example", name: "示例", capabilities: ["fuel"] }

function txn(id: string, ts: number) {
  return { id, ts, liters: 40, price: 7.5, amount: 300, paid: 300, grade: 95, station: null, channel: "油卡", plate: null }
}

/** 9 月、10 月各有两笔；8 月一笔 */
const ALL = [
  txn("aug", bj("2026-08-25T09:00:00")),
  txn("sep-1", bj("2026-09-03T09:00:00")), txn("sep-2", bj("2026-09-28T18:00:00")),
  txn("oct-1", bj("2026-10-01T08:00:00")), txn("oct-2", bj("2026-10-12T14:00:00")),
]

type Call = { action: PluginAction; params: Record<string, unknown>; at: number; resolve: (v: unknown) => void }

/** 假时钟和假插件：auto 时插件马上按 respond 回答，否则由测试调 resolve */
function harness(opts: { auto?: boolean; persisted?: PluginCacheFile | null; respond?: (action: PluginAction, params: Record<string, unknown>) => unknown } = {}) {
  let now = NOW
  const timers: Array<{ at: number; resolve: () => void }> = []
  const calls: Call[] = []
  let file = opts.persisted ?? null
  const respond = opts.respond ?? ((action: PluginAction, params: Record<string, unknown>) => {
    if (action === "fuel") return { ok: true, items: ALL.filter(t => t.ts >= Number(params.from) && t.ts <= Number(params.to)) }
    return { ok: true, connected: true, account: "138****0000" }
  })
  const source = createPluginSource({
    call: (_script, action, params) => new Promise(resolve => {
      const c: Call = { action, params, at: now, resolve }
      calls.push(c)
      if (opts.auto !== false) resolve(respond(action, params))
    }),
    load: () => file,
    save: f => { file = JSON.parse(JSON.stringify(f)) },
    now: () => now,
    sleep: ms => new Promise<void>(resolve => { timers.push({ at: now + ms, resolve }) }),
  })
  const flush = () => new Promise(r => setImmediate(r))
  return {
    source, calls, file: () => file, flush,
    async advance(ms: number) {
      now += ms
      for (const t of timers.filter(x => x.at <= now)) {
        timers.splice(timers.indexOf(t), 1)
        t.resolve()
      }
      await flush()
    },
  }
}

const ids = (r: { ok: boolean; value?: Array<{ id: string }> }) => (r.ok && r.value ? r.value.map(t => t.id) : null)

test("月份按北京时间；from 到 to 落在哪几个月", () => {
  assert.equal(monthOf(bj("2026-10-01T00:30:00")), "2026-10")
  assert.equal(monthOf(bj("2026-09-30T23:59:00")), "2026-09")
  assert.deepEqual(monthsBetween(bj("2026-08-20T00:00:00"), bj("2026-10-12T00:00:00")), ["2026-08", "2026-09", "2026-10"])
  assert.deepEqual(monthsBetween(bj("2026-10-11T00:00:00"), bj("2026-10-13T00:00:00")), ["2026-10"])
})

test("加油交易按月向插件要，按时间筛、新的在前；10 分钟内不再调插件", async () => {
  const h = harness()
  const r = await h.source.fuel(REF, { from: bj("2026-09-15T00:00:00"), to: NOW })
  assert.deepEqual(ids(r), ["oct-2", "oct-1", "sep-2"])
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.calls[0].params, { from: bj("2026-09-01T00:00:00"), to: bj("2026-11-01T00:00:00") - 1 })
  await h.advance(5 * MIN)
  await h.source.fuel(REF, { from: bj("2026-09-15T00:00:00"), to: NOW })
  assert.equal(h.calls.length, 1, "缓存还新鲜")
})

test("包含最近 2 天的月份 10 分钟过期，只重新要这个月；更早的月份 1 天过期", async () => {
  const h = harness()
  const range = { from: bj("2026-09-15T00:00:00"), to: NOW }
  await h.source.fuel(REF, range)
  await h.advance(RECENT_MONTH_TTL_MS + MIN)
  await h.source.fuel(REF, range)
  assert.equal(h.calls.length, 2)
  assert.deepEqual(h.calls[1].params, { from: bj("2026-10-01T00:00:00"), to: bj("2026-11-01T00:00:00") - 1 }, "9 月还在缓存里")
  await h.advance(OLD_MONTH_TTL_MS)
  await h.source.fuel(REF, range)
  assert.deepEqual(h.calls[2].params, { from: bj("2026-09-01T00:00:00"), to: bj("2026-11-01T00:00:00") - 1 })
})

test("缺哪几个月就要哪几个月：缓存里有 10 月，再要 8 月到 10 月时只要 8、9 月", async () => {
  const h = harness()
  await h.source.fuel(REF, { from: bj("2026-10-05T00:00:00"), to: NOW })
  const r = await h.source.fuel(REF, { from: bj("2026-08-20T00:00:00"), to: NOW })
  assert.deepEqual(h.calls[1].params, { from: bj("2026-08-01T00:00:00"), to: bj("2026-10-01T00:00:00") - 1 })
  assert.deepEqual(ids(r), ["oct-2", "oct-1", "sep-2", "sep-1", "aug"])
})

test("出错不缓存：插件说凭据过期，下次照样调插件；记下「已过期」", async () => {
  let expired = true
  const h = harness({ respond: (action, params) => (expired ? { ok: false, error: "expired", message: "凭据已过期" } : { ok: true, items: ALL.filter(t => t.ts >= Number(params.from)) }) })
  const r = await h.source.fuel(REF, { from: bj("2026-10-05T00:00:00"), to: NOW })
  assert.ok(!r.ok && r.error.kind === "expired" && r.error.message === "凭据已过期")
  assert.equal(h.source.lastState("example"), "expired")
  assert.deepEqual(h.file()?.months ?? {}, {}, "出错时不缓存交易")
  expired = false
  const again = await h.source.fuel(REF, { from: bj("2026-10-05T00:00:00"), to: NOW })
  assert.deepEqual(ids(again), ["oct-2"])
  assert.equal(h.calls.length, 2)
  assert.equal(h.source.lastState("example"), "connected")
})

test("下拉刷新不看缓存：分两笔付款，付完第一笔就打开过，10 分钟内再打开也能看到第二笔", async () => {
  const items = [txn("first", bj("2026-10-12T13:58:00"))]
  const h = harness({ respond: () => ({ ok: true, items: [...items] }) })
  const range = { from: bj("2026-10-11T00:00:00"), to: NOW }
  await h.source.fuel(REF, range)
  items.push(txn("second", bj("2026-10-12T14:01:00")))
  assert.deepEqual(ids(await h.source.fuel(REF, range)), ["first"], "缓存里还是一笔")
  assert.deepEqual(ids(await h.source.fuel(REF, range, { force: true })), ["second", "first"])
})

test("缓存写进文件：冷启动时直接用", async () => {
  const a = harness()
  await a.source.fuel(REF, { from: bj("2026-10-05T00:00:00"), to: NOW })
  const b = harness({ persisted: a.file() })
  const r = await b.source.fuel(REF, { from: bj("2026-10-05T00:00:00"), to: NOW })
  assert.deepEqual(ids(r), ["oct-2"])
  assert.equal(b.calls.length, 0)
})

test("相同的请求共用一个结果；同一个插件同一时间只发一个请求", async () => {
  const h = harness({ auto: false })
  const range = { from: bj("2026-10-05T00:00:00"), to: NOW }
  const a = h.source.fuel(REF, range)
  const b = h.source.fuel(REF, range)
  const s = h.source.status(REF)
  await h.flush()
  assert.equal(h.calls.length, 1, "两次相同的读取只调一次；读状态排在后面")
  h.calls[0].resolve({ ok: true, items: [ALL[4]] })
  assert.deepEqual(ids(await a), ["oct-2"])
  assert.deepEqual(ids(await b), ["oct-2"])
  await h.flush()
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1].action, "status")
  h.calls[1].resolve({ ok: true, connected: true, account: null })
  assert.ok((await s).ok)
})

test("超时从真正调用时算起：排队等前一个请求的时间不算", async () => {
  const h = harness({ auto: false })
  const s = h.source.status(REF)
  const f = h.source.fuel(REF, { from: bj("2026-10-05T00:00:00"), to: NOW })
  await h.flush()
  await h.advance(4 * 1000)
  h.calls[0].resolve({ ok: true, connected: true, account: null })
  assert.ok((await s).ok)
  await h.flush()
  assert.equal(h.calls[1].action, "fuel")
  await h.advance(19 * 1000)
  h.calls[1].resolve({ ok: true, items: [ALL[4]] })
  assert.deepEqual(ids(await f), ["oct-2"], "排队 4 秒、调用 19 秒，没有超过 20 秒")
})

test("超时：不再等，返回「插件没有回应」，放开这个插件；晚回来的结果丢掉，不缓存", async () => {
  const h = harness({ auto: false })
  const range = { from: bj("2026-10-01T00:00:00"), to: NOW }
  const f = h.source.fuel(REF, range)
  await h.flush()
  await h.advance(20 * 1000)
  const r = await f
  assert.ok(!r.ok && r.error.kind === "timeout" && r.error.message === "插件没有回应")
  const again = h.source.fuel(REF, range)
  await h.flush()
  assert.equal(h.calls.length, 2, "下一次重新调用插件")
  h.calls[0].resolve({ ok: true, items: [ALL[4]] })
  await h.flush()
  assert.deepEqual(h.file()?.months ?? {}, {}, "超时以后才回来的结果不缓存")
  h.calls[1].resolve({ ok: true, items: [ALL[3], ALL[4]] })
  assert.deepEqual(ids(await again), ["oct-2", "oct-1"])
})

test("连接页不限时；重新连接后清掉这个插件的缓存，移除时连状态一起清", async () => {
  const h = harness()
  const range = { from: bj("2026-10-05T00:00:00"), to: NOW }
  await h.source.fuel(REF, range)
  const c = await h.source.connect(REF)
  assert.ok(c.ok && c.value.account === "138****0000")
  await h.source.fuel(REF, range)
  assert.equal(h.calls.filter(x => x.action === "fuel").length, 2, "重新连接后重新读")
  assert.equal(h.source.lastState("example"), "connected")
  h.source.forget("example")
  assert.equal(h.source.lastState("example"), null)
  assert.deepEqual(h.file()?.months, {})
})

test("脚本不在（Script.run 返回 null）：插件不可用，不改上次的状态", async () => {
  const h = harness({ respond: action => (action === "status" ? { ok: true, connected: false } : null) })
  await h.source.status(REF)
  assert.equal(h.source.lastState("example"), "not_connected")
  const r = await h.source.fuel(REF, { from: bj("2026-10-05T00:00:00"), to: NOW })
  assert.ok(!r.ok && r.error.kind === "unavailable")
  assert.equal(h.source.lastState("example"), "not_connected")
  const d = await h.source.describe("不存在的脚本")
  assert.ok(!d.ok && d.error.kind === "unavailable")
})

test("车辆、行程、车况：不缓存，每次都调插件；参数带车辆 id 和时间；成功记「已连接」，出错记插件说的状态", async () => {
  const ref: PluginRef = { script: "FuelNote 示例插件", id: "example", name: "示例", capabilities: ["vehicles", "trips", "vehicle_status"] }
  let expired = false
  const h = harness({
    respond: (action, params) => {
      if (expired) return { ok: false, error: "expired" }
      if (action === "vehicles") return { ok: true, items: [{ id: "car-1", name: "示例车", detail: "" }] }
      if (action === "trips") return { ok: true, items: [{ id: "t1", start_ts: Number(params.from), end_ts: Number(params.from) + 600e3, end_odometer_km: 100 }] }
      return { ok: true, status: { ts: NOW, fuel_l: 30, range_km: 400, avg_consumption: 9.5, odometer_km: 100 } }
    },
  })
  const cars = await h.source.vehicles(ref)
  assert.ok(cars.ok && cars.value[0].id === "car-1")
  const range = { from: NOW - DAY, to: NOW }
  assert.ok((await h.source.trips(ref, "car-1", range)).ok)
  assert.ok((await h.source.trips(ref, "car-1", range)).ok)
  const st = await h.source.vehicleStatus(ref, "car-1")
  assert.ok(st.ok && st.value.fuel_l === 30)
  assert.deepEqual(h.calls.map(c => c.action), ["vehicles", "trips", "trips", "vehicle_status"])
  assert.deepEqual(h.calls[1].params, { vehicle: "car-1", from: NOW - DAY, to: NOW })
  assert.deepEqual(h.calls[3].params, { vehicle: "car-1" })
  assert.equal(h.source.lastState("example"), "connected")
  expired = true
  const r = await h.source.vehicleStatus(ref, "car-1")
  assert.ok(!r.ok && r.error.kind === "expired")
  assert.equal(h.source.lastState("example"), "expired")
  assert.deepEqual(h.file()?.months, {})
})

test("养修：「插件 + 车辆」缓存 10 分钟；下拉不看缓存；出错不缓存；重新连接时清掉；参数带车辆 id", async () => {
  const ref: PluginRef = { script: "FuelNote 示例插件", id: "example", name: "示例", capabilities: ["vehicles", "service"] }
  let fail = false
  const visit = {
    id: "v1", arrive_ts: NOW - DAY, odometer: 100, title: "保养", dealer: null,
    expenses: [{ ts: NOW - DAY, title: "保养", remark: "", own: 0, maintenance: null, settlement: { lines: [{ label: "原价", amount: 0 }], note: "", coupons: [] }, perk_hints: [] }],
  }
  const h = harness({
    respond: action => (fail ? { ok: false, error: "network", message: "网络连接已中断。" } : action === "service" ? { ok: true, items: [visit] } : { ok: true, connected: true, account: null }),
  })
  const services = () => h.calls.filter(c => c.action === "service")
  const a = await h.source.service(ref, "car-1")
  assert.ok(a.ok && a.value[0].id === "v1")
  await h.source.service(ref, "car-1")
  assert.deepEqual(services().map(c => c.params), [{ vehicle: "car-1" }])
  await h.source.service(ref, "car-2")
  await h.source.service(ref, "car-1", { force: true })
  await h.advance(10 * MIN)
  await h.source.service(ref, "car-1")
  assert.equal(services().length, 4)
  assert.equal(h.source.lastState("example"), "connected")
  fail = true
  const e = await h.source.service(ref, "car-1", { force: true })
  assert.ok(!e.ok && e.error.kind === "network" && e.error.message === "网络连接已中断。")
  assert.ok((await h.source.service(ref, "car-1")).ok, "出错不缓存：上一次读到的还在")
  fail = false
  await h.source.connect(ref)
  assert.deepEqual(Object.keys(h.file()?.services ?? {}), [])
  await h.source.service(ref, "car-1")
  assert.deepEqual([services().length, Object.keys(h.file()?.services ?? {})], [6, ["example|car-1"]])
})

test("养修等 60 秒：第一次要读全部进店的明细", async () => {
  const h = harness({ auto: false })
  const p = h.source.service(REF, "car-1")
  let done = false
  void p.then(() => { done = true })
  await h.flush()
  await h.advance(30e3)
  assert.equal(done, false)
  await h.advance(30e3)
  const r = await p
  assert.ok(!r.ok && r.error.kind === "timeout")
})
