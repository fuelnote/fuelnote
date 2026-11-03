// 养修（插件化设计 3.4–3.6 节）：油记这边只用契约的字段（docs/plugins.md 第 7 节）：表单内容、先勾的卡、找门店、保存（common/service.ts）；
// 记录的来源；费用的标题（common/expense_title.ts）。把工单整理成要记的几笔费用是数据源插件的事（D19），不在这里测。编造的数据，不联网。
import { test } from "node:test"
import assert from "node:assert/strict"
import { expenseEntries } from "../common/expense_stats"
import { autoTitle, cnNumber, entryTitle, expenseTitle, oilChangeNumbers } from "../common/expense_title"
import { findExpenseDuplicate } from "../common/form"
import { BJ_OFFSET } from "../common/format"
import { makeAppData, putExpense, putFuel } from "../common/ledger"
import { ledgerProblems, normalizeLedger } from "../common/ledger_file"
import { perkBook, perkStart, usablePerks } from "../common/perks"
import { hintUses, putServiceVisit, serviceDraft, serviceStore } from "../common/service"
import { emptyLedger, ExpenseRecord, FuelData, InsuranceYear, LedgerFile, Perk, Settlement, Store, Vehicle } from "../common/types"
import { ServiceExpense, ServiceVisit } from "../providers/types"
import { emptyXxyhState } from "../sync/xxyh/types"

/** 北京时间「2026-04-03 10:26」 */
const T = (s: string) => Date.parse(`${s.replace(" ", "T")}:00+08:00`)
const v1: Vehicle = { id: "v1", name: "示例车", default_grade: 95, created_ts: 0, xxyh_car: null, provider: { id: "example", vehicle_id: "VIN1", name: "示例" } }
const FROM = { id: "example", name: "示例" }
const app = (l: LedgerFile) => makeAppData(l, emptyXxyhState())
const perk = (p: Partial<Perk>): Perk => ({
  id: "p1", vehicle_id: "v1", name: "维修保养券", kind: "balance", total: 1300, unit: "元", end_ts: T("2027-01-06 23:59"), source: "2026 车险",
  insurance_id: "y26", origin: "insurance", raw: "", note: "", created_ts: T("2026-10-20 10:00"), ...p,
})
const year = (id: string, paid: string): InsuranceYear => ({ id, vehicle_id: "v1", policies: [], discount: 0, paid_ts: T(paid), expense_id: null, remark: "" })


// ---------- 油记这边：表单内容（3.4 节，养-1～养-3） ----------

const settle = (own: number): Settlement => ({ lines: [{ label: "原价", amount: own }], note: "", coupons: [] })
const cexp = (p: Partial<ServiceExpense>): ServiceExpense => ({
  ts: T("2026-04-03 10:26"), title: "补漆 · 后保", remark: "划痕补漆X2", own: 300, maintenance: null, settlement: settle(300), perk_hints: [], ...p,
})
const MAINT = cexp({
  title: "保养 · 机油 0W20、机油滤清器等", remark: "检查空调不制冷", own: 380, settlement: settle(380),
  maintenance: { items: [{ name: "机油 0W20", from: "原厂基础保养" }, { name: "机油滤清器", from: "原厂基础保养" }, { name: "火花塞", from: "更换火花塞" }], notes: ["检查空调不制冷"] },
})
const cvisit = (p: Partial<ServiceVisit>): ServiceVisit => ({
  id: "visit-1", arrive_ts: T("2026-04-03 10:26"), odometer: 79471, title: "保养 · 补漆",
  dealer: { name: "示例汽车销售服务有限公司", short: "示例汽车", lng: 121.4, lat: 31.2 },
  expenses: [MAINT, cexp({ ts: T("2026-04-03 12:30") }), cexp({ ts: T("2026-04-03 15:55"), title: "补漆 · 左前门", remark: "划痕补漆赠送X1", own: 0, settlement: settle(0) })], ...p,
})
const STORE = (p: Partial<Store>): Store => ({ id: "s1", name: "示例汽车", full_name: "示例汽车销售服务有限公司", address: "", phone: "", hours: "", poi_id: "", lng: 121.4, lat: 31.2, ...p })
const emptyBook = perkBook(emptyLedger())

