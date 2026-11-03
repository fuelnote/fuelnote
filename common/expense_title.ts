// 费用的标题（插件化设计 3.6 节，纯函数）：填了标题就用填的；空着时自动生成：换了机油的保养「第 N 次保养」，其他带保养记录的写说明的第一行
// （没有说明时写项目），其余写备注的第一行，都没有时写类别名。这是 2.2 自己记的费用的规则。费用页、权益详情的使用记录、表单里的灰字都用它。
// 只导入类型：用不着为了类型加载费用统计这个大模块
import type { ExpenseEntry } from "./expense_stats"
import { ExpenseRecord, LedgerFile, MaintenanceRecord } from "./types"

/** 换了机油的保养：项目里有「机油」或「机油 <标号>」（机油滤清器不算） */
export const isOilChange = (items: string[]) => items.some(i => /^机油(\s|$)/.test(i))

const DIGITS = "零一二三四五六七八九"

/** 1–99 写成中文（「九」「十二」「三十五」），其余照写数字 */
export function cnNumber(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) return String(n)
  if (n < 10) return DIGITS[n]
  const tens = Math.floor(n / 10)
  return `${tens > 1 ? DIGITS[tens] : ""}十${n % 10 ? DIGITS[n % 10] : ""}`
}

function oilChanges(ledger: LedgerFile, vehicleId: string): MaintenanceRecord[] {
  return ledger.records
    .filter((r): r is MaintenanceRecord => r.kind === "maintenance" && r.vehicle_id === vehicleId && isOilChange(r.items))
    .sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id))
}

/** 这辆车换了机油的保养按时间编号：保养记录 id → 第几次 */
export function oilChangeNumbers(ledger: LedgerFile, vehicleId: string): Map<string, number> {
  return new Map(oilChanges(ledger, vehicleId).map((r, i) => [r.id, i + 1]))
}

const firstLine = (s: string) => s.split("\n").map(l => l.trim()).find(Boolean) ?? ""

/** 费用页一行的标题；numbers 是 oilChangeNumbers */
export function entryTitle(numbers: Map<string, number>, e: ExpenseEntry, category: string): string {
  const title = e.expense?.title?.trim()
  if (title) return title
  const m = e.maintenance
  const n = m ? numbers.get(m.id) : undefined
  if (n) return `第${cnNumber(n)}次保养`
  if (m) return firstLine(m.remark) || m.items.join("、") || category
  return firstLine(e.expense?.remark ?? "") || category
}

/** 一笔费用在费用页的标题（权益详情的使用记录用）：带保养记录的和费用页一样合成一行算 */
export function expenseTitle(ledger: LedgerFile, e: ExpenseRecord, category: string): string {
  const m = ledger.records.find((r): r is MaintenanceRecord => r.kind === "maintenance" && r.expense_id === e.id) ?? null
  const entry: ExpenseEntry = { id: e.id, ts: e.ts, amount: e.amount, category_id: e.category_id, expense: e, maintenance: m }
  return entryTitle(oilChangeNumbers(ledger, e.vehicle_id), entry, category)
}

/**
 * 表单里标题空着时的灰字：按表单现在的内容算，和保存以后费用页写的一样。
 * items 是要另存保养记录的项目（不存保养记录时为空）；maintenanceId 是编辑时这笔费用原来的保养记录，新记时 null
 */
export function autoTitle(ledger: LedgerFile, f: { vehicleId: string; maintenanceId: string | null; ts: number; items: string[]; remark: string; category: string }): string {
  if (f.items.length && isOilChange(f.items)) {
    const self = f.maintenanceId
    const before = oilChanges(ledger, f.vehicleId).filter(r => r.id !== self && (r.ts < f.ts || (r.ts === f.ts && !!self && r.id.localeCompare(self) < 0)))
    return `第${cnNumber(before.length + 1)}次保养`
  }
  if (f.items.length) return firstLine(f.remark) || f.items.join("、") || f.category
  return firstLine(f.remark) || f.category
}
