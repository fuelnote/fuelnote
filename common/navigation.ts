// 导航到一个地点（docs/specs/2026-11-04-presets-and-cards.md 7.3 节，D33）：长按信息卡片里带地点的一行，用高德地图、百度地图或苹果地图打开路线规划，
// 起点是手机现在的位置，驾车。三个一直显示：油记没法事先知道装了哪几个（Scripting 没有 canOpenURL），没装的打不开，不提示。
// 链接照各家公开的说明（高德 iOS 路线规划、百度 URI API、苹果 Map Links），2026-11-05 在手机上逐个试过：都直接跳到路线规划，起点、终点都对；
// 没装的 Safari.openURL 返回 false，没有弹窗。
import { toMap } from "../stations/map_search"
import { InfoPlace } from "./types"

export type NavApp = "amap" | "baidu" | "apple"

/** 菜单里的顺序和名称 */
export const NAV_APPS: ReadonlyArray<{ app: NavApp; title: string }> = [
  { app: "amap", title: "高德地图" },
  { app: "baidu", title: "百度地图" },
  { app: "apple", title: "苹果地图" },
]

/**
 * 路线规划的链接：终点按坐标（名称只给高德、百度显示），坐标换成地图用的（国内是 GCJ-02）；参数全部编码。
 * 苹果地图只给坐标：只给名称时要在地图上搜，搜不到会导航错
 */
export function navigationURL(app: NavApp, place: InfoPlace): string {
  const [lng, lat] = toMap([place.lng, place.lat]).map(n => n.toFixed(6))
  const enc = encodeURIComponent
  if (app === "amap") return `iosamap://path?sourceApplication=${enc("油记")}&dlat=${lat}&dlon=${lng}&dname=${enc(place.name)}&dev=0&t=0`
  if (app === "baidu") {
    return `baidumap://map/direction?origin=${enc("{{我的位置}}")}&destination=${enc(`latlng:${lat},${lng}|name:${place.name}`)}&coord_type=gcj02&mode=driving&src=${enc("ios.fuelnote.FuelNote")}`
  }
  return `https://maps.apple.com/?daddr=${enc(`${lat},${lng}`)}&dirflg=d`
}
