// 手机现在的位置（WGS-84）：门店、油站搜索框的区域中心（插件化设计 6.1 节，D14），加满金额按哪个地区的油价（加满金额设计第 3 节）。
// Location.requestCurrent：有缓存的位置时系统立刻返回，没有时才去定位；第一次用时系统请求 Scripting 的定位权限。
import { LngLat } from "../common/geo"

/** 没有定位权限、出错时 null */
export async function currentPosition(): Promise<LngLat | null> {
  try {
    const l = await Location.requestCurrent()
    return l ? [l.longitude, l.latitude] : null
  } catch {
    return null
  }
}

/** 反查省、市（加满金额设计第 3 节）：administrativeArea 是省（直辖市是空的），locality 是市；出错、没有结果时 null */
export async function placeOf([lng, lat]: LngLat): Promise<{ province: string | null; city: string | null } | null> {
  try {
    const r = await Location.reverseGeocode({ latitude: lat, longitude: lng, locale: "zh_CN" })
    const p = r && r[0]
    return p ? { province: p.administrativeArea ?? null, city: p.locality ?? null } : null
  } catch {
    return null
  }
}
