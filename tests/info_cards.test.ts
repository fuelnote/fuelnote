// 插件的信息卡片（docs/specs/2026-11-04-presets-and-cards.md 第 7 节）：契约的解析（7.1 节）、什么时候查（7.2 节，卡-*）、
// 记录页「当前」下面的一组（D4、D32）、小组件的两格（第 2 节，D18、D26、D28）。油记只认卡片的字段，测试里的卡片都是编的。
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseDescribe, parseInfo, pluginRef, refreshedRef } from "../common/plugin"
import {
  cardsOnError, cardTitles, EMPTY_INFO_CACHE, forgetInfo, InfoEntry, infoGroups, InfoParams, InfoPluginView, infoViews, liveCards, needsInfoRefresh, viewsOfGroup, widgetCards,
} from "../common/info_cards"
import { cardChoices, cardLine, cardRefOf, cardSlotView, normalizePresets, parseCardRef } from "../common/widget_layout"
import { EMPTY_WIDGET, WidgetSnapshot } from "../common/widget_data"
import { InfoCard, PluginRef } from "../common/types"

const H = 3600e3
const NOW = Date.parse("2026-11-04T18:30:00+08:00")
const MIDNIGHT = Date.parse("2026-11-05T00:00:00+08:00")
const P: InfoParams = { grade: 95, province: "上海", city: "上海" }

function card(d: Partial<InfoCard> = {}): InfoCard {
  return {
    id: "sample", title: "示例卡片", icon: "percent", tone: "good",
    rows: [{ label: "甲 · 1.0 km", value: "−0.3", detail: "示例的说明", tone: "good" }, { label: "乙 · 2.0 km", value: "注意", detail: null, tone: "warn" }],
    empty: "今天都没有", note: "示例插件编的。", summary: "甲 1.0 km · −0.3", until: MIDNIGHT, ...d,
  }
}
const entry = (d: Partial<InfoEntry> = {}): InfoEntry => ({ fetched_at: NOW - H, params: P, cards: [card()], done: true, error: null, ...d })
const view = (d: Partial<InfoPluginView> = {}): InfoPluginView => ({
  plugin: { id: "example", name: "示例" }, title: "示例卡片", cards: [card()], busy: false, progress: null, error: null, ...d,
})
const EXAMPLE: PluginRef = { script: "s", id: "example", name: "示例", capabilities: ["fuel", "info"], cards: [{ id: "sample", title: "示例卡片" }] }

test("describe 声明的卡片（D28）：要有 id 和标题，同一个 id 只留第一个；跟着插件的引用存下，声明变了也算插件有更新", () => {
  const r = parseDescribe({
    ok: true, contract: 1, id: "example", name: "示例", version: "1.2.0", capabilities: ["fuel", "info"],
    cards: [{ id: "sample", title: " 示例卡片 " }, { id: "sample", title: "重复的" }, { id: "x" }, { title: "没有 id" }, "坏的"],
  })
  assert.ok(r.ok)
  assert.deepEqual(r.ok && r.value.cards, [{ id: "sample", title: "示例卡片" }])
  assert.deepEqual(r.ok && r.value.capabilities, ["fuel", "info"])
  const ref = pluginRef("FuelNote 示例插件", r.ok ? r.value : (null as never))
  assert.deepEqual(ref.cards, [{ id: "sample", title: "示例卡片" }])
  const old: PluginRef = { ...ref, cards: [] }
  assert.deepEqual(refreshedRef(old, r.ok ? r.value : (null as never), [old])?.cards, [{ id: "sample", title: "示例卡片" }])
  const none = parseDescribe({ ok: true, contract: 1, id: "e", name: "e", version: "1", capabilities: ["fuel"] })
  assert.deepEqual(none.ok && none.value.cards, [])
})

