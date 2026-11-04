// 加满要多少钱（docs/specs/2026-11-03-fill-cost.md）：金额（第 1 节）、地区（第 3 节，区-*）、油价何时重查（第 4 节，价-*）、车况详情「加满」一组（第 5 节，显-*）。
import { test } from "node:test"
import assert from "node:assert/strict"
import { fillView, FillInput, needsPriceRefresh, PriceCache, priceRegion, shortRegion } from "../common/fill_cost"
import { vehicleGrade } from "../common/ledger"
import { Station } from "../common/types"
import { EMPTY_WIDGET, fillAmount, fillAmountNow, WidgetSnapshot } from "../common/widget_data"

const H = 3600e3
const NOW = Date.parse("2026-11-04T20:00:00+08:00")
const OCT29 = Date.parse("2026-10-29T00:12:00+08:00")
const SH = { province: "上海", city: "上海" }

function cache(d: Partial<PriceCache> = {}): PriceCache {
  return {
    plugin: { id: "ejoy", name: "易捷" }, region: SH, from: "location", fetched_at: NOW - H,
    prices: { region: "上海", effective: OCT29, items: [{ grade: 92, price: 8.85 }, { grade: 95, price: 9.41 }, { grade: 0, price: 8.57 }] },
    ...d,
  }
}

function station(d: Partial<Station>): Station {
  return { id: "s", name: "示例加油站", address: "", province: "", city: "", district: "", lng: 121.5, lat: 31.2, last_used_ts: 0, ...d }
}

const input = (d: Partial<FillInput> = {}): FillInput => ({ fuel: 52, tank: 55, grade: 95, plugin: true, cache: cache(), error: null, ...d })

test("金额：（油箱 − 剩余）× 挂牌价，四舍五入到元；真实数据的两个例子；满箱 ¥0（F9）；缺一样时没有", () => {
  assert.equal(fillAmount(52, 55, 9.41), 28)
  assert.equal(fillAmount(55 - 42.68, 55, 9.41), 402)
  assert.equal(fillAmount(55, 55, 9.41), 0)
  assert.equal(fillAmount(56.2, 55, 9.41), 0)
  assert.equal(fillAmount(null, 55, 9.41), null)
  assert.equal(fillAmount(52, null, 9.41), null)
})

test("小组件：按摘要里的车况和价格算；2.3 的 widget.json 没有 fill_price、没有车况时没有", () => {
  const snap: WidgetSnapshot = {
    ...EMPTY_WIDGET, status_source: true, fill_price: { grade: 95, price: 9.41 },
    status: { ts: NOW, fuel_l: 52, range_km: 620, tank_l: 55, odometer_km: 82943, read_at: NOW },
  }
  assert.equal(fillAmountNow(snap), 28)
  const old = { ...snap } as Partial<WidgetSnapshot>
  delete old.fill_price
  assert.equal(fillAmountNow(old as WidgetSnapshot), null)
  assert.equal(fillAmountNow({ ...snap, status_source: false }), null)
  assert.equal(fillAmountNow({ ...snap, status: null }), null)
})

test("区-4、区-6：省市写短名；直辖市的省是空的时用市", () => {
  assert.deepEqual(shortRegion("广西壮族自治区", "南宁市"), { province: "广西", city: "南宁" })
  assert.deepEqual(shortRegion("内蒙古自治区", "锡林郭勒盟"), { province: "内蒙古", city: "锡林郭勒盟" })
  assert.deepEqual(shortRegion("新疆维吾尔自治区", "乌鲁木齐市"), { province: "新疆", city: "乌鲁木齐" })
  assert.deepEqual(shortRegion("江苏省", "苏州市"), { province: "江苏", city: "苏州" })
  assert.deepEqual(shortRegion("", "上海市"), SH)
  assert.deepEqual(shortRegion(null, "上海市"), SH)
  assert.deepEqual(shortRegion("上海市", "上海市"), SH)
  assert.deepEqual(shortRegion("云南省", null), { province: "云南", city: "" })
  assert.equal(shortRegion("", "苏州市"), null)
  assert.equal(shortRegion(null, null), null)
})

test("区-1～区-3：有位置用位置；没有时用最近用过、带省市的油站；都没有时没有地区", () => {
  const stations = [
    station({ id: "a", province: "江苏省", city: "苏州市", last_used_ts: 100 }),
    station({ id: "b", province: "", city: "上海市", last_used_ts: 300 }),
    station({ id: "c", province: "", city: "", last_used_ts: 400 }),
  ]
  const here = { province: "浙江", city: "杭州" }
  assert.deepEqual(priceRegion(here, stations), { region: here, from: "location" })
  assert.deepEqual(priceRegion(null, stations), { region: SH, from: "station" })
  assert.equal(priceRegion(null, [station({ city: "", last_used_ts: 1 })]), null)
  assert.equal(priceRegion(null, []), null)
})

