// 门店（2.1 设计第 10 节；2.2 起用系统地图，插件化设计 6.1 节）：从地图上的地点建门店（名称去掉分店名，没有营业时间）、
// 同一个地点不重复加（名称相同、相距 80 m 内）、重新定位、用到这家店的条数、读账本时补上新字段、记费用那时停车的地方。编造的数据，不联网。
import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeLedger } from "../common/ledger_file"
import { addStore, parkedAt, relocatedStore, shortStoreName, storeFromPoi, storeOfPlace, storeUsage } from "../common/stores"
import { emptyLedger, Store, StorePoi } from "../common/types"

const POI: StorePoi = {
  name: "示例汽车销售服务有限公司（滨江店）", address: "示例路100号", district: "徐汇区", city: "上海市", kind: "汽车销售",
  lng: 121.4737, lat: 31.2304, phone: "+86 21 0000 0000", distance: 8,
}

/** 往东挪 dx 米 */
function east(p: StorePoi, dx: number): StorePoi {
  return { ...p, lng: p.lng + dx / (111320 * Math.cos((p.lat * Math.PI) / 180)) }
}

/** 2.1 从高德选的门店：改过名称，存着营业时间和高德地点 id */
const MINE: Store = { ...storeFromPoi(POI), id: "st1", name: "我起的名字", hours: "08:30-17:00", poi_id: "B00155L3J1", dealer: { provider: "volvo_cn", code: "SHK" } }

test("从地图上的地点建门店：名称去掉末尾括号里的分店名；全称、地址、电话、坐标照地图；没有营业时间、地点 id 和经销商代码", () => {
  assert.equal(shortStoreName("优车美装（正大乐城）"), "优车美装")
  assert.equal(shortStoreName("示例汽车销售服务有限公司"), "示例汽车销售服务有限公司")
  assert.equal(shortStoreName("（只有括号）"), "（只有括号）")
  const s = storeFromPoi(POI)
  assert.deepEqual([s.id, s.name, s.full_name, s.address, s.phone, s.hours, s.poi_id, s.lng, s.lat, s.dealer],
    ["", "示例汽车销售服务有限公司", "示例汽车销售服务有限公司（滨江店）", "示例路100号", "+86 21 0000 0000", "", "", 121.4737, 31.2304, null])
})

test("图-3、图-4：同名、相距 20 m 的用已有的那一家（改过名称的按全称认）；同名相距 2 km 的是连锁店的另一家，新加一家", () => {
  assert.equal(storeOfPlace([MINE], east(POI, 20))?.id, "st1")
  assert.equal(storeOfPlace([MINE], east(POI, 2000)), null)
  assert.equal(storeOfPlace([MINE], { ...POI, name: "示例洗车" }), null)
  const again = addStore([MINE], storeFromPoi(east(POI, 20)), () => "st2")
  assert.deepEqual([again.stores.length, again.store.id], [1, "st1"])
  const other = addStore([MINE], storeFromPoi(east(POI, 2000)), () => "st2")
  assert.deepEqual([other.stores.length, other.store.id], [2, "st2"])
})

test("重新定位：id、名称、经销商代码不变，全称、地址、电话、位置换成新的；以前高德的营业时间和地点 id 清掉", () => {
  const moved = relocatedStore(MINE, { ...east(POI, 500), name: "新地点", address: "新路1号", phone: "" })
  assert.deepEqual([moved.id, moved.name, moved.dealer, moved.full_name, moved.address, moved.phone, moved.hours, moved.poi_id],
    ["st1", "我起的名字", MINE.dealer, "新地点", "新路1号", "", "", ""])
  assert.ok(moved.lng! > MINE.lng!)
})

test("用到这家店的费用和权益卡；读账本时给门店补上 2.1 的字段", () => {
  const l = emptyLedger()
  l.records.push({ kind: "expense", id: "e1", vehicle_id: "v1", ts: 1, category_id: 100003, amount: 10, remark: "", store_id: "st1" })
  l.perks.push({ id: "p1", vehicle_id: "v1", name: "洗车", kind: "count", total: 1, unit: "次", end_ts: null, store_id: "st1", source: "", insurance_id: null, origin: "other", raw: "", note: "", created_ts: 0 })
  assert.deepEqual(storeUsage(l, "st1"), { expenses: 1, perks: 1 })
  const n = normalizeLedger({ ...l, stores: [{ id: "st1", name: "示例店", full_name: "", address: "", phone: "", lng: null, lat: null }] })
  assert.deepEqual([n.stores[0].hours, n.stores[0].poi_id, n.stores[0].dealer], ["", "", null])
})

test("记费用那时停车的地方：停车之后、开走之前；最后一站还没开走也算；在路上时没有", () => {
  const H = 3600e3
  const stops = [{ end_ts: 1 * H, stay_min: 60 }, { end_ts: 5 * H, stay_min: 120 }, { end_ts: 10 * H, stay_min: null }]
  assert.equal(parkedAt(stops, 5.5 * H), stops[1])
  assert.equal(parkedAt(stops, 9 * H), null, "停了 2 小时，过了半小时以上，车已经开走")
  assert.equal(parkedAt(stops, 30 * H), stops[2])
  assert.equal(parkedAt(stops, 0.5 * H), null)
})
