// 插件的信息卡片（docs/specs/2026-11-04-presets-and-cards.md 第 7 节，2.6）：缓存、什么时候查（7.2 节，卡-*）、给页面的视图、
// 「当前」那一行（D21）、没有车况的车记录页最上面那一组（D14）、小组件摘要里的卡片。油记只认卡片的字段，不认卡片里写的是什么（D1、D20）：
// 有效期、文字都由插件给。纯逻辑：调插件、读写缓存在 app/info_cards.ts。
import { usedCapabilities } from "./plugin"
import { InfoCard, InfoTone, PluginRef } from "./types"
import { CardRef, WidgetCard } from "./widget_data"
import { cardLine, cardRefOf } from "./widget_layout"

/** 传给插件的参数：车辆的默认标号（D16），所在的省、市（和油价同一个地区，D24；定不出地区时不查，D29） */
export type InfoParams = { grade: number; province: string; city: string }

/** 一个插件的缓存：什么时候查的、传的参数、卡片、查完没有、出错的原因 */
export type InfoEntry = { fetched_at: number; params: InfoParams; cards: InfoCard[]; done: boolean; error: string | null }

/** 缓存文件：cache/info.json，不进账本、不进备份 */
export const INFO_CACHE_FILE = "info.json"
export type InfoCache = { schema_version: 1; plugins: Record<string, InfoEntry> }

export const EMPTY_INFO_CACHE: InfoCache = { schema_version: 1, plugins: {} }

/** 插件一张卡片都没给时，隔多久再查（不然每次打开都查） */
const NO_CARDS_RETRY_MS = 24 * 3600e3

const sameParams = (a: InfoParams, b: InfoParams) => a.grade === b.grade && a.province === b.province && a.city === b.city

/**
 * 要不要查（卡-1～卡-5）：没有缓存、参数变了（默认标号、省、市）、上次没查完或出错、有卡片过了有效期时要查。
 * 插件每次都给全部卡片，所以最早的那张过期就重查；一张卡片都没给时 24 小时后再查
 */
export function needsInfoRefresh(entry: InfoEntry | null | undefined, params: InfoParams, now: number): boolean {
  if (!entry || !sameParams(entry.params, params) || !entry.done) return true
  if (!entry.cards.length) return now - entry.fetched_at >= NO_CARDS_RETRY_MS
  return Math.min(...entry.cards.map(c => c.until)) <= now
}

/**
 * 查到一半出错时留着的卡片（卡-5）：这次已经查到的（got）；这次一批都还没回来时，参数没变就留着上次的，
 * 变了（例如去了外地）不留，免得把别处的卡片当成这里的
 */
export function cardsOnError(prev: InfoEntry | null | undefined, params: InfoParams, got: InfoCard[] | null): InfoCard[] {
  if (got) return got
  return prev && sameParams(prev.params, params) ? prev.cards : []
}

/** 还没过有效期的卡片（卡-4） */
export function liveCards(entry: InfoEntry | null | undefined, now: number): InfoCard[] {
  return entry ? entry.cards.filter(c => c.until > now) : []
}

/** 卡-7：移除插件时清掉它的卡片 */
export function forgetInfo(cache: InfoCache, pluginId: string): InfoCache {
  const plugins = { ...cache.plugins }
  delete plugins[pluginId]
  return { ...cache, plugins }
}

/**
 * 给页面的：一个插件的卡片（没过有效期的）、在查着没有、插件给的进度、出错的原因；
 * title 是还没有卡片时那一组的组名（声明的第一张卡片的标题，没声明时插件名）
 */
export type InfoPluginView = {
  plugin: { id: string; name: string }
  title: string
  cards: InfoCard[]
  busy: boolean
  progress: string | null
  error: string | null
}

/**
 * 页面上的信息卡片（7.3 节）：提供 info 的插件按添加的顺序；running 是正在查的插件和它给的进度。
 * 插件查完了、一张卡片都没给时不列这个插件（不多一组）
 */