test("info 的返回（7.1 节）：卡片缺 id、标题或有效期时丢掉；行缺 label、value 时丢掉；语气只认 good、warn", () => {
  const r = parseInfo({
    ok: true, next: "1", progress: " 正在读 1/2 ",
    cards: [
      { id: "sample", title: "示例卡片", icon: "percent", tone: "good", until: MIDNIGHT, summary: "摘要", empty: "没有", note: "说明",
        rows: [{ label: "甲", value: "1", detail: "说明", tone: "good" }, { label: "乙", value: "2", tone: "red" }, { label: "丙" }, "坏的"] },
      { id: "no-until", title: "没有有效期", rows: [] },
      { title: "没有 id", until: MIDNIGHT, rows: [] },
      { id: "plain", title: "普通", until: MIDNIGHT, rows: "坏的", icon: 3, summary: "" },
    ],
  })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.value.next, "1")
  assert.equal(r.value.progress, "正在读 1/2")
  assert.deepEqual(r.value.cards.map(c => c.id), ["sample", "plain"])
  assert.deepEqual(r.value.cards[0].rows, [{ label: "甲", value: "1", detail: "说明", tone: "good" }, { label: "乙", value: "2", detail: null, tone: null }])
  assert.deepEqual({ icon: r.value.cards[1].icon, rows: r.value.cards[1].rows, summary: r.value.cards[1].summary }, { icon: null, rows: [], summary: null })
  assert.equal(parseInfo({ ok: true, cards: "坏的" }).ok, false)
  const last = parseInfo({ ok: true, cards: [] })
  assert.deepEqual(last.ok && { next: last.value.next, progress: last.value.progress }, { next: null, progress: null })
  // 插件的错误照常传上来
  const err = parseInfo({ ok: false, error: "not_connected", message: "还没连接易捷" })
  assert.deepEqual(!err.ok && err.error, { kind: "not_connected", message: "还没连接易捷" })
})

test("卡-1～卡-5：没有卡片、参数变了、上次没查完、过了有效期时查；都没变时不查", () => {
  assert.equal(needsInfoRefresh(null, P, NOW), true, "卡-1")
  assert.equal(needsInfoRefresh(entry(), P, NOW), false, "卡-2")
  assert.equal(needsInfoRefresh(entry(), { ...P, city: "苏州", province: "江苏" }, NOW), true, "卡-3")
  assert.equal(needsInfoRefresh(entry(), { ...P, grade: 98 }, NOW), true, "默认标号改了")
  assert.equal(needsInfoRefresh(entry(), P, MIDNIGHT), true, "卡-4")
  assert.equal(needsInfoRefresh(entry({ done: false, error: "插件没有回应" }), P, NOW), true, "卡-5")
  // 有一张过了有效期就重查（插件每次都给全部卡片）
  assert.equal(needsInfoRefresh(entry({ cards: [card(), card({ id: "b", until: NOW - 1 })] }), P, NOW), true)
  // 插件一张卡片都没给：24 小时后再查，不会每次打开都查
  assert.equal(needsInfoRefresh(entry({ cards: [], fetched_at: NOW - 2 * H }), P, NOW), false)
  assert.equal(needsInfoRefresh(entry({ cards: [], fetched_at: NOW - 24 * H }), P, NOW), true)
})

test("卡-5（D30）：出错时留着这次查到的；一批都还没回来时，参数没变才留着上次的", () => {
  const got = [card({ id: "got" })]
  assert.deepEqual(cardsOnError(entry(), P, got), got)
  assert.deepEqual(cardsOnError(entry(), P, []), [])
  assert.deepEqual(cardsOnError(entry(), P, null).map(c => c.id), ["sample"])
  assert.deepEqual(cardsOnError(entry(), { ...P, city: "苏州", province: "江苏" }, null), [], "去了外地：上次的卡片不留")
  assert.deepEqual(cardsOnError(null, P, null), [])
})

test("卡-4：过了有效期的卡片不显示", () => {
  const e = entry({ cards: [card(), card({ id: "old", until: NOW - 1 })] })
  assert.deepEqual(liveCards(e, NOW).map(c => c.id), ["sample"])
  assert.deepEqual(liveCards(e, MIDNIGHT), [])
  assert.deepEqual(liveCards(null, NOW), [])
})

