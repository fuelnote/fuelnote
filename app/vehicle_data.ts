// 车辆数据（设计文档第 8 节；插件化设计第 5 节）：内置数据源的连接；行程与加油停车（16.6 节，记加油表单、从行程选择共用一份缓存）、车况（第 18 节）。
// 读车辆、行程、车况都经过 app/data_sources.ts，内置的数据源和插件同一条路，缓存也共用。
import { AppData, fuelRecords, stationsFor } from "../common/ledger"
import { findStops, openRefuelStop, rankStops, refreshStops, Stop } from "../common/stops"
import { createStopSource, paymentStopsRange, StopGetOptions, StopsSnapshot } from "../common/stop_source"
import { createStatusSource, StatusSnapshot } from "../common/status_source"
import { ProviderId, Vehicle } from "../common/types"
import { providerById } from "../providers/registry"
import { Credential, RemoteVehicle, VehicleStatus } from "../providers/types"
import { providerCredential, providerCtx } from "../platform/provider_ctx"
import { providerSecretKey, providerSessionKey, removeSecret, setJsonSecret } from "../platform/secrets"
import { readCache, readStatusCache, saveStatusSnapshot, writeCache } from "../platform/storage"
import { cachedSpec, catalogSpec } from "./catalog"
import { sourceOf } from "./data_sources"
import { nearbyStations } from "./stations"
import { commit } from "./store"

// ---------- 内置数据源的连接（插件的连接在插件自己的页面里） ----------

/** 校验并保存凭据，返回账号下的车辆 */
export async function connectProvider(id: ProviderId, input: Credential): Promise<RemoteVehicle[]> {
  const p = providerById(id)
  if (!p) throw new Error("未知的车辆数据提供方")
  const cred = p.normalizeCredential(input)
  const vehicles = await p.vehicles(providerCtx(id), cred)
  setJsonSecret(providerSecretKey(id), cred)
  return vehicles
}

/** 内置数据源的凭据页里看一眼车况（设计文档 18.1 节）；提供方不支持时返回 null */
export async function providerVehicleStatus(id: ProviderId, vehicleId: string): Promise<VehicleStatus | null> {
  const p = providerById(id)
  const cred = providerCredential(id)
  if (!p || !cred || !p.vehicleStatus) return null
  return p.vehicleStatus(providerCtx(id), cred, vehicleId)
}

/** 断开内置的数据源：删除凭据和会话缓存，并解除所有车辆的关联 */
export function disconnectProvider(data: AppData, id: ProviderId): AppData {
  removeSecret(providerSecretKey(id))
  removeSecret(providerSessionKey(id))
  return commit(data, { ...data.ledger, vehicles: data.ledger.vehicles.map(v => (v.provider?.id === id ? { ...v, provider: null } : v)) })
}

// ---------- 行程与加油停车（设计文档 16.6 节） ----------

type TripsCacheFile = { schema_version: 1; entries: Record<string, StopsSnapshot> }
const TRIPS_CACHE_FILE = "trips_cache.json"

function readTripsCache(): Record<string, StopsSnapshot> {
  const f = readCache<TripsCacheFile>(TRIPS_CACHE_FILE)
  return f && f.schema_version === 1 && f.entries ? f.entries : {}
}

/** 最近 7 天的停车：记加油表单、从行程选择共用一份，缓存 10 分钟（cache/trips_cache.json） */
const stopSource = createStopSource({
  load: key => readTripsCache()[key] || null,
  save: snap => writeCache(TRIPS_CACHE_FILE, { schema_version: 1, entries: { ...readTripsCache(), [snap.key]: snap } }),
  now: () => Date.now(),
})

/** 行程、车况缓存的键：车辆和它关联的远端车 */
export const stopsKey = (v: Vehicle) => `${v.id}|${v.provider?.id}|${v.provider?.vehicle_id}`

/** 这辆车能不能读行程：关联的数据源提供行程、已经添加，并且能读（内置的凭据还在，插件不是「未连接」） */
export function canReadTrips(data: AppData, vehicle: Vehicle | null): boolean {
  const s = sourceOf(data, vehicle)
  return !!(s && s.capabilities.includes("trips") && s.readable())
}

/** 最近 7 天的停车。「已记录」和我的油站按当前数据重新判断 */
export async function vehicleStops(data: AppData, vehicle: Vehicle, opts: StopGetOptions = {}): Promise<Stop[]> {
  if (!canReadTrips(data, vehicle)) return []
  const snap = await stopSource.get(stopsKey(vehicle), range => fetchStops(data, vehicle, range), opts)
  return refreshStops(snap.stops, stationsFor(data, vehicle), fuelRecords(data, vehicle))
}