test("养-1～养-3、题-5：第一笔填进表单（带保养记录：到店里程、项目、说明；换了机油标题空着），其余各另记一笔（标题是数据源给的）；自付 0 的实付填 0，其余空着", () => {
  const d = serviceDraft([], emptyBook, "v1", FROM, cvisit({}))
  assert.deepEqual([d.from, d.main.odometer, d.main.items.map(i => i.name), d.main.notes, d.main.title, d.main.amount, d.main.source.remark],
    [FROM, 79471, ["机油 0W20", "机油滤清器", "火花塞"], ["检查空调不制冷"], "", null, "检查空调不制冷"])
  assert.deepEqual(d.others.map(o => [o.title, o.amount, o.source.ts]), [["补漆 · 后保", null, T("2026-04-03 12:30")], ["补漆 · 左前门", 0, T("2026-04-03 15:55")]])
  // 养-2：第一笔不带保养记录：没有里程和项目，标题照数据源
  const noMaint = serviceDraft([], emptyBook, "v1", FROM, cvisit({ expenses: [cexp({})] }))
  assert.deepEqual([noMaint.main.odometer, noMaint.main.items, noMaint.main.title, noMaint.others.length], [null, [], "补漆 · 后保", 0])
  // 没换机油的保养：标题照数据源给的
  const noOil = serviceDraft([], emptyBook, "v1", FROM, cvisit({ expenses: [cexp({ ...MAINT, title: "保养 · 空调滤芯", maintenance: { items: [{ name: "空调滤芯", from: "" }], notes: [] } })] }))
  assert.equal(noOil.main.title, "保养 · 空调滤芯")
})

// ---------- 先勾的卡（养-5～养-7）、卡的有效期起 ----------

test("有效期起：车险赠送从那一年保险的购买日（当天）起；写了 start_ts 用它；其余从添加那天起。只列这一笔那天有效的卡", () => {
  const book = { perks: [perk({}), perk({ id: "p2", insurance_id: null, origin: "other", source: "购车赠送", name: "基础保养", kind: "count", total: 6, unit: "张", end_ts: null, start_ts: T("2020-01-02 00:00") }),
    perk({ id: "p3", insurance_id: null, origin: "package", source: "套餐", name: "原厂喷漆", kind: "count", total: 1, unit: "面", end_ts: null, created_ts: T("2019-11-30 20:00") })],
  uses: [], years: [year("y26", "2025-12-23 15:44")], stores: [] }
  assert.equal(perkStart(book, book.perks[0]), T("2025-12-23 00:00"))
  assert.equal(perkStart(book, book.perks[2]), T("2019-11-30 00:00"))
  const ids = (ts: number) => usablePerks(book, "v1", ts, null).map(u => u.perk.id).sort()
  assert.deepEqual(ids(T("2025-12-23 09:00")), ["p1", "p2", "p3"], "买保险那天早上的保养也能用")
  assert.deepEqual(ids(T("2025-07-03 09:00")), ["p2", "p3"], "历史的养修不列下一期的车险赠送")
  assert.deepEqual(ids(T("2019-12-01 09:00")), ["p3"])
})

