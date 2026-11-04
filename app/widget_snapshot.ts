// 小组件的摘要（widget.json）：App 每次改动、读到车况后重写，小组件只读这个小文件（设计文档 18.2 节）
import { consumptionById } from "../common/fuel"
import { monthFuelCost, summarize, yearSummaries } from "../common/fuel_stats"
import { AppData, currentVehicle, fuelRecords, stationsFor } from "../common/ledger"
import { monthKey } from "../common/time"
import { WidgetSnapshot } from "../common/widget_data"
import { saveWidgetFile } from "../platform/storage"
import { sourceOf } from "./data_sources"
import { widgetFillPrice } from "./fuel_price"
import { widgetInfo } from "./info_cards"
import { hasStatusSource, statusSource, stopsKey, vehicleTank } from "./vehicle_data"

/** 摘要的内容（FuelNote Check 用它在 App 里画小组件） */
export function buildWidgetSnapshot(data: AppData, now = Date.now()): WidgetSnapshot {
  const v = currentVehicle(data)
  // 小组件属于油耗（设计文档 21.3 节）：只读加油记录，花费只算加油
  const fills = v ? fuelRecords(data, v) : []
  const sum = v ? summarize(fills, "all", now) : null
  const d = new Date(now)
  // 小组件可能刚写进更新的车况，以文件为准
  const st = v && hasStatusSource(data, v) ? statusSource.latest(stopsKey(v)) : null
  const source = v && hasStatusSource(data, v) ? sourceOf(data, v) : null
  // 大号「最近加油」：最近 3 次加油的油站名和油耗（设计文档 18.2 节，1.4 起）
  const consumption = consumptionById(fills)
  const stationNames = new Map((v ? stationsFor(data, v) : []).map(s => [s.id, s.name]))
  const year = yearSummaries(fills).find(y => y.year === d.getFullYear())
  return {
    schema_version: 1,
    updated_at: now,
    vehicle: v ? v.name : null,
    status_source: hasStatusSource(data, v),
    status: v && st
      ? { ts: st.status.ts, fuel_l: st.status.fuel_l, range_km: st.status.range_km, tank_l: vehicleTank(data, v), odometer_km: st.status.odometer_km, read_at: st.read_at }
      : null,
    // 小组件自己读车况用（设计文档 18.3 节第 2 步）：调关联的数据源插件；凭据在插件里，不写进文件
    status_link: v && v.provider && source
      ? { key: stopsKey(v), provider: v.provider.id, script: source.script, vehicle_id: v.provider.vehicle_id, tank_l: vehicleTank(data, v) }
      : null,
    latest_consumption: sum ? sum.latest_consumption : null,
    avg_consumption: sum ? sum.avg_consumption : null,
    last_fuel_ts: sum ? sum.last_fuel_ts : null,
    last_odometer: sum ? sum.last_odometer : null,
    last_fuel_odometer: fills.length ? fills[0].odometer : null,
    last_fuel_full: fills.length ? fills[0].full : false,
    month: monthKey(now),
    month_cost: monthFuelCost(fills, now),
    // 本月油费做大数字时下面写上月（小组件方案设计第 3 节）：这个月 1 日 0 点的前一刻属于上个月
    prev_month_cost: monthFuelCost(fills, new Date(d.getFullYear(), d.getMonth(), 1).getTime() - 1),
    year: String(d.getFullYear()),
    year_cost: year ? year.cost : 0,
    recent: fills.slice(0, 3).map(r => ({
      ts: r.ts, liters: r.liters, grade: r.grade, station: (r.station_id && stationNames.get(r.station_id)) || null, paid: r.paid,
      consumption: consumption.get(r.id) ?? null,
    })),
    // 加满金额（加满金额设计第 4 节）：小组件按自己读到的车况重算，所以只写价格
    fill_price: v ? widgetFillPrice(data, v) : null,
    // 小组件方案（小组件方案设计第 5 节）：小组件按「参数」选一套，不读账本
    presets: data.ledger.settings.widget_presets ?? [],
    // 插件的信息卡片（同一设计 7.3 节）：方案里换成卡片的两格只读这里，不调插件
    ...widgetInfo(data, now),
  }
}

export function saveWidgetSnapshot(data: AppData, now = Date.now()): void {
  const snap = buildWidgetSnapshot(data, now)
  try { saveWidgetFile(JSON.stringify(snap)) } catch { /* 小组件下次再更新 */ }
}
