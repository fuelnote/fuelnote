// 小组件方案（docs/specs/2026-11-04-presets-and-cards.md，2.5）：每一格放什么（第 4 节）、参数选方案（第 5 节）、
// 每种格子里写什么（第 3 节）、写「—」时的原因（D12）、改方案（第 5、6 节，D13）。
// 纯逻辑：小组件（经 common/widget_runtime）和设置页（经 common/model）都用。
import { gradeText } from "./types"
import {
  CardRef, CardSlot, daysAgoText, fillAmountNow, fillDay, fuelTone, lastMonthCostNow, moneyText, monthCostNow, WidgetCard, WidgetContent, WidgetPreset, WidgetSlot,
  WidgetSnapshot, WidgetStatus, yearCostNow,
} from "./widget_data"

/** 参数空着、或者填的名称没有这套方案时用的方案；它不能改名、不能删（设计第 5 节） */
export const DEFAULT_PRESET = "默认"

export const CONTENT_TITLES: Record<WidgetContent, string> = {
  latest: "最近油耗", average: "平均油耗", fuel: "剩余油量", range: "续航", fill: "加满约", month: "本月油费", year: "今年油费", last_fill: "上次加油",
}
export const SLOT_TITLES: Record<WidgetSlot, string> = { hero: "大数字", top_left: "左上", top_right: "右上", bottom_left: "左下", bottom_right: "右下", circle: "中间" }

/** 中号、大号上一起出现的格子，按这个顺序处理（第 4 节）；小号只有大数字，锁屏圆形只有中间 */
export const HOME_SLOTS: WidgetSlot[] = ["hero", "top_left", "top_right", "bottom_left", "bottom_right"]
const CELLS: WidgetContent[] = ["latest", "average", "fuel", "range", "fill", "month", "year", "last_fill"]

/** 每一格放得下的内容（第 3 节，D8），也是设置里菜单的顺序 */
export const SLOT_CHOICES: Record<WidgetSlot, WidgetContent[]> = {
  hero: ["latest", "fuel", "fill", "month"],
  top_left: CELLS, top_right: CELLS, bottom_left: CELLS, bottom_right: CELLS,
  circle: ["fill", "latest", "range"],
}

/** 自动的顺序（第 4 节，和 2.4 的样子一样） */
const AUTO: Record<WidgetSlot, WidgetContent[]> = {
  hero: ["latest"], top_left: ["fuel", "average"], top_right: ["range", "last_fill"], bottom_left: ["fill", "month"], bottom_right: ["month", "year"],
  circle: ["fill", "latest"],
}
/** 自动顺序用完时的总顺序（第 4 节第 3 条） */
const FALLBACK: WidgetContent[] = ["latest", "fuel", "range", "fill", "month", "year", "average", "last_fill"]

/** 一格放的内容；missing 是选了这一项、暂时没有，写「—」（D6） */
export type Placed = { content: WidgetContent; missing: boolean }

const statusOf = (s: WidgetSnapshot): WidgetStatus | null => (s.status_source ? s.status : null)

/** 有没有这项内容：剩余油量、续航要有车况，加满约要算得出金额，其余总有（没算出时写「—」，和 2.4 一样） */
export function hasContent(s: WidgetSnapshot, c: WidgetContent): boolean {
  if (c === "fuel" || c === "range") return statusOf(s) != null
  if (c === "fill") return fillAmountNow(s) != null
  return true
}

/**
 * 一个小组件的各格放什么（第 4 节，位-1～位-11）：
 * 1. 选了具体内容的格子先放，没有时写「—」；两格是同一项时放在前面那一格，后面那一格写「—」。
 * 2. 自动的格子按自己的自动顺序，取第一项有、又没放过的。
 * 3. 用完时按总顺序取放得下的；都没有时放自动顺序的第一项。
 */
export function placeSlots(preset: WidgetPreset, slots: WidgetSlot[], has: (c: WidgetContent) => boolean): Partial<Record<WidgetSlot, Placed>> {
  const out: Partial<Record<WidgetSlot, Placed>> = {}
  const picked = new Set<WidgetContent>()
  const placed = new Set<WidgetContent>()
  for (const slot of slots) {
    const c = preset.slots[slot]
    if (!c) continue
    const first = !picked.has(c)
    picked.add(c)
    const shown = first && has(c)
    out[slot] = { content: c, missing: !shown }
    if (shown) placed.add(c)
  }
  for (const slot of slots) {
    if (out[slot]) continue
    const fits = SLOT_CHOICES[slot]
    const c = [...AUTO[slot], ...FALLBACK.filter(x => fits.includes(x))].find(x => has(x) && !placed.has(x)) ?? AUTO[slot][0]
    out[slot] = { content: c, missing: false }
    placed.add(c)
  }
  return out
}