test("养-5～养-7：储值的提示配那一期车险赠送的储值卡（剩余要够）；次数的提示配名字带它的次数卡；对得上的不止一张时不勾；同一张卡的剩余不重复算给几笔", () => {
  const perks = [perk({}), perk({ id: "b26", name: "基础保养", kind: "count", total: 1, unit: "次" }), perk({ id: "o26", name: "油漆面", kind: "count", total: 3, unit: "面" })]
  const book = { perks, uses: [], years: [year("y26", "2025-12-23 15:44")], stores: [] }
  const ts = T("2026-04-03 10:26")
  assert.deepEqual(hintUses(book, "v1", ts, [{ kind: "count", name: "基础保养", used: 1 }, { kind: "balance", origin: "insurance", amount: 1297 }]),
    [{ perk_id: "b26", used: 1, deduct: 0 }, { perk_id: "p1", used: 1297, deduct: 1297 }], "养-5")
  assert.deepEqual(hintUses(book, "v1", ts, [{ kind: "balance", origin: "insurance", amount: 3000 }, { kind: "count", name: "油漆面", used: 3 }]),
    [{ perk_id: "o26", used: 3, deduct: 0 }], "储值卡剩 1300 不够 3000，不勾")
  const two = { ...book, perks: [...perks, perk({ id: "o26b", name: "驾乘险油漆面", kind: "count", total: 2, unit: "面" })] }
  assert.deepEqual(hintUses(two, "v1", ts, [{ kind: "count", name: "油漆面", used: 2 }]), [], "养-6：两张油漆面卡都够，不勾")
  assert.deepEqual(hintUses(book, "v1", T("2025-07-03 09:00"), [{ kind: "balance", origin: "insurance", amount: 100 }]), [], "那一期还没有车险赠送的卡")
  // 养-7：两笔都提示基础保养 1 次，那一期的卡只剩 1 次：只勾给第一笔
  const ledger: LedgerFile = { ...emptyLedger(), vehicles: [v1], insurance: [year("y26", "2025-12-23 15:44")], perks }
  const hint = [{ kind: "count" as const, name: "基础保养", used: 1 }]
  const d = serviceDraft([], perkBook(ledger), "v1", FROM, cvisit({ expenses: [cexp({ perk_hints: hint }), cexp({ ts: T("2026-04-03 12:00"), perk_hints: hint })] }))
  assert.deepEqual([d.main.uses, d.others[0].uses], [[{ perk_id: "b26", used: 1, deduct: 0 }], []])
})

// ---------- 找门店（养-8～养-10） ----------

test("养-8～养-10：我的门店里名称等于经销商简称或全称的；没有时经销商 300 m 内最近的一家；都没有时空着，「附近」按经销商的位置", () => {
  const dealer = cvisit({}).dealer
  const east = (m: number) => 121.4 + m / (111320 * Math.cos((31.2 * Math.PI) / 180))
  assert.equal(serviceStore([STORE({ id: "a", name: "别的", full_name: "", lng: east(50) }), STORE({ id: "b", name: "我的店" })], dealer)?.id, "b", "养-8：全称相同")
  assert.equal(serviceStore([STORE({ id: "c", name: "示例汽车", full_name: "", lng: 0, lat: 0 })], dealer)?.id, "c", "简称相同")
  assert.equal(serviceStore([STORE({ id: "far", name: "甲", full_name: "", lng: east(260) }), STORE({ id: "near", name: "乙", full_name: "", lng: east(120) })], dealer)?.id, "near", "养-9")
  assert.equal(serviceStore([STORE({ name: "远处", full_name: "", lng: east(400) })], dealer), null, "养-10")
  assert.equal(serviceStore([STORE({})], null), null)
  const d = serviceDraft([STORE({ name: "远处", full_name: "", lng: east(400) })], emptyBook, "v1", FROM, cvisit({}))
  assert.deepEqual([d.store, d.dealerPoint], [null, [121.4, 31.2]])
})

// ---------- 保存（养-11～养-14、源-3） ----------

