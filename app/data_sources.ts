// 数据源（插件化设计 4.2 节、第 5 节）：读车辆、行程、车况、养修只经过这里。2.3.0-beta.3 起数据源都是插件，没有内置的。
// 插件经过 app/plugins.ts（排队、超时；行程、车况的缓存在 app/vehicle_data.ts）。
import { AppData } from "../common/ledger"
import { PluginResult, PluginState, usedCapabilities, VEHICLE_CAPABILITIES } from "../common/plugin"
import { PluginCapability, PluginRef, ProviderId, Vehicle } from "../common/types"
import { RemoteVehicle, ServiceVisit, Trip, VehicleStatus } from "../providers/types"
import { pluginService, pluginsOf, pluginState, pluginTrips, pluginVehicles, pluginVehicleStatus } from "./plugins"

export type DataSource = {
  id: ProviderId
  name: string
  /** 插件的脚本名：连接时打开它自己的页面 */
  script: string
  capabilities: PluginCapability[]
  /** 能不能读：上次调用不是「未连接」 */
  readable(): boolean
  /** 上次调用的结果（记费用「从<名称>选」右边写未连接、已过期） */
  state(): PluginState | null
  vehicles(): Promise<RemoteVehicle[]>
  /** 这段时间的行程，按开始时间从早到晚 */
  trips(vehicleId: string, range: { from: number; to: number }): Promise<Trip[]>
  vehicleStatus(vehicleId: string): Promise<VehicleStatus>
  /** 已结算的进店，新的在前（插件化设计 3.4 节），缓存 10 分钟；force：不看缓存。出错时给出错误的种类，选进店页照它显示 */
  service(vehicleId: string, force: boolean): Promise<PluginResult<ServiceVisit[]>>
}

/** 插件的错误照插件写的说明抛出，页面照常显示 */
function value<T>(r: PluginResult<T>): T {
  if (r.ok) return r.value
  throw new Error(r.error.message)
}

function plugin(ref: PluginRef): DataSource {
  return {
    // 用到的项（2.7，插件化设计 5.2 节）：关掉的车况、行程、养修不调，车辆关联也按它列
    id: ref.id, name: ref.name, script: ref.script, capabilities: usedCapabilities(ref),
    readable: () => pluginState(ref.id) !== "not_connected",
    state: () => pluginState(ref.id),
    vehicles: async () => value(await pluginVehicles(ref)),
    trips: async (vehicleId, range) => value(await pluginTrips(ref, vehicleId, range)),
    vehicleStatus: async vehicleId => value(await pluginVehicleStatus(ref, vehicleId)),
    service: (vehicleId, force) => pluginService(ref, vehicleId, force),
  }
}

/** 按添加的顺序 */
export function dataSources(data: AppData): DataSource[] {
  return pluginsOf(data).map(plugin)
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

/** 关联了数据源、但那个数据源还没添加的车（设置 › 数据源最上面提示，插件化设计第 5 节，D24）；隐藏的车不算 */
export function missingSources(data: AppData): Vehicle[] {
  return data.ledger.vehicles.filter(v => !v.hidden && v.provider && !dataSourceById(data, v.provider.id))
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
