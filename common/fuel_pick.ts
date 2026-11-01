// 记加油从数据源选（插件化设计第 3、3.2、3.3 节，D9–D13）：要读的时间段、列表的顺序、几笔合成、整理成 ReceiptFill、
// 油站按五步定、停车配错时的提醒。纯函数；我的油站、地图搜索由调用方传进来。
import { FieldSource, ReceiptFill } from "./draft"
import { round2 } from "./fuel"
import { distanceText, LngLat, metres } from "./geo"
import { FuelTxn, FuelTxnStation } from "./plugin"
import { monthEnd, monthOf, monthStart } from "./plugin_source"
import { Stop } from "./stops"
import { Poi, Station } from "./types"
import { nearestStation, SAME_STATION_M, sameStationName, stationFromPoi, stationFromTxn } from "../stations/match"

const DAY = 86400e3
/** 表单有时间时，列前后 1 天的交易 */
export const PICK_NEAR_MS = DAY
/** 几笔首尾相隔超过 15 分钟时提醒（沿用截图识别合并两笔的规则） */
export const MERGE_GAP_MS = 15 * 60e3
/** 到站停车：熄火不早于付款前 10 分钟 */
export const ARRIVAL_MS = 10 * 60e3
/** 第 2 步：到站停车这么近的地图上的加油站 */
export const STOP_MAP_M = 60
/** 第 4 步：交易坐标这么近的地图上的加油站 */
export const TXN_MAP_M = 500
/** 停车离交易坐标超过这么远时提醒核对里程（3.3 节） */
export const STOP_FAR_M = 500
/** 第 2 步按这个半径搜地图，和找加油停车的搜索共用缓存 */
const STOP_SEARCH_M = 200

/** 要读的时间段：表单有时间时前后 1 天；没有时一开始列本月和上月，再往前由「加载更早的交易」一个月一个月地加 */
export function pickRange(at: number | null, now: number): { from: number; to: number } {
  return at != null ? { from: at - PICK_NEAR_MS, to: at + PICK_NEAR_MS } : { from: monthStart(firstMonth(now)), to: now }
}

// ---------- 往前加载（画稿第十七轮 DsPickMore；用户 2026-11-02）----------
// 每次一个月，按稳定性定：油记调一次插件最多等 20 秒，缺的几个月合成一次调用、成败一起，失败时一个月也不缓存；
// 一个月正好是一次调用、一个缓存单位（common/plugin_source.ts 按北京时间的月份缓存），失败只影响这一个月。

/** 表单没有时间时，一开始列出的最早一个月：上个月「2026-09」 */
export function firstMonth(now: number): string {
  return prevMonth(monthOf(now))
}

/** 「2026-01」的上一个月「2025-12」 */
export function prevMonth(m: string): string {
  return monthOf(monthStart(m) - 1)
}

/** 这个月的时间段（北京时间） */
export function monthRange(m: string): { from: number; to: number } {
  return { from: monthStart(m), to: monthEnd(m) }
}

/** 「9 月」；不是今年时「2025 年 12 月」 */
export function pickMonthTitle(m: string, now: number): string {
  const [y, mo] = m.split("-").map(Number)
  return m.slice(0, 4) === monthOf(now).slice(0, 4) ? `${mo} 月` : `${y} 年 ${mo} 月`
}

/** 按月分组：组和组里的顺序都跟着传进来的顺序（新的在前时，新的月份在前） */
export function groupByMonth(txns: FuelTxn[]): { month: string; items: FuelTxn[] }[] {
  const out: { month: string; items: FuelTxn[] }[] = []
  for (const t of txns) {
    const m = monthOf(t.ts)
    const last = out[out.length - 1]
    if (last && last.month === m) last.items.push(t)
    else out.push({ month: m, items: [t] })
  }
  return out
}

/** 从 from 往前一个月一个月加载到 target：要读的月份，按读的顺序（from 已经列出，不在里面） */
export function monthsDown(from: string, target: string): string[] {
  const out: string[] = []
  for (let m = prevMonth(from); m >= target; m = prevMonth(m)) out.push(m)
  return out
}

/**
 * 打开选交易页按什么列。表单的时间就是从这个插件选的交易给的、没手动改过时（「更换」，用户 2026-11-02），
 * 按没有时间打开：加载到上次加载到的月份，勾上原来那几笔。时间来自截图、停车或手动填写时，列前后 1 天；新记录默认的现在不算。
 * last：这个插件上次填入的（那时列到的最早月份、是哪几笔），换了插件或没填过时 null
 */