/** 记下 cvisit 那次：这一笔带保养记录，另记的第一笔打开（用了油漆面），第二笔关掉 */
function saveVisit(ledger: LedgerFile, store: Store | null) {
  const d = serviceDraft(ledger.stores, perkBook(ledger), "v1", FROM, cvisit({}))
  const main = d.main.source
  const other = d.others[0].source
  return putServiceVisit(app(ledger), v1, {
    from: d.from,
    main: { expense: { ts: main.ts, category_id: 100001, amount: 380, remark: main.remark, title: d.main.title }, uses: [], store,
      maintenance: { odometer: 79471, items: d.main.items.map(i => i.name), remark: main.remark }, settlement: main.settlement },
    others: [{ expense: { ts: other.ts, category_id: 100001, amount: 300, remark: other.remark, title: d.others[0].title }, uses: [{ perk_id: "o", used: 2, deduct: 0 }], settlement: other.settlement }],
  }).ledger
}

test("保存：这一笔和保养记录、打开的另记一笔（关掉的不记，养-12）；每一笔存下标题、结算明细、来源（源-3）；门店同这一笔，不写经销商代码；用了的权益记在各自的费用上", () => {
  const store = STORE({})
  const ledger: LedgerFile = { ...emptyLedger(), vehicles: [v1], stores: [store], perks: [perk({ id: "o", name: "油漆面", kind: "count", total: 2, unit: "面", insurance_id: null, origin: "other", end_ts: null })] }
  const l = saveVisit(ledger, store)
  const exps = l.records.filter((r): r is ExpenseRecord => r.kind === "expense")
  assert.deepEqual(exps.map(e => [e.amount, e.store_id, e.title ?? "", e.data_source, e.settlement]), [
    [380, "s1", "", FROM, settle(380)], [300, "s1", "补漆 · 后保", FROM, settle(300)]])
  assert.equal(l.records.filter(r => r.kind === "maintenance").length, 1)
  assert.deepEqual(l.perk_uses.map(u => [u.perk_id, u.used, u.expense_id]), [["o", 2, exps[1].id]])
  assert.deepEqual(l.stores, [store])
  assert.deepEqual(ledgerProblems(l), [])
  // 养-11：再选同一次进店、实付一样：每一笔都和已有的一笔对上
  const again = [{ ts: MAINT.ts, amount: 380 }, { ts: T("2026-04-03 12:30"), amount: 300 }]
  assert.deepEqual(again.map(x => findExpenseDuplicate(l.records, "v1", { ...x, category_id: 100001 })?.id), exps.map(e => e.id))
})

test("养-13、题-7、养-14：编辑记下的补漆，标题能改、清空后回到自动生成；结算明细和来源不变；改了没换机油的保养的项目，存下的标题不变；移除数据源以后照旧", () => {
  const ledger: LedgerFile = { ...emptyLedger(), vehicles: [v1], perks: [perk({ id: "o", name: "油漆面", kind: "count", total: 2, unit: "面", insurance_id: null, origin: "other", end_ts: null })] }
  const l = saveVisit(ledger, null)
  const paint = l.records.find((r): r is ExpenseRecord => r.kind === "expense" && r.amount === 300)!
  const edited = putExpense(app(l), v1, paint.id, { ts: paint.ts, category_id: 100001, amount: 300, remark: paint.remark, title: "补漆 · 后保杠" }).ledger
  const e2 = edited.records.find((r): r is ExpenseRecord => r.id === paint.id)!
  assert.deepEqual([e2.title, e2.settlement, e2.data_source], ["补漆 · 后保杠", settle(300), FROM])
  const cleared = putExpense(app(edited), v1, paint.id, { ts: paint.ts, category_id: 100001, amount: 300, remark: paint.remark, title: "" }).ledger
  const e3 = cleared.records.find((r): r is ExpenseRecord => r.id === paint.id)!
  assert.deepEqual(["title" in e3, entryTitle(new Map(), { id: e3.id, ts: e3.ts, amount: 300, category_id: 100001, expense: e3, maintenance: null }, "维修保养")], [false, "划痕补漆X2"])
  // 不传标题（例如保险那边改金额）时不动标题
  const kept = putExpense(app(edited), v1, paint.id, { ts: paint.ts, category_id: 100001, amount: 310, remark: paint.remark }).ledger
  assert.equal(kept.records.find((r): r is ExpenseRecord => r.id === paint.id)!.title, "补漆 · 后保杠")
  // 题-7：没换机油的保养存着数据源给的标题，改了项目也不变
  const noOil: LedgerFile = { ...emptyLedger(), vehicles: [v1], records: [
    { kind: "expense", id: "e9", vehicle_id: "v1", ts: 1, category_id: 100001, amount: 0, remark: "", title: "保养 · 空调滤芯", data_source: FROM },
    { kind: "maintenance", id: "m9", vehicle_id: "v1", ts: 1, odometer: 1, items: ["空调滤芯", "火花塞"], amount: 0, remark: "", expense_id: "e9" }] }
  assert.equal(expenseTitle(noOil, noOil.records[0] as ExpenseRecord, "维修保养"), "保养 · 空调滤芯")
  // 养-14：设置里没有这个数据源了，记下的照样显示
  assert.deepEqual(noOil.settings.plugins, [])
  assert.equal((noOil.records[0] as ExpenseRecord).data_source?.name, "示例")
})

