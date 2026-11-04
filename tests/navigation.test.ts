// 导航到一个地点（docs/specs/2026-11-04-presets-and-cards.md 7.3 节，D33）：菜单里的三个导航软件、路线规划的链接（坐标换成地图用的、参数全部编码）。
import { test } from "node:test"
import assert from "node:assert/strict"
import { NAV_APPS, navigationURL } from "../common/navigation"
import { wgs84ToGcj02 } from "../common/geo"

/** 上海的一个点（WGS-84）；名称里带要编码的字符 */
const SH = { name: "甲加油站 & 乙|丙", lng: 121.4737, lat: 31.2304 }

test("菜单里一直是高德地图、百度地图、苹果地图三个，这个顺序", () => {
  assert.deepEqual(NAV_APPS.map(a => a.title), ["高德地图", "百度地图", "苹果地图"])
})

test("国内的点换成 GCJ-02；三家都是驾车，起点是手机现在的位置，参数全部编码", () => {
  const [lng, lat] = wgs84ToGcj02([SH.lng, SH.lat]).map(n => n.toFixed(6))
  assert.notEqual(lat, SH.lat.toFixed(6), "国内要换算")
  const name = encodeURIComponent(SH.name)
  assert.equal(navigationURL("amap", SH), `iosamap://path?sourceApplication=%E6%B2%B9%E8%AE%B0&dlat=${lat}&dlon=${lng}&dname=${name}&dev=0&t=0`)
  assert.equal(navigationURL("baidu", SH),
    `baidumap://map/direction?origin=%7B%7B%E6%88%91%E7%9A%84%E4%BD%8D%E7%BD%AE%7D%7D&destination=${encodeURIComponent(`latlng:${lat},${lng}|name:${SH.name}`)}`
    + "&coord_type=gcj02&mode=driving&src=ios.fuelnote.FuelNote")
  assert.equal(navigationURL("apple", SH), `https://maps.apple.com/?daddr=${lat}%2C${lng}&dirflg=d`)
  // 网址里不留没编码的 | 和空格（手机上会把整个网址再编码一次）
  for (const a of NAV_APPS) assert.doesNotMatch(navigationURL(a.app, SH), /[| ]/)
})

test("国外的点不换算", () => {
  const tokyo = { name: "東京", lng: 139.767125, lat: 35.681236 }
  assert.equal(navigationURL("apple", tokyo), "https://maps.apple.com/?daddr=35.681236%2C139.767125&dirflg=d")
})
