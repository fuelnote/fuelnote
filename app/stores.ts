// 门店（2.1 设计第 10 节；2.2 起用系统地图，插件化设计 6.1 节）：搜索门店（附近、关键字），在系统地图里打开，记费用那时车停的地方。
// 门店的存、改、删在 app/records.ts。系统地图不要 Key，FuelNote Check 的数据文件夹里也能搜。
import { LngLat } from "../common/geo"
import { AppData } from "../common/ledger"
import { parkedAt } from "../common/stores"
import { Store, StorePoi, Vehicle } from "../common/types"
import { Place } from "../providers/types"
import { mapStoresByKeyword, mapStoresNearby, toMap } from "../stations/map_search"
import { locatePlaces } from "../platform/map_search"
import { searchCenterFor } from "./stations"
import { canReadTrips, stopsForPayment } from "./vehicle_data"

/** 搜索框：按输入的文字搜，以手机现在的位置为区域（取不到时用最近用过的油站） */
export async function searchStores(data: AppData, keyword: string): Promise<StorePoi[]> {
  return mapStoresByKeyword(locatePlaces, keyword, await searchCenterFor(data))
}

/** 一个点附近 1500 m 内的汽车服务，按距离排 */
export function nearbyStores(p: LngLat): Promise<StorePoi[]> {
  return mapStoresNearby(locatePlaces, p)
}

/**
 * 在系统地图里打开：按门店的全称在它的位置附近搜（网址的 sll 只是搜索的提示），打开的是地图上这家店的页面。
 * 位置按系统地图的坐标给（国内是 GCJ-02）
 */
export function openStoreInMaps(store: Store): void {
  if (store.lng == null || store.lat == null) return
  const [lng, lat] = toMap([store.lng, store.lat])
  void Safari.openURL(`https://maps.apple.com/?q=${encodeURIComponent(store.full_name || store.name)}&sll=${lat.toFixed(6)},${lng.toFixed(6)}`)
}

/** 记费用那时车停的地方（车辆数据的行程）；读不到行程、那时车不在停着时为 null */
export async function parkedPlace(data: AppData, vehicle: Vehicle, ts: number): Promise<Place | null> {
  if (!canReadTrips(vehicle)) return null
  const { stops } = await stopsForPayment(data, vehicle, ts)
  return parkedAt(stops, ts)?.place ?? null
}
