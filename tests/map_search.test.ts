// 系统地图搜索（插件化设计 6.1 节，D14）：坐标换算、地址、按距离筛和排、几次搜索合起来、加油站、附近门店（图-1～图-6）、搜索框的区域、同一家门店
import { test } from "node:test"
import assert from "node:assert/strict"
import { LngLat, metres, wgs84ToGcj02 } from "../common/geo"
import { sameStorePlace } from "../common/stores"
import { Station, Store } from "../common/types"
import {
  fromMap, locateAll, MapPlace, MapQuery, mapStoresByKeyword, mapStoresNearby, mergePlaces, placeAddress, placesNear, SEARCH_HINT_M, searchCenter, STORE_KEYWORDS,
  stationsByKeyword, stationsNearby, storeKind, toMap,
} from "../stations/map_search"

/** 人民广场附近（WGS-84） */
const CENTER: LngLat = [121.4737, 31.2304]

/** 从 center 往东 dx 米、往北 dy 米 */
function offset([lng, lat]: LngLat, dx: number, dy: number): LngLat {
  return [lng + dx / (111320 * Math.cos((lat * Math.PI) / 180)), lat + dy / 111320]
}

/** 系统地图给的地点：国内的坐标是 GCJ-02；一行地址「路名门牌, 市, 国家」，上海没有省 */
function place(name: string, wgs: LngLat, d: Partial<MapPlace> = {}): MapPlace {
  const [lng, lat] = wgs84ToGcj02(wgs)
  return { name, lng, lat, category: null, phone: null, street: "示例路 1 号", address: "示例路 1 号, 上海市, 中国", province: null, city: "上海市", district: "黄浦区", ...d }
}

test("坐标：国内的按 GCJ-02 换算，来回误差不到 1 米；国外的原样", () => {
  const back = fromMap(toMap(CENTER))
  assert.ok(metres(back, CENTER) < 1)
  assert.ok(metres(toMap(CENTER), CENTER) > 300, "国内换算后差几百米")
  const paris: LngLat = [2.3522, 48.8566]
  assert.deepEqual(fromMap(paris), paris)
  assert.deepEqual(toMap(paris), paris)
})

test("地址：路名门牌、市、区、省照 placemark；直辖市的省填市名；没有路名门牌时取一行地址的第一段", () => {
  assert.deepEqual(placeAddress(place("甲", CENTER, { street: "龙华中路 1 号", address: "龙华中路 1 号, 上海市, 中国", district: "徐汇区" })),
    { address: "龙华中路 1 号", province: "上海市", city: "上海市", district: "徐汇区" })
  assert.deepEqual(placeAddress(place("乙", CENTER, { street: "中山路 8 号", address: "中山路 8 号, 南京市, 江苏省, 中国", province: "江苏省", city: "南京市", district: "鼓楼区" })),
    { address: "中山路 8 号", province: "江苏省", city: "南京市", district: "鼓楼区" })
  assert.deepEqual(placeAddress(place("丙", CENTER, { street: null, address: "示例路 9 号, 上海市, 中国", district: "浦东新区" })),
    { address: "示例路 9 号", province: "上海市", city: "上海市", district: "浦东新区" })
  assert.deepEqual(placeAddress(place("丁", CENTER, { street: null, address: null, district: null })), { address: "", province: "上海市", city: "上海市", district: "" })
})

test("按距离筛和排；不给中心时按系统地图的顺序", () => {
  const list = [place("远", offset(CENTER, 2000, 0)), place("近", offset(CENTER, 100, 0)), place("中", offset(CENTER, 0, 800))]
  assert.deepEqual(placesNear(list, CENTER, 1500).map(h => h.place.name), ["近", "中"])
  assert.ok(Math.abs((placesNear(list, CENTER, 1500)[0].dist as number) - 100) < 1)
  assert.deepEqual(placesNear(list, null, null).map(h => h.place.name), ["远", "近", "中"])
})

test("几次搜索合起来：位置和名称都相同的算一个；同一个位置不同名称的都留下", () => {
  const a = place("示例修理厂", offset(CENTER, 100, 0))
  const b = place("示例洗车", offset(CENTER, 100, 0))
  assert.deepEqual(mergePlaces([[a], [{ ...a }, b]]).map(p => p.name), ["示例修理厂", "示例洗车"])
})

test("几个关键字同时搜：一部分出错时用搜到的；都出错时报第一个错误", async () => {
  const ok = await locateAll(async q => (q.query === "坏" ? Promise.reject(new Error("没网")) : [place(q.query, CENTER)]), [
    { query: "好", center: null, radiusM: null, gasStation: false }, { query: "坏", center: null, radiusM: null, gasStation: false },
  ])
  assert.deepEqual(ok.map(p => p.name), ["好"])
  await assert.rejects(locateAll(async () => { throw new Error("没网") }, [{ query: "甲", center: null, radiusM: null, gasStation: false }]), /没网/)
})

