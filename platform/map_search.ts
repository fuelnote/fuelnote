// 系统地图搜索：只调 MapSearch.locate，把 MapItem 的字段抄成普通对象（MapItem 不能直接 JSON.stringify）。
// 坐标、地址、按距离筛这些规则在 stations/map_search.ts。
import { MapPlace, MapQuery } from "../stations/map_search"

/** MKError.placemarkNotFound（4）：搜不到时 MapSearch.locate 报这个错，不是返回空列表（2.2.0-beta.2 在手机上实测） */
const NOT_FOUND = /MKErrorDomain\D{0,8}4\b/

export async function locatePlaces(q: MapQuery): Promise<MapPlace[]> {
  const region = q.center && q.radiusM != null
    ? {
      center: { latitude: q.center[1], longitude: q.center[0] },
      span: { latitudeDelta: (2 * q.radiusM) / 111320, longitudeDelta: (2 * q.radiusM) / (111320 * Math.cos((q.center[1] * Math.PI) / 180)) },
    }
    : null
  let items: MapItem[]
  try {
    items = await MapSearch.locate({
      query: q.query,
      resultTypes: ["pointOfInterest" as const],
      ...(region ? { region } : {}),
      ...(q.gasStation ? { pointOfInterestFilter: { includes: ["gasStation" as const] } } : {}),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (NOT_FOUND.test(message)) return []
    throw new Error(`地图搜索出错：${message}`)
  }
  return items.filter(it => !!it.name).map(it => ({
    name: it.name ?? "",
    lng: it.coordinate.longitude,
    lat: it.coordinate.latitude,
    category: it.pointOfInterestCategory,
    phone: it.phoneNumber,
    street: it.placemark.thoroughfare ?? null,
    address: it.formattedAddress,
    province: it.placemark.administrativeArea ?? null,
    city: it.placemark.locality ?? null,
    district: it.placemark.subLocality ?? null,
  }))
}
