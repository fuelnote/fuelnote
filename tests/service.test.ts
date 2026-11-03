// 养修（插件化设计 3.4–3.6、6.2 节）：沃尔沃接口返回的整理和按沃尔沃的规则整理成要记的几笔费用（providers/volvo_service.ts，D19）；
// 油记这边只用契约的字段：表单内容、先勾的卡、找门店、保存（common/service.ts）；记录的来源；费用的标题（common/expense_title.ts）；
// 2.2 记下的养修转换一次。编造的数据，不联网；车牌、券号是编的。
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
import {
  classifyLabour, convertServiceRecords, oilGrade, parseDealer, parseTicket, parseVisit, parseVisitList, perkHints, prefName, serviceVisitOf, serviceVisitsOf,
  settlementCoupons, settlementOf, ticketLabel, ticketTitle, visitTitle, volvoAliases, volvoNaming, volvoTicketItems, volvoTime, VolvoTicket, VolvoVisit,
} from "../providers/volvo_service"
import { emptyXxyhState } from "../sync/xxyh/types"

const T = (s: string) => volvoTime(s) as number
const v1: Vehicle = { id: "v1", name: "示例车", default_grade: 95, created_ts: 0, xxyh_car: null, provider: { id: "volvo_cn", vehicle_id: "VIN1", name: "示例" } }
const naming = volvoNaming([])
const FROM = { id: "volvo_cn", name: "沃尔沃" }
const app = (l: LedgerFile) => makeAppData(l, emptyXxyhState())

function ticket(p: Partial<VolvoTicket>): VolvoTicket {
  return {
    ro_no: "RO1", type: "保养", created_ts: T("2026-04-03 10:30"), settled_ts: T("2026-04-03 13:40"), projects: ["保养"], labours: [], parts: [],
    total: 0, own: 0, labour_discount: 0, discounts: [], prefs: [], rounding: 0, remark: "", ...p,
  }
}
function visit(p: Partial<VolvoVisit>): VolvoVisit {
  return {
    provider: "volvo_cn", order_id: "NR_X_1", dealer_code: "D01", arrive_ts: T("2026-04-03 10:26"), state: "已评价", settled_ts: T("2026-04-03 13:40"), odometer: 79471,
    dealer: { short: "示例汽车", name: "示例汽车销售服务有限公司", address: "示例路1号", phone: "", lng: 121.4, lat: 31.2, hours: "08:30–17:00" }, tickets: [ticket({})], ...p,
  }
}
const perk = (p: Partial<Perk>): Perk => ({
  id: "p1", vehicle_id: "v1", name: "维修保养券", kind: "balance", total: 1300, unit: "元", end_ts: T("2027-01-06 23:59"), source: "2026 车险",
  insurance_id: "y26", origin: "insurance", raw: "", note: "", created_ts: T("2026-10-20 10:00"), ...p,
})
const year = (id: string, paid: string): InsuranceYear => ({ id, vehicle_id: "v1", policies: [], discount: 0, paid_ts: T(paid), expense_id: null, remark: "" })

/** 2024/10/11 那次进店：两张补漆（事故，一张自付 0、一张续保赠送油漆券）和一张保养（人寿赠送基础保养，抹零 0.22） */
const visit1011 = () => visit({
  order_id: "NR_X_3", arrive_ts: T("2024-10-11 12:21"), settled_ts: T("2024-10-15 15:41"), odometer: 58052,
  tickets: [
    ticket({ ro_no: "RA", type: "事故", created_ts: T("2024-10-11 12:21"), projects: ["划痕补漆赠送X1"], labours: ["提供底漆照片", "喷漆：左前门"], own: 0, total: 120,
      discounts: [{ name: "上门取车", amount: 60 }, { name: "送车上门", amount: 60 }] }),
    ticket({ ro_no: "RB", type: "事故", created_ts: T("2024-10-11 15:55"), projects: ["划痕补漆续保赠送X2"], labours: ["喷漆：前保，后保", "自费左前门整形"], own: 300, total: 2300,
      prefs: [{ name: "续保赠送油漆券", type: "预付费抵扣", amount: 2000 }] }),
    ticket({ ro_no: "RC", created_ts: T("2024-10-11 15:59"), labours: ["原厂基础保养"], parts: ["沃尔沃全合成机油 0W20 208L"], own: 380, total: 1337.22,
      prefs: [{ name: "人寿电销基础保养", type: "预付费抵扣", amount: 957 }], rounding: 0.22, remark: "保养人寿赠送基础保养" }),
  ],
})