// ---------- 加油的来源（源-1、源-2、源-4、源-6） ----------

test("源-1、源-2、源-4、源-6：从插件选了交易来填的加油存来源；只按停车填了里程的不存；编辑时不传来源，原来的留着", () => {
  const fuel: FuelData = { ts: T("2026-10-12 14:03"), odometer: 82912, liters: 42.68, price: 7.82, amount: 333.76, paid: 328.76, grade: 95, full: true, light_on: false, missed_before: false, station_id: null, remark: "" }
  const base: LedgerFile = { ...emptyLedger(), vehicles: [v1] }
  const picked = putFuel(app(base), v1, null, fuel, null, { id: "ejoy", name: "易捷" })
  const rec = picked.ledger.records[0]
  assert.deepEqual(rec.kind === "fuel" ? rec.data_source : null, { id: "ejoy", name: "易捷" })
  const edited = putFuel(app(picked.ledger), v1, picked.recordId!, { ...fuel, paid: 330 }, null).ledger.records[0]
  assert.deepEqual(edited.kind === "fuel" ? [edited.paid, edited.data_source] : null, [330, { id: "ejoy", name: "易捷" }])
  const screenshot = putFuel(app(base), v1, null, fuel, null).ledger.records[0]
  assert.equal("data_source" in screenshot, false)
})

// ---------- 费用的标题（3.6 节，题-1～题-8） ----------

test("费用页的标题：填了标题就用填的（题-6）；空着时换了机油的保养按时间数第几次（只换机油滤清器不算，题-2）；其他保养写说明的第一行，没有说明写项目（题-3）；其余写备注的第一行（题-1），都没有时写类别名（题-4）", () => {
  const m = (id: string, ts: string, items: string[], remark: string, expense?: string) =>
    ({ kind: "maintenance" as const, id, vehicle_id: "v1", ts: T(ts), odometer: 1, items, amount: 0, remark, ...(expense ? { expense_id: expense } : {}) })
  const e = (id: string, ts: string, remark: string, extra: Partial<ExpenseRecord> = {}) =>
    ({ kind: "expense" as const, id, vehicle_id: "v1", ts: T(ts), category_id: 100001, amount: 0, remark, ...extra })
  const l: LedgerFile = { ...emptyLedger(), vehicles: [v1], records: [
    m("m1", "2020-07-17 10:00", ["机油", "机油滤清器"], "第一次保养"),
    m("m2", "2021-01-12 10:00", ["机油 5W30", "机油滤清器"], ""),
    m("m3", "2021-12-08 10:00", ["换轮胎"], "示例轮胎 前轮*2"),
    m("m4", "2022-11-25 10:00", ["空调滤芯", "雨刮片"], ""),
    e("e1", "2022-12-01 10:00", "\n精洗\n示例洗车店"),
    e("e2", "2022-12-02 10:00", ""),
    e("e3", "2023-03-01 10:00", "", { title: "年度保养" }),
    m("m5", "2023-03-01 10:00", ["机油 0W20", "机油滤清器"], "", "e3"),
    e("e4", "2024-10-11 15:55", "划痕补漆续保赠送X2", { title: "补漆 · 前保、后保" }),
  ] }
  const numbers = oilChangeNumbers(l, "v1")
  assert.deepEqual(expenseEntries(l.records).map(x => entryTitle(numbers, x, "维修保养")), [
    "补漆 · 前保、后保", "年度保养", "维修保养", "精洗", "空调滤芯、雨刮片", "示例轮胎 前轮*2", "第二次保养", "第一次保养",
  ])
  assert.equal(numbers.get("m5"), 3, "填了标题的保养照样算进第几次")
  assert.deepEqual([1, 9, 10, 12, 20, 35, 100].map(cnNumber), ["一", "九", "十", "十二", "二十", "三十五", "100"])
})

