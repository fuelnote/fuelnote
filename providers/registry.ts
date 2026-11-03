// 所有车辆数据提供方。接入新品牌：实现 VehicleDataProvider 并加到这里。
import { ProviderId } from "../common/types"
import { VehicleDataProvider } from "./types"
import { volvoCn } from "./volvo_cn"

export const PROVIDERS: VehicleDataProvider[] = [volvoCn]

export function providerById(id: ProviderId): VehicleDataProvider | null {
  return PROVIDERS.find(p => p.id === id) || null
}

/** 2.2 记下的养修转换一次（插件化设计 6.2 节）：2.3.0-beta.2 打开账本时调用，beta.3 随沃尔沃一起删掉 */
export { convertServiceRecords } from "./volvo_service"