/** 这一格选自动时会显示什么（设置里菜单的「自动 · 剩余油量」）：按同一个小组件上的格子算 */
export function autoContent(preset: WidgetPreset, slot: WidgetSlot, s: WidgetSnapshot): WidgetContent {
  const slots = { ...preset.slots }
  delete slots[slot]
  const group = slot === "circle" ? ["circle" as WidgetSlot] : HOME_SLOTS
  return placeSlots({ name: preset.name, slots }, group, c => hasContent(s, c))[slot]!.content
}

const defaultOf = (presets: WidgetPreset[]): WidgetPreset => presets.find(p => p.name === DEFAULT_PRESET) ?? { name: DEFAULT_PRESET, slots: {} }

/** 小组件的参数选方案（方-1～方-6）：比较时去掉前后的空格；预览传的是 JSON 写法（带引号）；空着、没有这套时用默认方案 */
export function presetFor(presets: WidgetPreset[] | undefined, parameter: string | null | undefined): WidgetPreset {
  const list = presets ?? []
  let name = (parameter ?? "").trim()
  if (name.startsWith("\"")) {
    try {
      const v = JSON.parse(name)
      if (typeof v === "string") name = v.trim()
    } catch { /* 不是 JSON，照原样比较 */ }
  }
  return (name && list.find(p => p.name === name)) || defaultOf(list)
}

/** 大数字写「—」时下面那一行（D12） */
export function missingReason(s: WidgetSnapshot, c: WidgetContent): string {
  const st = statusOf(s)
  if (!st || (c === "fill" && st.fuel_l == null)) return "还没有车况"
  if (c === "fill" && st.tank_l == null) return "不知道油箱容量"
  return c === "fill" ? "还没有油价" : "还没有车况"
}

const num = (n: number | null | undefined, digits = 2) => (n == null ? "—" : n.toFixed(digits))
const round = (n: number | null | undefined) => (n == null ? "—" : String(Math.round(n)))

/**
 * 大数字（小号的主体、中号和大号的左栏）：名称、数、小号的单位、左栏的单位（左栏窄，最近油耗不带单位）、
 * 左栏右上角、下面一行；trend 是最近油耗那一行（和平均比较，小组件自己画）；low 是油量低，数字用橙色
 */
export type HeroText = { label: string; value: string; unit: string; leftUnit: string; corner: string | null; line: string; trend: boolean; low: boolean }

export function heroText(s: WidgetSnapshot, p: Placed, now = Date.now()): HeroText {
  const label = CONTENT_TITLES[p.content]
  const plain = { label, unit: "", leftUnit: "", corner: null, trend: false, low: false }
  if (p.missing) return { ...plain, value: "—", line: missingReason(s, p.content) }
  const st = statusOf(s)
  switch (p.content) {
    case "latest":
      return { ...plain, value: num(s.latest_consumption), unit: "L/100km", corner: s.recent.length ? fillDay(s.recent[0].ts).slice(0, 5) : null, line: "", trend: true }
    case "fuel":
      return {
        ...plain, value: round(st?.fuel_l), unit: "L", leftUnit: "L", line: st && st.range_km != null ? `约可行驶 ${Math.round(st.range_km)} km` : "",
        low: !!st && fuelTone(st) === "low",
      }
    case "fill": {
      const price = s.fill_price
      return { ...plain, value: String(fillAmountNow(s) ?? "—"), unit: "元", leftUnit: "元", line: price ? `${gradeText(price.grade)} 挂牌价 ${price.price.toFixed(2)}` : "" }
    }
    case "month":
      return { ...plain, value: moneyText(monthCostNow(s, now), 2), line: `上月 ${moneyText(lastMonthCostNow(s, now), 2)}` }
    default: {
      // 大数字只放得下上面四种（第 3 节）；万一来了别的，照数字格写
      const c = cellText(s, p, now)
      return { ...plain, value: c.value, unit: c.unit, leftUnit: c.unit, line: "" }
    }
  }
}

/** 数字格：名称、数、单位（油费不写 ¥，和 2.4 一样）；写「—」时名称照写 */
export type CellText = { label: string; value: string; unit: string }