// ---------- 沃尔沃接口返回的整理 ----------

test("进店列表：时间按北京时间，新的在前；已取消的标出来；没有工单号或经销商代码的不要", () => {
  const heads = parseVisitList([
    { orderId: "A", dealerCode: "D01", reservationDate: "2024/10/11 12:21", stateName: "已评价" },
    { orderId: "B", dealerCode: "D01", reservationDate: "2026/04/03 10:26", stateName: "已取消" },
    { orderId: "", dealerCode: "D01", reservationDate: "2026/04/04 10:26", stateName: "已评价" },
  ])
  assert.deepEqual(heads.map(h => [h.order_id, h.cancelled]), [["B", true], ["A", false]])
  assert.equal(heads[1].arrive_ts, Date.UTC(2024, 9, 11, 12, 21) - BJ_OFFSET)
})

test("优惠名去掉车牌和券号（券号是 KQ 加 12 位数字）", () => {
  assert.equal(prefName("沪A12B34;优惠名称续保赠送油漆券"), "续保赠送油漆券")
  assert.equal(prefName("12B34;优惠名称销售促销"), "销售促销")
  assert.equal(prefName("KQ2025122200332026忠诚守候养修/保养套餐优惠券-200元"), "2026忠诚守候养修/保养套餐优惠券-200元")
  assert.equal(prefName("KQ20231018001223年秋冬服-55元空调滤材料费抵扣券"), "23年秋冬服-55元空调滤材料费抵扣券")
  assert.equal(prefName("沪A12B34销售赠送保养券"), "销售赠送保养券")
  assert.equal(prefName("上门取车"), "上门取车")
})

test("一张工单的结算：工时优惠、其他减免（不和券重复）、券和活动优惠、抹零按差额（可以是负数）、开单时间取委托单", () => {
  const b = {
    roNo: "RO9", repairTypeName: "保养", balanceTime: "2023-12-04 16:27:39", totalAmount: "5,049.72", ownAmount: "0.0", balanceRemark: " 建议更换小电瓶 ",
    discountList: [{ name: "上门取车", amount: "75" }, { name: "送车上门", amount: "55" }, { name: "工时：更换火花塞", amount: "10" },
      { name: "KQ20231018001223年秋冬服-55元空调滤材料费抵扣券", amount: "55" }, { name: "沪A12B34销售赠送保养券", amount: "1,337" }, { name: "沪A12B34续保赠送补漆券，代金券", amount: "3,517" }],
    roPreferentialVoList: [{ preferentialType: "优惠券", preferentialName: "KQ20231018001223年秋冬服-55元空调滤材料费抵扣券", preferentialAmount: "55.0" },
      { preferentialType: "经销商优惠", preferentialName: "沪A12B34销售赠送保养券", preferentialAmount: "1337.0" },
      { preferentialType: "经销商优惠", preferentialName: "沪A12B34续保赠送补漆券，代金券", preferentialAmount: "3517.0" },
      { preferentialType: "优惠券", preferentialName: "上门取送车抵扣券", preferentialAmount: "0.0" }],
    handRepairProjectList: [{ handRepairProjectName: "机油机滤更换保养套餐", roLabourList: [{ labourName: "工时：原厂维修保养" }, { labourName: "工时：喷漆：左前门" }],
      repairPartList: [{ partName: "材料：沃尔沃全合成机油 0W20 208L" }] }],
  }
  const t = parseTicket(b, new Map([["RO9", T("2023-12-01 11:47")]]))!
  assert.deepEqual([t.type, t.total, t.own, t.labour_discount, t.remark, t.created_ts], ["保养", 5049.72, 0, 10, "建议更换小电瓶", T("2023-12-01 11:47")])
  assert.deepEqual(t.discounts, [{ name: "上门取车", amount: 75 }, { name: "送车上门", amount: 55 }])
  assert.deepEqual(t.prefs.map(p => [p.name, p.type, p.amount]), [["23年秋冬服-55元空调滤材料费抵扣券", "优惠券", 55], ["销售赠送保养券", "经销商优惠", 1337], ["续保赠送补漆券，代金券", "经销商优惠", 3517]])
  assert.equal(t.rounding, 0.72)
  assert.deepEqual([t.labours, t.parts], [["原厂维修保养", "喷漆：左前门"], ["沃尔沃全合成机油 0W20 208L"]])
  const up = parseTicket({ roNo: "R2", repairTypeName: "机电维修", balanceTime: "2023-04-25 09:07:09", totalAmount: "1,495.43", ownAmount: "1467.0",
    discountList: [{ name: "工时：更换蒸发排放阀", amount: "28.8" }] }, new Map())!
  assert.equal(up.rounding, -0.37, "自付比原价减去优惠还多：向上取整")
  assert.equal(up.created_ts, up.settled_ts, "没有委托单时开单时间用结算时间")
})

