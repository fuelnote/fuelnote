// 记加油从数据源选（插件化设计第 3、3.2、3.3 节，D9–D13）：要读的时间段和顺序、合成（D11）、整理成 ReceiptFill、
// 油站按五步定（站-1～站-14、站-18、站-19）、新油站从哪来、停车配错时的提醒（停-1～停-6）。编造的数据，地图搜索是假的。
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  appendTxns, arrivalStop, fillFromTxn, firstMonth, gapText, groupByMonth, mergeTxns, monthRange, newStationNote, pickMonthTitle, pickRange, pickStation, prevMonth,
  replaceRecent, sortTxns, StationDeps, stopWarning,
} from "../common/fuel_pick"
import { LngLat, metres } from "../common/geo"
import { FuelTxn, FuelTxnStation } from "../common/plugin"
import { Stop } from "../common/stops"
import { Poi, Station } from "../common/types"

const MIN = 60e3
const T0 = Date.UTC(2026, 4, 21, 9, 31)
/** 人民广场附近（WGS-84） */
const C: LngLat = [121.4737, 31.2304]

/** 从 p 往东 dx 米、往北 dy 米 */
function at(p: LngLat, dx: number, dy = 0): LngLat {
  return [p[0] + dx / (111320 * Math.cos((p[1] * Math.PI) / 180)), p[1] + dy / 111320]
}

function txn(id: string, d: Partial<FuelTxn> = {}): FuelTxn {
  return { id, ts: T0, liters: 30, price: 7.82, amount: 234.6, paid: 229.6, grade: 95, station: null, channel: "油卡", plate: null, ...d }
}

function site(code: string | null, p: LngLat | null, d: Partial<FuelTxnStation> = {}): FuelTxnStation {
  return { code, name: "中国石化晋元加油站", address: "示例路 1 号", province: "上海市", city: "上海市", district: "静安区", lng: p ? p[0] : null, lat: p ? p[1] : null, ...d }
}

function stop(p: LngLat | null, end_ts = T0 - MIN): Stop {
  return {
    trip: { id: String(end_ts), start_ts: end_ts - 20 * MIN, end_ts, start_odometer_km: 1, end_odometer_km: 80944, distance_km: 1, fuel_l: null, start: null, end: null },
    end_ts, place: p ? { lng: p[0], lat: p[1], address: "示例路", city: "上海市", district: "静安区" } : null,
    odometer_km: 80944, stay_min: 6, candidate: null, refuel: true, recorded: null,
  }
}

function mine(id: string, p: LngLat, name = `我的油站${id}`): Station {
  return { id, name, address: "", province: "上海市", city: "上海市", district: "静安区", lng: p[0], lat: p[1], last_used_ts: 0 }
}

function poi(name: string, p: LngLat, address = "示例路 1 号"): Poi {
  return { name, address, province: "上海市", city: "上海市", district: "静安区", lng: p[0], lat: p[1] }
}

/** 假的地图搜索：返回 radius 内的地点；fail 时出错（没网） */
function deps(stations: Station[], pois: Poi[], fail = false): StationDeps & { calls: Array<[LngLat, number]> } {
  const calls: Array<[LngLat, number]> = []
  return {
    calls, mine: stations, now: T0,
    nearby: async (p, r) => {
      calls.push([p, r])
      if (fail) throw new Error("没网")
      return pois.filter(x => metres([x.lng, x.lat], p) <= r)
    },
  }
}

test("要读的时间段：有时间时前后 1 天，没有时从上个月 1 日（北京时间）到现在；顺序：有时间时离它近的在前，没有时新的在前", () => {
  assert.deepEqual(pickRange(T0, T0 + 5 * 86400e3), { from: T0 - 86400e3, to: T0 + 86400e3 })
  const now = Date.parse("2026-10-27T10:37:00+08:00")
  assert.deepEqual(pickRange(null, now), { from: Date.parse("2026-09-01T00:00:00+08:00"), to: now })
  // 北京时间 1 月 1 日 00:30（UTC 还是去年 12 月 31 日）：上个月是去年 12 月
  const newYear = Date.parse("2027-01-01T00:30:00+08:00")
  assert.equal(firstMonth(newYear), "2026-12")
  assert.equal(pickRange(null, newYear).from, Date.parse("2026-12-01T00:00:00+08:00"))
  const list = [txn("a", { ts: T0 - 3 * 3600e3 }), txn("b", { ts: T0 + 3600e3 }), txn("c", { ts: T0 - 20 * 3600e3 })]
  assert.deepEqual(sortTxns(list, T0).map(t => t.id), ["b", "a", "c"])
  assert.deepEqual(sortTxns(list, null).map(t => t.id), ["b", "a", "c"])
  assert.deepEqual(sortTxns(list, T0 - 18 * 3600e3).map(t => t.id), ["c", "a", "b"])
})

