// 调用数据源插件（插件化设计 4.1、5 节；docs/plugins.md 第 4 节）：
// - 同一个插件同一时间只发一个请求，相同的请求共用一个结果；超时从真正调用时算起，排队的时间不算。超时后放开这个插件，晚回来的结果丢掉；
// - 加油交易按「插件 + 月份」缓存：缺哪几个月就向插件要哪几个月，取出来再按时间筛。包含最近 2 天的月份 10 分钟，更早的 1 天；出错不缓存；
// - 养修按「插件 + 车辆」缓存 10 分钟（插件化设计 3.4 节）；下拉不看缓存，出错不缓存；
// - 车辆、行程、车况这里不缓存：行程、车况的缓存和内置的数据源共用，在 app/vehicle_data.ts（插件化设计第 5 节）；
// - 油价这里不缓存，按地区缓存在 app/fuel_price.ts（加满金额设计第 4 节）；查油价不用登录，结果不改插件的连接状态；
// - 记下每个插件上次调用的结果（已连接、未连接、已过期），记加油的入口和设置里显示。
// 纯逻辑：调用插件、读写缓存、时钟和计时都由调用方注入（照 common/stop_source.ts 的写法），Node 测试可用。
import { RemoteVehicle, ServiceVisit, Trip, VehicleStatus } from "../providers/types"
import { BJ_OFFSET } from "./format"
import {
  FuelTxn, parseDescribe, parseFuel, parseFuelPrices, parseService, parseStatus, parseTrips, parseVehicles, parseVehicleStatus, PluginAction, pluginError, PluginInfo, PluginResult,
  PluginState, PluginStatus, PLUGIN_TIMEOUT_MS, stateOfError, stateOfStatus,
} from "./plugin"
import { FuelPrices, PluginRef, PriceRegion } from "./types"

export const RECENT_MONTH_TTL_MS = 10 * 60e3
export const OLD_MONTH_TTL_MS = 86400e3
export const SERVICE_TTL_MS = 10 * 60e3
const RECENT_MS = 2 * 86400e3

export type PluginMonth = { fetched_at: number; items: FuelTxn[] }
export type PluginServiceCache = { fetched_at: number; items: ServiceVisit[] }

/** cache/plugins.json，不进备份 */
export type PluginCacheFile = {
  schema_version: 1
  /** 「插件 id|2026-10」→ 这个月的交易 */
  months: Record<string, PluginMonth>
  /** 插件 id → 上次调用的结果 */
  states: Record<string, PluginState>
  /** 「插件 id|车辆」→ 读到的养修（2.3） */
  services?: Record<string, PluginServiceCache>
}

export type PluginSourceDeps = {
  /** 调用插件（`Script.run`）：返回插件 exit 的结果；脚本不在或没有结果时 null */
  call(script: string, action: PluginAction, params: Record<string, unknown>): Promise<unknown>
  load(): PluginCacheFile | null
  save(file: PluginCacheFile): void
  now(): number
  /** 等 ms 毫秒（超时用） */
  sleep(ms: number): Promise<void>
}

export type PluginSource = {
  describe(script: string): Promise<PluginResult<PluginInfo>>
  status(ref: PluginRef): Promise<PluginResult<PluginStatus>>
  /** 打开插件自己的连接页，不限时；回来以后清掉这个插件的缓存 */
  connect(ref: PluginRef): Promise<PluginResult<PluginStatus>>
  /** 这段时间的加油交易，新的在前；force：不看缓存（选交易页下拉刷新） */
  fuel(ref: PluginRef, range: { from: number; to: number }, opts?: { force?: boolean }): Promise<PluginResult<FuelTxn[]>>
  /** 账号下的车辆（关联车辆用） */
  vehicles(ref: PluginRef): Promise<PluginResult<RemoteVehicle[]>>
  /** 这段时间的行程，按开始时间从早到晚；vehicle 是 vehicles 给的车辆 id */
  trips(ref: PluginRef, vehicle: string, range: { from: number; to: number }): Promise<PluginResult<Trip[]>>
  vehicleStatus(ref: PluginRef, vehicle: string): Promise<PluginResult<VehicleStatus>>
  /** 已结算的进店，新的在前；force：不看缓存（选进店页下拉） */
  service(ref: PluginRef, vehicle: string, opts?: { force?: boolean }): Promise<PluginResult<ServiceVisit[]>>
  /** 这个地区的挂牌价（2.4） */
  fuelPrice(ref: PluginRef, region: PriceRegion): Promise<PluginResult<FuelPrices>>
  lastState(pluginId: string): PluginState | null
  /** 移除插件：清掉它的缓存和状态 */
  forget(pluginId: string): void
}

