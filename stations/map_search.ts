// 系统地图搜索（插件化设计 6.1 节，D14）：油站和门店都用 Scripting 的 MapSearch，国内和高德是同一份数据，不要 Key。
// 纯逻辑：一次搜索由外面注入（platform/map_search.ts 调 MapSearch.locate），这里管坐标换算、地址、按距离筛和排、几次搜索合起来去重。
import { gcj02ToWgs84, LngLat, metres, wgs84ToGcj02 } from "../common/geo"
import { Poi, Station, StorePoi } from "../common/types"

/**
 * 系统地图的一个地点。坐标原样（国内是 GCJ-02）。字段是 MapItem 的（2.2.0-beta.2 在手机上看过）：
 * street 是 placemark.thoroughfare（路名门牌）；address 是一行地址「路名门牌, 市, 省, 国家」，直辖市没有省，没有区；
 * province、city、district 是 placemark 的 administrativeArea（直辖市是空的）、locality、subLocality
 */
export type MapPlace = {
  name: string
  lng: number
  lat: number
  category: string | null
  phone: string | null
  street: string | null
  address: string | null
  province: string | null
  city: string | null
  district: string | null
}

/** 搜一次：中心按系统地图的坐标给；radiusM 为 null 时不给区域；gasStation 时只要加油站 */
export type MapQuery = { query: string; center: LngLat | null; radiusM: number | null; gasStation: boolean }
export type MapLocate = (q: MapQuery) => Promise<MapPlace[]>

/** 粗略的国内范围：系统地图在国内给 GCJ-02，国外给 WGS-84 */
function inChina([lng, lat]: LngLat): boolean {
  return lng >= 72.004 && lng <= 137.8347 && lat >= 0.8293 && lat <= 55.8271
}

/** 系统地图的坐标换成油记用的 WGS-84 */
export function fromMap(p: LngLat): LngLat {
  return inChina(p) ? gcj02ToWgs84(p) : p
}

/** 油记的 WGS-84 换成系统地图的坐标（搜索区域的中心） */
export function toMap(p: LngLat): LngLat {
  return inChina(p) ? wgs84ToGcj02(p) : p
}

const MUNICIPALITY = /^(北京|上海|天津|重庆)市$/

/** 地址：路名门牌（没有时取一行地址的第一段）、省（直辖市填市名）、市、区 */
export function placeAddress(p: MapPlace): { address: string; province: string; city: string; district: string } {
  const city = p.city ?? ""
  const address = p.street?.trim() || (p.address ?? "").split(/,\s*/)[0].trim()
  return { address, province: p.province || (MUNICIPALITY.test(city) ? city : ""), city, district: p.district ?? "" }
}

export type PlaceHit = { place: MapPlace; point: LngLat; dist: number | null }

/** 换成 WGS-84；有 center 时只留 radiusM 内的，按距离排，没有时按系统地图给的顺序 */
export function placesNear(places: MapPlace[], center: LngLat | null, radiusM: number | null): PlaceHit[] {
  const hits = places.map(place => {
    const point = fromMap([place.lng, place.lat])
    return { place, point, dist: center ? metres(point, center) : null }
  })
  if (!center) return hits
  return hits.filter(h => radiusM == null || (h.dist as number) <= radiusM).sort((a, b) => (a.dist as number) - (b.dist as number))
}

/** 几次搜索合起来：位置和名称都相同的算一个 */
export function mergePlaces(lists: MapPlace[][]): MapPlace[] {
  const seen = new Map<string, MapPlace>()
  for (const list of lists) {
    for (const p of list) {
      const key = `${p.lng.toFixed(5)},${p.lat.toFixed(5)}|${p.name}`
      if (!seen.has(key)) seen.set(key, p)
    }
  }
  return [...seen.values()]
}

