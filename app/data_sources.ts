// 数据源（插件化设计 4.2 节、第 5 节）：内置的数据源和插件包成同一个接口。读车辆、行程、车况、养修只经过这里，分不出是插件还是内置。
// 内置的用油记钥匙串里的凭据；插件经过 app/plugins.ts（排队、超时；行程、车况的缓存在 app/vehicle_data.ts，两种共用）。
import { AppData } from "../common/ledger"
import { pluginError, PluginErrorKind, PluginResult, PluginState, VEHICLE_CAPABILITIES } from "../common/plugin"
import { SERVICE_TTL_MS } from "../common/plugin_source"
import { PluginCapability, PluginRef, ProviderId, Vehicle } from "../common/types"
import { PROVIDERS } from "../providers/registry"
import { ProviderError, RemoteVehicle, ServiceStore, ServiceVisit, Trip, VehicleDataProvider, VehicleStatus } from "../providers/types"
import { providerCredential, providerCtx } from "../platform/provider_ctx"
import { readCache, writeCache } from "../platform/storage"
import { errorText } from "./errors"
import { pluginService, pluginsOf, pluginState, pluginTrips, pluginVehicles, pluginVehicleStatus, providerCapabilities } from "./plugins"

export type DataSource = {
  id: ProviderId
  name: string
  /** 内置的（2.3.0-beta.3 搬成插件以前的沃尔沃）还是插件 */
  builtin: boolean
  capabilities: PluginCapability[]
  /** 能不能读：内置的看凭据在不在，插件看上次调用是不是「未连接」 */
  readable(): boolean
  /** 上次调用的结果（记费用「从<名称>选」右边写未连接、已过期）：内置的看凭据在不在、上次读养修是不是登录过期 */
  state(): PluginState | null
  vehicles(): Promise<RemoteVehicle[]>
  /** 这段时间的行程，按开始时间从早到晚 */
  trips(vehicleId: string, range: { from: number; to: number }): Promise<Trip[]>
  vehicleStatus(vehicleId: string): Promise<VehicleStatus>
  /** 已结算的进店，新的在前（插件化设计 3.4 节），缓存 10 分钟；force：不看缓存。出错时给出错误的种类，选进店页照它显示 */
  service(vehicleId: string, force: boolean): Promise<PluginResult<ServiceVisit[]>>
}

/** 内置数据源的养修明细（service_visits.json，不进备份）：键是「数据源|车辆」；2.2 的键前面多了油记的车辆 id，照样认 */
const SERVICE_FILE = "service_visits.json"

function serviceStore(providerId: ProviderId, vehicleId: string): ServiceStore {
  const key = `${providerId}|${vehicleId}`
  const all = (): Record<string, unknown> => {
    const f = readCache<{ schema_version: 1; entries: Record<string, unknown> }>(SERVICE_FILE)
    return f && f.schema_version === 1 && f.entries && typeof f.entries === "object" ? f.entries : {}
  }
  return {
    load: () => {
      const e = all()
      return e[key] ?? Object.entries(e).find(([k]) => k.endsWith(`|${key}`))?.[1] ?? null
    },
    save: value => writeCache(SERVICE_FILE, { schema_version: 1, entries: { ...all(), [key]: value } }),
  }
}

/** 内置数据源读到的养修（10 分钟内再打开选进店页不重读），和上次读养修时登录过期的 */
const builtinService = new Map<string, { at: number; items: ServiceVisit[] }>()
const builtinExpired = new Set<ProviderId>()

function builtinError(e: unknown): PluginErrorKind {
  if (!(e instanceof ProviderError)) return "failed"
  return e.kind === "auth" ? "expired" : e.kind === "network" ? "network" : "failed"
}

