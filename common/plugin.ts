// 数据源插件的契约（插件化设计第 4 节）：版本、标记文件、各动作的超时；返回值的校验和整理；添加前的检查；给用户看的错误和状态。
// 纯逻辑：调用插件在 platform/plugin_bridge.ts，排队、超时和缓存在 common/plugin_source.ts。
import { PerkHint, Place, RemoteVehicle, ServiceExpense, ServiceVisit, Trip, VehicleStatus } from "../providers/types"
import { GRADES, PluginCapability, PluginRef, Settlement } from "./types"

export const PLUGIN_CONTRACT = 1
/** 插件文件夹里的标记（D8）：只把带它的脚本列为可添加的插件，不运行其他脚本 */
export const PLUGIN_MARKER = "fuelnote.json"

export type PluginAction = "describe" | "status" | "connect" | PluginCapability

/** 油记等多久（docs/plugins.md 第 4 节）；connect 打开插件自己的页面，不限 */
export const PLUGIN_TIMEOUT_MS: Record<PluginAction, number | null> = {
  describe: 5000, status: 5000, connect: null, vehicles: 20000, fuel: 20000, trips: 20000, vehicle_status: 10000, service: 60000,
}

const CAPABILITIES: PluginCapability[] = ["fuel", "vehicles", "trips", "vehicle_status", "service"]
/** 要关联到一辆车的数据：提供其中之一的插件必须提供 vehicles */
export const VEHICLE_CAPABILITIES: PluginCapability[] = ["trips", "vehicle_status", "service"]

export const CAPABILITY_TITLES: Record<PluginCapability, string> = { fuel: "加油交易", vehicles: "车辆", trips: "行程", vehicle_status: "车况", service: "养修" }

/** 「加油交易、行程」 */
export function capabilityLine(caps: PluginCapability[]): string {
  return caps.map(c => CAPABILITY_TITLES[c]).join("、")
}

// ---------- 错误 ----------

/** 插件返回的错误（第 4.2 节），和油记这边的：不可用（脚本不在或没有返回）、没有回应（超时）、版本不兼容、返回的数据不对 */
export type PluginErrorKind = "not_connected" | "expired" | "network" | "unsupported" | "failed" | "unavailable" | "timeout" | "incompatible" | "invalid"
export type PluginError = { kind: PluginErrorKind; message: string }
export type PluginResult<T> = { ok: true; value: T } | { ok: false; error: PluginError }

const FROM_PLUGIN: PluginErrorKind[] = ["not_connected", "expired", "network", "unsupported", "failed"]

const MESSAGES: Record<PluginErrorKind, string> = {
  not_connected: "未连接",
  expired: "凭据已过期，请重新连接",
  network: "网络错误，请稍后再试",
  unsupported: "插件不支持这项数据",
  failed: "读取失败",
  unavailable: "插件不可用：找不到这个脚本，或它没有返回结果",
  timeout: "插件没有回应",
  incompatible: "插件版本不兼容",
  invalid: "插件返回的数据不对",
}

/** 插件写了 message 时直接给用户看，没写时用默认的说法 */
export function pluginError(kind: PluginErrorKind, message?: string | null): PluginError {
  return { kind, message: message?.trim() || MESSAGES[kind] }
}

function fail(kind: PluginErrorKind, message?: string | null): { ok: false; error: PluginError } {
  return { ok: false, error: pluginError(kind, message) }
}

/** 插件的返回先过这一关：null 是不可用；ok 为 false 时按插件给的错误（不认识的种类算读取失败） */
function envelope(raw: unknown): PluginResult<Record<string, unknown>> {
  if (raw == null) return fail("unavailable")
  if (typeof raw !== "object" || Array.isArray(raw)) return fail("invalid")
  const r = raw as Record<string, unknown>
  if (r.ok === true) return { ok: true, value: r }
  if (r.ok === false) {
    const kind = FROM_PLUGIN.find(k => k === r.error) ?? "failed"
    return fail(kind, typeof r.message === "string" ? r.message : null)
  }
  return fail("invalid")
}

// ---------- 返回值 ----------