/** 只看缓存（可能已过期），不发请求；没有缓存时为 null */
export function cachedStops(data: AppData, vehicle: Vehicle | null): Stop[] | null {
  if (!vehicle || !vehicle.provider) return null
  const snap = stopSource.peek(stopsKey(vehicle))
  return snap ? refreshStops(snap.stops, stationsFor(data, vehicle), fuelRecords(data, vehicle)) : null
}

/**
 * 按付款时间配对用的停车：付款时间在共用的 7 天内时用共用的（shared 为 true）；
 * 更早时单独读付款前后各 1 天，不进缓存（设计文档 19.2 节）
 */
export async function stopsForPayment(data: AppData, vehicle: Vehicle, payTs: number): Promise<{ stops: Stop[]; shared: boolean }> {
  const range = paymentStopsRange(payTs, Date.now())
  if (!range) return { stops: await vehicleStops(data, vehicle, { needAfter: payTs }), shared: true }
  if (!canReadTrips(data, vehicle)) return { stops: [], shared: false }
  const stops = await fetchStops(data, vehicle, range)
  return { stops: refreshStops(stops, stationsFor(data, vehicle), fuelRecords(data, vehicle)), shared: false }
}

/** 从行程选择：加油停车在前 */
export async function recentStops(data: AppData, vehicle: Vehicle, force = false): Promise<Stop[]> {
  return rankStops(await vehicleStops(data, vehicle, { force }))
}

/** 记加油「自动填写」：最近 2 天里还没记录的加油停车（最新的一次） */
export function openStopIn(data: AppData, vehicle: Vehicle, stops: Stop[]): Stop | null {
  return openRefuelStop(stops, fuelRecords(data, vehicle), Date.now())
}

async function fetchStops(data: AppData, vehicle: Vehicle, range: { from: number; to: number }): Promise<Stop[]> {
  if (!vehicle.provider) throw new Error("这辆车没有关联车辆数据")
  const s = sourceOf(data, vehicle)
  if (!s) throw new Error("这辆车关联的数据源还没添加，请在设置 › 数据源中添加")
  const trips = await s.trips(vehicle.provider.vehicle_id, range)
  return findStops(trips, { stations: stationsFor(data, vehicle), fuel: fuelRecords(data, vehicle), nearby: nearbyStations, now: range.to })
}

// ---------- 车况（设计文档第 18 节） ----------

/** 车况：记录页、小组件共用一份，缓存 10 分钟（cache/status_cache.json；小组件也会写） */
export const statusSource = createStatusSource({
  load: key => readStatusCache()[key] || null,
  save: saveStatusSnapshot,
  now: () => Date.now(),
})

/** 这辆车关联的数据源提供车况，并且已经添加（不看能不能读） */
export function hasStatusSource(data: AppData, vehicle: Vehicle | null): boolean {
  const s = sourceOf(data, vehicle)
  return !!(s && s.capabilities.includes("vehicle_status"))
}

/** 能读车况：数据源提供车况，并且能读（内置的凭据还在，插件不是「未连接」） */
export function canReadStatus(data: AppData, vehicle: Vehicle | null): boolean {
  const s = sourceOf(data, vehicle)
  return !!(s && s.capabilities.includes("vehicle_status") && s.readable())
}

/** 油箱容量（升）：车型参数里的 tank，只读缓存的车型参数 */
const tankMemo = new Map<number, number | null>()
export function vehicleTank(_data: AppData, vehicle: Vehicle): number | null {
  const model = vehicle.profile?.model
  if (!model || model <= 0) return null
  if (!tankMemo.has(model)) {
    const spec = cachedSpec(model)
    if (!spec) return null // 还没查过车型参数，查到后再记
    tankMemo.set(model, spec.tank && spec.tank > 0 ? spec.tank : null)
  }
  return tankMemo.get(model) ?? null
}

/** 上次读到的车况（可能已过期），不发请求 */
export function cachedStatus(data: AppData, vehicle: Vehicle | null): StatusSnapshot | null {
  return vehicle && hasStatusSource(data, vehicle) ? statusSource.peek(stopsKey(vehicle)) : null
}

/** 读车况（10 分钟内用缓存；force 时重新读）。第一次用到油箱容量时顺便查车型参数 */
export async function readVehicleStatus(data: AppData, vehicle: Vehicle | null, force = false): Promise<StatusSnapshot | null> {
  const s = sourceOf(data, vehicle)
  if (!vehicle || !vehicle.provider || !s || !canReadStatus(data, vehicle)) return null
  const remoteId = vehicle.provider.vehicle_id
  const snap = await statusSource.get(stopsKey(vehicle), () => s.vehicleStatus(remoteId), { force })
  const model = vehicle.profile?.model
  if (model && model > 0 && vehicleTank(data, vehicle) == null) {
    try { await catalogSpec(model) } catch { /* 没有油箱容量时只显示升数 */ }
  }
  return snap
}