test("一次进店：经销商坐标换成 WGS-84，到店里程取委托单最大的，最后结算时间；没结算时没有工单", () => {
  const head = { order_id: "NR_X_1", dealer_code: "D01", arrive_ts: T("2024-10-11 12:21"), state: "已评价", cancelled: false }
  const v = parseVisit(head, { dealerInfo: { companyShortNameCn: "示例汽车", companyNameCn: "示例汽车销售服务有限公司", addressZh: "示例路1号", phone: "021-0", longitude: "121.4633", latitude: "31.1903", openTime: "08:30", closeTime: "17:00" } },
    [{ roNo: "R1", roCreateDate: "2024-10-11 15:59:25", inMileage: "58052KM" }, { roNo: "R2", roCreateDate: "2024-10-11 12:21:20", inMileage: "58000KM" }],
    [{ roNo: "R1", repairTypeName: "保养", balanceTime: "2024-10-15 15:36:58", totalAmount: "100", ownAmount: "100" },
      { roNo: "R2", repairTypeName: "事故", balanceTime: "2024-10-15 15:41:31", totalAmount: "0", ownAmount: "0" }])
  assert.deepEqual([v.odometer, v.settled_ts, v.tickets.map(t => t.ro_no), v.dealer!.hours], [58052, T("2024-10-15 15:41:31"), ["R2", "R1"], "08:30–17:00"])
  assert.ok(Math.abs(v.dealer!.lng! - 121.4633) > 0.001 && Math.abs(v.dealer!.lng! - 121.4633) < 0.01, "GCJ-02 换成 WGS-84")
  assert.deepEqual([parseVisit(head, {}, [], []).tickets, parseVisit(head, {}, [], []).settled_ts, parseVisit(head, {}, [], []).dealer], [[], null, null])
  assert.equal(parseDealer({ companyNameCn: "只有全称" })!.short, "只有全称")
})

// ---------- 沃尔沃的规则：保养项目、叫法、标题 ----------

