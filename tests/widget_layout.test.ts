// 小组件方案（docs/specs/2026-11-04-presets-and-cards.md）：格子放什么（第 4 节，位-*）、参数选方案（第 5 节，方-*）、
// 每种格子里写什么（第 3 节）、写「—」时的原因（D12）、改方案（第 5、6 节，D13）。
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  addPreset, autoContent, cellText, circleText, DEFAULT_PRESET, hasContent, heroText, HOME_SLOTS, missingReason, normalizePresets, Placed, placeSlots, presetFor,
  presetList, presetNameProblem, removePreset, renamePreset, resetDefault, setPresetSlot, usedElsewhere,
} from "../common/widget_layout"
import { EMPTY_WIDGET, lastMonthCostNow, WidgetContent, WidgetPreset, WidgetSlot, WidgetSnapshot } from "../common/widget_data"

// 本地时间：小组件按手机的时区算本月、上月和「N 天前」，测试和 CI（UTC）都用本地时间构造
const NOW = new Date(2026, 10, 4, 20, 0).getTime()
const OCT12 = new Date(2026, 9, 12, 9, 30).getTime()

/** 画稿第二十六轮的真实数据：剩 47 L、续航 330 km、油箱 55 L、95# 9.41；10/12 加满后还没加油 */
function snap(d: Partial<WidgetSnapshot> = {}): WidgetSnapshot {
  return {
    ...EMPTY_WIDGET, updated_at: NOW, vehicle: "S90", status_source: true,
    status: { ts: NOW, fuel_l: 47, range_km: 330, tank_l: 55, odometer_km: 82984, read_at: NOW },
    latest_consumption: 11.597826086956522, avg_consumption: 12.424845772734535, last_fuel_ts: OCT12, last_fuel_odometer: 82912, last_fuel_full: true,
    month: "2026-11", month_cost: 0, prev_month_cost: 389.24, year: "2026", year_cost: 8551.8841,
    recent: [{ ts: OCT12, liters: 42.68, grade: 98, station: "示例加油站", paid: 389.24, consumption: 11.597826086956522 }],
    fill_price: { grade: 95, price: 9.41 },
    ...d,
  }
}
const NO_PRICE = snap({ fill_price: null })
const NO_STATUS = snap({ status_source: false, status: null })

const preset = (slots: WidgetPreset["slots"] = {}, name = "测试"): WidgetPreset => ({ name, slots })
const has = (s: WidgetSnapshot) => (c: WidgetContent) => hasContent(s, c)
/** 中号、大号的五格：大数字、左上、右上、左下、右下；写「—」的标上 — */
function home(p: WidgetPreset, s: WidgetSnapshot): string[] {
  const r = placeSlots(p, HOME_SLOTS, has(s))
  return HOME_SLOTS.map(slot => `${r[slot]!.content}${r[slot]!.missing ? "—" : ""}`)
}
const circle = (p: WidgetPreset, s: WidgetSnapshot) => { const r = placeSlots(p, ["circle"], has(s)).circle!; return `${r.content}${r.missing ? "—" : ""}` }

test("位-1～位-3：都是自动时和 2.4（没有车况时和 2.3）一样", () => {
  assert.deepEqual(home(preset(), snap()), ["latest", "fuel", "range", "fill", "month"])
  assert.equal(circle(preset(), snap()), "fill")
  assert.deepEqual(home(preset(), NO_PRICE), ["latest", "fuel", "range", "month", "year"])
  assert.equal(circle(preset(), NO_PRICE), "latest")
  assert.deepEqual(home(preset(), NO_STATUS), ["latest", "average", "last_fill", "month", "year"])
  assert.equal(circle(preset(), NO_STATUS), "latest")
})

test("位-4：大数字选剩余油量，左上（自动）换成平均油耗", () => {
  assert.deepEqual(home(preset({ hero: "fuel" }), snap()), ["fuel", "average", "range", "fill", "month"])
})

test("位-5、位-6：大数字选的内容没有时写「—」，自动的格子照旧换", () => {
  assert.deepEqual(home(preset({ hero: "fill" }), NO_PRICE), ["fill—", "fuel", "range", "month", "year"])
  assert.deepEqual(home(preset({ hero: "fuel" }), NO_STATUS), ["fuel—", "average", "last_fill", "month", "year"])
})

test("位-7：左上选剩余油量，没有车况时写「—」，其余自动", () => {
  assert.deepEqual(home(preset({ top_left: "fuel" }), NO_STATUS), ["latest", "fuel—", "last_fill", "month", "year"])
})

test("位-8：左上选本月油费，左下的自动顺序用完了，按总顺序取剩余油量", () => {
  assert.deepEqual(home(preset({ top_left: "month" }), NO_PRICE), ["latest", "month", "range", "fuel", "year"])
})

test("位-9：圆形选续航，没有车况时写「—」", () => {
  assert.equal(circle(preset({ circle: "range" }), NO_STATUS), "range—")
  assert.equal(circle(preset({ circle: "range" }), snap()), "range")
})