test("价-1～价-4：没有缓存、超过 24 小时、省或市变了、换了插件时重查；同一天没变不查", () => {
  assert.equal(needsPriceRefresh(null, "ejoy", SH, NOW), true)
  assert.equal(needsPriceRefresh(cache({ fetched_at: NOW - 11 * H }), "ejoy", SH, NOW), false)
  assert.equal(needsPriceRefresh(cache({ fetched_at: NOW - 24 * H }), "ejoy", SH, NOW), true)
  assert.equal(needsPriceRefresh(cache(), "ejoy", { province: "江苏", city: "苏州" }, NOW), true)
  assert.equal(needsPriceRefresh(cache(), "ejoy", { province: "上海", city: "" }, NOW), true)
  assert.equal(needsPriceRefresh(cache(), "other", SH, NOW), true)
})

test("显-1：按位置；行写金额和升数、标号的挂牌价；说明写地区、调价日期、插件", () => {
  const v = fillView(input())!
  assert.deepEqual({ litres: v.litres, amount: v.amount, priceLabel: v.priceLabel, price: v.price }, { litres: 3, amount: 28, priceLabel: "95# 挂牌价", price: 9.41 })
  assert.equal(v.note, "按上海 10/29 起的挂牌价算，不扣优惠；标号是车辆设置里的默认标号。油价来自易捷，每天更新一次。")
})

test("显-2：按最近一次加油的油站", () => {
  assert.equal(fillView(input({ cache: cache({ from: "station" }) }))!.note,
    "按上海 10/29 起的挂牌价算，不扣优惠。取不到手机的位置，地区按最近一次加油的油站。标号是车辆设置里的默认标号；油价来自易捷，每天更新一次。")
})

test("显-3：没有地区、也没有缓存；显-5：没添加提供油价的插件", () => {
  const none = fillView(input({ cache: null, noRegion: true }))!
  assert.deepEqual({ amount: none.amount, price: none.price, litres: none.litres }, { amount: null, price: null, litres: 3 })
  assert.equal(none.note, "允许 Scripting 使用位置，或者记一笔带油站的加油后，按所在地区的挂牌价算出加满金额。")
  assert.equal(fillView(input({ plugin: false, cache: null }))!.note, "添加提供油价的数据源插件后，按所在地区的挂牌价算出加满金额。")
})

test("显-6：没选过默认标号的车（小熊里没写标号，导入后是 null）按车辆设置里显示的 95# 算", () => {
  const car = { id: "v", name: "车", default_grade: null, created_ts: 0, xxyh_car: null, provider: null }
  assert.equal(vehicleGrade(car), 95)
  assert.equal(vehicleGrade({ ...car, default_grade: 98 }), 98)
  assert.equal(fillView(input({ grade: vehicleGrade(car) }))!.amount, 28)
})

test("显示的升数和取整后的剩余油量对得上：剩 32.5 L（写 33 L）、油箱 55 L 写 22 L，金额按 22.5 L 算", () => {
  const v = fillView(input({ fuel: 32.5, cache: cache({ prices: { region: "上海", effective: OCT29, items: [{ grade: 95, price: 8 }] } }) }))!
  assert.deepEqual({ litres: v.litres, amount: v.amount }, { litres: 22, amount: 180 })
})

test("显-4：剩余不小于油箱容量写 ¥0 · 0 L", () => {
  const v = fillView(input({ fuel: 55.4 }))!
  assert.deepEqual({ litres: v.litres, amount: v.amount }, { litres: 0, amount: 0 })
})

test("显-7：这个地区没有默认标号的挂牌价", () => {
  const v = fillView(input({ grade: 98 }))!
  assert.equal(v.amount, null)
  assert.equal(v.note, "上海 10/29 起的挂牌价里没有 98#。")
})

test("价-5：读油价出错时照旧用缓存，说明写缓存的地区；价-6、显-8：出错又没有缓存", () => {
  const v = fillView(input({ error: "连不上中国石化的油价查询" }))!
  assert.equal(v.amount, 28)
  assert.ok(v.note.startsWith("按上海 10/29 起"))
  assert.equal(fillView(input({ cache: null, error: "连不上中国石化的油价查询" }))!.note, "还没有读到油价：连不上中国石化的油价查询")
  assert.equal(fillView(input({ cache: null }))!.note, "还没有读到油价。")
})

test("显-9：不知道剩余油量或油箱容量时没有这一组；生效时间不知道时不写日期", () => {
  assert.equal(fillView(input({ fuel: null })), null)
  assert.equal(fillView(input({ tank: null })), null)
  const v = fillView(input({ cache: cache({ prices: { region: "云南五价区", effective: null, items: [{ grade: 95, price: 9.99 }] } }) }))!
  assert.equal(v.note, "按云南五价区的挂牌价算，不扣优惠；标号是车辆设置里的默认标号。油价来自易捷，每天更新一次。")
})