test("页面上的卡片（7.3 节）：按添加插件的顺序；查着时带进度，不查时带上次出错的原因；插件查完了一张都没给时不列", () => {
  const other: PluginRef = { script: "t", id: "other", name: "别的", capabilities: ["fuel"] }
  const plain: PluginRef = { script: "u", id: "plain", name: "没声明", capabilities: ["info"] }
  const cache = { ...EMPTY_INFO_CACHE, plugins: { example: entry({ cards: [card(), card({ id: "old", until: NOW - 1 })] }), plain: entry({ cards: [], error: "插件没有回应", done: false }) } }
  const idle = infoViews(cache, [other, EXAMPLE, plain], new Map(), NOW)
  assert.deepEqual(idle.map(v => [v.plugin.id, v.title, v.cards.map(c => c.id), v.busy, v.progress, v.error]), [
    ["example", "示例卡片", ["sample"], false, null, null],
    ["plain", "没声明", [], false, null, "插件没有回应"],
  ])
  const busy = infoViews(cache, [EXAMPLE, plain], new Map([["plain", "正在读 1/2"]]), NOW)
  assert.deepEqual(busy.map(v => [v.busy, v.progress, v.error]), [[false, null, null], [true, "正在读 1/2", null]])
  // 查完了、一张卡片都没给：不多一组；查着时照样列出来（写进度）
  const none = { ...EMPTY_INFO_CACHE, plugins: { example: entry({ cards: [] }) } }
  assert.deepEqual(infoViews(none, [EXAMPLE], new Map(), NOW), [])
  assert.equal(infoViews(none, [EXAMPLE], new Map([["example", null]]), NOW).length, 1)
  // 还没查过：列出来，组名按声明
  assert.deepEqual(infoViews(EMPTY_INFO_CACHE, [EXAMPLE], new Map(), NOW).map(v => [v.title, v.cards.length]), [["示例卡片", 0]])
})

test("D4：记录页「当前」下面每张卡片一组，按添加插件的顺序；有摘要写摘要和条数，没有摘要时写「共 N 条」", () => {
  const a = view({ plugin: { id: "a", name: "甲插件" }, cards: [card({ summary: null }), card({ id: "x", title: "第二张" })] })
  const b = view({ plugin: { id: "b", name: "乙插件" }, cards: [card({ summary: "乙的摘要" })] })
  assert.deepEqual(infoGroups([a, b]).map(g => [g.key, g.title, g.text, g.tone, g.count]), [
    ["a/sample", "示例卡片", "共 2 条", null, null],
    ["a/x", "第二张", "甲 1.0 km · −0.3", "good", 2],
    ["b/sample", "示例卡片", "乙的摘要", "good", 2],
  ])
  assert.deepEqual(infoGroups([view()])[0], {
    key: "example/sample", plugin_id: "example", card_id: "sample", title: "示例卡片", icon: "percent", text: "甲 1.0 km · −0.3", tone: "good", count: 2,
  })
  assert.deepEqual(infoGroups([]), [])
})

test("卡-6、D32：一行都没有时这一组照样显示，写 empty；查着、卡片还没有内容时写进度", () => {
  assert.deepEqual(infoGroups([view({ cards: [card({ summary: null, rows: [] })] })]).map(g => [g.text, g.icon, g.tone, g.count]), [["今天都没有", "percent", null, null]])
  assert.equal(infoGroups([view({ cards: [card({ summary: null, rows: [], empty: null })], busy: true, progress: "正在读 1/2" })])[0].text, "正在读 1/2…")
})

test("D30：插件还没有卡片时一组，组名按声明，写进度、出错的原因或「还没读到」", () => {
  const g = (d: Partial<InfoPluginView>) => infoGroups([view({ cards: [], ...d })]).map(x => [x.key, x.card_id, x.title, x.icon, x.text, x.count])
  assert.deepEqual(g({ busy: true }), [["example", null, "示例卡片", null, "正在读取…", null]])
  assert.deepEqual(g({ busy: true, progress: "正在读 1/2" })[0][4], "正在读 1/2…")
  assert.deepEqual(g({ error: "插件没有回应" })[0][4], "没有查完：插件没有回应")
  assert.deepEqual(g({})[0][4], "还没读到")
})

test("轻点一组弹出的一页：只有这个插件；是一张卡片时只有这一张，插件还没有卡片时照原样", () => {
  const a = view({ plugin: { id: "a", name: "甲插件" }, cards: [card(), card({ id: "x" })] })
  const b = view({ plugin: { id: "b", name: "乙插件" }, cards: [] })
  assert.deepEqual(viewsOfGroup([a, b], { plugin_id: "a", card_id: "x" }).map(v => [v.plugin.id, v.cards.map(c => c.id)]), [["a", ["x"]]])
  assert.deepEqual(viewsOfGroup([a, b], { plugin_id: "b", card_id: null }), [b])
  assert.deepEqual(viewsOfGroup([a], { plugin_id: "b", card_id: null }), [])
})