test("位-11：数据里两格是同一项，放在前面那一格，后面那一格写「—」", () => {
  assert.deepEqual(home(preset({ top_left: "range", top_right: "range" }), snap()), ["latest", "range", "range—", "fill", "month"])
})

test("第 4 节第 3 条：只取放得下的内容；都没有时放这一格自动顺序的第一项", () => {
  // 四格选了最近油耗和本月油费，没有车况：大数字能放的（最近油耗、剩余油量、加满约、本月油费）都没了
  assert.deepEqual(home(preset({ top_left: "latest", top_right: "month" }), NO_STATUS), ["latest", "latest", "month", "year", "average"])
})

test("「花费」（R26Presets）：大数字本月油费，四格今年油费、加满约、平均油耗、上次加油", () => {
  const p = preset({ hero: "month", top_left: "year", top_right: "fill", bottom_left: "average", bottom_right: "last_fill" }, "花费")
  assert.deepEqual(home(p, snap()), ["month", "year", "fill", "average", "last_fill"])
})

test("方-1～方-6：参数选方案；空着、没有这套、删了或改了名时用默认", () => {
  const spend = preset({ hero: "month" }, "花费")
  const list = [spend]
  assert.equal(presetFor(list, "").name, DEFAULT_PRESET)
  assert.equal(presetFor(list, null).name, DEFAULT_PRESET)
  assert.deepEqual(presetFor(list, "").slots, {})
  assert.equal(presetFor(list, "花费"), spend)
  assert.equal(presetFor(list, " 花费 "), spend)
  assert.equal(presetFor(list, "话费").name, DEFAULT_PRESET)
  assert.equal(presetFor([], "花费").name, DEFAULT_PRESET)
  assert.equal(presetFor(list, "\"花费\""), spend)
  assert.equal(presetFor(list, "\"默认\"").name, DEFAULT_PRESET)
  // 改过的默认方案
  const def = preset({ circle: "range" }, DEFAULT_PRESET)
  assert.equal(presetFor([def, spend], ""), def)
  assert.equal(presetFor([def, spend], "没有"), def)
})

test("D12：大数字写「—」时下面写为什么没有", () => {
  assert.equal(missingReason(NO_STATUS, "fuel"), "还没有车况")
  assert.equal(missingReason(NO_STATUS, "fill"), "还没有车况")
  assert.equal(missingReason(NO_STATUS, "range"), "还没有车况")
  assert.equal(missingReason(snap({ status: { ...snap().status!, tank_l: null } }), "fill"), "不知道油箱容量")
  assert.equal(missingReason(NO_PRICE, "fill"), "还没有油价")
})

const ok = (content: WidgetContent): Placed => ({ content, missing: false })
const gone = (content: WidgetContent): Placed => ({ content, missing: true })

test("大数字写什么（第 3 节，R26Hero）", () => {
  const s = snap()
  assert.deepEqual(heroText(s, ok("latest"), NOW), { label: "最近油耗", value: "11.60", unit: "L/100km", leftUnit: "", corner: "10/12", line: "", trend: true, low: false })
  assert.deepEqual(heroText(s, ok("fuel"), NOW), { label: "剩余油量", value: "47", unit: "L", leftUnit: "L", corner: null, line: "约可行驶 330 km", trend: false, low: false })
  assert.deepEqual(heroText(s, ok("fill"), NOW), { label: "加满约", value: "75", unit: "元", leftUnit: "元", corner: null, line: "95# 挂牌价 9.41", trend: false, low: false })
  assert.deepEqual(heroText(s, ok("month"), NOW), { label: "本月油费", value: "0.00", unit: "", leftUnit: "", corner: null, line: "上月 389.24", trend: false, low: false })
  assert.deepEqual(heroText(NO_PRICE, gone("fill"), NOW), { label: "加满约", value: "—", unit: "", leftUnit: "", corner: null, line: "还没有油价", trend: false, low: false })
  // 油量低时数字用橙色（和车况详情一样）
  assert.equal(heroText(snap({ status: { ...s.status!, fuel_l: 6 } }), ok("fuel"), NOW).low, true)
})

test("数字格写什么（第 3 节，R26Cells）；写「—」时名称照写", () => {
  const s = snap()
  const cells = (["latest", "average", "fuel", "range", "fill", "month", "year", "last_fill"] as WidgetContent[]).map(c => cellText(s, ok(c), NOW))
  assert.deepEqual(cells.map(c => `${c.label} ${c.value}${c.unit ? ` ${c.unit}` : ""}`), [
    "最近油耗 11.60", "平均油耗 12.42", "剩余油量 47 L", "续航 330 km", "加满约 75 元", "本月油费 0.00", "今年油费 8,552", "上次加油 23 天前",
  ])
  assert.deepEqual(cellText(NO_STATUS, gone("fuel"), NOW), { label: "剩余油量", value: "—", unit: "" })
})

test("锁屏圆形中间写什么（第 3 节）；写「—」时下面写名称", () => {
  assert.deepEqual(circleText(snap(), ok("fill")), { value: "¥75", caption: "加满约" })
  assert.deepEqual(circleText(snap(), ok("latest")), { value: "11.6", caption: "L/100km" })
  assert.deepEqual(circleText(snap(), ok("range")), { value: "330", caption: "km" })
  assert.deepEqual(circleText(NO_STATUS, gone("range")), { value: "—", caption: "续航" })
})