test("表单里的灰字（题-1～题-5、题-8）：按表单现在的内容算，和保存以后费用页写的一样；新记的换了机油的保养按时间排进去数第几次", () => {
  const m = (id: string, ts: string, items: string[]) => ({ kind: "maintenance" as const, id, vehicle_id: "v1", ts: T(ts), odometer: 1, items, amount: 0, remark: "" })
  const l: LedgerFile = { ...emptyLedger(), vehicles: [v1], records: [m("m1", "2020-07-17 10:00", ["机油"]), m("m2", "2023-01-12 10:00", ["机油 5W30"])] }
  const f = (p: Partial<Parameters<typeof autoTitle>[1]>) => autoTitle(l, { vehicleId: "v1", maintenanceId: null, ts: T("2022-05-01 10:00"), items: [], remark: "", category: "维修保养", ...p })
  assert.equal(f({ items: ["机油 0W20", "机油滤清器"] }), "第二次保养", "排在两次之间")
  assert.equal(f({ items: ["机油 0W20"], ts: T("2024-01-01 10:00") }), "第三次保养")
  assert.equal(f({ items: ["机油"], maintenanceId: "m2", ts: T("2023-01-12 10:00") }), "第二次保养", "编辑时不和自己比")
  assert.equal(f({ items: ["空调滤芯", "雨刮片"] }), "空调滤芯、雨刮片")
  assert.equal(f({ items: ["空调滤芯"], remark: "顺便检查\n第二行" }), "顺便检查")
  assert.equal(f({ remark: "精洗" }), "精洗")
  assert.equal(f({ category: "行车费" }), "行车费")
})

// ---------- 读账本（2.3 新加的字段） ----------

test("读账本时校验 2.3 新加的字段：类型不对的标题、结算明细、来源去掉，空的标题不留；2.2 的 service_records 原样留着不用", () => {
  const good = { kind: "expense", id: "e1", vehicle_id: "v1", ts: 1, category_id: 100001, amount: 0, remark: "", title: "补漆", settlement: settle(0), data_source: FROM }
  const bad = { kind: "expense", id: "e2", vehicle_id: "v1", ts: 1, category_id: 100001, amount: 0, remark: "", title: "  ", settlement: { lines: [{ label: "原价" }] }, data_source: { name: "示例" } }
  const fuel = { kind: "fuel", id: "f1", vehicle_id: "v1", ts: 1, data_source: "易捷" }
  const n = normalizeLedger({ ...emptyLedger(), vehicles: [v1], records: [good, bad, fuel], service_records: [{ order_id: "X" }] } as unknown as Record<string, unknown>)
  assert.deepEqual(n.records[0], good)
  assert.deepEqual(["title" in n.records[1], "settlement" in n.records[1], "data_source" in n.records[1], "data_source" in n.records[2]], [false, false, false, false])
  assert.deepEqual((n as unknown as { service_records: unknown }).service_records, [{ order_id: "X" }])
  assert.deepEqual(ledgerProblems(n), [])
})