test("合成：单价相同的两笔相加，时间取最早一笔，单价不变，标号一致才填；相隔 15 分钟内不提醒", () => {
  const card = txn("card", { ts: T0, liters: 38.78, amount: 357.94, paid: 357.87, station: site("S1", C) })
  const wallet = txn("wallet", { ts: T0 + 3 * MIN, liters: 7.84, amount: 72.36, paid: 72.36, station: site("S1", C), channel: "钱包" })
  const m = mergeTxns([wallet, card])
  assert.ok(m.ok)
  if (!m.ok) return
  assert.deepEqual([m.txn.ts, m.txn.liters, m.txn.amount, m.txn.paid, m.txn.price, m.txn.grade], [T0, 46.62, 430.3, 430.23, 7.82, 95])
  assert.deepEqual(m.parts.map(t => t.id), ["card", "wallet"])
  assert.deepEqual(m.warnings, [])
  assert.equal(m.txn.station?.code, "S1", "油站信息用最早一笔的")
  const g = mergeTxns([card, { ...wallet, grade: 98 }])
  assert.ok(g.ok && g.txn.grade === null, "标号不同时不填")
  const one = mergeTxns([card])
  assert.ok(one.ok && one.txn === card && !one.warnings.length)
})

test("D11：单价不同、站码不同都不能合成；有一笔没有站码时不比（站-14、站-18）；相隔超过 15 分钟只提醒", () => {
  const a = txn("a", { station: site("S1", C) })
  assert.deepEqual(mergeTxns([a, txn("b", { price: 7.95, station: site("S1", C) })]), { ok: false, reason: "单价不同，不是同一次加油" })
  assert.deepEqual(mergeTxns([a, txn("c", { ts: T0 + 6 * MIN, station: site("S2", C) })]), { ok: false, reason: "油站不同，不是同一次加油" })
  const noCode = mergeTxns([txn("d", { station: site(null, null) }), a])
  assert.ok(noCode.ok, "站-18")
  const late = mergeTxns([a, txn("e", { ts: T0 + 2 * 86400e3 + 6 * 3600e3, station: site("S1", C) })])
  assert.ok(late.ok)
  assert.deepEqual(late.ok ? late.warnings : null, ["这几笔相隔 2 天，请确认是同一次加油"])
  assert.deepEqual([gapText(40 * MIN), gapText(3 * 3600e3), gapText(54 * 3600e3)], ["40 分钟", "3 小时", "2 天"])
})

test("整理成 ReceiptFill：付款时间就是记录的时间，字段旁标插件；没有推算的字段", () => {
  const f = fillFromTxn(txn("a", { station: site("S1", C) }))
  assert.deepEqual([f.source, f.tsSource, f.ts, f.payTs, f.price, f.liters, f.amount, f.paid, f.printedGrade, f.station],
    ["plugin", "plugin", T0, T0, 7.82, 30, 234.6, 229.6, 95, "中国石化晋元加油站"])
  assert.deepEqual(f.derived, [])
})

test("到站停车：熄火不早于付款前 10 分钟", () => {
  assert.ok(arrivalStop(stop(C, T0 - 4 * MIN), T0))
  assert.equal(arrivalStop(stop(C, T0 - 25 * MIN), T0), null, "站-6")
  assert.equal(arrivalStop(stop(null, T0 - MIN), T0), null, "没有位置")
  assert.equal(arrivalStop(null, T0), null)
})

test("站-1、站-5：到站停车 80 m 内有我的油站就用它，交易坐标标偏了也不看", async () => {
  const s = mine("m1", at(C, 30))
  const r1 = await pickStation(site("S1", C), stop(C), deps([s], []))
  assert.deepEqual(r1 && [r1.station.id, r1.isNew, r1.via, r1.from], ["m1", false, "stop", "mine"])
  const r5 = await pickStation(site("S1", at(C, 317)), stop(at(C, 20)), deps([mine("m2", C)], []))
  assert.deepEqual(r5 && [r5.station.id, r5.via], ["m2", "stop"])
})