/** 北京时间的月份「2026-10」 */
export function monthOf(ts: number): string {
  return new Date(ts + BJ_OFFSET).toISOString().slice(0, 7)
}

/** 这个月第一天 0 点（北京时间） */
export function monthStart(m: string): number {
  const [y, mo] = m.split("-").map(Number)
  return Date.UTC(y, mo - 1, 1) - BJ_OFFSET
}

/** 这个月最后 1 毫秒（北京时间） */
export function monthEnd(m: string): number {
  const [y, mo] = m.split("-").map(Number)
  return Date.UTC(y, mo, 1) - BJ_OFFSET - 1
}

/** from 到 to 落在哪几个月，按时间顺序 */
export function monthsBetween(from: number, to: number): string[] {
  const out: string[] = []
  for (let m = monthOf(from); monthStart(m) <= to; m = monthOf(monthEnd(m) + 1)) out.push(m)
  return out
}

const emptyFile = (): PluginCacheFile => ({ schema_version: 1, months: {}, states: {}, services: {} })

export function createPluginSource(deps: PluginSourceDeps): PluginSource {
  let file: PluginCacheFile | null = null
  /** 每个插件最后一个请求：下一个排在它后面 */
  const tails = new Map<string, Promise<void>>()
  const shared = new Map<string, Promise<PluginResult<unknown>>>()

  function cache(): PluginCacheFile {
    if (file) return file
    let f: PluginCacheFile | null = null
    try { f = deps.load() } catch { f = null }
    file = f && f.schema_version === 1 && f.months && typeof f.months === "object"
      ? { schema_version: 1, months: f.months, states: f.states || {}, services: f.services && typeof f.services === "object" ? f.services : {} }
      : emptyFile()
    return file
  }

  function persist(): void {
    try { deps.save(cache()) } catch { /* 缓存写不进去不影响使用 */ }
  }

  function remember(id: string, state: PluginState | null): void {
    if (!state || cache().states[id] === state) return
    cache().states[id] = state
    persist()
  }

  /** 重新连接、移除时清掉这个插件读到的交易和养修 */
  function clearData(id: string): void {
    const { months, services = {} } = cache()
    for (const k of Object.keys(months)) if (k.startsWith(`${id}|`)) delete months[k]
    for (const k of Object.keys(services)) if (k.startsWith(`${id}|`)) delete services[k]
    persist()
  }

  /** 调一次插件：排在这个插件前一个请求后面，超时从真正调用时算起 */
  function invoke(script: string, action: PluginAction, params: Record<string, unknown>): Promise<PluginResult<unknown>> {
    const prev = tails.get(script) ?? Promise.resolve()
    const task = prev.then((): Promise<PluginResult<unknown>> => {
      const call = deps.call(script, action, params).then(
        (raw): PluginResult<unknown> => ({ ok: true, value: raw }),
        (): PluginResult<unknown> => ({ ok: false, error: pluginError("unavailable") }),
      )
      const limit = PLUGIN_TIMEOUT_MS[action]
      if (limit == null) return call
      const timeout = deps.sleep(limit).then((): PluginResult<unknown> => ({ ok: false, error: pluginError("timeout") }))
      return Promise.race([call, timeout])
    })
    const tail = task.then(() => undefined, () => undefined)
    tails.set(script, tail)
    void tail.then(() => { if (tails.get(script) === tail) tails.delete(script) })
    return task
  }

  /** 相同的请求还没回来时，共用它的结果 */
  function once<T>(key: string, run: () => Promise<PluginResult<T>>): Promise<PluginResult<T>> {
    const running = shared.get(key) as Promise<PluginResult<T>> | undefined
    if (running) return running
    const p = run()
    shared.set(key, p as Promise<PluginResult<unknown>>)
    const done = () => { if (shared.get(key) === p) shared.delete(key) }
    p.then(done, done)
    return p
  }

  function describe(script: string): Promise<PluginResult<PluginInfo>> {
    return once(`${script}|describe`, async () => {
      const r = await invoke(script, "describe", {})
      return r.ok ? parseDescribe(r.value) : r
    })
  }

  function status(ref: PluginRef): Promise<PluginResult<PluginStatus>> {
    return once(`${ref.script}|status`, async () => {
      const r = await invoke(ref.script, "status", {})
      const s = r.ok ? parseStatus(r.value) : r
      remember(ref.id, s.ok ? stateOfStatus(s.value) : stateOfError(s.error))
      return s
    })
  }

  async function connect(ref: PluginRef): Promise<PluginResult<PluginStatus>> {
    const r = await invoke(ref.script, "connect", {})
    const s = r.ok ? parseStatus(r.value) : r
    clearData(ref.id)
    remember(ref.id, s.ok ? stateOfStatus(s.value) : stateOfError(s.error))
    return s
  }

  async function fuel(ref: PluginRef, range: { from: number; to: number }, opts: { force?: boolean } = {}): Promise<PluginResult<FuelTxn[]>> {
    const now = deps.now()
    const key = (m: string) => `${ref.id}|${m}`
    const fresh = (m: string) => {
      const e = cache().months[key(m)]
      const ttl = monthEnd(m) >= now - RECENT_MS ? RECENT_MONTH_TTL_MS : OLD_MONTH_TTL_MS
      return !!e && now - e.fetched_at < ttl
    }
    const months = monthsBetween(range.from, range.to)
    const missing = opts.force ? months : months.filter(m => !fresh(m))
    if (missing.length) {
      const first = missing[0]
      const last = missing[missing.length - 1]
      const r = await once(`${ref.script}|fuel|${first}|${last}`, async () => {
        const res = await invoke(ref.script, "fuel", { from: monthStart(first), to: monthEnd(last) })
        const parsed = res.ok ? parseFuel(res.value) : res
        if (!parsed.ok) {
          remember(ref.id, stateOfError(parsed.error))
          return parsed
        }
        for (const m of monthsBetween(monthStart(first), monthEnd(last))) {
          cache().months[key(m)] = { fetched_at: now, items: parsed.value.filter(t => monthOf(t.ts) === m) }
        }
        persist()
        remember(ref.id, "connected")
        return parsed
      })
      if (!r.ok) return r
    }
    const items = months.flatMap(m => cache().months[key(m)]?.items ?? []).filter(t => t.ts >= range.from && t.ts <= range.to)
    return { ok: true, value: items.sort((a, b) => b.ts - a.ts) }
  }

  /** 车辆、行程、车况：排队、超时、相同的请求共用，记下状态；不缓存 */
  /** track：按结果记下插件的连接状态；不用登录的动作（油价）不记 */
  function read<T>(ref: PluginRef, action: PluginAction, params: Record<string, unknown>, parse: (raw: unknown) => PluginResult<T>, track = true): Promise<PluginResult<T>> {
    return once(`${ref.script}|${action}|${JSON.stringify(params)}`, async () => {
      const r = await invoke(ref.script, action, params)
      const parsed = r.ok ? parse(r.value) : r
      if (track) remember(ref.id, parsed.ok ? "connected" : stateOfError(parsed.error))
      return parsed
    })
  }

  /** 养修：「插件 + 车辆」缓存 10 分钟；force 时不看缓存；出错不缓存 */
  async function service(ref: PluginRef, vehicle: string, opts: { force?: boolean } = {}): Promise<PluginResult<ServiceVisit[]>> {
    const key = `${ref.id}|${vehicle}`
    const hit = cache().services?.[key]
    if (!opts.force && hit && deps.now() - hit.fetched_at < SERVICE_TTL_MS) return { ok: true, value: hit.items }
    return once(`${ref.script}|service|${vehicle}`, async () => {
      const at = deps.now()
      const r = await invoke(ref.script, "service", { vehicle })
      const parsed = r.ok ? parseService(r.value) : r
      remember(ref.id, parsed.ok ? "connected" : stateOfError(parsed.error))
      if (parsed.ok) {
        const f = cache()
        f.services = { ...(f.services ?? {}), [key]: { fetched_at: at, items: parsed.value } }
        persist()
      }
      return parsed
    })
  }

  function forget(pluginId: string): void {
    delete cache().states[pluginId]
    clearData(pluginId)
  }

  return {
    describe, status, connect, fuel,
    vehicles: ref => read(ref, "vehicles", {}, parseVehicles),
    trips: (ref, vehicle, range) => read(ref, "trips", { vehicle, from: range.from, to: range.to }, parseTrips),
    vehicleStatus: (ref, vehicle) => read(ref, "vehicle_status", { vehicle }, parseVehicleStatus),
    service,
    fuelPrice: (ref, region) => read(ref, "fuel_price", { province: region.province, city: region.city }, parseFuelPrices, false),
    lastState: id => cache().states[id] ?? null,
    forget,
  }
}