test("加油站：关键字「加油站」、只要加油站、区域中心换成 GCJ-02；结果换成 WGS-84，留半径内的，按距离排", async () => {
  const queries: MapQuery[] = []
  const locate = async (q: MapQuery) => {
    queries.push(q)
    return [place("示例加油站（远）", offset(CENTER, 0, 300)), place("示例加油站（近）", offset(CENTER, 40, 0)), place("示例加油站（外）", offset(CENTER, 900, 0))]
  }
  const pois = await stationsNearby(locate, CENTER, 500)
  assert.deepEqual(queries[0].query, "加油站")
  assert.equal(queries[0].gasStation, true)
  assert.ok(metres(queries[0].center as LngLat, wgs84ToGcj02(CENTER)) < 0.01)
  assert.deepEqual(pois.map(p => p.name), ["示例加油站（近）", "示例加油站（远）"])
  assert.ok(metres([pois[0].lng, pois[0].lat], offset(CENTER, 40, 0)) < 1, "坐标换回 WGS-84")
  assert.equal(pois[0].city, "上海市")
  const byName = await stationsByKeyword(locate, "示例加油站", CENTER)
  assert.ok(metres(queries[1].center as LngLat, wgs84ToGcj02(CENTER)) < 0.01, "搜索框的区域中心换成 GCJ-02")
  assert.equal(queries[1].radiusM, SEARCH_HINT_M)
  assert.deepEqual(byName.map(p => p.name), ["示例加油站（远）", "示例加油站（近）", "示例加油站（外）"], "按名称搜时照系统地图的顺序，不按距离筛")
  await stationsByKeyword(locate, "示例加油站", null)
  assert.deepEqual([queries[2].center, queries[2].radiusM], [null, null], "没有中心时不给区域")
})

test("图-1、图-2：附近门店按 4 个关键字分别搜，同一家只列一次，只列 1500 m 内的，按距离排", async () => {
  const queries: string[] = []
  const repair = place("示例修理厂", offset(CENTER, 300, 0), { category: "automotiveRepair" })
  const dealer = place("示例沃尔沃 4S 店", offset(CENTER, 0, 120), { category: "automotiveDealership", phone: "+86 21 0000 0000" })
  const wash = place("示例洗车", offset(CENTER, 900, 0))
  const far = place("示例汽修（远）", offset(CENTER, 2000, 0), { category: "automotiveRepair" })
  const locate = async (q: MapQuery) => {
    queries.push(q.query)
    assert.equal(q.gasStation, false)
    return q.query === "洗车" ? [wash] : q.query === "4S店" ? [dealer] : [repair, far, dealer]
  }
  const list = await mapStoresNearby(locate, CENTER)
  assert.deepEqual(queries.sort(), [...STORE_KEYWORDS].sort())
  assert.deepEqual(list.map(s => s.name), ["示例沃尔沃 4S 店", "示例修理厂", "示例洗车"])
  assert.deepEqual(list.map(s => s.kind), ["汽车销售", "汽车维修", ""], "图-5、图-6")
  assert.equal(list[0].phone, "+86 21 0000 0000")
  assert.ok(Math.abs((list[0].distance as number) - 120) < 1)
})

test("门店的类别标签：维修、销售、租车，别的不写", () => {
  assert.equal(storeKind("automotiveRepair"), "汽车维修")
  assert.equal(storeKind("automotiveDealership"), "汽车销售")
  assert.equal(storeKind("carRental"), "租车")
  assert.equal(storeKind("store"), "")
  assert.equal(storeKind(null), "")
})

test("门店的搜索框：按输入的文字搜，区域只是提示，照系统地图的顺序，不按距离筛", async () => {
  const queries: MapQuery[] = []
  const a = place("示例 4S 店（远）", offset(CENTER, 20000, 0), { category: "automotiveDealership" })
  const b = place("示例 4S 店（近）", offset(CENTER, 500, 0))
  const list = await mapStoresByKeyword(async q => { queries.push(q); return [a, b] }, "示例 4S 店", CENTER)
  assert.deepEqual([queries[0].query, queries[0].radiusM, queries[0].gasStation], ["示例 4S 店", SEARCH_HINT_M, false])
  assert.ok(metres(queries[0].center as LngLat, wgs84ToGcj02(CENTER)) < 0.01)
  assert.deepEqual(list.map(s => s.name), ["示例 4S 店（远）", "示例 4S 店（近）"])
  assert.equal(list[0].kind, "汽车销售")
  assert.equal(list[0].distance, null)
})

test("搜索框的区域中心：手机现在的位置；取不到时用最近用过的油站；都没有时不给区域", () => {
  const st = (id: string, p: LngLat, used: number): Station =>
    ({ id, name: id, address: "", province: "", city: "", district: "", lng: p[0], lat: p[1], last_used_ts: used })
  const old = st("s1", offset(CENTER, 5000, 0), 1)
  const recent = st("s2", offset(CENTER, 0, 3000), 9)
  const here = offset(CENTER, 100, 100)
  assert.deepEqual(searchCenter(here, [old, recent]), here)
  assert.deepEqual(searchCenter(null, [old, recent]), [recent.lng, recent.lat])
  assert.equal(searchCenter(null, []), null)
})

test("图-3、图-4：同一家门店是名称相同、相距 80 m 内；连锁店的另一家、没有位置的门店都不算", () => {
  const p = offset(CENTER, 0, 0)
  const store: Store = { id: "s1", name: "示例沃尔沃", full_name: "示例沃尔沃 4S 店", address: "", phone: "", hours: "", poi_id: "", lng: p[0], lat: p[1] }
  const at = (dx: number): LngLat => offset(CENTER, dx, 0)
  assert.equal(sameStorePlace(store, { name: "示例沃尔沃 4S 店", lng: at(20)[0], lat: at(20)[1] }), true)
  assert.equal(sameStorePlace(store, { name: "示例沃尔沃 4S 店", lng: at(2000)[0], lat: at(2000)[1] }), false)
  assert.equal(sameStorePlace(store, { name: "示例洗车", lng: at(10)[0], lat: at(10)[1] }), false)
  assert.equal(sameStorePlace({ ...store, lng: null, lat: null }, { name: "示例沃尔沃 4S 店", lng: p[0], lat: p[1] }), false)
})
