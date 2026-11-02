// 数据源（插件化设计 4.2 节、第 5 节）：内置的数据源和插件包成同一个接口。读车辆、行程、车况只经过这里，分不出是插件还是内置。
// 内置的用油记钥匙串里的凭据；插件经过 app/plugins.ts（排队、超时；行程、车况的缓存在 app/vehicle_data.ts，两种共用）。
import { AppData } from "../common/ledger"
import { PluginResult, VEHICLE_CAPABILITIES } from "../common/plugin"
import { PluginCapability, PluginRef, ProviderId, Vehicle } from "../common/types"
import { PROVIDERS } from "../providers/registry"
import { RemoteVehicle, Trip, VehicleDataProvider, VehicleStatus } from "../providers/types"
import { providerCredential, providerCtx } from "../platform/provider_ctx"
import { pluginsOf, pluginState, pluginTrips, pluginVehicles, pluginVehicleStatus, providerCapabilities } from "./plugins"

export type DataSource = {
  id: ProviderId
  name: string
  /** 内置的（2.3.0-beta.3 搬成插件以前的沃尔沃）还是插件 */
  builtin: boolean
  capabilities: PluginCapability[]
  /** 能不能读：内置的看凭据在不在，插件看上次调用是不是「未连接」 */
  readable(): boolean
  vehicles(): Promise<RemoteVehicle[]>
  /** 这段时间的行程，按开始时间从早到晚 */
  trips(vehicleId: string, range: { from: number; to: number }): Promise<Trip[]>
  vehicleStatus(vehicleId: string): Promise<VehicleStatus>
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
    vehicles: () => p.vehicles(providerCtx(p.id), cred()),
    trips: (vehicleId, range) => p.trips(providerCtx(p.id), cred(), vehicleId, range),
    vehicleStatus: async vehicleId => {
      if (!p.vehicleStatus) throw new Error(`${p.name}不提供车况`)
      return p.vehicleStatus(providerCtx(p.id), cred(), vehicleId)
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
    vehicles: async () => value(await pluginVehicles(ref)),
    trips: async (vehicleId, range) => value(await pluginTrips(ref, vehicleId, range)),
    vehicleStatus: async vehicleId => value(await pluginVehicleStatus(ref, vehicleId)),
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

/** 数据源账号下的车辆；数据源不在时是空的 */
export async function sourceVehicles(data: AppData, id: ProviderId): Promise<RemoteVehicle[]> {
  const s = dataSourceById(data, id)
  return s ? s.vehicles() : []
}