function builtin(p: VehicleDataProvider): DataSource {
  const cred = () => {
    const c = providerCredential(p.id)
    if (!c) throw new Error(`未连接${p.name}，请在设置中连接`)
    return c
  }
  return {
    id: p.id, name: p.name, builtin: true, capabilities: providerCapabilities(p),
    readable: () => !!providerCredential(p.id),
    state: () => (!providerCredential(p.id) ? "not_connected" : builtinExpired.has(p.id) ? "expired" : "connected"),
    vehicles: () => p.vehicles(providerCtx(p.id), cred()),
    trips: (vehicleId, range) => p.trips(providerCtx(p.id), cred(), vehicleId, range),
    vehicleStatus: async vehicleId => {
      if (!p.vehicleStatus) throw new Error(`${p.name}不提供车况`)
      return p.vehicleStatus(providerCtx(p.id), cred(), vehicleId)
    },
    service: async (vehicleId, force) => {
      if (!p.service) return { ok: false, error: pluginError("unsupported") }
      const c = providerCredential(p.id)
      if (!c) return { ok: false, error: pluginError("not_connected", `连接后，记费用时可以选择${p.name}的进店。`) }
      const key = `${p.id}|${vehicleId}`
      const hit = builtinService.get(key)
      if (!force && hit && Date.now() - hit.at < SERVICE_TTL_MS) return { ok: true, value: hit.items }
      try {
        const items = await p.service(providerCtx(p.id), c, vehicleId, serviceStore(p.id, vehicleId))
        builtinService.set(key, { at: Date.now(), items })
        builtinExpired.delete(p.id)
        return { ok: true, value: items }
      } catch (e) {
        const kind = builtinError(e)
        if (kind === "expired") builtinExpired.add(p.id)
        return { ok: false, error: pluginError(kind, errorText(e)) }
      }
    },
  }
}

/** 插件的错误照插件写的说明抛出，页面照常显示 */
function value<T>(r: PluginResult<T>): T {
  if (r.ok) return r.value
  throw new Error(r.error.message)
}

function plugin(ref: PluginRef): DataSource {
  return {
    id: ref.id, name: ref.name, builtin: false, capabilities: ref.capabilities,
    readable: () => pluginState(ref.id) !== "not_connected",
    state: () => pluginState(ref.id),
    vehicles: async () => value(await pluginVehicles(ref)),
    trips: async (vehicleId, range) => value(await pluginTrips(ref, vehicleId, range)),
    vehicleStatus: async vehicleId => value(await pluginVehicleStatus(ref, vehicleId)),
    service: (vehicleId, force) => pluginService(ref, vehicleId, force),
  }
}

/** 内置的在前，插件按添加的顺序 */
export function dataSources(data: AppData): DataSource[] {
  return [...PROVIDERS.map(builtin), ...pluginsOf(data).map(plugin)]
}

export function dataSourceById(data: AppData, id: ProviderId): DataSource | null {
  return dataSources(data).find(s => s.id === id) ?? null
}

/** 能关联到车的数据源（提供行程、车况或养修的）：车辆的「车辆数据」里列出 */
export function vehicleSources(data: AppData): DataSource[] {
  return dataSources(data).filter(s => s.capabilities.some(c => VEHICLE_CAPABILITIES.includes(c)))
}

/** 这辆车关联的数据源；没关联、或关联的数据源还没添加时 null */
export function sourceOf(data: AppData, vehicle: Vehicle | null): DataSource | null {
  return vehicle && vehicle.provider ? dataSourceById(data, vehicle.provider.id) : null
}

/** 这辆车关联的、提供养修的数据源（记费用的「从<名称>选」）；没有时 null */
export function serviceSourceOf(data: AppData, vehicle: Vehicle | null): DataSource | null {
  const s = sourceOf(data, vehicle)
  return s && s.capabilities.includes("service") ? s : null
}

/** 数据源账号下的车辆；数据源不在时是空的 */
export async function sourceVehicles(data: AppData, id: ProviderId): Promise<RemoteVehicle[]> {
  const s = dataSourceById(data, id)
  return s ? s.vehicles() : []
}