/** 去掉首尾空白，空串当 null */
function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

function two(v: unknown): number | null {
  const n = num(v)
  return n == null ? null : Math.round(n * 100) / 100
}

export type PluginInfo = { id: string; name: string; version: string; capabilities: PluginCapability[] }

export function parseDescribe(raw: unknown): PluginResult<PluginInfo> {
  const e = envelope(raw)
  if (!e.ok) return e
  const r = e.value
  if (r.contract !== PLUGIN_CONTRACT) return fail("incompatible")
  const id = text(r.id)
  if (!id) return fail("invalid")
  const caps = Array.isArray(r.capabilities) ? CAPABILITIES.filter(c => (r.capabilities as unknown[]).includes(c)) : []
  return { ok: true, value: { id, name: text(r.name) ?? id, version: text(r.version) ?? "", capabilities: caps } }
}

/** status 和 connect 的返回；account 是插件打码后的账号 */
export type PluginStatus = { connected: boolean; expired: boolean; account: string | null }

export function parseStatus(raw: unknown): PluginResult<PluginStatus> {
  const e = envelope(raw)
  if (!e.ok) return e
  const r = e.value
  return { ok: true, value: { connected: r.connected === true, expired: r.expired === true, account: text(r.account) } }
}

/** 加油交易（docs/plugins.md 第 5 节）。坐标是 WGS-84；金额、升数两位小数 */
export type FuelTxnStation = {
  code: string | null
  name: string | null
  address: string | null
  province: string | null
  city: string | null
  district: string | null
  lng: number | null
  lat: number | null
}

export type FuelTxn = {
  id: string
  ts: number
  liters: number
  price: number
  amount: number
  paid: number
  grade: number | null
  station: FuelTxnStation | null
  channel: string | null
  plate: string | null
}

function txnStation(raw: unknown): FuelTxnStation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const lng = num(r.lng)
  const lat = num(r.lat)
  const point = lng != null && lat != null && Math.abs(lng) <= 180 && Math.abs(lat) <= 90
  return {
    code: text(r.code) ?? (num(r.code) != null ? String(r.code) : null),
    name: text(r.name), address: text(r.address), province: text(r.province), city: text(r.city), district: text(r.district),
    lng: point ? lng : null, lat: point ? lat : null,
  }
}

function fuelTxn(raw: unknown): FuelTxn | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const id = text(r.id)
  const ts = num(r.ts)
  const liters = two(r.liters)
  const price = two(r.price)
  const amount = two(r.amount)
  const paid = two(r.paid)
  if (!id || ts == null || liters == null || price == null || amount == null || paid == null) return null
  if (liters <= 0 || price <= 0 || amount < 0 || paid < 0) return null
  const grade = typeof r.grade === "number" && GRADES.includes(r.grade) ? r.grade : null
  return { id, ts, liters, price, amount, paid, grade, station: txnStation(r.station), channel: text(r.channel), plate: text(r.plate) }
}

export function parseFuel(raw: unknown): PluginResult<FuelTxn[]> {
  const e = envelope(raw)
  if (!e.ok) return e
  if (!Array.isArray(e.value.items)) return fail("invalid")
  return { ok: true, value: e.value.items.map(fuelTxn).filter((t): t is FuelTxn => !!t) }
}

// ---------- 车辆、行程、车况（docs/plugins.md 第 6 节） ----------

/** 数字的 id 也认（转成文字） */
function idText(v: unknown): string | null {
  return text(v) ?? (num(v) != null ? String(v) : null)
}

function remoteVehicle(raw: unknown): RemoteVehicle | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const id = idText(r.id)
  return id ? { id, name: text(r.name) ?? id, detail: text(r.detail) ?? "" } : null
}

export function parseVehicles(raw: unknown): PluginResult<RemoteVehicle[]> {
  const e = envelope(raw)
  if (!e.ok) return e
  if (!Array.isArray(e.value.items)) return fail("invalid")
  return { ok: true, value: e.value.items.map(remoteVehicle).filter((v): v is RemoteVehicle => !!v) }
}

