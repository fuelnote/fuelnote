// 手机现在的位置（WGS-84）：门店、油站搜索框的区域中心（插件化设计 6.1 节，D14）。
// 只调 Location.requestCurrent：有缓存的位置时系统立刻返回，没有时才去定位；第一次用时系统请求 Scripting 的定位权限。
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