export function pickOpening(o: { ts: number; tsSource: FieldSource | undefined; tsTouched: boolean; last: { start: string | null; ids: string[] } | null }):
  { at: number | null; back: string | null; selected: string[] } {
  if (o.last && o.tsSource === "plugin" && !o.tsTouched) return { at: null, back: o.last.start, selected: o.last.ids }
  return { at: o.tsSource || o.tsTouched ? o.ts : null, back: null, selected: [] }
}

/** 加载到更早一个月的交易：并进来，同一笔不重复 */
export function appendTxns(list: FuelTxn[], more: FuelTxn[]): FuelTxn[] {
  const ids = new Set(list.map(t => t.id))
  return [...list, ...more.filter(t => !ids.has(t.id))]
}

/** 下拉刷新只重读本月和上月：换掉 first 以后的，更早加载过的留着 */
export function replaceRecent(list: FuelTxn[], fresh: FuelTxn[], first: string): FuelTxn[] {
  return appendTxns(fresh, list.filter(t => monthOf(t.ts) < first))
}

/** 列表的顺序：有时间时离它近的在前，没有时新的在前 */
export function sortTxns(txns: FuelTxn[], at: number | null): FuelTxn[] {
  return txns.slice().sort((a, b) => (at != null ? Math.abs(a.ts - at) - Math.abs(b.ts - at) : 0) || b.ts - a.ts)
}

/** 「40 分钟」「3 小时」「2 天」 */
export function gapText(ms: number): string {
  const min = ms / 60e3
  if (min < 60) return `${Math.round(min)} 分钟`
  if (min < 48 * 60) return `${Math.round(min / 60)} 小时`
  return `${Math.floor(min / (24 * 60))} 天`
}

export type TxnMerge =
  | { ok: true; txn: FuelTxn; parts: FuelTxn[]; warnings: string[] }
  | { ok: false; reason: string }

const cents = (n: number) => Math.round(n * 100)

/**
 * 选好的一笔或几笔（第 3 节，D11）：只合成单价相同的几笔，几笔都有站码时站码也要相同（有一笔没有站码时不比）。
 * 升数、机显、实付相加，时间取最早一笔，单价就用那个单价，几笔标号一致时才填标号，油站信息用最早一笔的；首尾相隔超过 15 分钟时提醒
 */
export function mergeTxns(txns: FuelTxn[]): TxnMerge {
  const parts = txns.slice().sort((a, b) => a.ts - b.ts)
  const first = parts[0]
  if (!first) return { ok: false, reason: "还没有选交易" }
  if (parts.some(t => cents(t.price) !== cents(first.price))) return { ok: false, reason: "单价不同，不是同一次加油" }
  const codes = parts.map(t => t.station?.code ?? null)
  if (codes.every(c => c != null) && new Set(codes).size > 1) return { ok: false, reason: "油站不同，不是同一次加油" }
  if (parts.length === 1) return { ok: true, txn: first, parts, warnings: [] }
  const sum = (k: "liters" | "amount" | "paid") => round2(parts.reduce((s, t) => s + t[k], 0))
  const grade = parts.every(t => t.grade === first.grade) ? first.grade : null
  const txn: FuelTxn = { ...first, liters: sum("liters"), amount: sum("amount"), paid: sum("paid"), grade }
  const gap = parts[parts.length - 1].ts - first.ts
  return { ok: true, txn, parts, warnings: gap > MERGE_GAP_MS ? [`这几笔相隔 ${gapText(gap)}，请确认是同一次加油`] : [] }
}

/** 选好的交易整理成 ReceiptFill，和截图识别走同一条路（第 3 节）：付款时间就是记录的时间，字段旁标插件的名称 */
export function fillFromTxn(txn: FuelTxn): ReceiptFill {
  return {
    source: "plugin", price: txn.price, liters: txn.liters, amount: txn.amount, paid: txn.paid, derived: [],
    ts: txn.ts, tsSource: "plugin", payTs: txn.ts, printedGrade: txn.grade, station: txn.station?.name ?? null,
    merged: { tx: null, parts: [], merged: false, unmerged: false },
  }
}

// ---------- 油站（3.2 节） ----------

/** 到站停车：配到的那次停车，熄火不早于付款前 10 分钟；没有位置的不算 */
export function arrivalStop(stop: Stop | null, payTs: number): Stop | null {
  return stop && stop.place && stop.end_ts >= payTs - ARRIVAL_MS ? stop : null
}

/** 按停车找到的（第 1、2 步）标「行程」，按交易找到的（第 3–5 步）标插件的名称 */
export type StationVia = "stop" | "txn"