/** 位置：坐标缺了或超出范围时整个不要 */
function place(raw: unknown): Place | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const lng = num(r.lng)
  const lat = num(r.lat)
  if (lng == null || lat == null || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null
  return { lng, lat, address: text(r.address) ?? "", city: text(r.city) ?? "", district: text(r.district) ?? "" }
}

function trip(raw: unknown): Trip | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const id = idText(r.id)
  const start = num(r.start_ts)
  const end = num(r.end_ts)
  const endKm = num(r.end_odometer_km)
  if (!id || start == null || end == null || endKm == null || end < start) return null
  return {
    id, start_ts: start, end_ts: end, start_odometer_km: num(r.start_odometer_km), end_odometer_km: endKm,
    distance_km: num(r.distance_km), fuel_l: num(r.fuel_l), start: place(r.start), end: place(r.end),
  }
}

/** 行程，按开始时间从早到晚 */
export function parseTrips(raw: unknown): PluginResult<Trip[]> {
  const e = envelope(raw)
  if (!e.ok) return e
  if (!Array.isArray(e.value.items)) return fail("invalid")
  return { ok: true, value: e.value.items.map(trip).filter((t): t is Trip => !!t).sort((a, b) => a.start_ts - b.start_ts) }
}

export function parseVehicleStatus(raw: unknown): PluginResult<VehicleStatus> {
  const e = envelope(raw)
  if (!e.ok) return e
  const s = e.value.status
  if (!s || typeof s !== "object" || Array.isArray(s)) return fail("invalid")
  const r = s as Record<string, unknown>
  return { ok: true, value: { ts: num(r.ts), fuel_l: num(r.fuel_l), range_km: num(r.range_km), avg_consumption: num(r.avg_consumption), odometer_km: num(r.odometer_km) } }
}

// ---------- 养修（docs/plugins.md 第 7 节） ----------

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** 结算明细：每一行都要有名称和金额，每一条对照都要有名称（金额可以是 null）；有一项不对时整个不要 */
function settlement(raw: unknown): Settlement | null {
  if (!isObject(raw) || !Array.isArray(raw.lines) || !Array.isArray(raw.coupons)) return null
  const lines: Settlement["lines"] = []
  for (const x of raw.lines) {
    const label = isObject(x) ? text(x.label) : null
    const amount = isObject(x) ? two(x.amount) : null
    if (!label || amount == null) return null
    lines.push({ label, amount })
  }
  const coupons: Settlement["coupons"] = []
  for (const x of raw.coupons) {
    const name = isObject(x) ? text(x.name) : null
    if (!name || !isObject(x)) return null
    const amount = x.amount == null ? null : two(x.amount)
    if (x.amount != null && amount == null) return null
    coupons.push({ name, amount })
  }
  return { lines, note: typeof raw.note === "string" ? raw.note.trim() : "", coupons }
}

function perkHint(raw: unknown): PerkHint | null {
  if (!isObject(raw)) return null
  if (raw.kind === "balance" && raw.origin === "insurance") {
    const amount = two(raw.amount)
    return amount != null && amount > 0 ? { kind: "balance", origin: "insurance", amount } : null
  }
  if (raw.kind === "count") {
    const name = text(raw.name)
    const used = num(raw.used)
    return name && used != null && used > 0 ? { kind: "count", name, used } : null
  }
  return null
}

/** 保养记录：项目要有名称；说明里的几段是文字。不是对象时 undefined（这一笔不要） */
function maintenanceOf(raw: unknown): ServiceExpense["maintenance"] | undefined {
  if (raw == null) return null
  if (!isObject(raw) || !Array.isArray(raw.items)) return undefined
  const items = raw.items.flatMap(x => {
    const name = isObject(x) ? text(x.name) : null
    return name && isObject(x) ? [{ name, from: text(x.from) ?? "" }] : []
  })
  const notes = (Array.isArray(raw.notes) ? raw.notes : []).map(text).filter((n): n is string => !!n)
  return { items, notes }
}