export function cellText(s: WidgetSnapshot, p: Placed, now = Date.now()): CellText {
  const label = CONTENT_TITLES[p.content]
  if (p.missing) return { label, value: "—", unit: "" }
  const st = statusOf(s)
  switch (p.content) {
    case "latest": return { label, value: num(s.latest_consumption), unit: "" }
    case "average": return { label, value: num(s.avg_consumption), unit: "" }
    case "fuel": return { label, value: round(st?.fuel_l), unit: "L" }
    case "range": return { label, value: round(st?.range_km), unit: "km" }
    case "fill": return { label, value: String(fillAmountNow(s) ?? "—"), unit: "元" }
    case "month": return { label, value: moneyText(monthCostNow(s, now), 2), unit: "" }
    case "year": return { label, value: moneyText(yearCostNow(s, now), 0), unit: "" }
    case "last_fill": return { label, value: s.last_fuel_ts ? daysAgoText(s.last_fuel_ts, now) : "—", unit: "" }
  }
}

/** 锁屏圆形中间：数和下面的小字；写「—」时小字写名称 */
export type CircleText = { value: string; caption: string }

export function circleText(s: WidgetSnapshot, p: Placed): CircleText {
  if (p.missing) return { value: "—", caption: CONTENT_TITLES[p.content] }
  if (p.content === "fill") return { value: `¥${fillAmountNow(s) ?? "—"}`, caption: "加满约" }
  if (p.content === "range") return { value: round(statusOf(s)?.range_km), caption: "km" }
  return { value: num(s.latest_consumption, 1), caption: "L/100km" }
}

// ---------- 改方案（设计第 5、6 节） ----------

/** 设置里的列表：默认方案在最前（没存过时是都自动的），其余按添加的顺序 */
export function presetList(presets: WidgetPreset[]): WidgetPreset[] {
  return [defaultOf(presets), ...presets.filter(p => p.name !== DEFAULT_PRESET)]
}

/** 名称不能空、不能重复、不能叫「默认」；改名时 current 是原来的名称 */
export function presetNameProblem(presets: WidgetPreset[], name: string, current?: string): string | null {
  const n = name.trim()
  if (!n) return "名称不能空"
  if (n === DEFAULT_PRESET) return "「默认」是默认方案的名称"
  if (n !== current && presets.some(p => p.name === n)) return `已经有叫「${n}」的方案`
  return null
}

/** 添加时各格都是自动（名称先用 presetNameProblem 检查） */
export function addPreset(presets: WidgetPreset[], name: string): WidgetPreset[] {
  return [...presets, { name: name.trim(), slots: {} }]
}

export function renamePreset(presets: WidgetPreset[], from: string, to: string): WidgetPreset[] {
  return presets.map(p => (p.name === from ? { ...p, name: to.trim() } : p))
}

export function removePreset(presets: WidgetPreset[], name: string): WidgetPreset[] {
  return presets.filter(p => p.name !== name)
}

/** 选一格的内容；content 是 null 时选回自动。默认方案没存过时存一份 */
export function setPresetSlot(presets: WidgetPreset[], name: string, slot: WidgetSlot, content: WidgetContent | null): WidgetPreset[] {
  const list = presets.some(p => p.name === name) ? presets : [...presets, { name, slots: {} }]
  return list.map(p => {
    if (p.name !== name) return p
    const slots = { ...p.slots }
    if (content) slots[slot] = content
    else delete slots[slot]
    return { ...p, slots }
  })
}

/** 还原默认方案：都是自动，就是 2.4 的样子 */
export function resetDefault(presets: WidgetPreset[]): WidgetPreset[] {
  return presets.filter(p => p.name !== DEFAULT_PRESET)
}

/** 大数字和四格里，别的格子选了的内容（D13）：菜单里是灰的，写在哪一格。锁屏圆形自己一组 */
export function usedElsewhere(preset: WidgetPreset, slot: WidgetSlot): Partial<Record<WidgetContent, WidgetSlot>> {
  const out: Partial<Record<WidgetContent, WidgetSlot>> = {}
  if (slot === "circle") return out
  for (const other of HOME_SLOTS) {
    const c = preset.slots[other]
    if (other !== slot && c && !out[c]) out[c] = other
  }
  return out
}

// ---------- 换成信息卡片的两格（设计第 2 节、7.3 节，2.6） ----------

const CARD_REF = /^card:([^/\s]+)\/(\S+)$/

export const cardRefOf = (pluginId: string, cardId: string): CardRef => `card:${pluginId}/${cardId}`