test("卡片写成一行（7.3 节）：有摘要写摘要和语气；没有时写「共 N 条」或 empty", () => {
  assert.deepEqual(cardLine(card(), 2), { text: "甲 1.0 km · −0.3", tone: "good" })
  assert.deepEqual(cardLine(card({ summary: null }), 4), { text: "共 4 条", tone: null })
  assert.deepEqual(cardLine(card({ summary: null }), 0), { text: "今天都没有", tone: null })
  assert.deepEqual(cardLine(card({ summary: null, empty: null }), 0), { text: "还没读到", tone: null })
})

test("卡-7：移除插件时清掉它的卡片", () => {
  const cache = { ...EMPTY_INFO_CACHE, plugins: { a: entry(), b: entry() } }
  assert.deepEqual(Object.keys(forgetInfo(cache, "a").plugins), ["b"])
})

test("小组件的摘要：只写没过有效期的卡片，每张最多 3 行，带插件名和行数", () => {
  const many = card({ rows: [1, 2, 3, 4].map(i => ({ label: `第 ${i} 行`, value: String(i), detail: null, tone: null })) })
  const plugins: PluginRef[] = [{ script: "s", id: "example", name: "示例", capabilities: ["info"], cards: [{ id: "sample", title: "示例卡片" }] }]
  const cache = { ...EMPTY_INFO_CACHE, plugins: { example: entry({ cards: [many, card({ id: "old", until: NOW - 1 })] }), gone: entry() } }
  const w = widgetCards(cache, plugins, NOW)
  assert.deepEqual(w.map(c => [c.plugin_id, c.plugin_name, c.id, c.rows.length, c.row_count]), [["example", "示例", "sample", 3, 4]])
})

test("小组件的两格（D18、D26、D28）：按 describe 的声明列菜单；取不到时写原因", () => {
  const plugins: PluginRef[] = [
    { script: "s", id: "example", name: "示例", capabilities: ["fuel", "info"], cards: [{ id: "sample", title: "示例卡片" }] },
    { script: "t", id: "other", name: "别的", capabilities: ["fuel"] },
  ]
  const ref = cardRefOf("example", "sample")
  assert.equal(ref, "card:example/sample")
  assert.deepEqual(parseCardRef(ref), { pluginId: "example", cardId: "sample" })
  assert.equal(parseCardRef("card:坏的"), null)
  assert.deepEqual(cardChoices(plugins), [{ ref, label: "示例卡片 · 示例" }])
  assert.deepEqual(cardTitles(plugins), { [ref]: { title: "示例卡片", plugin_name: "示例" } })

  const base: WidgetSnapshot = { ...EMPTY_WIDGET, card_titles: { [ref]: { title: "示例卡片", plugin_name: "示例" } } }
  assert.deepEqual(cardSlotView(base, ref, NOW), { title: "示例卡片", plugin: "示例", card: null, reason: "还没读到" })
  const c = { plugin_id: "example", plugin_name: "示例", ...card(), rows: card().rows.slice(0, 3), row_count: 2 }
  const s = { ...base, cards: [c] }
  assert.deepEqual(cardSlotView(s, ref, NOW), { title: "示例卡片", plugin: "示例", card: c, reason: null })
  assert.deepEqual(cardSlotView(s, ref, MIDNIGHT), { title: "示例卡片", plugin: "示例", card: null, reason: "已过期，打开油记更新" })
  // 卡-7：插件移除了（或不再声明这张卡片），摘要里没有它的组名：这一格照旧；2.5 的 widget.json 也是这样
  assert.equal(cardSlotView({ ...s, card_titles: {} }, ref, NOW), null)
  assert.equal(cardSlotView(EMPTY_WIDGET, ref, NOW), null)
  assert.equal(cardSlotView({ ...EMPTY_WIDGET, card_titles: undefined, cards: undefined }, ref, NOW), null)
})

test("读账本：方案里的两格只认 card:<插件>/<卡片>", () => {
  const raw = [{ name: "花费", slots: { hero: "month" }, cards: { tank: "card:example/sample", list: "card:坏的", other: "card:a/b", recent: 3 } }]
  assert.deepEqual(normalizePresets(raw), [{ name: "花费", slots: { hero: "month" }, cards: { tank: "card:example/sample" } }])
  // 没选卡片的方案不多出 cards
  assert.deepEqual(normalizePresets([{ name: "默认", slots: {} }]), [{ name: "默认", slots: {} }])
})
