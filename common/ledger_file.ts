// 账本文件（ledger2.json）的纯逻辑：读进来时补齐字段、检查所有引用都找得到。读账本、恢复备份、测试共用（2.0 设计第 3 节）。
import { DEFAULT_EXPENSE_CATEGORIES, defaultSettings, LedgerFile, Settlement, Settings } from "./types"
import { normalizePresets } from "./widget_layout"

/** 2.0 的账本：车辆和记录必须在（缺了不当作空的，免得恢复出一个空账本）；其余的列表读进来时补齐 */
export function isLedgerV2(raw: unknown): boolean {
  const l = raw as { schema_version?: unknown; vehicles?: unknown; records?: unknown } | null
  return !!l && typeof l === "object" && l.schema_version === 2 && Array.isArray(l.vehicles) && Array.isArray(l.records)
}

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

const isText = (v: unknown): v is string => typeof v === "string"
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

function validSource(v: unknown): boolean {
  const s = v as { id?: unknown; name?: unknown } | null
  return !!s && typeof s === "object" && isText(s.id) && !!s.id && isText(s.name)
}

function validSettlement(v: unknown): boolean {
  const s = v as Settlement | null
  return !!s && typeof s === "object" && isText(s.note)
    && Array.isArray(s.lines) && s.lines.every(x => !!x && isText(x.label) && isNum(x.amount))
    && Array.isArray(s.coupons) && s.coupons.every(x => !!x && isText(x.name) && (x.amount === null || isNum(x.amount)))
}

/** 2.3 记录上新加的字段（插件化设计 3.4–3.6 节）：类型不对的去掉，空的标题不留 */
function cleanRecord(r: Record<string, unknown>): Record<string, unknown> {
  const out = { ...r }
  if ("title" in out && !(isText(out.title) && out.title.trim())) delete out.title
  if ("settlement" in out && !validSettlement(out.settlement)) delete out.settlement
  if ("data_source" in out && !validSource(out.data_source)) delete out.data_source
  return out
}

/**
 * 补齐以后版本新加的字段；不认识的字段原样保留（从 2.1 回退到 2.0 时不丢东西；没装过 2.3.0-beta.2 的账本里，2.2 的 service_records 和门店的经销商代码留着不用）
 */
export function normalizeLedger(raw: Record<string, unknown>): LedgerFile {
  const l = { ...raw } as Record<string, unknown>
  l.schema_version = 2
  for (const k of ["vehicles", "records", "stations", "insurance", "stores", "perks", "perk_uses"]) l[k] = arr(l[k])
  l.records = arr<Record<string, unknown>>(l.records).map(cleanRecord)
  // 2.1 门店新加的字段
  l.stores = arr<Record<string, unknown>>(l.stores).map(s => ({ hours: "", poi_id: "", ...s }))
  const cats = arr<LedgerFile["expense_categories"][number]>(l.expense_categories)
  l.expense_categories = cats.length ? cats : DEFAULT_EXPENSE_CATEGORIES.map(c => ({ ...c }))
  const settings = { ...defaultSettings(), ...((l.settings as Partial<Settings>) || {}) } as Settings & Record<string, unknown>
  settings.plugins = arr(settings.plugins)
  // 2.5 小组件方案：丢掉不认识的格子和内容（小组件方案设计第 5 节）；没存过方案时不补，账本照原样
  if (settings.widget_presets !== undefined) settings.widget_presets = normalizePresets(settings.widget_presets)
  // 2.3 去掉了记录页的加油停车提示（插件化设计 D2），点过「×」的记录不再用
  delete settings.dismissed_stops
  l.settings = settings
  return l as unknown as LedgerFile
}

/** 所有引用都找得到：车辆、油站、门店、费用、权益卡；记录 id 不重复。返回问题的说明，没有问题时是空数组 */
export function ledgerProblems(l: LedgerFile): string[] {
  const out: string[] = []
  const vehicles = new Set(l.vehicles.map(v => v.id))
  const stations = new Set(l.stations.map(s => s.id))
  const stores = new Set(l.stores.map(s => s.id))
  const perks = new Set(l.perks.map(p => p.id))
  const expenses = new Set(l.records.filter(r => r.kind === "expense").map(r => r.id))
  const seen = new Set<string>()
  for (const r of l.records) {
    if (seen.has(r.id)) out.push(`记录 ${r.id} 重复`)
    seen.add(r.id)
    if (!vehicles.has(r.vehicle_id)) out.push(`记录 ${r.id} 的车辆不存在`)
    if (r.kind === "fuel" && r.station_id && !stations.has(r.station_id)) out.push(`加油记录 ${r.id} 的油站不在油站列表里`)
    if (r.kind === "expense" && r.store_id && !stores.has(r.store_id)) out.push(`费用 ${r.id} 的门店不在门店列表里`)
    if (r.kind === "maintenance" && r.expense_id && !expenses.has(r.expense_id)) out.push(`保养记录 ${r.id} 对应的费用不存在`)
  }
  for (const y of l.insurance) {
    if (!vehicles.has(y.vehicle_id)) out.push(`保险 ${y.id} 的车辆不存在`)
    if (y.expense_id && !expenses.has(y.expense_id)) out.push(`保险 ${y.id} 对应的费用不存在`)
  }
  for (const p of l.perks) {
    if (!vehicles.has(p.vehicle_id)) out.push(`权益 ${p.id} 的车辆不存在`)
    if (p.store_id && !stores.has(p.store_id)) out.push(`权益 ${p.id} 的门店不在门店列表里`)
  }
  for (const u of l.perk_uses) {
    if (!perks.has(u.perk_id)) out.push(`使用记录 ${u.id} 的权益不存在`)
    if (u.expense_id && !expenses.has(u.expense_id)) out.push(`使用记录 ${u.id} 对应的费用不存在`)
  }
  return out
}