export function infoViews(cache: InfoCache, plugins: PluginRef[], running: ReadonlyMap<string, string | null>, now: number): InfoPluginView[] {
  // 关掉了「信息」的不列（开-1）
  return plugins.filter(p => usedCapabilities(p).includes("info")).flatMap(p => {
    const e = cache.plugins[p.id]
    const busy = running.has(p.id)
    if (!busy && e && e.done && !e.cards.length) return []
    return [{
      plugin: { id: p.id, name: p.name }, title: p.cards?.[0]?.title ?? p.name, cards: liveCards(e, now), busy,
      progress: busy ? running.get(p.id) ?? null : null, error: busy ? null : e?.error ?? null,
    }]
  })
}

/** 查着时组里写的一句（7.1 节）：插件给的进度，没给时「正在读取」，后面加省略号 */
export const progressText = (v: { progress: string | null }): string => `${v.progress ?? "正在读取"}…`

/**
 * 记录页「当前」下面的一组（D4，画稿 R28Place）：组名、图标、一行字和语气；count 是写在右边的「共 N 条」（写摘要时才有）。
 * 轻点弹出的一页按 plugin_id、card_id 取（viewsOfGroup）；插件还没有卡片时 card_id 是 null
 */
export type InfoGroup = {
  key: string; plugin_id: string; card_id: string | null; title: string; icon: string | null; text: string; tone: InfoTone | null; count: number | null
}

/**
 * 记录页「当前」下面（没有「当前」时在最上面）每张卡片一组，按添加插件的顺序（7.3 节）：有摘要写摘要和「共 N 条」；
 * 没有摘要时写「共 N 条」，一行都没有写 empty、照样显示（卡-6，D32）；查着、卡片还没有内容时写进度。
 * 插件还没有卡片时一组，组名按声明，写进度、出错的原因或「还没读到」（D30）
 */
export function infoGroups(views: InfoPluginView[]): InfoGroup[] {
  return views.flatMap((v): InfoGroup[] => {
    if (!v.cards.length) {
      const text = v.busy ? progressText(v) : v.error ? `没有查完：${v.error}` : "还没读到"
      return [{ key: v.plugin.id, plugin_id: v.plugin.id, card_id: null, title: v.title, icon: null, text, tone: null, count: null }]
    }
    return v.cards.map(card => {
      const line = cardLine(card, card.rows.length, v.busy ? progressText(v) : undefined)
      return {
        key: `${v.plugin.id}/${card.id}`, plugin_id: v.plugin.id, card_id: card.id, title: card.title, icon: card.icon, text: line.text, tone: line.tone,
        count: card.summary && card.rows.length ? card.rows.length : null,
      }
    })
  })
}

/** 轻点一组弹出的一页（7.3 节）：只有这个插件；这一组是一张卡片时只有这一张 */
export function viewsOfGroup(views: InfoPluginView[], g: { plugin_id: string; card_id: string | null }): InfoPluginView[] {
  return views.filter(v => v.plugin.id === g.plugin_id).map(v => (g.card_id ? { ...v, cards: v.cards.filter(c => c.id === g.card_id) } : v))
}

/** 小组件的摘要里写的卡片：还添加着的插件、没过有效期的，每张最多 3 行（大号放得下的），带插件名和总行数 */
export function widgetCards(cache: InfoCache, plugins: PluginRef[], now: number): WidgetCard[] {
  return plugins.flatMap(p => liveCards(cache.plugins[p.id], now).map(c => ({
    plugin_id: p.id, plugin_name: p.name, id: c.id, title: c.title, icon: c.icon, tone: c.tone,
    // 小组件不导航：地点不写进 widget.json
    rows: c.rows.slice(0, 3).map(r => ({ label: r.label, value: r.value, detail: r.detail, tone: r.tone })), row_count: c.rows.length, empty: c.empty, summary: c.summary, until: c.until,
  })))
}

/** 方案里换成卡片的格子要写的组名和插件名：按 describe 的声明（D28），还没查过也有；移除了的插件没有（小组件照旧，卡-7） */
export function cardTitles(plugins: PluginRef[]): Record<CardRef, { title: string; plugin_name: string }> {
  const out: Record<CardRef, { title: string; plugin_name: string }> = {}
  for (const p of plugins) {
    if (!usedCapabilities(p).includes("info")) continue
    for (const c of p.cards ?? []) out[cardRefOf(p.id, c.id)] = { title: c.title, plugin_name: p.name }
  }
  return out
}
