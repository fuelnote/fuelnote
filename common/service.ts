// 从数据源的养修记费用（插件化设计 3.4 节，纯函数）：按数据源给的一次进店整理表单（这一笔、另记一笔、实付的默认值、标题），按权益提示先勾卡（养-5～养-7），
// 找门店（养-8～养-10），保存（每一笔存标题、结算明细和对照、来源；不存进店和工单的编号）。只用契约的字段，油记不认识工单；读懂工单的规则在数据源里（D19）。
import { isOilChange } from "./expense_title"
import { metres } from "./geo"
import { AppData, Change } from "./ledger"
import { MaintenanceInput, putMaintenance } from "./maintenance"
import { putExpenseWithPerks } from "./perk_ledger"
import { deductOf, PerkBook, usablePerks, Use } from "./perks"
import { normalizeName } from "./stores"
import { DataSourceMark, ExpenseData, ExpenseRecord, Settlement, Store, Vehicle } from "./types"
import type { PerkHint, ServiceExpense, ServiceVisit } from "../providers/types"

const round2 = (n: number) => Math.round(n * 100) / 100
const NEAR_DEALER_M = 300

/** 实付的默认值：自付为 0 时 0，否则空着（null，必须填） */
export const defaultPaid = (own: number): number | null => (own === 0 ? 0 : null)

/**
 * 按权益提示先勾的卡：在这一笔的时间有效、还有剩余的卡里找，对得上的正好一张时勾上。储值的提示找那一期车险赠送的储值卡，剩余不少于金额；
 * 次数的提示找名字带提示名称的次数卡，剩余不少于次数。taken 是已经勾给前面几笔的用量：同一张卡的剩余不重复算给几笔
 */
export function hintUses(book: PerkBook, vehicleId: string, ts: number, hints: PerkHint[], taken: Map<string, number> = new Map()): Use[] {
  const usable = usablePerks(book, vehicleId, ts, null)
  const out: Use[] = []
  const free = (id: string, left: number) => left - (taken.get(id) ?? 0) - out.filter(u => u.perk_id === id).reduce((t, u) => t + u.used, 0)
  for (const h of hints) {
    const used = h.kind === "balance" ? h.amount : h.used
    const cands = usable.filter(u => (h.kind === "balance"
      ? u.perk.kind === "balance" && u.perk.origin === h.origin
      : u.perk.kind === "count" && u.perk.name.includes(h.name)) && free(u.perk.id, u.left) >= used)
    if (cands.length !== 1) continue
    const p = cands[0].perk
    const had = out.find(u => u.perk_id === p.id)
    if (had) { had.used = round2(had.used + used); had.deduct = deductOf(p, had.used) }
    else out.push({ perk_id: p.id, used, deduct: deductOf(p, used) })
  }
  for (const u of out) taken.set(u.perk_id, (taken.get(u.perk_id) ?? 0) + u.used)
  return out
}

/** 门店：我的门店里名称等于经销商简称或全称的；没有时找经销商 300 m 内最近的一家；都没有时 null */
export function serviceStore(stores: Store[], dealer: ServiceVisit["dealer"]): Store | null {
  if (!dealer) return null
  const names = [dealer.short, dealer.name].filter((x): x is string => !!x).map(normalizeName)
  const byName = stores.find(s => names.includes(normalizeName(s.name)) || (!!s.full_name && names.includes(normalizeName(s.full_name))))
  if (byName) return byName
  if (dealer.lng == null || dealer.lat == null) return null
  const at: [number, number] = [dealer.lng, dealer.lat]
  const near = stores
    .flatMap(s => (s.lng != null && s.lat != null ? [{ s, d: metres([s.lng, s.lat], at) }] : []))
    .filter(x => x.d <= NEAR_DEALER_M)
    .sort((a, b) => a.d - b.d)
  return near.length ? near[0].s : null
}

/** 表单里的一笔：数据源给的这一笔，和填进表单的初始值 */
export type DraftExpense = {
  source: ServiceExpense
  /** 标题：换了机油的保养空着（费用页自动写第 N 次保养），其余是数据源给的 */
  title: string
  /** 实付：自付为 0 时 0，否则空着（必须填） */
  amount: number | null
  /** 按权益提示先勾好的卡 */
  uses: Use[]
}

export type ServiceDraft = {
  /** 数据源的 id 和名称：保存时写成来源 */
  from: DataSourceMark
  visit: ServiceVisit
  /** 这一笔：带保养记录时，里程是到店里程，项目和写进说明的检查、问题用数据源整理好的 */
  main: DraftExpense & { odometer: number | null; items: Array<{ name: string; from: string }>; notes: string[] }
  /** 另记一笔：时间、标题、备注用数据源给的 */
  others: DraftExpense[]
  /** 按经销商的名称或位置找到的门店 */
  store: Store | null
  /** 经销商的位置（WGS-84）：没找到门店时，选择门店的「附近」按它 */
  dealerPoint: [number, number] | null
}

/** 选中一次进店：第一笔填进表单，其余各另记一笔；先勾的卡按顺序算，同一张卡不重复算 */
export function serviceDraft(stores: Store[], book: PerkBook, vehicleId: string, from: DataSourceMark, visit: ServiceVisit): ServiceDraft {
  const taken = new Map<string, number>()
  const one = (e: ServiceExpense): DraftExpense => ({
    source: e,
    title: e.maintenance && isOilChange(e.maintenance.items.map(i => i.name)) ? "" : e.title,
    amount: defaultPaid(e.own),
    uses: hintUses(book, vehicleId, e.ts, e.perk_hints, taken),
  })
  const [first, ...rest] = visit.expenses
  const main = one(first)
  const others = rest.map(one)
  const m = first.maintenance
  const d = visit.dealer
  return {
    from, visit,
    main: { ...main, odometer: m ? visit.odometer : null, items: m ? m.items : [], notes: m ? m.notes : [] },
    others,
    store: serviceStore(stores, d),
    dealerPoint: d && d.lng != null && d.lat != null ? [d.lng, d.lat] : null,
  }
}

/** 保存一次进店：这一笔和打开的另记一笔（关掉的不传），每一笔带着结算明细 */
export type ServiceSave = {
  from: DataSourceMark
  main: { expense: ExpenseData; uses: Use[]; store: Store | null; maintenance: MaintenanceInput | null; settlement: Settlement }
  others: Array<{ expense: ExpenseData; uses: Use[]; settlement: Settlement }>
}

/**
 * 记下一次进店：这一笔（带保养记录的再写一条保养记录）和打开的另记一笔，门店同这一笔，用了的权益记在各自的费用上；
 * 每一笔存下标题、结算明细和对照、来源
 */
export function putServiceVisit(data: AppData, vehicle: Vehicle, input: ServiceSave): Change {
  const meta = (settlement: Settlement) => ({ settlement, data_source: input.from })
  const c = putExpenseWithPerks(data, vehicle, null, input.main.expense, { uses: input.main.uses, store: input.main.store, meta: meta(input.main.settlement) })
  const mainId = c.recordId as string
  let ledger = putMaintenance(c.ledger, mainId, input.main.maintenance)
  const storeId = (ledger.records.find(r => r.id === mainId) as ExpenseRecord | undefined)?.store_id ?? null
  const store = storeId ? ledger.stores.find(s => s.id === storeId) ?? null : null
  for (const o of input.others) {
    ledger = putExpenseWithPerks({ ...data, ledger }, vehicle, null, o.expense, { uses: o.uses, store, meta: meta(o.settlement) }).ledger
  }
  return { ledger, recordId: mainId }
}
