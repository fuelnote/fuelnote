// 加满金额的油价（加满金额设计第 3、4 节）：定地区（手机的位置 → 最近用过的油站）、按地区缓存一天、调提供油价的插件；
// 车况详情「加满」一组和小组件的价格都从这里取。规则在 common/fill_cost.ts。
import { fillView, FillView, needsPriceRefresh, PriceCache, priceFor, priceRegion, shortRegion } from "../common/fill_cost"
import { AppData } from "../common/ledger"
import { PluginRef, PriceRegion, Vehicle } from "../common/types"
import { placeOf } from "../platform/location"
import { readCache, writeCache } from "../platform/storage"
import { pluginFuelPrice, pluginsWith } from "./plugins"
import { warmSearchCenter } from "./stations"
import { vehicleTank } from "./vehicle_data"

/** 油价缓存：不进账本、不进备份 */
const CACHE_FILE = "fuel_price.json"
/** 取位置最多等 3 秒（和搜索框一样） */
const POSITION_WAIT_MS = 3000
/** 同一次运行里 10 分钟内不重复反查地址 */
const PLACE_TTL_MS = 10 * 60e3

let place: { at: number; region: PriceRegion } | null = null
/** 这次读油价出错的原因（显-8）、这次没定出地区（显-3）：只在内存里 */
let lastError: string | null = null
let noRegion = false

/** 提供油价的插件：几个都提供时用第一个（F7） */
function pricePlugin(data: AppData): PluginRef | null {
  return pluginsWith(data, "fuel_price")[0] ?? null
}

export const pricePluginId = (data: AppData): string | null => pricePlugin(data)?.id ?? null

/** 缓存的油价：只用还添加着的那个插件的（移除插件后不用） */
function usablePrice(data: AppData): PriceCache | null {
  const p = pricePlugin(data)
  const c = readCache<PriceCache>(CACHE_FILE)
  return p && c && c.plugin && c.plugin.id === p.id ? c : null
}

/** 手机所在的省、市：取不到位置、反查不出时 null（区-1） */
async function here(): Promise<PriceRegion | null> {
  const now = Date.now()
  if (place && now - place.at < PLACE_TTL_MS) return place.region
  const p = await Promise.race([warmSearchCenter(), new Promise<null>(resolve => setTimeout(() => resolve(null), POSITION_WAIT_MS))])
  const found = p ? await placeOf(p) : null
  const region = found ? shortRegion(found.province, found.city) : null
  if (region) place = { at: now, region }
  return region
}

/**
 * 打开油记、回到前台时调（F8）：没添加提供油价的插件时不取位置（区-5）；地区没变、读了不到一天时不调插件。
 * 出错时缓存不动（价-5）。返回缓存有没有变
 */
export async function refreshFuelPrice(data: AppData): Promise<boolean> {
  const plugin = pricePlugin(data)
  if (!plugin) return false
  const picked = priceRegion(await here(), data.ledger.stations)
  noRegion = !picked
  if (!picked) return false
  const cache = usablePrice(data)
  if (!needsPriceRefresh(cache, plugin.id, picked.region, Date.now())) {
    if (!cache || cache.from === picked.from) return false
    // 同一个地区，换成了从位置（或油站）定的：只改说明，不重查
    writeCache(CACHE_FILE, { ...cache, from: picked.from })
    return true
  }
  const at = Date.now()
  const r = await pluginFuelPrice(plugin, picked.region)
  if (!r.ok) {
    lastError = r.error.message
    return false
  }
  lastError = null
  const next: PriceCache = { plugin: { id: plugin.id, name: plugin.name }, region: picked.region, from: picked.from, fetched_at: at, prices: r.value }
  writeCache(CACHE_FILE, next)
  return true
}

/** 车况详情「加满」一组；不知道剩余油量或油箱容量时 null */
export function fillViewFor(data: AppData, vehicle: Vehicle, status: { fuel_l: number | null } | null): FillView | null {
  return fillView({
    fuel: status ? status.fuel_l : null, tank: vehicleTank(data, vehicle), grade: vehicle.default_grade,
    plugin: !!pricePlugin(data), cache: usablePrice(data), error: lastError, noRegion,
  })
}

/** 小组件摘要里的价格：这辆车默认标号的挂牌价 */
export const widgetFillPrice = (data: AppData, vehicle: Vehicle): { grade: number; price: number } | null => priceFor(usablePrice(data), vehicle.default_grade)