export function parseCardRef(ref: string): { pluginId: string; cardId: string } | null {
  const m = CARD_REF.exec(ref)
  return m ? { pluginId: m[1], cardId: m[2] } : null
}

/** 设置里菜单能选的卡片（D28）：提供信息卡片的插件在 describe 里声明的，写「<标题> · <插件名>」 */
export function cardChoices(plugins: Array<{ id: string; name: string; capabilities: string[]; cards?: Array<{ id: string; title: string }> }>): Array<{ ref: CardRef; label: string }> {
  return plugins.filter(p => p.capabilities.includes("info"))
    .flatMap(p => (p.cards ?? []).map(c => ({ ref: cardRefOf(p.id, c.id), label: `${c.title} · ${p.name}` })))
}

/** 改方案里换成卡片的一格；ref 是 null 时照旧（这一箱、最近加油） */
export function setPresetCard(presets: WidgetPreset[], name: string, slot: CardSlot, ref: CardRef | null): WidgetPreset[] {
  const list = presets.some(p => p.name === name) ? presets : [...presets, { name, slots: {} }]
  return list.map(p => {
    if (p.name !== name) return p
    const cards = { ...(p.cards ?? {}) }
    if (ref) cards[slot] = ref
    else delete cards[slot]
    const { cards: _old, ...rest } = p
    return Object.keys(cards).length ? { ...rest, cards } : rest
  })
}

/**
 * 卡片写成一行（7.3 节：记录页最上面、小组件的「这一箱」）：有摘要写摘要，按卡片的语气上色；
 * 没有摘要时有行写「共 N 条」，一行都没有写插件给的 empty（D26）；都没有时写 pending（还没查完）
 */
export function cardLine(card: { summary: string | null; empty: string | null; tone: "good" | "warn" | null }, count: number, pending = "还没读到"): { text: string; tone: "good" | "warn" | null } {
  if (card.summary) return { text: card.summary, tone: card.tone }
  return { text: count ? `共 ${count} 条` : card.empty ?? pending, tone: null }
}

/**
 * 小组件里换成卡片的一格（D26）：组名和插件名（按声明，还没查过也有）、卡片；
 * 取不到时写原因：还没查过「还没读到」，过了有效期「已过期，打开油记更新」（一行都没有时由画的地方写卡片的 empty）。
 * 插件移除了、不再声明这张卡片时 null：这一格照旧（卡-7）
 */
export function cardSlotView(s: WidgetSnapshot, ref: CardRef, now = Date.now()): { title: string; plugin: string; card: WidgetCard | null; reason: string | null } | null {
  const named = s.card_titles?.[ref]
  if (!named) return null
  const parsed = parseCardRef(ref)
  const card = parsed ? (s.cards ?? []).find(c => c.plugin_id === parsed.pluginId && c.id === parsed.cardId) ?? null : null
  const head = { title: named.title, plugin: named.plugin_name }
  if (!card) return { ...head, card: null, reason: "还没读到" }
  if (card.until <= now) return { ...head, card: null, reason: "已过期，打开油记更新" }
  return { ...head, card, reason: null }
}

/** 读账本时整理方案：丢掉不认识的格子、内容和这一格放不下的内容；名称去掉前后的空格，空的、重名的（只留第一个）丢掉 */
export function normalizePresets(raw: unknown): WidgetPreset[] {
  if (!Array.isArray(raw)) return []
  const out: WidgetPreset[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const r = item as { name?: unknown; slots?: unknown; cards?: unknown }
    const name = typeof r.name === "string" ? r.name.trim() : ""
    if (!name || out.some(p => p.name === name)) continue
    const slots: WidgetPreset["slots"] = {}
    if (r.slots && typeof r.slots === "object") {
      for (const [slot, c] of Object.entries(r.slots as Record<string, unknown>)) {
        const choices = SLOT_CHOICES[slot as WidgetSlot]
        if (choices && choices.includes(c as WidgetContent)) slots[slot as WidgetSlot] = c as WidgetContent
      }
    }
    const cards: Partial<Record<CardSlot, CardRef>> = {}
    if (r.cards && typeof r.cards === "object") {
      for (const [slot, ref] of Object.entries(r.cards as Record<string, unknown>)) {
        if ((slot === "tank" || slot === "list") && typeof ref === "string" && parseCardRef(ref)) cards[slot] = ref as CardRef
      }
    }
    out.push(Object.keys(cards).length ? { name, slots, cards } : { name, slots })
  }
  return out
}