/** 一笔费用：缺字段或类型不对时 null；第二笔以后的保养记录不用 */
function serviceExpense(raw: unknown, first: boolean): ServiceExpense | null {
  if (!isObject(raw)) return null
  const ts = num(raw.ts)
  const own = two(raw.own)
  const s = settlement(raw.settlement)
  const m = maintenanceOf(raw.maintenance)
  if (ts == null || own == null || own < 0 || typeof raw.title !== "string" || typeof raw.remark !== "string" || !s || m === undefined) return null
  const hints = Array.isArray(raw.perk_hints) ? raw.perk_hints.map(perkHint).filter((h): h is PerkHint => !!h) : []
  return { ts, title: raw.title.trim(), remark: raw.remark.trim(), own, maintenance: first ? m : null, settlement: s, perk_hints: hints }
}

function serviceVisit(raw: unknown): ServiceVisit | null {
  if (!isObject(raw)) return null
  const id = idText(raw.id)
  const arrive = num(raw.arrive_ts)
  if (!id || arrive == null || typeof raw.title !== "string" || !Array.isArray(raw.expenses)) return null
  // 第一笔不能用时丢掉，留下的第一笔不带保养记录（它原来不是第一笔）
  const expenses = raw.expenses.map((x, i) => serviceExpense(x, i === 0)).filter((e): e is ServiceExpense => !!e)
  if (!expenses.length) return null
  const d = raw.dealer
  const lng = isObject(d) ? num(d.lng) : null
  const lat = isObject(d) ? num(d.lat) : null
  const point = lng != null && lat != null && Math.abs(lng) <= 180 && Math.abs(lat) <= 90
  return {
    id, arrive_ts: arrive, odometer: num(raw.odometer), title: raw.title.trim(),
    dealer: isObject(d) ? { name: text(d.name), short: text(d.short), lng: point ? lng : null, lat: point ? lat : null } : null,
    expenses,
  }
}

/** 已结算的进店，新的在前；缺字段或类型不对的进店、费用丢掉，一笔都不剩的进店丢掉 */
export function parseService(raw: unknown): PluginResult<ServiceVisit[]> {
  const e = envelope(raw)
  if (!e.ok) return e
  if (!Array.isArray(e.value.items)) return fail("invalid")
  return { ok: true, value: e.value.items.map(serviceVisit).filter((v): v is ServiceVisit => !!v).sort((a, b) => b.arrive_ts - a.arrive_ts) }
}

// ---------- 添加 ----------

/**
 * 添加前的检查：没有提供油记用得上的数据、提供了要关联到车的数据却没有车辆、
 * id 和内置的数据源或已添加的插件重复时不加；可以加时 null
 */
export function addProblem(info: PluginInfo, plugins: PluginRef[], builtinIds: string[]): string | null {
  if (!info.capabilities.some(c => c !== "vehicles")) return "这个插件没有提供油记用得上的数据"
  if (info.capabilities.some(c => VEHICLE_CAPABILITIES.includes(c)) && !info.capabilities.includes("vehicles")) {
    return "这个插件提供了行程、车况或养修，但没有提供车辆，关联不到车"
  }
  if (builtinIds.includes(info.id)) return `插件的 id「${info.id}」和内置的数据源重复`
  const same = plugins.find(p => p.id === info.id)
  if (same) return `「${same.name}」已经添加过了`
  return null
}

export function pluginRef(script: string, info: PluginInfo): PluginRef {
  return { script, id: info.id, name: info.name, capabilities: info.capabilities }
}

// ---------- 状态 ----------

/** 上次调用的结果：记加油的入口、设置里显示 */
export type PluginState = "connected" | "not_connected" | "expired"

const STATE_TEXT: Record<PluginState, string> = { connected: "已连接", not_connected: "未连接", expired: "已过期" }

export const pluginStateText = (s: PluginState): string => STATE_TEXT[s]

export function stateOfStatus(s: PluginStatus): PluginState {
  return s.expired ? "expired" : s.connected ? "connected" : "not_connected"
}

/** 出错时的状态；网络错误、超时这类说明不了连接状态的，返回 null（保留上次的） */
export function stateOfError(e: PluginError): PluginState | null {
  return e.kind === "expired" ? "expired" : e.kind === "not_connected" ? "not_connected" : null
}
