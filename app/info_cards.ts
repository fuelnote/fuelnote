// 插件的信息卡片（docs/specs/2026-11-04-presets-and-cards.md 第 7 节，2.6）：打开油记、回到前台时，要查的插件在后台一批一批地调（7.2 节），
// 每批后写缓存 cache/info.json、通知界面和小组件；页面和小组件的摘要都从缓存取，不调插件。规则在 common/info_cards.ts。
import {
  cardsOnError, cardTitles, EMPTY_INFO_CACHE, INFO_CACHE_FILE, InfoCache, InfoEntry, InfoParams, InfoPluginView, infoViews, needsInfoRefresh, widgetCards,
} from "../common/info_cards"
import { AppData, currentVehicle, vehicleGrade } from "../common/ledger"
import { InfoCard, PluginRef } from "../common/types"
import { CardRef, WidgetCard } from "../common/widget_data"
import { readCache, writeCache } from "../platform/storage"
import { currentRegion } from "./fuel_price"
import { pluginInfo, pluginsWith } from "./plugins"
import { enabledCards } from "../common/plugin"

/** 一次最多要几批：插件一直给 next 时到这里停下，下次打开再查 */
const MAX_BATCHES = 30

/** 正在查的插件 → 插件给的进度（还没给时 null）：只在内存里 */
const running = new Map<string, string | null>()
/** 打开着的卡片那一页：卡片变了时跟着更新 */
const watchers = new Set<() => void>()

/** 卡片、进度变了时通知；返回取消的函数 */
export function watchInfo(listener: () => void): () => void {
  watchers.add(listener)
  return () => { watchers.delete(listener) }
}

function changed(onChange: () => void): void {
  onChange()
  for (const w of [...watchers]) w()
}

function load(): InfoCache {
  const c = readCache<InfoCache>(INFO_CACHE_FILE)
  return c && c.schema_version === 1 && c.plugins && typeof c.plugins === "object" ? c : EMPTY_INFO_CACHE
}

function save(pluginId: string, entry: InfoEntry): void {
  const c = load()
  try {
    writeCache(INFO_CACHE_FILE, { ...c, plugins: { ...c.plugins, [pluginId]: entry } })
  } catch { /* 缓存写不进去时下次再查 */ }
}

/** 传给插件的参数：当前车辆的默认标号（D16），所在的省、市（和油价同一个地区，D24）；还没有车辆、定不出地区时 null（不查，D29） */
async function paramsFor(data: AppData): Promise<InfoParams | null> {
  const v = currentVehicle(data)
  if (!v) return null
  const picked = await currentRegion(data)
  return picked ? { grade: vehicleGrade(v), province: picked.region.province, city: picked.region.city } : null
}

/** 一个插件的参数：加上启用的卡片（插件声明了卡片时，开-11），启用的卡片变了就重查 */
function paramsOf(ref: PluginRef, params: InfoParams): InfoParams {
  const cards = enabledCards(ref)
  return cards ? { ...params, cards: cards.map(c => c.id) } : params
}

/** 一个插件一批一批地查（卡-1、卡-5）：每批整个替换卡片，写缓存、调 onChange；出错停下，已经查到的照样留着，下次打开再查 */
async function run(ref: PluginRef, params: InfoParams, onChange: () => void): Promise<void> {
  running.set(ref.id, null)
  changed(onChange)
  const at = Date.now()
  // 只请求启用的卡片（开-11）：插件声明了卡片时传 cards；插件不认这个参数也照常工作，多给的卡片油记不显示
  const base = { grade: params.grade, province: params.province, city: params.city, ...(params.cards ? { cards: params.cards } : {}) }
  let got: InfoCard[] | null = null
  let cursor: string | null = null
  try {
    for (let i = 0; i < MAX_BATCHES; i++) {
      const r = await pluginInfo(ref, cursor ? { ...base, cursor } : base)
      if (!r.ok) {
        save(ref.id, { fetched_at: at, params, cards: cardsOnError(load().plugins[ref.id], params, got), done: false, error: r.error.message })
        return
      }
      got = r.value.cards
      cursor = r.value.next
      save(ref.id, { fetched_at: at, params, cards: got, done: !cursor, error: null })
      if (!cursor) return
      running.set(ref.id, r.value.progress)
      changed(onChange)
    }
    save(ref.id, { fetched_at: at, params, cards: got ?? [], done: false, error: "插件没有查完" })
  } finally {
    running.delete(ref.id)
    changed(onChange)
  }
}

/**
 * 打开油记、回到前台、添加了提供 info 的插件、换了车辆或默认标号时调（7.2 节，D30）：没有卡片、卡片过了有效期、默认标号或省市变了才查；
 * force 是卡片那一页的「重新查」。插件各查各的，同一个插件同时只跑一次（正在查的不再查）；没有车辆、定不出地区时不查（D29）
 */
export async function refreshInfo(data: AppData, onChange: () => void, force = false): Promise<void> {
  if (!pluginsWith(data, "info").length) return
  const params = await paramsFor(data)
  if (!params) return
  const cache = load()
  const now = Date.now()
  const due = pluginsWith(data, "info").map(p => ({ p, ps: paramsOf(p, params) }))
    .filter(({ p, ps }) => !running.has(p.id) && (force || needsInfoRefresh(cache.plugins[p.id], ps, now)))
  await Promise.all(due.map(({ p, ps }) => run(p, ps, onChange)))
}

/** 页面上的信息卡片：每个提供 info 的插件，按添加的顺序 */
export function infoViewsFor(data: AppData, now = Date.now()): InfoPluginView[] {
  return infoViews(load(), pluginsWith(data, "info"), running, now)
}

/** 小组件摘要里的卡片和方案里换成卡片的格子要写的组名、插件名 */
export function widgetInfo(data: AppData, now = Date.now()): { cards: WidgetCard[]; card_titles: Record<CardRef, { title: string; plugin_name: string }> } {
  const plugins = pluginsWith(data, "info")
  return { cards: plugins.length ? widgetCards(load(), plugins, now) : [], card_titles: cardTitles(plugins) }
}

/** 添加着的提供 info 的插件、它们启用的卡片和当前车辆的默认标号：变了时查一次（添加了插件，卡-1；启用了卡片，开-10；换了车辆、改了默认标号） */
export function infoKey(data: AppData): string {
  const v = currentVehicle(data)
  const plugins = pluginsWith(data, "info").map(p => `${p.id}:${(enabledCards(p) ?? []).map(c => c.id).join("+")}`)
  return `${plugins.join("|")}#${v ? vehicleGrade(v) : ""}`
}