/** 几个关键字同时搜，合起来；都出错时抛出第一个错误，只有一部分出错时用搜到的 */
export async function locateAll(locate: MapLocate, queries: MapQuery[]): Promise<MapPlace[]> {
  const rs = await Promise.allSettled(queries.map(q => locate(q)))
  const ok = rs.flatMap(r => (r.status === "fulfilled" ? [r.value] : []))
  if (!ok.length) {
    const failed = rs.find(r => r.status === "rejected")
    throw failed && failed.status === "rejected" ? failed.reason : new Error("地图搜索出错")
  }
  return mergePlaces(ok)
}

function toPoi(h: PlaceHit): Poi {
  return { name: h.place.name, ...placeAddress(h.place), lng: h.point[0], lat: h.point[1] }
}

/** p 附近 radiusM 内的加油站（关键字「加油站」，类别只要加油站），按距离排 */
export async function stationsNearby(locate: MapLocate, p: LngLat, radiusM: number): Promise<Poi[]> {
  const places = await locate({ query: "加油站", center: toMap(p), radiusM, gasStation: true })
  return placesNear(places, p, radiusM).map(toPoi)
}

/** 搜索框给的区域只是提示：实测 1.5 km 和 20 km 结果一样，结果不按距离筛 */
export const SEARCH_HINT_M = 1500

/**
 * 搜索框的区域中心（D14，用户 2026-11-01 选）：手机现在的位置；取不到时用最近用过的油站；都没有时 null，不给区域。
 * 不给区域时系统不按手机的位置排：实测按全称搜一家门店，只给出 1047 km 外的同名地点
 */
export function searchCenter(here: LngLat | null, stations: Station[]): LngLat | null {
  if (here) return here
  const last = [...stations].sort((a, b) => b.last_used_ts - a.last_used_ts)[0]
  return last ? [last.lng, last.lat] : null
}

function hinted(query: string, center: LngLat | null, gasStation: boolean): MapQuery {
  return { query, center: center ? toMap(center) : null, radiusM: center ? SEARCH_HINT_M : null, gasStation }
}

/** 油站的搜索框：按输入的文字搜，center 是区域的提示（WGS-84），按系统地图给的顺序 */
export async function stationsByKeyword(locate: MapLocate, keyword: string, center: LngLat | null): Promise<Poi[]> {
  return placesNear(await locate(hinted(keyword, center, true)), null, null).map(toPoi)
}

// ---------- 门店 ----------

/** 附近门店按这几个关键字分别搜：类别过滤只认 Scripting 列出的 26 个类别，里面没有汽车服务 */
export const STORE_KEYWORDS = ["汽车服务", "汽车维修", "洗车", "4S店"]
export const STORE_RADIUS_M = 1500

const STORE_KINDS: Record<string, string> = { automotiveRepair: "汽车维修", automotiveDealership: "汽车销售", carRental: "租车" }

/** 门店的类别标签；别的类别和没有类别的不写 */
export function storeKind(category: string | null): string {
  return (category && STORE_KINDS[category]) || ""
}

/** 系统地图的地点没有 id，也没有营业时间 */
function toStorePoi(h: PlaceHit): StorePoi {
  const a = placeAddress(h.place)
  return {
    name: h.place.name, address: a.address, district: a.district, city: a.city, kind: storeKind(h.place.category),
    lng: h.point[0], lat: h.point[1], phone: h.place.phone ?? "", distance: h.dist,
  }
}

/** p 附近的汽车服务：几个关键字同时搜，合起来去重，留 radiusM 内的，按距离排 */
export async function mapStoresNearby(locate: MapLocate, p: LngLat, radiusM = STORE_RADIUS_M): Promise<StorePoi[]> {
  const places = await locateAll(locate, STORE_KEYWORDS.map(query => ({ query, center: toMap(p), radiusM, gasStation: false })))
  return placesNear(places, p, radiusM).map(toStorePoi)
}

/** 门店的搜索框：按输入的文字搜，center 是区域的提示（WGS-84），按系统地图给的顺序 */
export async function mapStoresByKeyword(locate: MapLocate, keyword: string, center: LngLat | null): Promise<StorePoi[]> {
  return placesNear(await locate(hinted(keyword, center, false)), null, null).map(toStorePoi)
}