test("项目整理：不记的、写进说明的、原厂基础保养 = 机油 <标号> + 机油滤清器、去掉「更换」、斜杠取主名、服务关怀、括号照原样、去重", () => {
  const aliases = volvoAliases(["工时：更换空调滤芯/乘客室空气滤清器/花粉滤", "更换刹车油/制动液"])
  const c = (l: string, parts: string[] = []) => classifyLabour(l, parts, aliases)
  assert.deepEqual([c("提供底漆照片"), c("交运沃尔沃免费检查（价值360元）"), c("车辆健康检查工时")], [{ kind: "skip" }, { kind: "skip" }, { kind: "skip" }])
  assert.deepEqual(c("客户反映：急加速，右后有异响，请检查"), { kind: "note", text: "客户反映：急加速，右后有异响，请检查" })
  assert.deepEqual(c("工时：检查空调不制冷"), { kind: "note", text: "检查空调不制冷" })
  assert.deepEqual(c("喷漆：左前门，左后门"), { kind: "note", text: "补漆：左前门、左后门" })
  assert.deepEqual(c("原厂基础保养", ["机油滤芯", "沃尔沃全合成机油 5W30 208L"]), { kind: "items", items: ["机油 5W30", "机油滤清器"] })
  assert.deepEqual(c("原厂维修保养", ["OIL 0W/20 208L"]), { kind: "items", items: ["机油 0W20", "机油滤清器"] })
  assert.deepEqual(c("原厂基础保养", ["机油滤芯"]), { kind: "items", items: ["机油", "机油滤清器"] })
  assert.deepEqual(c("服务关怀-车内杀菌"), { kind: "items", items: ["车内杀菌"] })
  assert.deepEqual(c("更换燃油滤清器/汽滤"), { kind: "items", items: ["燃油滤清器"] })
  assert.deepEqual(c("更换乘客室空气滤清器"), { kind: "items", items: ["空调滤芯"] }, "别名按别的工单里的斜杠统一成主名")
  assert.deepEqual(c("更换制动衬片（后2个）"), { kind: "items", items: ["制动衬片（后2个）"] })
  assert.equal(oilGrade(["火花塞套件"]), "")
})

test("一张工单：只有保养工单出项目；第二行是来自哪个工时；只有基础保养的工单标出来", () => {
  const basic = ticket({ labours: ["提供底漆照片", "车辆健康检查工时", "原厂基础保养"], parts: ["OIL 0W/20 208L"] })
  assert.deepEqual(naming(basic), { items: [{ name: "机油 0W20", labour: "原厂基础保养" }, { name: "机油滤清器", labour: "原厂基础保养" }], notes: [], basic_only: true })
  const more = naming(ticket({ labours: ["检查空调不制冷", "更换火花塞", "更换火花塞", "更换燃油滤清器/汽滤"] }))
  assert.deepEqual([more.items.map(i => i.name), more.notes, more.basic_only], [["火花塞", "燃油滤清器"], ["检查空调不制冷"], false])
  assert.deepEqual(volvoTicketItems(ticket({ type: "事故", labours: ["喷漆：前保"] }), new Map()), { items: [], notes: [], basic_only: false })
})

test("进店的叫法：保养在前；补漆、维修、零售照规则；自付为 0 的保修、事故不写，全是这种时才写", () => {
  assert.equal(ticketLabel(ticket({ type: "机电维修", projects: ["划痕补漆平安电销X1"] })), "补漆")
  assert.equal(ticketLabel(ticket({ type: "零售", projects: ["其他"] })), "补漆")
  assert.equal(visitTitle(visit({ tickets: [ticket({ type: "事故", own: 300, projects: ["划痕补漆X2"] }), ticket({ type: "事故", own: 0 }), ticket({})] })), "保养 · 补漆")
  assert.equal(visitTitle(visit({ tickets: [ticket({ type: "机电维修", own: 813, projects: ["延保"] }), ticket({})] })), "保养 · 维修")
  assert.equal(visitTitle(visit({ tickets: [ticket({ type: "保修", own: 0 })] })), "保修")
})

test("另记一笔的标题：事故维修写前两个部位，补漆、钣金写部位，保修写零件，维修写换的零件；读不出时用叫法和项目名", () => {
  assert.equal(ticketTitle(ticket({ type: "事故", projects: ["划痕补漆续保赠送X3"], labours: ["提供底漆照片", "喷漆：后保，左后叶，左裙边"] })), "补漆 · 后保、左后叶、左裙边")
  assert.equal(ticketTitle(ticket({ type: "事故", projects: ["前部事故"], labours: ["前部事故拆解报价", "喷漆：前保", "单位修复：前保", "钣金更换：中网，前保支架，导风板"] })), "事故维修 · 前保、中网等")
  assert.equal(ticketTitle(ticket({ type: "机电维修", projects: ["划痕补漆整形"], labours: ["钣金：右后翼子板"] })), "钣金 · 右后翼子板")
  assert.equal(ticketTitle(ticket({ type: "机电维修", projects: ["服务延保"], labours: ["更换蒸发排放阀", "检查发动机故障灯亮", "更换蒸发器排放软管"] })), "维修 · 蒸发排放阀、蒸发器排放软管")
  assert.equal(ticketTitle(ticket({ type: "保修", projects: ["服务保修"], labours: ["Fuse replace"], parts: ["保险丝"] })), "保修 · 保险丝")
  assert.equal(ticketTitle(ticket({ type: "零售", projects: ["其他"] })), "补漆 · 其他")
})

