// 从数据源的养修记费用（插件化设计 3.4 节）：只在选进店页读（各数据源缓存 10 分钟，下拉不看缓存）；选中一次进店整理成表单，保存时几笔一起写。
// 2.3 起不在后台读、不判断记没记（D3）。
import { AppData } from "../common/ledger"
import { PluginResult } from "../common/plugin"
import { perkBook } from "../common/perks"
import { putServiceVisit, serviceDraft, ServiceDraft, ServiceSave } from "../common/service"
import { Vehicle } from "../common/types"
import { ServiceVisit } from "../providers/types"
import { DataSource } from "./data_sources"
import { commit } from "./store"

/** 读这辆车的养修：已结算的进店，新的在前；force：选进店页下拉时不看缓存 */
export function readService(source: DataSource, vehicle: Vehicle, force: boolean): Promise<PluginResult<ServiceVisit[]>> {
  return source.service(vehicle.provider ? vehicle.provider.vehicle_id : "", force)
}

/** 选中一次进店：整理成表单（先勾的卡、门店）；来源写数据源现在的名称 */
export function serviceForm(data: AppData, vehicle: Vehicle, source: DataSource, visit: ServiceVisit): ServiceDraft {
  return serviceDraft(data.ledger.stores, perkBook(data.ledger), vehicle.id, { id: source.id, name: source.name }, visit)
}

/** 记下一次进店：这一笔和打开的另记一笔、保养记录、用了的权益、门店一起写 */
export function saveServiceVisit(data: AppData, vehicle: Vehicle, input: ServiceSave): AppData {
  return commit(data, putServiceVisit(data, vehicle, input).ledger)
}