test("站-2、站-3：停车附近没有我的油站，用 60 m 内站名对得上的地图加油站新建；站名对不上的更近也不用", async () => {
  const d = deps([], [poi("中国石化加油站（晋元站）", at(C, 45)), poi("中国石油示例站", at(C, 25))])
  const r = await pickStation(site("S1", at(C, 300)), stop(C), d)
  assert.ok(r)
  assert.deepEqual([r!.station.name, r!.isNew, r!.via, r!.from], ["中国石化加油站（晋元站）", true, "stop", "map"])
  assert.ok(metres([r!.station.lng, r!.station.lat], at(C, 45)) < 1, "位置用地图的")
  assert.equal(d.calls[0][1], 200, "和找加油停车共用 200 m 的搜索")
})

test("第 2、4 步找到的地点 80 m 内有我的油站时用我的油站（站-7）", async () => {
  const real = at(C, 317)
  const r = await pickStation(site("S1", C), null, deps([mine("m1", at(real, 30))], [poi("中国石化晋元加油站", real)]))
  assert.deepEqual(r && [r.station.id, r.isNew, r.via, r.from], ["m1", false, "txn", "mine"])
})

test("站-4：停车附近、交易坐标附近都没有：新建，位置用停车，名称、地址、省市区用交易的", async () => {
  const r = await pickStation(site("S1", at(C, 600), { province: "上海", city: null }), stop(C), deps([], []))
  assert.ok(r)
  assert.deepEqual([r!.station.name, r!.station.address, r!.station.province, r!.station.city, r!.isNew, r!.via, r!.from],
    ["中国石化晋元加油站", "示例路 1 号", "上海市", "上海市", true, "txn", "txn"])
  assert.deepEqual([r!.station.lng, r!.station.lat], C)
})

test("站-6：熄火比付款早 25 分钟不算到站停车，交易坐标 40 m 内有我的油站", async () => {
  const r = await pickStation(site("S1", C), stop(at(C, 2000), T0 - 25 * MIN), deps([mine("m1", at(C, 40))], []))
  assert.deepEqual(r && [r.station.id, r.via], ["m1", "txn"])
})

test("站-8、站-9：只连插件、附近没有我的油站：500 m 内站名对得上的地图加油站新建；地图上也没有就按交易新建在交易坐标", async () => {
  const r8 = await pickStation(site("S1", C), null, deps([], [poi("中国石化晋元加油站", at(C, 316))]))
  assert.deepEqual(r8 && [r8.station.name, r8.isNew, r8.via, r8.from], ["中国石化晋元加油站", true, "txn", "map"])
  const r9 = await pickStation(site("S1", C), null, deps([], []))
  assert.deepEqual(r9 && [r9.station.name, r9.from, r9.station.lng, r9.station.lat], ["中国石化晋元加油站", "txn", C[0], C[1]])
})

test("站-10：按标偏的交易坐标建过的油站，下次有到站停车、地图上仍没有时，第 3 步认出它，不再新建", async () => {
  const built = mine("built", C, "中国石化晋元加油站")
  const r = await pickStation(site("S1", C), stop(at(C, 317)), deps([built], []))
  assert.deepEqual(r && [r.station.id, r.isNew, r.via], ["built", false, "txn"])
})

test("站-11：站名对得上的加油站离停车 70 m：第 4 步按交易坐标找到它", async () => {
  const r = await pickStation(site("S1", at(C, 70)), stop(C), deps([], [poi("中国石化晋元加油站", at(C, 70))]))
  assert.deepEqual(r && [r.station.name, r.via, r.from], ["中国石化晋元加油站", "txn", "map"])
})

test("站-12、站-13：交易没有站名时第 2 步不比站名，跳过第 4、5 步；没有站名、坐标和到站停车时手选", async () => {
  const nameless = site(null, C, { name: null })
  const r = await pickStation(nameless, stop(C), deps([], [poi("中国石油示例站", at(C, 50))]))
  assert.deepEqual(r && [r.station.name, r.via, r.from], ["中国石油示例站", "stop", "map"])
  assert.equal(await pickStation(nameless, null, deps([], [poi("中国石油示例站", at(C, 50))])), null, "第 4、5 步跳过")
  assert.equal(await pickStation(site(null, null, { name: null }), null, deps([], [])), null)
  assert.equal(await pickStation(null, null, deps([], [])), null)
})