// ---------- 沃尔沃整理成契约的进店（D19） ----------

test("D19：保养工单合成第一笔（进店时间、到店里程、项目和来自哪项工时、说明、标题「保养 · 前两个项目」）；其余每张工单一笔（开单时间、标题、备注写项目名）", () => {
  const sv = serviceVisitOf(visit1011(), naming)
  assert.deepEqual([sv.id, sv.title, sv.odometer, sv.arrive_ts, sv.dealer], ["NR_X_3", "保养 · 补漆", 58052, T("2024-10-11 12:21"), { name: "示例汽车销售服务有限公司", short: "示例汽车", lng: 121.4, lat: 31.2 }])
  const [main, ...others] = sv.expenses
  assert.deepEqual([main.ts, main.own, main.title, main.remark, main.maintenance], [T("2024-10-11 12:21"), 380, "保养 · 机油 0W20、机油滤清器", "",
    { items: [{ name: "机油 0W20", from: "原厂基础保养" }, { name: "机油滤清器", from: "原厂基础保养" }], notes: [] }])
  assert.deepEqual(others.map(o => [o.ts, o.own, o.title, o.remark, o.maintenance]), [
    [T("2024-10-11 12:21"), 0, "补漆 · 左前门", "划痕补漆赠送X1", null], [T("2024-10-11 15:55"), 300, "补漆 · 前保、后保", "划痕补漆续保赠送X2", null]])
  // 几张保养工单合成一笔：项目去重，检查写进说明（用「；」隔开），标题写前两个项目
  const two = serviceVisitOf(visit({ tickets: [ticket({ ro_no: "M1", labours: ["原厂基础保养", "检查空调不制冷"], parts: ["OIL 0W/20"], own: 0 }),
    ticket({ ro_no: "M2", labours: ["更换火花塞", "更换燃油滤清器/汽滤", "客户反映：异响"], own: 0 })] }), naming)
  assert.deepEqual([two.expenses.length, two.expenses[0].title, two.expenses[0].remark], [1, "保养 · 机油 0W20、机油滤清器等", "检查空调不制冷；客户反映：异响"])
  // 没有保养工单：第一张工单是第一笔，不带保养记录
  const none = serviceVisitOf(visit({ tickets: [ticket({ ro_no: "Z1", type: "事故", projects: ["前部事故"] }), ticket({ ro_no: "Z2", type: "零售", projects: ["划痕补漆X3"] })] }), naming)
  assert.deepEqual(none.expenses.map(e => [e.title, e.maintenance]), [["事故 · 前部事故", null], ["补漆 · 划痕补漆X3", null]])
})

