// 加满要多少钱（docs/specs/2026-11-03-fill-cost.md）：交给插件的地区（第 3 节）、油价缓存什么时候重查（第 4 节）、车况详情「加满」一组（第 5 节）。
// 纯逻辑：取位置、反查地址、调插件和读写缓存在 app/fuel_price.ts。金额的算法和小组件共用 common/widget_data.ts。
import { FuelPrices, gradeText, PriceRegion, Station } from "./types"
import { fillAmount, fillLitres } from "./widget_data"

const DAY_MS = 86400e3
const MUNICIPALITY = /^(北京|上海|天津|重庆)$/

/** 地区从哪来：手机的位置，或最近一次加油的油站（F12） */
export type RegionSource = "location" | "station"

/** cache/fuel_price.json：哪个插件、哪个地区、什么时候读的；只存省、市（F10） */
export type PriceCache = { plugin: { id: string; name: string }; region: PriceRegion; from: RegionSource; fetched_at: number; prices: FuelPrices }

/** 省、市写短名（区-4、区-6）：省去掉「省」「市」「自治区」和民族名，市去掉「市」；直辖市的省是空的时用市；没有省时 null */
export function shortRegion(province: string | null | undefined, city: string | null | undefined): PriceRegion | null {
  const c = (city ?? "").trim().replace(/市$/, "")
  let p = (province ?? "").trim().replace(/(壮族|回族|维吾尔)?自治区$/, "").replace(/(省|市|特别行政区)$/, "")
  if (!p && MUNICIPALITY.test(c)) p = c
  return p ? { province: p, city: c } : null
}

/** 查哪个地区（区-1～区-3）：反查出的手机位置；没有时用最近用过、带省市的油站（和搜索框的区域中心一样，D14）；都没有时 null */
export function priceRegion(here: PriceRegion | null, stations: Station[]): { region: PriceRegion; from: RegionSource } | null {
  if (here) return { region: here, from: "location" }
  for (const s of [...stations].sort((a, b) => b.last_used_ts - a.last_used_ts)) {
    const region = shortRegion(s.province, s.city)
    if (region) return { region, from: "station" }
  }
  return null
}

/** 要不要调插件（价-1～价-4）：没有缓存、换了插件、省或市变了、读了 24 小时以上（F8） */
export function needsPriceRefresh(cache: PriceCache | null, pluginId: string, region: PriceRegion, now: number): boolean {
  return !cache || cache.plugin.id !== pluginId || cache.region.province !== region.province || cache.region.city !== region.city || now - cache.fetched_at >= DAY_MS
}

/** 默认标号在缓存里的挂牌价，写进小组件的摘要；没有时 null */
export function priceFor(cache: PriceCache | null, grade: number | null): { grade: number; price: number } | null {
  const hit = cache && grade != null ? cache.prices.items.find(x => x.grade === grade) : null
  return hit ? { grade: hit.grade, price: hit.price } : null
}

/**
 * 车况详情「加满」一组的输入：cache 只给还添加着的插件的；plugin 是添加了提供油价的插件；
 * noRegion 是这次没定出地区（区-3）；error 是这次读油价出错的原因
 */
export type FillInput = {
  fuel: number | null
  tank: number | null
  grade: number
  plugin: boolean
  cache: PriceCache | null
  error: string | null
  noRegion?: boolean
}

/** litres 是要加的升数（取整显示）；amount、price 没有时只写升数；priceLabel 是「95# 挂牌价」 */
export type FillView = { litres: number; amount: number | null; priceLabel: string | null; price: number | null; note: string }

const pad = (n: number) => String(n).padStart(2, "0")

/** 「上海 10/29 起的」；不知道生效时间时「上海的」 */
function since(p: FuelPrices): string {
  if (p.effective == null) return `${p.region}的`
  const d = new Date(p.effective)
  return `${p.region} ${pad(d.getMonth() + 1)}/${pad(d.getDate())} 起的`
}

/** 显-1～显-9：不知道剩余油量或油箱容量时 null（没有这一组） */
export function fillView(i: FillInput): FillView | null {
  if (fillLitres(i.fuel, i.tank) == null) return null
  // 显示的升数和「剩余 33 L」对得上（油箱 − 取整后的剩余）；金额按没取整的算
  const litres = Math.max(0, Math.round(i.tank!) - Math.round(i.fuel!))
  const only = (note: string): FillView => ({ litres, amount: null, priceLabel: null, price: null, note })
  if (!i.plugin) return only("添加提供油价的数据源插件后，按所在地区的挂牌价算出加满金额。")
  const c = i.cache
  if (!c) {
    if (i.noRegion) return only("允许 Scripting 使用位置，或者记一笔带油站的加油后，按所在地区的挂牌价算出加满金额。")
    return only(i.error ? `还没有读到油价：${i.error}` : "还没有读到油价。")
  }
  const grade = gradeText(i.grade)
  const hit = c.prices.items.find(x => x.grade === i.grade)
  if (!hit) return only(`${since(c.prices)}挂牌价里没有 ${grade}。`)
  const note = c.from === "station"
    ? `按${since(c.prices)}挂牌价算，不扣优惠。取不到手机的位置，地区按最近一次加油的油站。标号是车辆设置里的默认标号；油价来自${c.plugin.name}，每天更新一次。`
    : `按${since(c.prices)}挂牌价算，不扣优惠；标号是车辆设置里的默认标号。油价来自${c.plugin.name}，每天更新一次。`
  return { litres, amount: fillAmount(i.fuel, i.tank, hit.price), priceLabel: `${grade} 挂牌价`, price: hit.price, note }
}