test("站-19：没网，地图搜索出错：跳过第 2、4 步，交易坐标 80 m 内也没有我的油站时按交易新建", async () => {
  const d = deps([], [poi("中国石化晋元加油站", at(C, 20))], true)
  const r = await pickStation(site("S1", C), stop(at(C, 10)), d)
  assert.deepEqual(r && [r.station.name, r.from], ["中国石化晋元加油站", "txn"])
  assert.equal(d.calls.length, 2, "第 2、4 步都试过")
})

test("新油站下面写名称和地址从哪来", async () => {
  const fromMap = await pickStation(site("S1", C), stop(C), deps([], [poi("中国石化晋元加油站", at(C, 10), "示例路327号")]))
  assert.equal(newStationNote(fromMap!, "示例", stop(C)), "新油站：示例路327号（地图）")
  const fromTxn = await pickStation(site("S1", C), stop(C), deps([], []))
  assert.equal(newStationNote(fromTxn!, "示例", stop(C)), "新油站：示例路 1 号（示例），位置用到站停车")
  assert.equal(newStationNote(fromTxn!, "示例", null), "新油站：示例路 1 号（示例），位置用交易坐标")
  const mineOne = await pickStation(site("S1", C), stop(C), deps([mine("m1", C)], []))
  assert.equal(newStationNote(mineOne!, "示例", stop(C)), null)
})

test("停-1～停-6：停车离交易坐标超过 500 m 才提醒；停车在我的另一个油站时写出它", () => {
  const far = at(C, 6300)
  assert.equal(stopWarning(site("S1", C), stop(at(C, 20)), []), null, "停-1")
  assert.equal(stopWarning(site("S1", C), stop(far), []), "停车位置距付款油站 6.3 km，请核对里程", "停-2")
  assert.equal(stopWarning(site("S1", C), stop(at(C, 3200)), [mine("m9", at(C, 3210), "示例石化武宁站")]),
    "停车在示例石化武宁站，距付款油站 3.2 km，请核对里程", "停-3")
  assert.equal(stopWarning(site("S1", at(C, 317)), stop(C), [mine("m1", C)]), null, "停-4：标偏 317 m 不提醒")
  assert.match(stopWarning(site("S1", at(C, 800)), stop(C), []) ?? "", /^停车位置距付款油站 (79\d|80\d) m，请核对里程$/, "停-5")
  assert.equal(stopWarning(site("S1", null), stop(far), []), null, "停-6：交易没有坐标")
  assert.equal(stopWarning(null, stop(far), []), null)
})

test("往前加载：一次一个月（北京时间），跨年写年份；按月分组，新的月份在前", () => {
  assert.equal(prevMonth("2026-01"), "2025-12")
  assert.equal(prevMonth("2026-03"), "2026-02")
  assert.deepEqual(monthRange("2026-02"), { from: Date.parse("2026-02-01T00:00:00+08:00"), to: Date.parse("2026-03-01T00:00:00+08:00") - 1 })
  const now = Date.parse("2026-10-27T10:37:00+08:00")
  assert.equal(pickMonthTitle("2026-09", now), "9 月")
  assert.equal(pickMonthTitle("2025-12", now), "2025 年 12 月")
  const list = sortTxns([
    txn("oct", { ts: Date.parse("2026-10-12T14:41:00+08:00") }),
    txn("may-1", { ts: Date.parse("2026-05-09T09:54:00+08:00") }),
    txn("may-2", { ts: Date.parse("2026-05-09T09:57:00+08:00") }),
    txn("dec", { ts: Date.parse("2025-12-15T08:00:00+08:00") }),
  ], null)
  assert.deepEqual(groupByMonth(list).map(g => [g.month, g.items.map(t => t.id)]),
    [["2026-10", ["oct"]], ["2026-05", ["may-2", "may-1"]], ["2025-12", ["dec"]]])
})

test("往前加载：并进来不重复；下拉刷新只换本月和上月，更早加载过的留着", () => {
  const sep = txn("sep", { ts: Date.parse("2026-09-06T10:35:00+08:00") })
  const aug = txn("aug", { ts: Date.parse("2026-08-12T13:59:00+08:00") })
  const oct = txn("oct", { ts: Date.parse("2026-10-12T14:41:00+08:00") })
  assert.deepEqual(appendTxns([oct, sep], [sep, aug]).map(t => t.id), ["oct", "sep", "aug"])
  const fresh = [txn("oct-new", { ts: Date.parse("2026-10-20T08:00:00+08:00") }), oct]
  assert.deepEqual(replaceRecent([oct, sep, aug], fresh, "2026-09").map(t => t.id), ["oct-new", "oct", "aug"])
})