test("结算明细：原价、工时优惠、其他减免、券和活动优惠、抹零，同名的行相加，加起来是自付；结算备注去掉被包含的；对照（旧工单列项目名里写的赠送）", () => {
  const a = ticket({ total: 100, own: 10, labour_discount: 5, prefs: [{ name: "续保代金券", type: "", amount: 80 }], rounding: 5, remark: "建议每8500公里保养" })
  const b = ticket({ total: 50, own: 0, prefs: [{ name: "续保代金券", type: "", amount: 50 }], remark: "建议每8500公里保养，建议更换前刹车片" })
  const s = settlementOf([a, b])
  assert.deepEqual(s.lines, [{ label: "原价", amount: 150 }, { label: "工时优惠", amount: -5 }, { label: "续保代金券", amount: -130 }, { label: "抹零", amount: -5 }])
  assert.equal(s.lines.reduce((t, l) => t + l.amount, 0), 10)
  assert.deepEqual([s.note, s.coupons], ["建议每8500公里保养，建议更换前刹车片", [{ name: "续保代金券", amount: 80 }, { name: "续保代金券", amount: 50 }]])
  assert.deepEqual(settlementOf([ticket({ total: 1495.43, own: 1467, labour_discount: 28.8, rounding: -0.37 })]).lines,
    [{ label: "原价", amount: 1495.43 }, { label: "工时优惠", amount: -28.8 }, { label: "抹零", amount: 0.37 }], "自付比原价减去优惠还多：抹零是正的")
  assert.deepEqual(settlementCoupons([ticket({ prefs: [{ name: "忠诚守候养修/保养套餐优惠券-200元", type: "", amount: 200 }] }), ticket({ projects: ["保养（44382公里）国寿赠送", "保养"] })]),
    [{ name: "忠诚守候养修/保养套餐优惠券", amount: 200 }, { name: "保养（44382公里）国寿赠送", amount: null }])
})

test("先勾卡的提示：「续保」的优惠给车险赠送的储值；只有基础保养的工单上有优惠时给基础保养 1 次；补漆 X<n> 给油漆面 n 个", () => {
  const basic = ticket({ labours: ["提供底漆照片", "原厂基础保养"], prefs: [{ name: "销售促销", type: "会员权益", amount: 1397 }] })
  const other = ticket({ ro_no: "R2", labours: ["更换火花塞"], prefs: [{ name: "2026忠诚守候养修/保养套餐优惠券-200元", type: "优惠券", amount: 200 }, { name: "续保代金券", type: "会员权益", amount: 1297 }] })
  assert.deepEqual(perkHints([basic, other], naming), [{ kind: "count", name: "基础保养", used: 1 }, { kind: "balance", origin: "insurance", amount: 1297 }])
  const paint = ticket({ type: "零售", projects: ["划痕补漆续保赠送X3"], prefs: [{ name: "续保赠送油漆面", type: "预付费抵扣", amount: 3000 }] })
  assert.deepEqual(perkHints([paint], naming), [{ kind: "balance", origin: "insurance", amount: 3000 }, { kind: "count", name: "油漆面", used: 3 }])
  assert.deepEqual(perkHints([ticket({ labours: ["原厂基础保养"] })], naming), [], "没有优惠的基础保养不提示（自己付的钱）")
})

test("读到的进店整理成契约的：只要已结算的，新的在前；项目的别名从这些进店的全部工时收集", () => {
  const older = visit({ order_id: "A", arrive_ts: T("2022-08-01 10:00"), tickets: [ticket({ labours: ["更换空调滤芯/乘客室空气滤清器"] })] })
  const newer = visit({ order_id: "B", arrive_ts: T("2025-07-03 09:00"), tickets: [ticket({ labours: ["更换乘客室空气滤清器"] })] })
  const open = visit({ order_id: "C", arrive_ts: T("2026-04-03 10:00"), tickets: [], settled_ts: null })
  const out = serviceVisitsOf([older, open, newer])
  assert.deepEqual(out.map(v => v.id), ["B", "A"])
  assert.deepEqual(out[0].expenses[0].maintenance!.items.map(i => i.name), ["空调滤芯"])
})

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
  assert.equal((noOil.records[0] as ExpenseRecord).data_source?.name, "沃尔沃")
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
  const bad = { kind: "expense", id: "e2", vehicle_id: "v1", ts: 1, category_id: 100001, amount: 0, remark: "", title: "  ", settlement: { lines: [{ label: "原价" }] }, data_source: { name: "沃尔沃" } }
  const fuel = { kind: "fuel", id: "f1", vehicle_id: "v1", ts: 1, data_source: "易捷" }
  const n = normalizeLedger({ ...emptyLedger(), vehicles: [v1], records: [good, bad, fuel], service_records: [{ order_id: "X" }] } as unknown as Record<string, unknown>)
  assert.deepEqual(n.records[0], good)
  assert.deepEqual(["title" in n.records[1], "settlement" in n.records[1], "data_source" in n.records[1], "data_source" in n.records[2]], [false, false, false, false])
  assert.deepEqual((n as unknown as { service_records: unknown }).service_records, [{ order_id: "X" }])
  assert.deepEqual(ledgerProblems(n), [])
})