export type StationPick = {
  station: Station
  isNew: boolean
  via: StationVia
  /** 新油站的名称、地址从哪来：地图（第 2、4 步）或交易（第 5 步）；用我的油站时是 mine */
  from: "mine" | "map" | "txn"
}

export type StationDeps = {
  mine: Station[]
  /** 地图上 p 附近 radiusM 内的加油站（WGS-84）；出错时抛出 */
  nearby: (p: LngLat, radiusM: number) => Promise<Poi[]>
  now: number
}

/**
 * 从插件填入时的油站（3.2 节，站-1～站-19），按顺序用第一个找到的：
 * 1. 到站停车 80 m 内的我的油站；2. 到站停车 60 m 内、站名对得上的地图上的加油站；3. 交易坐标 80 m 内的我的油站；
 * 4. 交易坐标 500 m 内、站名对得上的地图上的加油站；5. 新建：位置用到站停车的，没有就用交易坐标，名称、地址、省市区用交易的。
 * 第 2、4 步取最近的，它 80 m 内有我的油站时用我的油站。交易没有站名时第 2 步不比站名，跳过第 4、5 步。
 * 地图搜索出错时跳过第 2、4 步。都没有时 null，手选
 */
export async function pickStation(txn: FuelTxnStation | null, arrival: Stop | null, deps: StationDeps): Promise<StationPick | null> {
  const name = txn?.name ?? null
  const stopAt: LngLat | null = arrival?.place ? [arrival.place.lng, arrival.place.lat] : null
  const txnAt: LngLat | null = txn && txn.lng != null && txn.lat != null ? [txn.lng, txn.lat] : null
  const mineNear = (p: LngLat) => nearestStation(deps.mine, p, SAME_STATION_M)?.station ?? null
  const onMap = async (p: LngLat, searchM: number, withinM: number): Promise<Poi | null> => {
    let pois: Poi[]
    try {
      pois = await deps.nearby(p, searchM)
    } catch {
      return null
    }
    const hits = pois
      .map(poi => ({ poi, d: metres([poi.lng, poi.lat], p) }))
      .filter(h => h.d <= withinM && (name == null || sameStationName(h.poi.name, name)))
      .sort((a, b) => a.d - b.d)
    return hits[0]?.poi ?? null
  }
  const usePoi = (poi: Poi, via: StationVia): StationPick => {
    const mine = mineNear([poi.lng, poi.lat])
    return mine ? { station: mine, isNew: false, via, from: "mine" } : { station: stationFromPoi(poi, deps.now), isNew: true, via, from: "map" }
  }
  if (stopAt) {
    const mine = mineNear(stopAt)
    if (mine) return { station: mine, isNew: false, via: "stop", from: "mine" }
    const poi = await onMap(stopAt, STOP_SEARCH_M, STOP_MAP_M)
    if (poi) return usePoi(poi, "stop")
  }
  if (txnAt) {
    const mine = mineNear(txnAt)
    if (mine) return { station: mine, isNew: false, via: "txn", from: "mine" }
  }
  if (!txn || name == null) return null
  if (txnAt) {
    const poi = await onMap(txnAt, TXN_MAP_M, TXN_MAP_M)
    if (poi) return usePoi(poi, "txn")
  }
  const at = stopAt ?? txnAt
  return at ? { station: stationFromTxn({ ...txn, name }, at, deps.now), isNew: true, via: "txn", from: "txn" } : null
}

/** 新油站下面的一行：名称和地址从哪来（3.2 节） */
export function newStationNote(pick: StationPick, pluginName: string, arrival: Stop | null): string | null {
  if (!pick.isNew) return null
  const where = pick.station.address || pick.station.name
  if (pick.from === "map") return `新油站：${where}（地图）`
  return `新油站：${where}（${pluginName}），位置用${arrival ? "到站停车" : "交易坐标"}`
}

// ---------- 停车配错时的提醒（3.3 节） ----------

/** 交易有坐标、配到的停车离它超过 500 m 时提醒核对里程；停车 80 m 内有我的油站时写出它（停-1～停-7）。只提醒，不改里程和油站 */
export function stopWarning(txn: FuelTxnStation | null, stop: Stop | null, mine: Station[]): string | null {
  if (!txn || txn.lng == null || txn.lat == null || !stop?.place) return null
  const at: LngLat = [stop.place.lng, stop.place.lat]
  const d = metres(at, [txn.lng, txn.lat])
  if (d <= STOP_FAR_M) return null
  const parked = nearestStation(mine, at, SAME_STATION_M)
  return `${parked ? `停车在${parked.station.name}，` : "停车位置"}距付款油站 ${distanceText(d)}，请核对里程`
}
