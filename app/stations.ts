// 油站搜索（设计文档第 9 节；2.2 起用系统地图，插件化设计 6.1 节）和按单价判断标号用的油价
import { LngLat, metres } from "../common/geo"
import { arrivalStop, pickStation, StationPick } from "../common/fuel_pick"
import { AppData, fuelRecords, stationsFor } from "../common/ledger"
import { FuelTxnStation } from "../common/plugin"
import { CityPrices, PriceRef, priceRefAt } from "../common/receipt"
import { Stop } from "../common/stops"
import { Station, StationCandidate, Vehicle } from "../common/types"
import { searchCenter, stationsByKeyword, stationsNearby } from "../stations/map_search"
import { candidateFromPoi, stationPoint } from "../stations/match"
import { createPoiCache, PoiCacheEntries } from "../stations/poi_cache"
import { cityPrices, price92History } from "../sync/xxyh/api"
import { currentPosition } from "../platform/location"
import { locatePlaces } from "../platform/map_search"
import { scriptingHttp } from "../platform/scripting_http"
import { readCache, writeCache } from "../platform/storage"
import { errorText } from "./errors"
import { xxyhToken } from "./xxyh_io"

type PoiCacheFile = { schema_version: 1; entries: PoiCacheEntries }
const POI_CACHE_FILE = "poi_cache.json"

/** 附近搜索的结果按坐标缓存 30 天（cache/poi_cache.json） */
const poiCache = createPoiCache({
  load: () => {
    const f = readCache<PoiCacheFile>(POI_CACHE_FILE)
    return f && f.schema_version === 1 && f.entries ? f.entries : null
  },
  save: entries => writeCache(POI_CACHE_FILE, { schema_version: 1, entries }),
  now: () => Date.now(),
})

/** 地图上 p 附近 radiusM 内的加油站，按距离排；同一个地方 30 天内用缓存（找加油停车、选择油站的附近） */
export const nearbyStations = poiCache.wrap("map", (p, r) => stationsNearby(locatePlaces, p, r))

/** 从插件填入时的油站（插件化设计 3.2 节）：到站停车、交易的站点信息、我的油站、地图上的加油站，按五步定；都没有时 null */
export function pluginStation(data: AppData, vehicle: Vehicle, txn: FuelTxnStation | null, stop: Stop | null, payTs: number): Promise<StationPick | null> {
  return pickStation(txn, arrivalStop(stop, payTs), { mine: stationsFor(data, vehicle), nearby: nearbyStations, now: Date.now() })
}

/** 搜索时最多等手机的位置这么久，等不到就用最近用过的油站 */
const POSITION_WAIT_MS = 3000
/** 取到的位置在这段时间里重复用 */
const POSITION_TTL_MS = 120e3
let position: { at: number; p: Promise<LngLat | null> } | null = null

/** 开始取手机的位置：搜索页打开时调，打完字时一般已经取到。2 分钟内重复用；取不到时下次重新取 */
export function warmSearchCenter(): Promise<LngLat | null> {
  const now = Date.now()
  if (position && now - position.at <= POSITION_TTL_MS) return position.p
  const entry = { at: now, p: currentPosition() }
  position = entry
  void entry.p.then(v => { if (!v && position === entry) position = null })
  return entry.p
}

/** 门店、油站搜索框的区域中心（插件化设计 6.1 节，D14）：手机现在的位置（最多等 3 秒），取不到时用最近用过的油站，都没有时 null */
export async function searchCenterFor(data: AppData): Promise<LngLat | null> {
  const here = await Promise.race([warmSearchCenter(), new Promise<null>(resolve => setTimeout(() => resolve(null), POSITION_WAIT_MS))])
  return searchCenter(here, data.ledger.stations)
}

const priceCache = new Map<string, Promise<{ current: CityPrices | null; history: Array<[number, number]> }>>()

/** 某个城市在某个时刻的 92#、95# 油价，用来按单价判断标号。当前油价需要小熊凭据，历史油价不需要 */
export async function priceRefFor(city: string, province: string, atMs: number): Promise<PriceRef | null> {
  if (!city) return null
  const key = `${province}|${city}`
  let entry = priceCache.get(key)
  if (!entry) {
    const token = xxyhToken()
    entry = Promise.all([
      token ? cityPrices(scriptingHttp, token, province || city, city).catch(() => null) : Promise.resolve(null),
      price92History(scriptingHttp, city).catch(() => [] as Array<[number, number]>),
    ]).then(([current, history]) => ({ current, history }))
    priceCache.set(key, entry)
    entry.then(v => { if (!v.current && !v.history.length) priceCache.delete(key) }) // 都失败时下次重试
  }
  const { current, history } = await entry
  return priceRefAt(current, history, atMs, city)
}

const MUNICIPALITY = /^(北京|上海|天津|重庆)市$/

/** 判断标号用哪个城市的油价：油站所在城市 → 停车点所在城市 → 最近一次加油的油站所在城市 */
export function priceCityFor(data: AppData, vehicle: Vehicle, station: Station | null, stop: Stop | null): { city: string; province: string } {
  const pick = (city: string, province: string) => ({ city, province: province || (MUNICIPALITY.test(city) ? city : "") })
  if (station && station.city) return pick(station.city, station.province)
  if (stop && stop.place && stop.place.city) return pick(stop.place.city, "")
  const stations = stationsFor(data, vehicle)
  for (const r of fuelRecords(data, vehicle)) {
    const s = r.station_id ? stations.find(x => x.id === r.station_id) : null
    if (s && s.city) return pick(s.city, s.province)
  }
  return { city: "", province: "" }
}

/** 选油站：附近（以 center 为中心）或关键字；都没有时按最近使用排序 */
export async function stationCandidates(data: AppData, vehicle: Vehicle | null, center: LngLat | null, keyword: string): Promise<{ list: StationCandidate[]; error: string | null }> {
  const mine = stationsFor(data, vehicle)
  const now = Date.now()
  const out: StationCandidate[] = []
  const seen = new Set<string>()
  const add = (c: StationCandidate) => {
    if (seen.has(c.station.id)) return
    seen.add(c.station.id)
    out.push(c)
  }
  let error: string | null = null
  const kw = keyword.trim()
  if (kw) {
    for (const st of mine.filter(x => x.name.includes(kw) || x.address.includes(kw)).slice(0, 8)) add({ kind: "mine", station: st, dist: center ? metres(stationPoint(st), center) : null })
    const hint = await searchCenterFor(data)
    try { for (const poi of await stationsByKeyword(locatePlaces, kw, hint)) add(candidateFromPoi(poi, mine, center, now)) } catch (e) { error = errorText(e) }
    return { list: out, error }
  }
  if (center) {
    mine.map(st => ({ st, d: metres(stationPoint(st), center) })).filter(x => x.d <= 3000).sort((a, b) => a.d - b.d).slice(0, 5)
      .forEach(x => add({ kind: "mine", station: x.st, dist: x.d }))
    try { for (const poi of await nearbyStations(center, 2000)) add(candidateFromPoi(poi, mine, center, now)) } catch (e) { error = errorText(e) }
    return { list: out.sort((a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9)).slice(0, 12), error }
  }
  mine.slice().sort((a, b) => b.last_used_ts - a.last_used_ts).slice(0, 30).forEach(st => add({ kind: "mine", station: st, dist: null }))
  return { list: out, error }
}