// ---------- 2.2 记下的养修转换一次（6.2 节，转-1～转-6） ----------

/** 2.2 记下 2024/10/11 那次：保养（换了机油）一笔、补漆 RB 另记一笔，RA 当时关掉没记；门店存着经销商代码 */
function legacyLedger(): LedgerFile {
  const v = visit1011()
  const l = {
    ...emptyLedger(), vehicles: [v1],
    stores: [{ ...STORE({}), dealer: { provider: "volvo_cn", code: "D01" } }],
    records: [
      { kind: "expense", id: "e1", vehicle_id: "v1", ts: v.arrive_ts, category_id: 100001, amount: 380, remark: "", store_id: "s1" },
      { kind: "maintenance", id: "m1", vehicle_id: "v1", ts: v.arrive_ts, odometer: 58052, items: ["机油 0W20", "机油滤清器"], amount: 380, remark: "", expense_id: "e1" },
      { kind: "expense", id: "e2", vehicle_id: "v1", ts: T("2024-10-11 15:55"), category_id: 100001, amount: 300, remark: "划痕补漆续保赠送X2", store_id: "s1" },
    ],
    service_records: [{
      vehicle_id: "v1", provider: "volvo_cn", order_id: v.order_id, dealer_code: "D01", arrive_ts: v.arrive_ts, odometer: 58052, dealer: v.dealer,
      tickets: [{ ...v.tickets[0], record_id: null }, { ...v.tickets[1], record_id: "e2" }, { ...v.tickets[2], record_id: "e1" }],
    }],
  }
  return l as unknown as LedgerFile
}

test("转-1、转-3、转-5：保养那笔写上结算明细和来源、不写标题（照旧第 N 次保养）；补漆写上 2.2 费用页的标题、结算明细和来源；关掉没记的不管；删掉 service_records 和门店的经销商代码，别的不动", () => {
  const before = legacyLedger()
  const l = convertServiceRecords(before)!
  const [e1, , e2] = l.records as ExpenseRecord[]
  const v = serviceVisitOf(visit1011(), naming)
  assert.deepEqual([e1.title, e1.settlement, e1.data_source], [undefined, v.expenses[0].settlement, FROM], "和再选一次这次进店时沃尔沃给的一样")
  assert.deepEqual([e2.title, e2.settlement, e2.data_source], ["补漆 · 前保、后保", v.expenses[2].settlement, FROM])
  assert.deepEqual([e1.amount, e1.store_id, e2.amount, e2.remark], [380, "s1", 300, "划痕补漆续保赠送X2"])
  assert.deepEqual(l.records[1], before.records[1], "保养记录不动")
  assert.equal("service_records" in l, false)
  assert.deepEqual(l.stores, [STORE({})])
  assert.equal(l.records.length, 3, "关掉没记的工单不补")
  assert.equal(convertServiceRecords(l), null, "转-6：转换完再打开什么都不做")
})

test("转-2、转-4：没换机油的保养按现在的项目写「保养 · 前两个项目等」；记成的费用后来删了的跳过；没有 service_records 和经销商代码的账本不转换", () => {
  const l = legacyLedger()
  const records = l.records.map(r => (r.kind === "maintenance" ? { ...r, items: ["空调滤芯", "火花塞", "燃油滤清器"] } : r)).filter(r => r.id !== "e2")
  const out = convertServiceRecords({ ...l, records })!
  assert.deepEqual([(out.records[0] as ExpenseRecord).title, out.records.length], ["保养 · 空调滤芯、火花塞等", 2])
  assert.equal(convertServiceRecords({ ...emptyLedger(), vehicles: [v1] }), null)
})