test("上月油费：摘要是这个月写的用 prev_month_cost，上个月写的用它的本月，更早的是 0", () => {
  assert.equal(lastMonthCostNow(snap(), NOW), 389.24)
  assert.equal(lastMonthCostNow(snap({ month: "2026-10", month_cost: 389.24 }), NOW), 389.24)
  assert.equal(lastMonthCostNow(snap({ month: "2026-09", month_cost: 391.19 }), NOW), 0)
  // 1 月看去年 12 月
  const jan = new Date(2027, 0, 5, 9, 0).getTime()
  assert.equal(lastMonthCostNow(snap({ month: "2026-12", month_cost: 400 }), jan), 400)
  // 2.4 的 widget.json 没有这一项
  const old = { ...snap() } as Partial<WidgetSnapshot>
  delete old.prev_month_cost
  assert.equal(lastMonthCostNow(old as WidgetSnapshot, NOW), 0)
})

test("名称：不能空、不能重复、不能叫「默认」；改名时可以留原名", () => {
  const list = [preset({}, "花费")]
  assert.equal(presetNameProblem(list, "  "), "名称不能空")
  assert.equal(presetNameProblem(list, "默认"), "「默认」是默认方案的名称")
  assert.equal(presetNameProblem(list, " 花费 "), "已经有叫「花费」的方案")
  assert.equal(presetNameProblem(list, "花费", "花费"), null)
  assert.equal(presetNameProblem(list, "车况"), null)
})

test("改方案：添加（都是自动）、改名、选格子、选回自动、删除、还原默认", () => {
  let list = addPreset([], " 花费 ")
  assert.deepEqual(list, [{ name: "花费", slots: {} }])
  list = setPresetSlot(list, "花费", "hero", "month")
  list = setPresetSlot(list, "花费", "top_left", "year")
  assert.deepEqual(list[0].slots, { hero: "month", top_left: "year" })
  list = setPresetSlot(list, "花费", "top_left", null)
  assert.deepEqual(list[0].slots, { hero: "month" })
  list = renamePreset(list, "花费", "油费")
  assert.deepEqual(list.map(p => p.name), ["油费"])
  // 默认方案没存过时，改它就存一份
  list = setPresetSlot(list, DEFAULT_PRESET, "circle", "range")
  assert.deepEqual(presetList(list).map(p => [p.name, p.slots]), [[DEFAULT_PRESET, { circle: "range" }], ["油费", { hero: "month" }]])
  assert.deepEqual(presetList([]).map(p => p.name), [DEFAULT_PRESET])
  list = resetDefault(list)
  assert.deepEqual(presetList(list)[0].slots, {})
  list = removePreset(list, "油费")
  assert.deepEqual(list, [])
})

test("D13：大数字和四格里别的格子选了的内容；锁屏圆形自己一组", () => {
  const p = preset({ hero: "month", top_left: "year", top_right: "fill", bottom_left: "average", circle: "fill" })
  assert.deepEqual(usedElsewhere(p, "bottom_right"), { month: "hero", year: "top_left", fill: "top_right", average: "bottom_left" })
  assert.deepEqual(usedElsewhere(p, "top_right"), { month: "hero", year: "top_left", average: "bottom_left" })
  assert.deepEqual(usedElsewhere(p, "circle"), {})
})

test("菜单里「自动 · …」写这一格选自动时会显示什么", () => {
  const p = preset({ hero: "month", top_left: "year", top_right: "fill", bottom_left: "average", bottom_right: "last_fill" })
  assert.equal(autoContent(p, "bottom_right", snap()), "latest")
  assert.equal(autoContent(preset(), "top_left", snap()), "fuel")
  assert.equal(autoContent(preset(), "top_left", NO_STATUS), "average")
  assert.equal(autoContent(preset(), "circle", NO_PRICE), "latest")
})

test("读账本：丢掉不认识的格子、内容和放不下的内容，同名只留第一个", () => {
  const raw = [
    { name: " 花费 ", slots: { hero: "month", top_left: "year", circle: "year", nope: "fuel", top_right: "nope" } },
    { name: "花费", slots: { hero: "fuel" } },
    { name: "", slots: {} },
    { slots: { hero: "fuel" } },
    "坏的",
    { name: DEFAULT_PRESET, slots: { hero: "average", circle: "range" } },
  ]
  assert.deepEqual(normalizePresets(raw), [{ name: "花费", slots: { hero: "month", top_left: "year" } }, { name: DEFAULT_PRESET, slots: { circle: "range" } }])
  assert.deepEqual(normalizePresets(undefined), [])
  assert.deepEqual(normalizePresets({}), [])
})

test("能选的格子（D7）：大数字 4 种、数字格 8 种、圆形 3 种", () => {
  const slots: WidgetSlot[] = ["hero", "top_left", "circle"]
  const names = slots.map(slot => normalizePresets([{ name: "x", slots: { [slot]: "average" } }])[0].slots[slot] ?? null)
  assert.deepEqual(names, [null, "average", null])
})
