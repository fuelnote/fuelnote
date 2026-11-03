// 手机上的自动检查（开发用，不随油记发布）。电脑端是 tools/device_check.ts，说明见 tools/check/README.md。
// 启动时把数据文件夹换成 FuelNoteCheck：账本、保单原件、小组件文件都在那里，不碰油记的真实数据；
// 不读写钥匙串、不连小熊，只向电脑上的采样服务（tools/ocr_bridge.mjs）取保单文件；数据源插件只调示例插件。
// 在 3200 端口等电脑的请求：/ping、/run/recognize、/run/ledger、/run/split、/run/benefits、/run/export、/run/service、/run/plugin、/run/map、/shot。识别扫描件要用这一页上的 WebView，所以这一页要留在屏幕上。
import {
  Button, fetch, List, Navigation, NavigationStack, ScreenshotMaker, ScrollView, Section, Text, TextField, VirtualNode, WebView, ZStack, useEffect, useRef,
  useState,
} from "scripting"
import {
  addVehicle, amountOnlyExpenses, AppData, batchInfo, batchPerks, categoriesFor, CategoryAmount, currentInsurance, currentVehicle, deductOf, deductSummary, defaultCategory,
  deleteInsurance, deletePerks, deleteRecord, doneGroups, emptyLedger, expenseEntries, expenseSummary, expenseTimes, expenseUses, expenseYears, ExpenseRecord,
  fuelRecords, giftLine, insuranceDefaults, InsuranceYear, insuranceYears, LedgerRecord, ledgerProblems, loadData, MAINTENANCE_CATEGORY, maintenanceOf, markMatch, monthTotals, newId, ParsedMark, Perk,
  perkBook, perkGroups, PerkKind, PerkScan, PickedPolicy, Policy, policyFilePath, RANGE_TITLES, readPolicyFiles, recognizePerks, remaining, renewalDue,
  renewalGifts, restoreBackup, saveBatch, saveExpense, saveInsurance, savePerks, savePolicyFile, savePolicyMark, saveStore, saveUse, saveWidgetSnapshot,
  scanPolicyFile, StatsRange, summarize, toPolicy, updateSettings, usablePerks, usedOf, Use, Vehicle, vehicleRecords,
  withoutCarInsurance, yearFiles, yearPeriod, yearTotal,
} from "../../common/model"
import { credentialsIncluded, deleteBackup, discardPickedBackup, flushAutoBackup, listBackups, openBackup, readBackupZip, writeBackupZip } from "../../app/backup"
import { backupName, MANUAL_PREFIX } from "../../common/backup_plan"
import { decryptSecrets, encryptSecrets, makeBackupKey } from "../../common/backup"
import { nativePbkdf2 } from "../../platform/kdf"
import { yearOf } from "../../common/insurance"
import { buildExport, changeCount } from "../../sync/xxyh/export"
import { FuelRecord, LedgerFile } from "../../common/types"
import { importCars } from "../../sync/xxyh/import"
import { carKey } from "../../sync/xxyh/mapping"
import { pendingExport } from "../../app/xxyh_io"
import { ExportPlanView } from "../../pages/xxyh_export"
import { MaintenanceItems } from "../../pages/maintenance_items"
import { usedItems } from "../../common/maintenance"
import { emptyXxyhState, XxyhBackup } from "../../sync/xxyh/types"
import {
  backupDirectory, dataDirectory, listBackupNames, policyDirectory, readAutoBackupState, readSnapshot, saveLedger, saveSnapshot, saveXxyhState, setDataRoot,
} from "../../platform/storage"
import { readPdfPages } from "../../platform/pdf"
import { BackupPasswordSheet } from "../../pages/backup_password"
import { BackupPreviewPage, RestoreList } from "../../pages/backup_restore"
import { BackupSettings } from "../../pages/backup_settings"
import { ExpenseForm } from "../../pages/expense_form"
import { EXPENSE_STATS_NAV, ExpenseTab } from "../../pages/expense_tab"
import { ExpenseStats } from "../../pages/expense_stats"
import { FUEL_STATS_NAV, FuelTab } from "../../pages/fuel_tab"
import { FuelStats } from "../../pages/fuel_stats"
import { InsuranceDetail } from "../../pages/insurance_detail"
import { InsuranceForm } from "../../pages/insurance_form"
import { InsuranceTab, InsuranceTabActions } from "../../pages/insurance_tab"
import { BenefitActions } from "../../pages/benefit_parts"
import { BatchPage } from "../../pages/benefit_batch"
import { BatchEditSheet } from "../../pages/benefit_batch_edit"
import { PerkDetail } from "../../pages/benefit_detail"
import { DonePage } from "../../pages/benefit_done"
import { AddPerksForm } from "../../pages/benefit_form"
import { ItemSheet } from "../../pages/benefit_item_form"
import { PerkPick } from "../../pages/benefit_pick"
import { BenefitTab } from "../../pages/benefit_tab"
import { UseSheet } from "../../pages/benefit_use"
import { StorePicker } from "../../pages/store_picker"
import { StoreDetail } from "../../pages/store_detail"
import { ServicePick } from "../../pages/service_pick"
import { autoTitle, categoryName, DataSource, entryTitle, expenseDuplicateText, findExpenseDuplicate, oilChangeNumbers, saveServiceVisit, serviceForm, ServiceVisit, toExpenseData, toFuelData } from "../../common/model"
import { addPlugin, connectPlugin, EXAMPLE_PLUGIN, installedPlugins, pluginsOf, pluginState, pluginStatus, removePlugin } from "../../common/model"
import { dataSourceById, readVehicleStatus, vehicleStops } from "../../common/model"
import { pluginFuel } from "../../app/plugins"
import { PluginAdd } from "../../pages/plugin_add"
import { FuelPick } from "../../pages/fuel_pick"
import { FuelForm } from "../../pages/fuel_form"
import {
  checkFuel, duplicateText, fillFromTxn, findDuplicate, FuelData, FuelTxn, mergeTxns, pickRange, PluginRef, pluginStation, saveFuel, stationsFor, Stop,
  stopWarning,
} from "../../common/model"
import { PluginDetail } from "../../pages/plugin_detail"
import { SettingsPage } from "../../pages/settings"
import { nearbyStores, searchStores, storeFromPoi, storeOfPlace, warmSearchCenter } from "../../common/model"
import { LngLat, metres } from "../../common/geo"
import { STATION_SEARCH_M } from "../../common/stops"
import { stationsNearby } from "../../stations/map_search"
import { locatePlaces } from "../../platform/map_search"

const SANDBOX = "FuelNoteCheck"
setDataRoot(SANDBOX)

/** 改了这个值，手机重新运行后报到的 STAMP 跟着变（确认跑的是新代码） */
export const STAMP = "53"
const PORT = 3200
const DAY = 86400e3
const BJ_OFFSET = 8 * 3600e3
const INSURANCE_CATEGORY = 100002

type Scheme = "light" | "dark"
type Step = { name: string; ok: boolean; detail: string }

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(() => resolve(), ms))
const query = (req: HttpRequest, key: string) => req.queryParams.find(q => q.key === key)?.value ?? ""
const jsonResponse = (value: unknown) => HttpResponse.ok(HttpResponseBody.text(JSON.stringify(value)))
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const money = (n: number) => n.toFixed(2)

function bodyJson<T>(req: HttpRequest): T {
  return JSON.parse(req.body.toRawString() ?? "{}") as T
}

function pngResponse(image: UIImage | null): HttpResponse {
  const data = image?.toPNGData() ?? null
  return data ? HttpResponse.raw(200, "OK", { headers: { "Content-Type": "image/png" }, body: data }) : HttpResponse.internalServerError()
}

/** 只清空检查用的文件夹；数据文件夹不是它时直接报错 */
function resetSandbox(): void {
  const dir = dataDirectory()
  if (!dir.endsWith(`/${SANDBOX}`)) throw new Error(`数据文件夹不是 ${SANDBOX}，不清空：${dir}`)
  if (FileManager.existsSync(dir)) FileManager.removeSync(dir)
}

/** 从电脑上的采样服务取保单文件，存到检查用的文件夹 inputs/ 下；返回 id → 本机路径 */
async function fetchInputs(bridge: string, ids: string[]): Promise<Map<string, string>> {
  const dir = `${dataDirectory()}/inputs`
  FileManager.createDirectorySync(dir, true)
  const out = new Map<string, string>()
  for (const id of ids) {
    const res = await fetch(`${bridge}/pdf?id=${encodeURIComponent(id)}`, { timeout: 60 })
    if (res.status !== 200) throw new Error(`取不到 ${id}：HTTP ${res.status}`)
    const path = `${dir}/${id.split("/").pop()}`
    FileManager.writeAsDataSync(path, await res.data())
    out.set(id, path)
  }
  return out
}

/** 与记保险相同：先取文字，读不出文字的逐页截图识别 */
async function readAll(paths: string[], web: WebViewController): Promise<PickedPolicy[]> {
  const out: PickedPolicy[] = []
  for (const p of await readPolicyFiles(paths)) out.push(p.textless ? await scanPolicyFile(p, web, () => undefined) : p)
  return out
}

const expenses = (data: AppData, v: Vehicle) => vehicleRecords(data, v).filter((r): r is ExpenseRecord & LedgerRecord => r.kind === "expense")

function add(steps: Step[], name: string, ok: boolean, detail = ""): void {
  steps.push({ name, ok, detail })
}

// ---------- 识别 ----------

/** 每个文件读出的保单和标志，由电脑和 expected.json 比较 */
async function runRecognize(bridge: string, ids: string[], web: WebViewController): Promise<unknown> {
  const inputs = await fetchInputs(bridge, ids)
  const picked = await readAll(ids.map(id => inputs.get(id) ?? ""), web)
  const results: unknown[] = []
  for (const [i, p] of picked.entries()) {
    // PDFKit 取出的原文也传回去：电脑把 pdfkit.jsonl 里还没有的补上（真实保单的测试用），新加的保单不用再跑 Probe
    const pages = p.image ? null : await readPdfPages(inputs.get(ids[i]) ?? "").catch(() => null)
    results.push({ id: ids[i], textless: p.textless, image: p.image, error: p.error, parsed: p.parsed, mark: p.mark, pages })
  }
  return { results }
}

// ---------- 记账 ----------

/** 电脑给的计划：小熊里已有的保险费用（真实数据只在电脑上，不进仓库），每年的保单文件和对应方式 */
type Plan = {
  seeds: Array<{ ts: number; amount: number; remark: string }>
  years: Array<{ label: string; files: string[]; link: number | null; amount: "total" | "keep" }>
}

type Imported = { label: string; id: string; link: number | null; amount: "total" | "keep"; markFrom: "file" | "page" | null; markText: boolean }

/** 本机北京时间某天结束（距今 days 天） */
const dayEndFromNow = (now: number, days: number) => Math.floor((now + BJ_OFFSET) / DAY) * DAY - BJ_OFFSET + (days + 1) * DAY - 1

function manualPolicy(start: number, end: number, file: string | null): Policy {
  return {
    kind: "compulsory", title: "机动车交通事故责任强制保险单", insurer: "示例财产保险股份有限公司", policy_no: "", start_ts: start, end_ts: end, premium: 950,
    premium_ex_tax: null, tax: null, float_rate: null, vehicle_tax: 360, phone: null, items: [], file, issues: [],
  }
}

/** 一年：与记保险表单相同的做法——保单原件复制进来，标志挂到对得上的交强险上，都不是的作为附件；补到已有费用或新记 */
async function importYear(data: AppData, v: Vehicle, y: Plan["years"][number], inputs: Map<string, string>, seedIds: string[], web: WebViewController, steps: Step[]): Promise<{ data: AppData; info: Imported }> {
  const id = newId("i")
  const picked = await readAll(y.files.map(f => inputs.get(f) ?? ""), web)
  const policies: Policy[] = []
  const marks: Array<{ path: string; page: number | null; name: string; info: ParsedMark; text: boolean }> = []
  const attachments: string[] = []
  const signs: number[] = []
  for (const r of picked) {
    if (r.mark) marks.push({ path: r.path, page: r.mark.page, name: r.name, info: r.mark.info, text: !r.textless && !r.image })
    if (r.parsed) {
      policies.push(toPolicy(r.parsed, savePolicyFile(id, r.path, r.name)))
      if (r.parsed.sign_ts) signs.push(r.parsed.sign_ts)
    } else if (!r.mark) attachments.push(savePolicyFile(id, r.path, r.name))
  }
  let markFrom: Imported["markFrom"] = null
  let markText = false
  for (const m of marks) {
    const i = policies.findIndex(p => !p.mark && markMatch(m.info, p) != null)
    if (i >= 0) {
      policies[i] = { ...policies[i], mark: await savePolicyMark(id, m) }
      markFrom = m.page == null ? "file" : "page"
      markText = m.text && /\.pdf$/i.test(m.path)
    } else if (m.page == null) attachments.push(savePolicyFile(id, m.path, m.name))
  }
  const seedId = y.link != null ? seedIds[y.link] : null
  const seed = seedId ? expenses(data, v).find(e => e.id === seedId) ?? null : null
  const year: InsuranceYear = {
    id, vehicle_id: v.id, policies, discount: 0, paid_ts: seed ? seed.ts : signs.length ? Math.max(...signs) : Date.now(), expense_id: seed ? seed.id : null,
    remark: "", ...(attachments.length ? { attachments } : {}),
  }
  const before = expenses(data, v)
  const r = saveInsurance(data, v, year, y.amount)
  const after = expenses(r.data, v)
  const exp = after.find(e => e.id === r.year.expense_id) ?? null
  const total = yearTotal(r.year)
  const label = y.label
  add(steps, `${label}：读出 ${policies.length} 份保单`, policies.length > 0, policies.map(p => `${p.kind} ${money(p.premium)}`).join("、"))
  if (seed) {
    add(steps, `${label}：补到已有的费用，不新增`, after.length === before.length && exp?.id === seed.id, `费用 ${after.length} 笔`)
    const want = y.amount === "keep" ? seed.amount : total
    add(steps, `${label}：费用金额${y.amount === "keep" ? "保留原金额" : "改成保单合计"}`, !!exp && Math.abs(exp.amount - want) < 0.005, `费用 ${money(exp?.amount ?? 0)}，应为 ${money(want)}`)
  } else {
    add(steps, `${label}：新记一笔费用`, after.length === before.length + 1 && !!exp, `费用 ${after.length} 笔`)
    add(steps, `${label}：金额是合计、类别保险和交通规费、日期是签单日期`,
      !!exp && Math.abs(exp.amount - total) < 0.005 && exp.category_id === INSURANCE_CATEGORY && exp.ts === year.paid_ts, `费用 ${money(exp?.amount ?? 0)}，合计 ${money(total)}`)
  }
  const files = yearFiles(r.year)
  const missing = files.filter(f => !FileManager.existsSync(policyFilePath(f)))
  add(steps, `${label}：原件都存进来了（${files.length} 个）`, missing.length === 0, missing.join("、"))
  if (marks.length) {
    const c = r.year.policies.find(p => p.kind === "compulsory")
    add(steps, `${label}：交强险标志挂到交强险上（${markFrom === "page" ? "保单里的一页" : "单独的文件"}）`, !!c?.mark && FileManager.existsSync(policyFilePath(c.mark)), c?.mark ?? "没有")
  }
  return { data: r.data, info: { label, id, link: y.link, amount: y.amount, markFrom, markText } }
}

async function runLedger(bridge: string, plan: Plan, web: WebViewController): Promise<{ steps: Step[] }> {
  const steps: Step[] = []
  resetSandbox()
  let data = loadData().data
  data = addVehicle(data, { name: "检查用车", grade: 95, profile: null, provider: null })
  const v = data.ledger.vehicles[data.ledger.vehicles.length - 1]
  // 小熊里已有的保险费用（照样记一笔）
  const seedIds: string[] = []
  for (const s of plan.seeds) {
    data = saveExpense(data, v, null, { ts: s.ts, category_id: INSURANCE_CATEGORY, amount: s.amount, remark: s.remark })
    seedIds.push(expenses(data, v).find(e => e.ts === s.ts && e.amount === s.amount)?.id ?? "")
  }
  const inputs = await fetchInputs(bridge, plan.years.flatMap(y => y.files))
  const imported: Imported[] = []
  for (const y of plan.years) {
    const r = await importYear(data, v, y, inputs, seedIds, web, steps)
    data = r.data
    imported.push(r.info)
  }
  const yearOf = (id: string) => data.ledger.insurance.find(y => y.id === id) ?? null
  const expenseOf = (y: InsuranceYear | null) => (y ? expenses(data, v).find(e => e.id === y.expense_id) ?? null : null)

  // 第 141 项：金额相符的那一年改优惠，费用跟着改；保留原金额的那一年改付款日期，费用跟着改日期、金额不变
  const follow = imported.find(i => i.link != null && i.amount === "total")
  const followYear = follow ? yearOf(follow.id) : null
  if (follow && followYear) {
    const original = expenseOf(followYear)?.amount ?? 0
    data = saveInsurance(data, v, { ...followYear, discount: 10 }, "total").data
    const changed = expenseOf(yearOf(follow.id))?.amount ?? 0
    data = saveInsurance(data, v, { ...(yearOf(follow.id) ?? followYear), discount: 0 }, "total").data
    const back = expenseOf(yearOf(follow.id))?.amount ?? 0
    add(steps, `${follow.label}：改优惠后费用跟着改，改回来恢复原样`, Math.abs(changed - (original - 10)) < 0.005 && Math.abs(back - original) < 0.005,
      `${money(original)} → ${money(changed)} → ${money(back)}`)
  }
  const keep = imported.find(i => i.link != null && i.amount === "keep")
  const keepYear = keep ? yearOf(keep.id) : null
  if (keep && keepYear) {
    const before = expenseOf(keepYear)
    const moved = keepYear.paid_ts + DAY
    data = saveInsurance(data, v, { ...keepYear, paid_ts: moved }, "keep").data
    const after = expenseOf(yearOf(keep.id))
    add(steps, `${keep.label}：保留原金额时改付款日期，费用跟着改日期、金额不变、关联还在`,
      !!before && !!after && after.ts === moved && Math.abs(after.amount - before.amount) < 0.005, `${money(before?.amount ?? 0)} → ${money(after?.amount ?? 0)}`)
  }

  // 第 135 项：另一辆车 20 天后到期，出现续保提醒
  data = addVehicle(data, { name: "检查用车（续保提醒）", grade: 95, profile: null, provider: null })
  const v2 = data.ledger.vehicles[data.ledger.vehicles.length - 1]
  const now = Date.now()
  const renew: InsuranceYear = {
    id: newId("i"), vehicle_id: v2.id, policies: [manualPolicy(dayEndFromNow(now, -345) - DAY + 1, dayEndFromNow(now, 20), null)], discount: 0, paid_ts: now - 350 * DAY,
    expense_id: null, remark: "",
  }
  data = saveInsurance(data, v2, renew, "total").data
  const due = renewalDue(insuranceYears(data.ledger.insurance, v2.id), now, [])
  add(steps, "续保提醒：20 天后到期的出现提醒", due?.daysLeft === 20, due ? `还有 ${due.daysLeft} 天` : "没有提醒")

  // 第 136 项：只删明细保留费用；删费用连明细一起删；原件都删掉
  const anyInput = [...inputs.values()].find(p => /\.pdf$/i.test(p)) ?? ""
  const makeOld = (y: number): InsuranceYear => {
    const id = newId("i")
    return {
      id, vehicle_id: v2.id, policies: [manualPolicy(Date.parse(`${y}-01-07T00:00:00+08:00`), Date.parse(`${y + 1}-01-06T23:59:59.999+08:00`), savePolicyFile(id, anyInput, "保单.pdf"))],
      discount: 0, paid_ts: Date.parse(`${y - 1}-12-20T12:00:00+08:00`), expense_id: null, remark: "",
    }
  }
  const a = saveInsurance(data, v2, makeOld(2017), "total")
  data = a.data
  const aExpense = a.year.expense_id
  data = deleteInsurance(data, a.year.id, false)
  add(steps, "删除：只删保单明细，费用还在，原件删掉",
    !yearOf(a.year.id) && expenses(data, v2).some(e => e.id === aExpense) && !FileManager.existsSync(`${dataDirectory()}/insurance/${a.year.id}`))
  const b = saveInsurance(data, v2, makeOld(2018), "total")
  data = b.data
  const bExpense = expenses(data, v2).find(e => e.id === b.year.expense_id)
  if (bExpense) data = deleteRecord(data, bExpense)
  add(steps, "删除：在记录里删保险费用，保单明细和原件一起删掉", !!bExpense && !yearOf(b.year.id) && !FileManager.existsSync(`${dataDirectory()}/insurance/${b.year.id}`))

  // 第 138 项（2.0.0-beta.3）：备份成 zip，删掉本机的原件，再恢复：保险明细一样，原件都回来
  const before = JSON.stringify(data.ledger.insurance)
  const filesBefore = data.ledger.insurance.flatMap(yearFiles).filter(f => FileManager.existsSync(policyFilePath(f)))
  const zipPath = `${dataDirectory()}/check-backup.zip`
  await writeBackupZip(zipPath, data, null)
  const read = await readBackupZip(zipPath)
  add(steps, "备份成 zip：记录和原件都在包里", read.backup.ledger.records.length === data.ledger.records.length && read.policyFiles >= filesBefore.length,
    `${read.backup.ledger.records.length} 条记录、${read.policyFiles} 份原件（账本里 ${filesBefore.length} 份）`)
  FileManager.removeSync(policyDirectory())
  const restored = await restoreBackup({ name: "check-backup.zip", path: zipPath, ...read }, { password: null })
  data = restored.data
  const files = data.ledger.insurance.flatMap(yearFiles)
  add(steps, "从 zip 恢复：保险明细一样，原件都回来了", JSON.stringify(data.ledger.insurance) === before && files.every(f => FileManager.existsSync(policyFilePath(f))) && !restored.missing.length,
    `${data.ledger.insurance.length} 年、${files.length} 个原件`)
  const { dir, icloud } = backupDirectory()
  add(steps, "恢复前的副本写在检查用的文件夹里，不碰 iCloud 的「油记备份」", !icloud && dir.startsWith(dataDirectory()) && listBackupNames(dir).some(n => n.startsWith("恢复前-")),
    `${dir.split("/").slice(-2).join("/")}：${listBackupNames(dir).join("、")}`)
  await flushAutoBackup(() => data)
  add(steps, "自动备份不在检查用的文件夹里运行", readAutoBackupState().last_ts === 0 && !listBackupNames(dir).some(n => n.startsWith("油记备份-")))
  FileManager.removeSync(zipPath)

  // 2.0.0-beta.4：恢复列表——立即备份和恢复前各一组，打开一份能读出记录，左滑删除立即备份；检查用的文件夹里不读钥匙串
  const manualName = backupName(MANUAL_PREFIX, Date.now())
  await writeBackupZip(`${dir}/${manualName}`, data, null)
  const groups = listBackups()
  const manual = groups.manual.find(e => e.name === manualName)
  add(steps, "恢复列表：立即备份、恢复前各一组", !!manual && groups.restore.length > 0 && !groups.daily.length,
    `立即备份 ${groups.manual.length} 份、恢复前 ${groups.restore.length} 份、自动备份 ${groups.daily.length + groups.weekly.length + groups.monthly.length} 份`)
  if (manual) {
    const opened = await openBackup(manual)
    add(steps, "打开列表里的一份：读出记录和原件份数", opened.backup.ledger.records.length === data.ledger.records.length && opened.policyFiles === read.policyFiles && (opened.size ?? 0) > 0,
      `${opened.backup.ledger.records.length} 条记录、${opened.policyFiles} 份原件、${((opened.size ?? 0) / 1024).toFixed(0)} KB`)
    discardPickedBackup(opened)
    deleteBackup(manual)
    add(steps, "删除立即备份", !listBackupNames(dir).includes(manualName))
  }
  add(steps, "检查用的文件夹里不带凭据（不读钥匙串）", !credentialsIncluded())

  // 2.0.0-beta.5：带凭据的备份——设密码时用原生 HMAC 派生一次密钥（分段算，界面不卡），写备份只做 AES；用密码解开拿回同一个密钥。
  // 凭据是编造的，密钥只在内存里，不碰钥匙串
  const reference = (require("crypto") as any).pbkdf2Sync("check-password", Buffer.alloc(16, 9), 1000, 32, "sha256").toString("base64")
  const native = (await nativePbkdf2("check-password", Buffer.alloc(16, 9), 1000)).toString("base64")
  add(steps, "原生 HMAC 派生的密钥和标准 PBKDF2 一样（以前的备份照样能解开）", native === reference)
  let ticks = 0
  let ticking = true
  const tick = () => {
    if (!ticking) return
    ticks++
    setTimeout(tick, 20)
  }
  setTimeout(tick, 20)
  const t0 = Date.now()
  const key = await makeBackupKey("check-password", { derive: nativePbkdf2 })
  const deriveMs = Date.now() - t0
  ticking = false
  add(steps, "设备份密码：派生一次约 1 秒，期间界面照常响应", deriveMs < 3000 && ticks >= deriveMs / 20 / 4,
    `${key.iterations} 次、${deriveMs} ms、计时器走了 ${ticks} 次（不卡应约 ${Math.floor(deriveMs / 20)} 次）`)
  const fake = { "check.a": "value-a", "check.b": "value-b" }
  const keyZip = `${dataDirectory()}/check-key.zip`
  const t1 = Date.now()
  await writeBackupZip(keyZip, data, encryptSecrets(fake, ["示例甲", "示例乙"], key))
  const writeMs = Date.now() - t1
  const keyRead = await readBackupZip(keyZip)
  FileManager.removeSync(keyZip)
  const t2 = Date.now()
  const unlocked = keyRead.backup.secrets ? await decryptSecrets(keyRead.backup.secrets, "check-password", nativePbkdf2) : null
  const unlockMs = Date.now() - t2
  add(steps, "带凭据的备份：写 zip 不再派生；用密码解开，拿回同一个密钥",
    !!unlocked && JSON.stringify(unlocked.values) === JSON.stringify(fake) && unlocked.key.key === key.key && writeMs < deriveMs,
    `写 zip ${writeMs} ms、用密码解开 ${unlockMs} ms`)
  let wrong = ""
  try {
    if (keyRead.backup.secrets) await decryptSecrets(keyRead.backup.secrets, "wrong-password", nativePbkdf2)
  } catch (e) {
    wrong = errorText(e)
  }
  add(steps, "密码不对时报「密码不正确」", wrong.includes("密码不正确"), wrong)

  // 截图时显示第一辆车
  updateSettings(data, { current_vehicle_id: v.id })
  return { steps }
}

// ---------- 1.6：油耗与费用分开（设计文档第 21 节） ----------

/** 电脑用同一份备份、同一套纯函数算出的期望值 */
type SplitExpect = {
  fuel: Array<{ range: StatsRange; count: number; cost: number; distance: number; avg: number | null }>
  /** 费用页（车险以外）各类别的合计（导入保单不影响） */
  categories: CategoryAmount[]
  /** 费用页、费用统计（1.6.0-beta.4）：车险以外的合计、笔数，和每年 [年份, 合计, 笔数] */
  expense: { total: number; count: number; years: Array<[number, number, number]> }
  /** 保险页：导入后的保险年度数、还只有金额的车险笔数 */
  insurance_years: number
  amount_only: number
  /** 保险和交通规费：导入保单后的合计 */
  insurance: number
  /** 保养记录条数：都应和同一时刻的费用合成一行 */
  maintenance: number
  /** 有保养的一个月：月合计只算一次 */
  month: { key: string; total: number } | null
  /** widget.json：只算加油 */
  widget: { month: string; month_cost: number; year: string; year_cost: number }
}

const near = (a: number | null, b: number | null) => (a == null || b == null ? a === b : Math.abs(a - b) < 0.005)

/**
 * 检查用的文件夹里从电脑发来的小熊备份导入一辆车（和「设置 › 小熊油耗」导入相同）。这一页不连小熊。
 * 按 1.5 的做法导入每年的保单（补到备份里已有的保险费用），再核对油耗、费用两边的统计和小组件
 */
async function runSplit(bridge: string, body: { doc: XxyhBackup; version: number; car: string; plan: Plan; expect: SplitExpect }, web: WebViewController): Promise<{ steps: Step[] }> {
  const steps: Step[] = []
  resetSandbox()
  const imported = importCars(emptyLedger(), body.doc, [body.car], Date.now())
  saveLedger(imported.ledger)
  saveXxyhState({ ...emptyXxyhState(), last_version: body.version })
  let data = loadData().data
  const v = data.ledger.vehicles[0]
  if (!v || v.xxyh_car !== body.car) throw new Error("没有导入小熊的车")
  const count = vehicleRecords(data, v).length
  add(steps, `导入小熊的车「${v.name}」：${count} 条记录`, count > 0 && imported.added[0]?.records === count, `导入报告 ${imported.added[0]?.records ?? 0} 条`)
  const seedIds = body.plan.seeds.map(s => expenses(data, v).find(e => e.ts === s.ts && Math.abs(e.amount - s.amount) < 0.005)?.id ?? "")
  add(steps, "备份里的保险费用都找到了", seedIds.every(Boolean), `${seedIds.filter(Boolean).length}/${seedIds.length}`)
  const inputs = await fetchInputs(bridge, body.plan.years.flatMap(y => y.files))
  for (const y of body.plan.years) data = (await importYear(data, v, y, inputs, seedIds, web, steps)).data

  // 第 145 项：油耗的统计只算加油
  const fills = fuelRecords(data, v)
  for (const f of body.expect.fuel) {
    const s = summarize(fills, f.range)
    add(steps, `油耗 · ${RANGE_TITLES[f.range]}：与电脑算的一致`, s.fuel_count === f.count && near(s.fuel_cost, f.cost) && s.distance_km === f.distance && near(s.avg_consumption, f.avg),
      `${s.fuel_count} 次 · ${money(s.fuel_cost)} · ${s.distance_km} km · ${s.avg_consumption?.toFixed(2) ?? "—"}`)
  }
  // 第 146、147 项：费用和保养合成一笔一行，统计只算费用
  const entries = expenseEntries(vehicleRecords(data, v))
  add(steps, "费用里没有加油记录", entries.every(e => !!e.expense || !!e.maintenance))
  const merged = entries.filter(e => e.expense && e.maintenance).length
  add(steps, `保养和同一时刻的费用合成一行（${body.expect.maintenance} 条保养）`, merged === body.expect.maintenance, `合成 ${merged} 行`)
  const all = expenseSummary(entries, "all")
  // 1.6.0-beta.4（第 156、158 项）：费用页和费用统计不含车险，保险页列出保险年度和只有金额的车险
  const years = insuranceYears(data.ledger.insurance, v.id)
  const rest = withoutCarInsurance(entries, years)
  const restAll = expenseSummary(rest, "all")
  const ee = body.expect.expense
  add(steps, "费用页、费用统计：不含车险，合计和笔数与电脑算的一致", near(restAll.total, ee.total) && restAll.count === ee.count,
    `${restAll.count} 笔 ${money(restAll.total)}，应为 ${ee.count} 笔 ${money(ee.total)}`)
  const others = restAll.categories
  add(steps, "费用 · 全部：各类别合计与电脑算的一致（没有保险和交通规费的车险）",
    others.length === body.expect.categories.length && others.every((c, i) => c.category_id === body.expect.categories[i].category_id && near(c.amount, body.expect.categories[i].amount)),
    others.map(c => `${c.category_id} ${money(c.amount)}`).join("、"))
  const byYear = expenseYears(rest)
  add(steps, "费用页按年分组：每年的合计和笔数与电脑算的一致，加起来等于费用统计「全部」",
    byYear.length === ee.years.length && byYear.every((y, i) => y.year === ee.years[i][0] && near(y.total, ee.years[i][1]) && y.count === ee.years[i][2])
      && near(byYear.reduce((t, y) => t + y.total, 0), restAll.total),
    byYear.map(y => `${y.year} ${money(y.total)}（${y.count} 笔）`).join("、"))
  const amountOnly = amountOnlyExpenses(vehicleRecords(data, v), years)
  add(steps, `保险页：${body.expect.insurance_years} 年保单，只有金额 ${body.expect.amount_only} 笔`,
    years.length === body.expect.insurance_years && amountOnly.length === body.expect.amount_only, `${years.length} 年、只有金额 ${amountOnly.length} 笔`)
  const insurance = all.categories.find(c => c.category_id === INSURANCE_CATEGORY)?.amount ?? 0
  add(steps, "账本里保险和交通规费是导入保单后的合计", near(insurance, body.expect.insurance), `${money(insurance)}，应为 ${money(body.expect.insurance)}`)
  const m = body.expect.month
  if (m) {
    const got = monthTotals(entries).get(m.key) ?? 0
    add(steps, `费用 · ${m.key} 的月合计：保养只算一次`, near(got, m.total), `${money(got)}，应为 ${money(m.total)}`)
  }
  // 第 148 项：小组件只算加油（写到检查用的文件夹里）
  saveWidgetSnapshot(data)
  const w = JSON.parse(FileManager.readAsStringSync(`${dataDirectory()}/widget.json`)) as SplitExpect["widget"]
  const ew = body.expect.widget
  add(steps, "小组件：本月、今年油费只算加油", w.month === ew.month && near(w.month_cost, ew.month_cost) && w.year === ew.year && near(w.year_cost, ew.year_cost),
    `本月 ${money(w.month_cost)}（应为 ${money(ew.month_cost)}），今年 ${money(w.year_cost)}（应为 ${money(ew.year_cost)}）`)

  // 2.1.0-beta.1：记保养——填了项目另存一条保养记录、费用页合成一行；里程、项目、金额两条一起改；导出的格式；删除时两条一起删。做完数据回到原样
  const count0 = vehicleRecords(data, v).length
  const t0 = Date.now()
  data = saveExpense(data, v, null, { ts: t0, category_id: MAINTENANCE_CATEGORY, amount: 1200, remark: "检查保养" }, { uses: [], store: null },
    { odometer: 90000, items: ["机油", "机油滤清器"], remark: "检查保养" })
  const fresh = vehicleRecords(data, v).find((r): r is ExpenseRecord => r.kind === "expense" && r.ts === t0 && r.remark === "检查保养")
  const pair = fresh ? maintenanceOf(data.ledger.records, fresh.id) : null
  const row = fresh ? expenseEntries(vehicleRecords(data, v)).find(e => e.expense?.id === fresh.id) : undefined
  add(steps, "记保养：填了项目另存一条保养记录（时间、金额跟着费用），费用页里合成一行",
    !!pair && pair.ts === t0 && pair.amount === 1200 && pair.odometer === 90000 && pair.items.join("、") === "机油、机油滤清器" && !!row?.maintenance && vehicleRecords(data, v).length === count0 + 2,
    pair ? `${pair.items.join("、")} · ${pair.odometer} km` : "没有保养记录")
  if (fresh && pair) {
    data = saveExpense(data, v, fresh.id, { ts: t0, category_id: MAINTENANCE_CATEGORY, amount: 1300, remark: "检查保养" }, { uses: [], store: null },
      { odometer: 90100, items: ["机油", "机油滤清器", "空调滤芯"], remark: "检查保养" })
    const pair2 = maintenanceOf(data.ledger.records, fresh.id)
    add(steps, "编辑保养：里程、项目、金额两条一起改，保养记录还是原来那条", pair2?.id === pair.id && pair2.odometer === 90100 && pair2.items.length === 3 && pair2.amount === 1300,
      pair2 ? `${pair2.items.join("、")} · ${pair2.odometer} km · ${money(pair2.amount)}` : "没有保养记录")
    const plan = buildExport(body.doc, data.ledger, { now: Date.now() })
    const car = plan.doc.cars.find(c => carKey(c) === body.car)
    const mrow = car?.maintainRecords?.find(r => r.currentMileage === 90100)
    const erow = car?.expenseRecords?.find(r => r.date === t0)
    add(steps, "导出新记的保养：项目不带结尾的逗号，费用备注是说明和「保养里程」「保养项目」两行，费用写保养的编号",
      mrow?.maintains === "机油,机油滤清器,空调滤芯" && erow?.description === "检查保养\n保养里程：90100公里\n保养项目：机油,机油滤清器,空调滤芯\n" && erow?.maintain_id === mrow?.wc_id && !plan.problems.length,
      `${JSON.stringify(mrow?.maintains)}；${JSON.stringify(erow?.description)}${plan.problems.length ? `；${plan.problems.join("；")}` : ""}`)
    const pair3 = maintenanceOf(data.ledger.records, fresh.id)
    if (pair3) data = deleteRecord(data, pair3)
    add(steps, "删除保养：保养记录和费用一起删", vehicleRecords(data, v).length === count0 && !data.ledger.records.some(r => r.id === fresh.id || r.id === pair.id))
  }
  updateSettings(data, { current_vehicle_id: v.id })
  return { steps }
}

// ---------- 1.7：权益（权益设计 docs/specs/2026-10-23-benefits-wallet.md） ----------

/** 电脑发来的权益（XXYH_ROOT/out/benefits/benefits.json，用户的真实条目，不进仓库）：每一项是一张卡的内容 */
type PlanItem = { name: string; kind: PerkKind; total: number; unit: string; note: string }
type BenefitsPlan = {
  store: { name: string; full_name: string; address: string }
  gift: { year: number; raw: string; items: PlanItem[] }
  /** image：套餐截图（base64，有时才发） */
  pkg: { title: string; price: number; bought: string; end: string; items: PlanItem[]; image?: string }
  /** 记一笔用了权益的维修保养费用：金额、用哪几项（名称）、储值抵扣多少 */
  expense: { amount: number; remark: string; uses: Array<{ name: string; used: number }> }
  /** 记一次使用的那一项（名称） */
  once: string
}

const BJ_DAY = (s: string) => Date.parse(`${s}T12:00:00+08:00`)
const BJ_END = (s: string) => Date.parse(`${s}T23:59:59.999+08:00`)
/** 识别车险赠送原文的结果，给添加权益的截图用 */
const scanFile = () => `${dataDirectory()}/perk_scan.json`

function planPerks(items: PlanItem[], base: Pick<Perk, "vehicle_id" | "end_ts" | "store_id" | "source" | "insurance_id" | "origin" | "raw">): Perk[] {
  return items.map(i => ({ ...base, id: newId("pk"), name: i.name, kind: i.kind, total: i.total, unit: i.unit, note: i.note, created_ts: Date.now() }))
}

/**
 * 在 split 导入的那辆车上：加门店，识别车险赠送原文（Scripting 助手），添加 2026 车险赠送、套餐（同时记一笔费用），
 * 记一笔用了权益的费用、记一次使用，改一批，删除用过的卡（费用不动）；
 * 核对剩余、分组、续保提醒、保单详情的「赠送」一行、费用的金额、备注和门店、权益抵扣、账本里的引用。数据留着给截图
 */
async function runBenefits(plan: BenefitsPlan): Promise<{ steps: Step[] }> {
  const steps: Step[] = []
  let data = loadData().data
  const v = data.ledger.vehicles.find(x => x.xxyh_car)
  if (!v) throw new Error("先跑 split（导入小熊的车）")
  if (data.ledger.perks.length) throw new Error("已经跑过权益，先重新跑 split")
  const near = (a: number, b: number) => Math.abs(a - b) < 0.005
  const now = Date.now()

  // 门店是地图上的地点：名称用全称（不用手写的简称）；这里没有位置
  const s = saveStore(data, { id: "", name: plan.store.full_name, full_name: plan.store.full_name, address: plan.store.address, phone: "", hours: "", poi_id: "", lng: null, lat: null })
  data = s.data
  const year = insuranceYears(data.ledger.insurance, v.id).find(y => yearOf(y) === plan.gift.year)
  add(steps, `${plan.gift.year} 年的保险在`, !!year)
  if (!year) return { steps }
  const giftKey = `ins:${year.id}`
  const pkgKey = `src:${plan.pkg.title}`

  // 识别车险赠送的原文（发送前去掉个人信息）：和手动整理的条目比，结果存下来给添加权益的截图
  const t0 = Date.now()
  const r = await recognizePerks({ text: plan.gift.raw, images: [] }, "insurance", { ocr_engine: "assistant", ocr_assistant: data.ledger.settings.ocr_assistant })
  if (r.scan) FileManager.writeAsStringSync(scanFile(), JSON.stringify({ raw: plan.gift.raw, scan: r.scan, summary: r.summary }))
  const kept = (r.scan?.items ?? []).filter(i => !i.policy_service)
  const names = (r.scan?.items ?? []).map(i => `${i.policy_service ? "（保单服务）" : ""}${i.name} ${i.total}${i.unit}`)
  add(steps, `识别车险赠送原文：认出 ${kept.length} 项，手动整理的是 ${plan.gift.items.length} 项`,
    !!r.scan && kept.length === plan.gift.items.length, r.error ?? `${names.join("、")}（${Math.round((Date.now() - t0) / 1000)} 秒）`)

  // 套餐截图：每一项都应认成次数，不带价值（用户 2026-10-23：套餐里标着价值的仍是次数券）
  const img = plan.pkg.image ? UIImage.fromBase64String(plan.pkg.image) : null
  if (img) {
    const t1 = Date.now()
    const p = await recognizePerks({ text: null, images: [img] }, "package", { ocr_engine: "assistant", ocr_assistant: data.ledger.settings.ocr_assistant })
    const items = p.scan?.items ?? []
    const balance = items.filter(i => i.kind === "balance").map(i => i.name)
    add(steps, `识别套餐截图：认出 ${items.length} 项、都是次数，手动整理的是 ${plan.pkg.items.length} 项；名称、售价、有效期都填上`,
      items.length === plan.pkg.items.length && !balance.length && !!p.scan?.source && p.scan.price === plan.pkg.price && !!p.scan.end_date,
      p.error ?? `「${p.scan?.source ?? ""}」售价 ${p.scan?.price ?? "—"} · 至 ${p.scan?.end_date ?? "—"}：${items.map(i => `${i.kind === "balance" ? "（储值）" : ""}${i.name} ${i.total}${i.unit}`).join("、")}（${Math.round((Date.now() - t1) / 1000)} 秒）`)
  }

  // 车险赠送：来自「2026 车险」，有效期取保险到期日，门店填进每一张
  const d = insuranceDefaults(year)
  const gift = planPerks(plan.gift.items, { vehicle_id: v.id, end_ts: d.end_ts, store_id: s.store.id, source: d.source, insurance_id: year.id, origin: "insurance", raw: plan.gift.raw })
  data = savePerks(data, v, gift, null)
  let book = perkBook(data.ledger)
  const groups = perkGroups(book, v.id, now)
  add(steps, "权益页：车险赠送一组、每一张的剩余", groups[0]?.key === giftKey && groups[0].title === `${plan.gift.year} 车险` && groups[0].items.length === gift.length
    && groups[0].items.every((x, i) => near(x.left, gift[i].total)), groups.map(g => `${g.title} ${g.items.length} 项`).join("、"))
  const line = giftLine(book, year)
  add(steps, "保单详情的「赠送」一行：名称和数量、都未使用", !!line && line.status === "都未使用" && line.names.split(" · ").length === gift.length, line ? `${line.names}（${line.status}）` : "没有")
  const renewalText = renewalGifts(book, year, yearPeriod(year)!.end - 45 * DAY)
  add(steps, "续保提醒并进赠送", renewalText === `赠送 ${gift.length} 项未使用`, renewalText ?? "没有")

  // 套餐：同时记一笔维修保养费用，只记这一次
  const pkg = planPerks(plan.pkg.items, { vehicle_id: v.id, end_ts: BJ_END(plan.pkg.end), store_id: s.store.id, source: plan.pkg.title, insurance_id: null, origin: "package", raw: "" })
  data = savePerks(data, v, pkg, { amount: plan.pkg.price, ts: BJ_DAY(plan.pkg.bought), remark: plan.pkg.title })
  const pe = expenses(data, v).find(e => e.ts === BJ_DAY(plan.pkg.bought) && e.remark === plan.pkg.title)
  add(steps, "套餐：同时记一笔维修保养费用，金额是买价、备注是名称、门店存在费用上", !!pe && near(pe.amount, plan.pkg.price) && pe.category_id === 100001 && pe.store_id === s.store.id,
    pe ? `${money(pe.amount)} · ${pe.remark}` : "没有")
  book = perkBook(data.ledger)
  add(steps, "套餐一组按到期排在车险赠送后面", perkGroups(book, v.id, now).map(g => g.key).join() === `${giftKey},${pkgKey}`, perkGroups(book, v.id, now).map(g => g.title).join("、"))

  // 记一笔用了权益的维修保养费用（金额写实付，备注只有自己写的，门店存在费用上）
  const ts = now - 3600e3
  const uses: Use[] = plan.expense.uses.map(u => {
    const p = gift.find(x => x.name === u.name)!
    return { perk_id: p.id, used: u.used, deduct: deductOf(p, u.used) }
  })
  const deduct = uses.reduce((t, u) => t + u.deduct, 0)
  const remark = plan.expense.remark
  data = saveExpense(data, v, null, { ts, category_id: 100001, amount: plan.expense.amount - deduct, remark }, { uses, store: s.store })
  const e = expenses(data, v).find(x => x.ts === ts)
  add(steps, "用权益记费用：金额是实付，备注只有自己写的，门店存在费用上", !!e && near(e.amount, plan.expense.amount - deduct) && e.remark === remark && e.store_id === s.store.id,
    e ? `${money(e.amount)} · ${e.remark.split("\n").pop()}` : "没有")
  book = perkBook(data.ledger)
  add(steps, "用掉的从剩余里减去", uses.every(u => {
    const p = book.perks.find(x => x.id === u.perk_id)!
    return near(remaining(book, p), p.total - u.used)
  }))
  const stats = deductSummary(book, v.id, expenseTimes(data, v), 0)
  add(steps, "费用统计的权益抵扣", near(stats.total, deduct), `${money(stats.total)} · ${stats.count} 次`)
  add(steps, "打开这笔费用：用过的卡都列出", !!e && expenseUses(book, v.id, e.id).length === uses.length)

  // 记一次使用（不记费用）
  const once = gift.find(x => x.name === plan.once)!
  data = saveUse(data, { id: newId("pu"), perk_id: once.id, ts: now, used: 1, expense_id: null, note: "" })
  book = perkBook(data.ledger)
  add(steps, `记一次使用：${plan.once} 用完，到「已用完和已过期」`, remaining(book, once) === 0 && doneGroups(book, v.id, now).some(g => g.items.some(i => i.perk.id === once.id)))
  add(steps, "保单详情的「赠送」一行写用了几项", giftLine(book, year)?.status === `已用 ${uses.length + 1} 项`, giftLine(book, year)?.status ?? "")

  // 改一批：有效期写进套餐的每一张，改回来
  const later = BJ_END(plan.pkg.end) + 30 * DAY
  data = saveBatch(data, v, pkgKey, { end_ts: later })
  const moved = batchPerks(perkBook(data.ledger), v.id, pkgKey)
  data = saveBatch(data, v, pkgKey, { end_ts: BJ_END(plan.pkg.end) })
  add(steps, "改一批：有效期写进套餐的每一张", moved.length === pkg.length && moved.every(p => p.end_ts === later), `${moved.length} 张`)

  // 删除用过的卡：使用记录一起删，那笔费用的金额和备注都不变；临时的卡和费用删掉
  const tmp = planPerks([{ name: "检查用储值", kind: "balance", total: 100, unit: "元", note: "" }],
    { vehicle_id: v.id, end_ts: null, source: "检查用临时卡", insurance_id: null, origin: "other", raw: "" })[0]
  data = savePerks(data, v, [tmp], null)
  const tmpTs = now - 7200e3
  const tmpUse: Use[] = [{ perk_id: tmp.id, used: 50, deduct: 50 }]
  const tmpRemark = "检查用临时费用"
  data = saveExpense(data, v, null, { ts: tmpTs, category_id: 100001, amount: 30, remark: tmpRemark }, { uses: tmpUse, store: null })
  data = deletePerks(data, v, [tmp.id])
  const left = expenses(data, v).find(x => x.ts === tmpTs)
  add(steps, "删除用过的卡：使用记录一起删，费用的金额和备注不变", !!left && near(left.amount, 30) && left.remark === tmpRemark
    && !data.ledger.perk_uses.some(u => u.perk_id === tmp.id), left ? `${money(left.amount)} · ${left.remark}` : "费用不见了")
  if (left) data = deleteRecord(data, left)

  // 费用的门店、使用记录的卡和费用、保养的费用都找得到
  const problems = ledgerProblems(data.ledger)
  add(steps, "账本里的引用都找得到", !problems.length, problems.slice(0, 3).join("；"))
  updateSettings(data, { current_vehicle_id: v.id })
  return { steps }
}

// ---------- 2.0.0-beta.6：导出到小熊（只生成，不上传） ----------

type ExportBody = { doc: XxyhBackup; version: number; car: string; now: number }

/**
 * 导入电脑发来的小熊备份里的那辆车，直接导出应和云端逐字段相同；再改一条加油、删最早的一笔费用、记一笔带门店的费用和一条用新油站的加油，
 * 只有这几条变化。把账本和生成的备份交回电脑，电脑用同一套纯函数再算一遍逐字段比较。凭据、云端都不碰
 */
async function runExportCheck(body: ExportBody): Promise<{ steps: Step[]; ledger: LedgerFile; doc: XxyhBackup }> {
  const steps: Step[] = []
  resetSandbox()
  saveLedger(importCars(emptyLedger(), body.doc, [body.car], body.now).ledger)
  saveXxyhState({ ...emptyXxyhState(), last_version: body.version })
  saveSnapshot(body.version, body.doc)
  let data = loadData().data
  const v = data.ledger.vehicles[0]
  if (!v || v.xxyh_car !== body.car) throw new Error("没有导入小熊的车")
  const opts = { now: body.now, cloudVersion: body.version, lastVersion: body.version, lastSnapshot: body.doc }
  const same = buildExport(body.doc, data.ledger, opts)
  add(steps, "导入后直接导出：和云端逐字段相同（键的顺序也一样），没有修改，检查通过",
    JSON.stringify(same.doc) === JSON.stringify(body.doc) && !same.problems.length && changeCount(same) === 0, same.problems.join("；"))
  const ledger = JSON.parse(JSON.stringify(data.ledger)) as LedgerFile
  const fills = ledger.records.filter((r): r is FuelRecord => r.kind === "fuel" && r.vehicle_id === v.id).sort((a, b) => b.ts - a.ts)
  fills[0].remark = `${fills[0].remark}（检查）`
  const oldest = ledger.records.filter((r): r is ExpenseRecord => r.kind === "expense" && r.vehicle_id === v.id).sort((a, b) => a.ts - b.ts)[0]
  ledger.records = ledger.records.filter(r => r.id !== oldest.id)
  ledger.stores.push({ id: "st-check", name: "检查用门店", full_name: "", address: "", phone: "", hours: "", poi_id: "", lng: null, lat: null })
  ledger.stations.push({ id: "check-station", name: "检查用油站", address: "", province: "", city: "", district: "", lng: 121.6, lat: 31.3, last_used_ts: body.now })
  ledger.records.push(
    { kind: "expense", id: "e-check", vehicle_id: v.id, ts: body.now, category_id: 100003, amount: 12.5, remark: "检查", store_id: "st-check" },
    { kind: "fuel", id: "f-check", vehicle_id: v.id, ts: body.now - 1000, odometer: fills[0].odometer + 500, liters: 40, price: 7.5, amount: 300, paid: 300, grade: 95, full: true, light_on: false, missed_before: false, station_id: "check-station", remark: "检查" },
  )
  saveLedger(ledger)
  data = loadData().data
  const plan = buildExport(body.doc, data.ledger, opts)
  const c = plan.cars[0]?.changes
  add(steps, "改一条、删一条、新增两条：只有这几条变化，检查通过",
    !!c && c.fuel.modified.length === 1 && c.fuel.added.length === 1 && c.expense.deleted.length === 1 && c.expense.added.length === 1 && changeCount(plan) === 4 && !plan.problems.length,
    c ? `加油 修改 ${c.fuel.modified.length} 新增 ${c.fuel.added.length}；费用 删除 ${c.expense.deleted.length} 新增 ${c.expense.added.length}${plan.problems.length ? `；${plan.problems.join("；")}` : ""}` : "没有导出的车")
  const row = plan.doc.cars.find(car => carKey(car) === body.car)?.expenseRecords?.find(r => r.date === body.now)
  add(steps, "新记的费用：备注末尾一行写门店；新油站补在末尾", row?.description === "检查\n检查用门店" && plan.stations.added === 1, `${JSON.stringify(row?.description)}，补上 ${plan.stations.added} 个油站`)
  const pending = pendingExport(data)
  add(steps, "还没导出的修改：按上次的快照离线算", pending === 4, `${pending}`)
  return { steps, ledger: data.ledger, doc: plan.doc }
}

/** 导出预览的截图：export-preview 是 /run/export 改过以后的计划；export-changed 另外假设小熊里改了一笔金额、新记了一笔（只在截图里） */
function exportScreen(screen: string, data: AppData): VirtualNode | null {
  const version = data.xxyh.last_version
  const snap = version != null ? readSnapshot(version) : null
  if (!snap || version == null) return null
  let cloud = snap
  let cloudVersion = version
  if (screen === "export-changed") {
    cloud = JSON.parse(JSON.stringify(snap)) as XxyhBackup
    const car = cloud.cars.find(c => carKey(c) === data.ledger.vehicles[0]?.xxyh_car)
    const list = car?.expenseRecords ?? []
    if (list[0]) list[0].expense = Number(list[0].expense ?? 0) + 100
    list.unshift({ date: Date.now() - 86400e3, type: 100000, expense: 20, description: "过路费", wc_id: 99999 })
    cloudVersion = version + 2
  }
  const plan = buildExport(cloud, data.ledger, { now: Date.now(), cloudVersion, lastVersion: version, lastSnapshot: snap })
  return <NavigationStack><ExportPlanView prepared={{ version: cloudVersion, plan }} exported={false} busy={false} onExport={noop} /></NavigationStack>
}

// ---------- 截图 ----------

/**
 * 弹出的页面外面包一层，出现后把「截图」「关闭」交给调用方。
 * height 不为 0 时把页面撑到这么高（放在 ScrollView 里），一张截图里看到整页
 */
function ShotHost({ scheme, page, height, ready }: { scheme: Scheme; page: VirtualNode; height: number; ready: (take: () => UIImage | null, close: () => void) => void }) {
  const dismiss = Navigation.useDismiss()
  const ref = useRef<ScreenshotMaker>(null)
  useEffect(() => {
    ready(() => ref.current?.screenshot() ?? null, () => dismiss())
  }, [])
  if (!height) return <ZStack screenshotRef={ref} environments={{ colorScheme: scheme }}>{page}</ZStack>
  return <ScrollView environments={{ colorScheme: scheme }}>
    <ZStack screenshotRef={ref} frame={{ maxWidth: "infinity", minHeight: height, maxHeight: height }}>{page}</ZStack>
  </ScrollView>
}

const noop = () => undefined
const vehicleStub = { switchVehicle: noop, addVehicle: noop, manageVehicles: noop }
const fuelStub = { ...vehicleStub, addFuel: noop, edit: noop, remove: noop, refresh: async () => undefined }
const expenseStub = { ...vehicleStub, addExpense: noop, open: noop, remove: noop }
const detailStub = { edit: async () => undefined, remove: async () => false }
function benefitStub(data: AppData): BenefitActions {
  return {
    getData: () => data, addPerks: noop, editPerk: noop, removePerk: async () => false, editBatch: noop, addToBatch: noop, removeBatch: async () => false,
    useOnce: noop, removeUse: noop, useInExpense: noop, openExpense: noop, stores: { save: s => s, remove: noop },
  }
}
const batchStub = (data: AppData) => (key: string) => <BatchPage data={data} batchKey={key} actions={benefitStub(data)} />
function insuranceStub(data: AppData): InsuranceTabActions {
  return {
    ...vehicleStub, getData: () => data, addInsurance: noop, renew: noop, dismissRenewal: noop, removeExpense: noop, detail: detailStub,
    giftPage: batchStub(data), addGift: async () => undefined,
  }
}

/**
 * 1.7（/run/benefits）之后：权益页、一批（车险赠送）、权益详情（用在费用上的储值）、已用完和已过期、添加权益（识别后）、编辑权益、编辑一批（套餐）、
 * 记一次使用、使用权益、用了权益的费用、选择门店
 */
function benefitScreen(screen: string, data: AppData): VirtualNode | null {
  const v = currentVehicle(data)
  if (!v) return null
  const book = perkBook(data.ledger)
  const stub = benefitStub(data)
  const years = insuranceYears(data.ledger.insurance, v.id)
  const year = currentInsurance(years, Date.now()) ?? years[0] ?? null
  const groups = perkGroups(book, v.id, Date.now())
  const giftKey = groups.find(g => g.key.startsWith("ins:"))?.key ?? null
  const pkgKey = groups.find(g => g.key.startsWith("src:"))?.key ?? null
  const mine = book.perks.filter(p => p.vehicle_id === v.id)
  if (screen === "benefit-tab") {
    return <BenefitTab data={data} subtitle={v.name} actions={{ ...stub, ...vehicleStub, policyPage: () => <Text>保单</Text> }} />
  }
  if (screen === "benefit-batch" && giftKey) return <NavigationStack><BatchPage data={data} batchKey={giftKey} actions={stub} policyPage={() => <Text>保单</Text>} /></NavigationStack>
  const usedCard = mine.find(p => p.kind === "balance" && book.uses.some(u => u.perk_id === p.id && u.expense_id != null)) ?? mine[0]
  if (screen === "benefit-card" && usedCard) return <NavigationStack><PerkDetail data={data} perkId={usedCard.id} actions={stub} batchPage={batchStub(data)} /></NavigationStack>
  if (screen === "benefit-done") return <NavigationStack><DonePage data={data} actions={stub} batchPage={batchStub(data)} /></NavigationStack>
  if (screen === "benefit-add") {
    const file = scanFile()
    const scanned = FileManager.existsSync(file) ? JSON.parse(FileManager.readAsStringSync(file)) as { raw: string; scan: PerkScan; summary: string } : null
    // 识别后的样子：这一年已有的卡先拿掉，免得都标成「已有，可能重复」
    const fresh = { ...data, ledger: { ...data.ledger, perks: data.ledger.perks.filter(p => p.insurance_id !== year?.id) } }
    return <AddPerksForm getData={() => fresh} vehicle={v} presetYear={year?.id ?? null} stores={stub.stores} {...(scanned ? { scanned } : {})} />
  }
  if (screen === "benefit-item" && usedCard) {
    return <ItemSheet getData={() => data} perk={usedCard} isNew={false} used={usedOf(book, usedCard.id)} stores={stub.stores} />
  }
  if (screen === "benefit-batch-edit" && pkgKey) {
    const ps = batchPerks(book, v.id, pkgKey)
    const info = batchInfo(book, v.id, pkgKey)
    return <BatchEditSheet getData={() => data} title={ps[0].source} insurance={false} start={info?.start ?? Date.now()} end={ps[0].end_ts} store={info?.store ?? null} mixedStores={!!info?.mixedStores} raw={ps[0].raw} count={ps.length} stores={stub.stores} />
  }
  const unused = mine.find(p => p.kind === "count" && remaining(book, p) > 0 && !book.uses.some(u => u.perk_id === p.id))
  if (screen === "benefit-use" && unused) return <UseSheet getData={() => data} perk={unused} use={null} />
  if (screen === "benefit-pick") {
    const usable = usablePerks(book, v.id, Date.now(), null)
    const first = usable.find(u => u.perk.kind === "balance") ?? usable[0]
    const uses = first ? [{ perk_id: first.perk.id, used: Math.min(first.left, 500), deduct: deductOf(first.perk, Math.min(first.left, 500)) }] : []
    return <NavigationStack><PerkPick usable={usable} uses={uses} amount={2000} onChange={noop} /></NavigationStack>
  }
  if (screen === "expense-benefits") {
    const used = vehicleRecords(data, v).find((r): r is ExpenseRecord & LedgerRecord => r.kind === "expense" && expenseUses(book, v.id, r.id).length > 0)
    return used ? expenseFormOf(data, v, used) : null
  }
  if (screen === "store-detail" && data.ledger.stores[0]) {
    return <NavigationStack><StoreDetail getData={() => data} storeId={data.ledger.stores[0].id} stores={stub.stores} close={noop} /></NavigationStack>
  }
  if (screen === "store-picker") return <NavigationStack><StorePicker getData={() => data} selected={data.ledger.stores[0] ?? null} near={null} query="" onPick={noop} stores={stub.stores} /></NavigationStack>
  return null
}

// ---------- 养修（/run/service，2.3.0-beta.2 起）：电脑把沃尔沃的探测数据（真实数据，结算备注里的电话已去掉）按契约整理成要记的几笔费用发来，
// 在这里当作沃尔沃这个数据源；不联网、不读钥匙串 ----------

type ServiceBody = { visits: ServiceVisit[] }
const serviceFile = () => `${dataDirectory()}/service_check.json`

function readServiceVisits(): ServiceVisit[] {
  try { return JSON.parse(FileManager.readAsStringSync(serviceFile())) as ServiceVisit[] } catch { return [] }
}

/** 检查用的沃尔沃：养修是电脑发来的探测数据，别的都不读 */
function checkSource(visits: ServiceVisit[]): DataSource {
  return {
    id: "volvo_cn", name: "沃尔沃", builtin: true, capabilities: ["vehicles", "trips", "vehicle_status", "service"],
    readable: () => true, state: () => "connected",
    vehicles: async () => [], trips: async () => [],
    vehicleStatus: async () => { throw new Error("检查里不读车况") },
    service: async () => ({ ok: true, value: visits }),
  }
}

const bjDate = (ts: number) => new Date(ts + BJ_OFFSET).toISOString().slice(0, 10)
const sumLines = (lines: Array<{ amount: number }>) => Math.round(lines.reduce((t, l) => t + l.amount, 0) * 100) / 100

/** 这辆车费用页的标题（费用和保养合成一行），按时间倒序 */
function expenseTitles(data: AppData, v: Vehicle): Array<{ ts: number; id: string; title: string; maintenance: boolean }> {
  const numbers = oilChangeNumbers(data.ledger, v.id)
  return expenseEntries(vehicleRecords(data, v)).map(x => ({
    ts: x.ts, id: x.id, title: entryTitle(numbers, x, categoryName(data, x.category_id)), maintenance: !!x.maintenance,
  }))
}

/**
 * 要在 split、benefits 之后（导入的那辆车、2026 车险的赠送、检查用的门店）：
 * 从沃尔沃选 → 2026/4/3 填好的内容（标题、项目、说明、先勾的卡、门店、结算明细）→ 保存 → 编辑标题 → 再选一次看「可能重复」→ 删掉；
 * 2024/10/11 另记的两笔；最后记下 2024/10/11（三笔，给截图里编辑补漆的标题和来源）
 */
async function runService(body: ServiceBody): Promise<{ steps: Step[] }> {
  const steps: Step[] = []
  let data = loadData().data
  const v = data.ledger.vehicles.find(x => x.xxyh_car)
  if (!v || !data.ledger.perks.length) throw new Error("先跑 split 和 benefits")
  if (data.ledger.records.some(r => r.kind === "expense" && r.data_source)) throw new Error("已经跑过养修，先重新跑 split")
  FileManager.writeAsStringSync(serviceFile(), JSON.stringify(body.visits))
  const visits = body.visits
  const source = checkSource(visits)
  const sorted = visits.every((x, i) => i === 0 || x.arrive_ts <= visits[i - 1].arrive_ts)
  add(steps, "从沃尔沃选：结算过的 10 次进店，新的在前；每次要记几笔（保养合成一笔，其余每张工单一笔）", visits.length === 10 && sorted,
    visits.map(x => `${bjDate(x.arrive_ts)} ${x.title} ${x.expenses.length} 笔`).slice(0, 4).join("；"))
  const at = (day: string) => visits.find(x => bjDate(x.arrive_ts) === day)
  const v0403 = at("2026-04-03")
  const v1011 = at("2024-10-11")
  add(steps, "2026/4/3、2024/10/11 都在", !!v0403 && !!v1011)
  if (!v0403 || !v1011) return { steps }
  const store = data.ledger.stores[0]

  const d = serviceForm(data, v, source, v0403)
  const items = d.main.items.map(i => i.name)
  const auto = autoTitle(data.ledger, { vehicleId: v.id, maintenanceId: null, ts: d.main.source.ts, items, remark: d.main.source.remark, category: "维修保养" })
  add(steps, "2026/4/3：项目照沃尔沃的叫法，检查写进说明，自付为 0 时实付填 0，里程是到店里程；换了机油，标题空着，灰字写第几次保养",
    items.join("、") === "机油 0W20、机油滤清器、火花塞、燃油滤清器" && d.main.source.remark === "检查空调不制冷" && d.main.amount === 0 && d.main.odometer === 79471
    && d.main.title === "" && /^第.+次保养$/.test(auto),
    `${items.join("、")} · ${d.main.source.remark} · ${d.main.amount} · ${d.main.odometer} · ${auto}`)
  add(steps, "先勾好的权益：这里维修保养券只剩 ¥300、基础保养已用完，都不勾", !d.main.uses.length, JSON.stringify(d.main.uses))
  add(steps, "门店按经销商的名称找到（旁边标沃尔沃）", !!store && d.store?.id === store.id, d.store?.name ?? "没有")
  const s = d.main.source.settlement
  add(steps, "结算明细：原价在前，各行加起来是自付 0；对照列出这一笔的券", s.lines[0]?.label === "原价" && sumLines(s.lines) === 0 && s.coupons.length > 0,
    `${s.lines.map(l => `${l.label} ${l.amount}`).join("、")}；对照 ${s.coupons.map(c => c.name).join("、")}`)

  data = saveServiceVisit(data, v, {
    from: d.from, others: [],
    main: {
      expense: { ts: d.main.source.ts, category_id: MAINTENANCE_CATEGORY, amount: 0, remark: d.main.source.remark, title: "" }, uses: [], store: d.store,
      maintenance: { odometer: d.main.odometer ?? 0, items, remark: d.main.source.remark }, settlement: s,
    },
  })
  const e = data.ledger.records.find((r): r is ExpenseRecord & LedgerRecord => r.kind === "expense" && r.vehicle_id === v.id && r.ts === d.main.source.ts && !!r.data_source)
  const m = e ? maintenanceOf(data.ledger.records, e.id) : null
  add(steps, "保存：一笔维修保养费用和它的保养记录；存下结算明细和来源「沃尔沃」，没有标题；门店不写经销商代码",
    !!e && e.amount === 0 && !e.title && e.data_source?.id === "volvo_cn" && e.data_source?.name === "沃尔沃" && JSON.stringify(e.settlement) === JSON.stringify(s)
    && !!m && m.items.length === 4 && m.odometer === 79471 && !!store && !("dealer" in (data.ledger.stores.find(x => x.id === store.id) ?? {})),
    e ? `${e.data_source?.name ?? "没有来源"} · ${e.settlement?.lines.length ?? 0} 行结算明细` : "没存下")
  if (!e) return { steps }
  const nth = (t: string) => /^第.+次保养$/.test(t)
  const titleOf = (id: string) => expenseTitles(data, v).find(x => x.id === id)?.title ?? ""
  const before = titleOf(e.id)
  data = saveExpense(data, v, e.id, { ...toExpenseData(e), title: "年度保养" })
  const renamed = titleOf(e.id)
  const kept = data.ledger.records.find((r): r is ExpenseRecord & LedgerRecord => r.kind === "expense" && r.id === e.id)
  data = saveExpense(data, v, e.id, { ...toExpenseData(e), title: "" })
  add(steps, "编辑：填了标题「年度保养」费用页写它，结算明细和来源不变；清空后回到第几次保养",
    nth(before) && renamed === "年度保养" && JSON.stringify(kept?.settlement) === JSON.stringify(s) && kept?.data_source?.name === "沃尔沃" && titleOf(e.id) === before,
    `${before} → ${renamed} → ${titleOf(e.id)}`)
  const dup = findExpenseDuplicate(data.ledger.records, v.id, { ts: d.main.source.ts, category_id: MAINTENANCE_CATEGORY, amount: 0 })
  const dupText = dup ? expenseDuplicateText(dup, categoryName(data, dup.category_id)) : ""
  add(steps, "再选一次这次进店，实付一样：保存时提示可能重复", dupText === "4月3日 已有一笔 ¥0.00 的维修保养，可能重复", dupText || "没有提示")
  data = deleteRecord(data, e)
  add(steps, "删掉那笔费用：保养记录一起删", !data.ledger.records.some(r => r.id === e.id || (r.kind === "maintenance" && r.expense_id === e.id)))

  const d2 = serviceForm(data, v, source, v1011)
  add(steps, "2024/10/11：保养一笔（自付 ¥380，实付要填），另记两笔补漆（自付 0 的填 0、¥300 的要填），标题是沃尔沃给的，时间是各自的开单时间",
    d2.main.amount == null && d2.others.length === 2 && d2.others.map(o => String(o.amount)).sort().join() === "0,null"
    && d2.others.every(o => o.title.startsWith("补漆") && o.source.ts !== d2.main.source.ts),
    d2.others.map(o => `${o.title} · ${o.amount ?? "必填"}`).join("；"))
  data = saveServiceVisit(data, v, {
    from: d2.from,
    main: {
      expense: { ts: d2.main.source.ts, category_id: MAINTENANCE_CATEGORY, amount: d2.main.source.own, remark: d2.main.source.remark, title: d2.main.title }, uses: [], store: d2.store,
      maintenance: { odometer: d2.main.odometer ?? 0, items: d2.main.items.map(i => i.name), remark: d2.main.source.remark }, settlement: d2.main.source.settlement,
    },
    others: d2.others.map(o => ({
      expense: { ts: o.source.ts, category_id: MAINTENANCE_CATEGORY, amount: o.amount ?? o.source.own, remark: o.source.remark, title: o.title }, uses: [], settlement: o.source.settlement,
    })),
  })
  const saved = data.ledger.records.filter((r): r is ExpenseRecord & LedgerRecord => r.kind === "expense" && r.vehicle_id === v.id && r.data_source?.id === "volvo_cn")
  const titles = expenseTitles(data, v)
  const paints = saved.filter(x => x.title).map(x => titleOf(x.id))
  add(steps, "记下 2024/10/11：三笔的来源都是沃尔沃；费用页的标题：保养写第几次保养，补漆写沃尔沃给的",
    saved.length === 3 && saved.filter(x => !x.title).length === 1 && paints.length === 2 && paints.every(t => t.startsWith("补漆"))
    && titles.filter(t => t.maintenance && nth(t.title)).length > 0,
    titles.filter(t => bjDate(t.ts) === "2024-10-11").map(t => t.title).join("；"))
  const problems = ledgerProblems(data.ledger)
  add(steps, "账本里的引用都找得到", !problems.length, problems.slice(0, 3).join("；"))
  return { steps }
}

/** 养修的截图（/run/service 之后）：选进店页、填好的记费用（2024/10/11）、编辑补漆（标题、来源、结算明细）、使用权益的对照、保养项目、门店详情 */
function serviceScreen(screen: string, data: AppData): VirtualNode | null {
  const v = data.ledger.vehicles.find(x => x.xxyh_car)
  const visits = readServiceVisits()
  if (!v || !visits.length) return null
  const source = checkSource(visits)
  const stores = benefitStub(data).stores
  const at = (day: string) => visits.find(x => bjDate(x.arrive_ts) === day)
  if (screen === "service-pick") return <ServicePick source={source} vehicle={v} connect={async () => undefined} />
  const v1011 = at("2024-10-11")
  if (screen === "service-filled" && v1011) {
    return <ExpenseForm getData={() => data} vehicle={v} record={null} maintenance={null} odometer={null} initialCategory={MAINTENANCE_CATEGORY} preset={null} stores={stores}
      service={{ source, connect: async () => undefined, initial: v1011 }} />
  }
  if (screen === "service-edit") {
    const e = data.ledger.records.find((r): r is ExpenseRecord & LedgerRecord => r.kind === "expense" && r.vehicle_id === v.id && !!r.data_source && !!r.title)
    return e ? expenseFormOf(data, v, e) : null
  }
  const v0403 = at("2026-04-03")
  if (screen === "service-perks" && v0403) {
    const d = serviceForm(data, v, source, v0403)
    return <NavigationStack><PerkPick usable={usablePerks(perkBook(data.ledger), v.id, v0403.arrive_ts, null)} uses={d.main.uses} amount={null} onChange={noop}
      refs={d.main.source.settlement.coupons} refsSource="沃尔沃" linked /></NavigationStack>
  }
  const old = at("2023-04-21")
  if (screen === "service-perks-old" && old) {
    return <NavigationStack><PerkPick usable={usablePerks(perkBook(data.ledger), v.id, old.arrive_ts, null)} uses={[]} amount={null} onChange={noop}
      refs={old.expenses.flatMap(x => x.settlement.coupons)} refsSource="沃尔沃" linked /></NavigationStack>
  }
  if (screen === "service-items" && v0403) {
    const d = serviceForm(data, v, source, v0403)
    return <NavigationStack><MaintenanceItems items={d.main.items.map(i => i.name)} used={usedItems(data.ledger.records, v.id)} onChange={noop}
      sources={Object.fromEntries(d.main.items.map(i => [i.name, i.from]))} notes={d.main.notes} onNote={noop} /></NavigationStack>
  }
  const store = data.ledger.stores[0]
  if (screen === "service-store" && store) return <NavigationStack><StoreDetail getData={() => data} storeId={store.id} stores={stores} close={noop} /></NavigationStack>
  return null
}

// ---------- 2.2.0-beta.1 数据源插件（/run/plugin）：在检查用的文件夹里添加示例插件、读状态和交易、移除；调别的脚本被拦下 ----------

/** 要先装好示例插件（npm run check:install），并在手机上同步过一次。最后把示例插件加回来，留给截图 */
async function runPlugin(): Promise<{ steps: Step[] }> {
  const steps: Step[] = []
  let data = loadData().data
  for (const p of pluginsOf(data)) data = removePlugin(data, p.id)
  const getData = () => data
  const all = FileManager.readDirectorySync(FileManager.scriptsDirectory).map(p => p.split("/").pop() || p)
  const marked = all.filter(n => FileManager.existsSync(`${FileManager.scriptsDirectory}/${n}/fuelnote.json`))
  const ex = installedPlugins().find(p => p.script === EXAMPLE_PLUGIN)
  add(steps, "脚本目录：列得出已装的脚本，读得到示例插件的 fuelnote.json 和 script.json（名称、版本、图标）", !!ex && !!ex.version && !!ex.icon,
    `${all.length} 个脚本、${marked.length} 个带标记${ex ? `；${ex.title} · ${ex.version} · ${ex.icon}` : ""}`)
  if (!ex) return { steps }

  data = await addPlugin(getData, EXAMPLE_PLUGIN)
  const ref = pluginsOf(data).find(p => p.script === EXAMPLE_PLUGIN)
  add(steps, "添加：调一次 describe，存进设置（id、名称、提供的数据）", !!ref && ref.id === "example" && ref.capabilities.join() === "fuel,vehicles,trips,vehicle_status,service",
    ref ? JSON.stringify(ref) : "没有")
  if (!ref) return { steps }
  let dup = ""
  try { await addPlugin(getData, EXAMPLE_PLUGIN) } catch (e) { dup = errorText(e) }
  add(steps, "同一个插件再添加一次被拦下", dup.includes("已经添加过了"), dup)

  let st = await pluginStatus(ref)
  // 手机验收时会把示例插件切到「已过期」「未连接」：打开它的连接页，在手机上切回「已连接」再点「完成」
  if (st.ok && (!st.value.connected || st.value.expired)) st = await connectPlugin(ref)
  add(steps, "读状态：已连接，账号打码，记下上次的结果", st.ok && st.value.connected && !!st.value.account && pluginState(ref.id) === "connected",
    st.ok ? `${st.value.account ?? "没有账号"} · ${pluginState(ref.id)}` : st.error.message)
  const now = Date.now()
  const t0 = Date.now()
  const fuel = await pluginFuel(ref, { from: now - 30 * DAY, to: now })
  const first = Date.now() - t0
  const t1 = Date.now()
  const again = await pluginFuel(ref, { from: now - 30 * DAY, to: now })
  const second = Date.now() - t1
  add(steps, "读加油交易：最近 30 天 8 笔，新的在前；10 分钟内再读用缓存", fuel.ok && fuel.value.length === 8 && fuel.value[0].ts >= fuel.value[7].ts && again.ok && again.value.length === 8,
    fuel.ok ? `${fuel.value.length} 笔，第一次 ${first} ms，再读 ${second} ms` : fuel.error.message)

  // 2.3.0-beta.1：车辆、行程、车况走契约（插件化设计第 5 节）。示例插件包成数据源，和内置的沃尔沃同一条路、同一份缓存
  const src = dataSourceById(data, ref.id)
  let cars: string | Array<{ id: string; name: string; detail: string }> = "没有这个数据源"
  if (src) { try { cars = await src.vehicles() } catch (e) { cars = errorText(e) } }
  add(steps, "数据源：示例插件提供车辆，账号下一辆示例车", Array.isArray(cars) && cars.length === 1 && cars[0].id === "example-car",
    Array.isArray(cars) ? cars.map(c => `${c.name} · ${c.detail}`).join("；") : cars)
  const car: Vehicle = { id: "check-plugin-car", name: "示例车（检查）", default_grade: 95, created_ts: now, xxyh_car: null, provider: { id: ref.id, vehicle_id: "example-car", name: "示例车" } }
  let stops: string | Array<{ end_ts: number; odometer_km: number }> = []
  try { stops = await vehicleStops(data, car, { force: true }) } catch (e) { stops = errorText(e) }
  let snap: string | { status: { fuel_l: number | null; odometer_km: number | null } } | null = null
  try { snap = await readVehicleStatus(data, car, true) } catch (e) { snap = errorText(e) }
  const lastStop = Array.isArray(stops) && stops.length ? stops.reduce((a, b) => (b.end_ts > a.end_ts ? b : a)) : null
  add(steps, "行程：最近 7 天的停车按时间配出来（示例插件每天一趟，加油前停在那个油站）", Array.isArray(stops) && stops.length >= 7,
    Array.isArray(stops) ? `${stops.length} 次停车，最后一次 ${lastStop ? lastStop.odometer_km : "—"} km` : stops)
  add(steps, "车况：剩余 32.5 L，里程是最后一趟熄火时的", !!snap && typeof snap === "object" && snap.status.fuel_l === 32.5 && !!lastStop && snap.status.odometer_km === lastStop.odometer_km,
    snap && typeof snap === "object" ? `${snap.status.fuel_l} L · ${snap.status.odometer_km} km` : String(snap))
  // 2.3.0-beta.2：养修走契约（插件化设计 3.4 节）：经过 Script.run 调示例插件的 service，校验、整理以后给记费用
  const sv = src ? await src.service("example-car", true) : null
  const sv0 = sv && sv.ok ? sv.value : []
  add(steps, "养修：示例插件给两次已结算的进店，新的在前；保养那次要记两笔，只有第一笔带保养记录；保修那次对照只有名称",
    sv0.length === 2 && sv0[0].arrive_ts > sv0[1].arrive_ts && sv0[0].expenses.length === 2 && !!sv0[0].expenses[0].maintenance && !sv0[0].expenses[1].maintenance
    && sv0[1].expenses[0].own === 0 && sv0[1].expenses[0].settlement.coupons[0]?.amount === null,
    sv && sv.ok ? sv0.map(v => `${v.title} ${v.expenses.length} 笔`).join("；") : sv ? sv.error.message : "没有这个数据源")

  let blocked = ""
  try { await addPlugin(getData, "FuelNote") } catch (e) { blocked = errorText(e) }
  add(steps, "检查用的文件夹里调别的脚本被拦下（不运行它）", blocked.includes("不可用"), blocked)

  data = removePlugin(data, ref.id)
  add(steps, "移除：设置里没有了，上次的结果一起清掉", !pluginsOf(data).length && pluginState(ref.id) == null)
  data = await addPlugin(getData, EXAMPLE_PLUGIN)
  return { steps: [...steps, ...(await runPluginFuel(data))] }
}

/** 截图用：示例插件和分两笔付的那两笔合成的结果（/run/plugin 之后） */
let pickShot: { plugin: PluginRef; txn: FuelTxn; parts: FuelTxn[] } | null = null

/**
 * 2.2.0-beta.3 记加油从数据源选（插件化设计第 3、3.2、3.3、7 节）：不能合成、合成、保存、再选同一笔是「可能重复」；
 * 油站按停车认出、按交易坐标新建，停车离付款油站远时提醒。要在 split 之后（导入的车和油站）。保存的那一条最后删掉
 */
async function runPluginFuel(start: AppData): Promise<Step[]> {
  const steps: Step[] = []
  let data = start
  const v = currentVehicle(data)
  const ref = pluginsOf(data).find(p => p.script === EXAMPLE_PLUGIN)
  if (!v || !ref) {
    add(steps, "记加油：要先跑 split，并加好示例插件", false)
    return steps
  }
  const read = await pluginFuel(ref, pickRange(null, Date.now()))
  const byId = (id: string) => (read.ok ? read.value.find(t => t.id === id) ?? null : null)
  const [s1, s2, op, os] = ["split-1", "split-2", "other-price", "other-station"].map(byId)
  if (!s1 || !s2 || !op || !os) {
    add(steps, "记加油：读到示例插件分两笔付的那组交易", false, read.ok ? `${read.value.length} 笔` : read.error.message)
    return steps
  }
  const blocked = [mergeTxns([s1, op]), mergeTxns([s2, os])].map(m => (m.ok ? "能合成" : m.reason))
  add(steps, "选单价不同、站码不同的两笔：不能合成，写明原因（「填入」不可用）",
    blocked.join("；") === "单价不同，不是同一次加油；油站不同，不是同一次加油", blocked.join("；"))

  const m = mergeTxns([s2, s1])
  if (!m.ok) {
    add(steps, "分两笔付的合成一条", false, m.reason)
    return steps
  }
  pickShot = { plugin: ref, txn: m.txn, parts: m.parts }
  const sum = (k: "liters" | "amount" | "paid") => Math.round((s1[k] + s2[k]) * 100) / 100
  add(steps, "分两笔付的合成一条：升数、机显、实付相加，时间取最早一笔，单价不变",
    m.txn.ts === s1.ts && m.txn.liters === sum("liters") && m.txn.amount === sum("amount") && m.txn.paid === sum("paid") && m.txn.price === s1.price && !m.warnings.length,
    `${m.txn.liters.toFixed(2)} L · 实付 ${m.txn.paid.toFixed(2)}`)

  // 保存：里程接在这辆车最近一次加油后面；没有停车，油站按交易定
  const f = fillFromTxn(m.txn)
  const others = fuelRecords(data, v)
  const last = others.slice().sort((a, b) => b.ts - a.ts)[0]
  const odometer = (last ? last.odometer : 0) + 400
  const st = await pluginStation(data, v, m.txn.station, null, m.txn.ts)
  const fuel: FuelData = {
    ts: m.txn.ts, odometer, liters: m.txn.liters, price: m.txn.price, amount: m.txn.amount, paid: m.txn.paid, grade: f.printedGrade ?? 95,
    full: true, light_on: false, missed_before: false, station_id: st ? st.station.id : null, remark: "检查：从示例插件填入",
  }
  const c1 = checkFuel(fuel, others)
  data = saveFuel(data, v, null, fuel, st && st.isNew ? st.station : null)
  const saved = fuelRecords(data, v).find(r => r.remark === fuel.remark && r.ts === fuel.ts)
  add(steps, "合成后保存：核对通过，油站按交易的站点信息定（没有停车）", !c1.errors.length && !!saved && !!st && st.via === "txn",
    st ? `${st.from === "mine" ? "我的油站" : st.from === "map" ? "地图" : "交易"} · ${st.station.name}` : "没有油站")

  // 再选其中一笔：前后 1 小时内已有加油
  const all = fuelRecords(data, v)
  const dup = findDuplicate(all, s1.ts, s1.amount)
  const draft: FuelData = { ...fuel, liters: s1.liters, amount: s1.amount, paid: s1.paid, remark: "" }
  const dupArg = dup ? { record: dup, text: duplicateText(dup) } : null
  const c2 = checkFuel(draft, all, undefined, dupArg)
  add(steps, "再选其中一笔：配到同一个里程时报「可能重复」，不能保存", !!dup && dup.id === saved?.id && c2.errors.includes(duplicateText(dup)), c2.errors.join("；"))
  const c3 = checkFuel({ ...draft, odometer: odometer + 30 }, all, undefined, dupArg)
  add(steps, "里程不冲突时不是错误，保存时再确认", !!dup && !c3.errors.includes(duplicateText(dup)), c3.errors.join("；") || "没有错误")
  if (saved) data = deleteRecord(data, saved)

  // 油站：用 45 天前在「世纪公园」的那笔（示例插件里坐标偏几百米的站）。到站停车在我的油站（编一次停车）→ 按停车认出，并提醒核对里程
  const older = await pluginFuel(ref, { from: Date.now() - 60 * DAY, to: Date.now() })
  const far = older.ok ? older.value.find(t => t.id === "d45") ?? null : null
  const home = stationsFor(data, v).slice().sort((a, b) => b.last_used_ts - a.last_used_ts)[0]
  if (!home || !far || !far.station) {
    add(steps, "油站：读到示例插件 45 天前那笔，账本里有我的油站", false, `${far ? "" : "没有那笔交易；"}${home ? "" : "没有我的油站"}`)
  } else {
    const stop: Stop = {
      trip: { id: "check-stop", start_ts: far.ts - 30 * 60e3, end_ts: far.ts - 2 * 60e3, start_odometer_km: odometer - 10, end_odometer_km: odometer, distance_km: 10, fuel_l: null, start: null, end: null },
      end_ts: far.ts - 2 * 60e3, place: { lng: home.lng, lat: home.lat, address: home.address, city: home.city, district: home.district },
      odometer_km: odometer, stay_min: 6, candidate: null, refuel: true, recorded: null,
    }
    const byStop = await pluginStation(data, v, far.station, stop, far.ts)
    add(steps, "到站停车 80 m 内有我的油站：用它，交易坐标远也不看", !!byStop && byStop.via === "stop" && byStop.station.id === home.id, byStop ? byStop.station.name : "没有")
    const warn = stopWarning(far.station, stop, stationsFor(data, v))
    add(steps, "停车离付款油站超过 500 m：提醒核对里程，写出停车的油站", !!warn && warn.startsWith(`停车在${home.name}，距付款油站`), warn ?? "没有提醒")
    const byTxn = await pluginStation(data, v, far.station, null, far.ts)
    add(steps, "没有停车、附近也没有我的油站：按交易坐标新建（地图上站名对得上的用地图的）", !!byTxn && byTxn.isNew && byTxn.via === "txn",
      byTxn ? `${byTxn.from === "map" ? "地图" : "交易"} · ${byTxn.station.name}` : "没有")
  }
  return steps
}

// ---------- 2.2.0-beta.2 地图搜索（/run/map）：系统地图搜加油站和汽车服务，核对坐标换算、按距离筛、同一家门店不重复加 ----------

/** 要在 split 之后：用它导入的油站核对坐标换算，最近用过的油站当附近的中心。只报个数、距离和耗时 */
async function runMap(): Promise<{ steps: Step[] }> {
  const steps: Step[] = []
  let data = loadData().data
  const stations = [...data.ledger.stations].sort((a, b) => b.last_used_ts - a.last_used_ts).slice(0, 10)
  if (!stations.length) throw new Error("先跑 split（导入小熊的油站）")
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

  // 不经过 30 天的缓存，直接搜：换算对的话最近的一个只差几米，不换算差约 480 m
  const gaps: number[] = []
  const t0 = Date.now()
  for (const st of stations) {
    const pois = await stationsNearby(locatePlaces, [st.lng, st.lat], STATION_SEARCH_M)
    if (pois.length) gaps.push(metres([pois[0].lng, pois[0].lat], [st.lng, st.lat]))
  }
  add(steps, "加油站：账本里的油站附近 200 m 内搜得到，最近的一个和账本的位置中位差不到 30 m（坐标换算对）",
    gaps.length >= Math.ceil(stations.length * 0.8) && median(gaps) < 30,
    gaps.length ? `${gaps.length}/${stations.length} 个搜得到，中位 ${Math.round(median(gaps))} m、最远 ${Math.round(Math.max(...gaps))} m；每次 ${Math.round((Date.now() - t0) / stations.length)} ms` : "一个也没搜到")

  const center: LngLat = [stations[0].lng, stations[0].lat]
  const t1 = Date.now()
  const near = await nearbyStores(center)
  const dists = near.map(p => p.distance ?? Infinity)
  const keys = new Set(near.map(p => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}|${p.name}`))
  add(steps, "附近的汽车服务（图-1、图-2）：4 个关键字合起来，都在 1500 m 内、按距离排、没有重复",
    near.length > 0 && dists.every((d, i) => d <= 1500 && (i === 0 || d >= dists[i - 1])) && keys.size === near.length,
    near.length ? `${near.length} 个，最近 ${Math.round(dists[0])} m、最远 ${Math.round(dists[dists.length - 1])} m，有类别标签的 ${near.filter(p => p.kind).length} 个；${Date.now() - t1} ms` : "一个也没有")
  if (!near.length) return { steps }

  const first = saveStore(data, storeFromPoi(near[0]))
  data = first.data
  const again = await nearbyStores(center)
  const same = again.find(p => storeOfPlace(data.ledger.stores, p)?.id === first.store.id)
  const twice = same ? saveStore(data, storeFromPoi(same)) : null
  add(steps, "图-3：选中的地点存进我的门店；再搜一次认得出这一家，再选不新加",
    !!twice && twice.store.id === first.store.id && twice.data.ledger.stores.length === data.ledger.stores.length, `门店 ${data.ledger.stores.length} 家`)

  // 搜索框以手机现在的位置为区域（D14）：第一次可能弹定位权限，最多等 15 秒看取不取得到
  const t2 = Date.now()
  const here = await Promise.race([warmSearchCenter(), wait(15000).then(() => null)])
  add(steps, "搜索框的区域：取得到手机现在的位置（没有时用最近用过的油站）", !!here, `${here ? "取到" : "没取到"}，${Date.now() - t2} ms`)
  const t3 = Date.now()
  const found = await searchStores(data, near[0].name)
  const rank = found.findIndex(p => storeOfPlace(data.ledger.stores, p)?.id === first.store.id)
  add(steps, "搜索框按名称搜：搜得到这一家", rank >= 0, `${found.length} 个，${rank >= 0 ? `这一家排第 ${rank + 1}` : "没有这一家"}；${Date.now() - t3} ms`)

  let empty = ""
  try { empty = `${(await searchStores(data, "qzxjvkwpb")).length} 个` } catch (e) { empty = `报错：${errorText(e)}` }
  add(steps, "搜不到时返回列表（页面写「没有找到」），不报错", !empty.startsWith("报错"), empty)

  // 截图用：像 2.1 从高德选的门店，存着营业时间
  data = saveStore(data, {
    id: "", name: "检查用门店（2.1）", full_name: "检查用门店（2.1）", address: "示例路 1 号", phone: "021-00000000", hours: "08:30-17:30", poi_id: "check-amap",
    lng: center[0] + 0.02, lat: center[1],
  }).data
  return { steps }
}

/** 地图搜索的截图（/run/map 之后）：设置页（没有「油站搜索」）、选择门店（附近、搜索结果）、门店详情（地图上选的、2.1 存着营业时间的） */
function mapScreen(screen: string, data: AppData): VirtualNode | null {
  const stores = benefitStub(data).stores
  const center = [...data.ledger.stations].sort((a, b) => b.last_used_ts - a.last_used_ts)[0]
  const placed = data.ledger.stores.find(s => s.lng != null && !s.hours)
  const old = data.ledger.stores.find(s => !!s.hours)
  if (screen === "map-settings") return <SettingsPage data={data} app={{ getData: () => data, setData: noop, addVehicle: async () => undefined }} />
  if (screen === "map-picker" && center) {
    return <NavigationStack><StorePicker getData={() => data} selected={null} near={{ point: [center.lng, center.lat], label: "检查用油站附近" }} query="" onPick={noop} stores={stores} /></NavigationStack>
  }
  if (screen === "map-search" && placed) return <NavigationStack><StorePicker getData={() => data} selected={null} near={null} query={placed.full_name} onPick={noop} stores={stores} /></NavigationStack>
  if (screen === "map-store" && placed) return <NavigationStack><StoreDetail getData={() => data} storeId={placed.id} stores={stores} close={noop} /></NavigationStack>
  if (screen === "map-store-hours" && old) return <NavigationStack><StoreDetail getData={() => data} storeId={old.id} stores={stores} close={noop} /></NavigationStack>
  return null
}

/** 数据源插件的截图（/run/plugin 之后）：设置页、添加插件、插件详情 */
function pluginScreen(screen: string, data: AppData): VirtualNode | null {
  const app = { getData: () => data, setData: noop, addVehicle: async () => undefined }
  if (screen === "plugin-settings") return <SettingsPage data={data} app={app} />
  if (screen === "plugin-add") return <PluginAdd getData={() => data} onAdded={noop} />
  if (screen === "plugin-detail" && pluginsOf(data).length) return <NavigationStack><PluginDetail app={app} pluginId={pluginsOf(data)[0].id} /></NavigationStack>
  // 2.2.0-beta.3：选交易（单选、合成、不能合成）、填好的表单
  const ref = pluginsOf(data).find(p => p.script === EXAMPLE_PLUGIN)
  const picks: Record<string, string[]> = { "plugin-pick-one": ["d6"], "plugin-pick-merge": ["split-1", "split-2"], "plugin-pick-block": ["split-1", "other-price"] }
  if (ref && picks[screen]) return <FuelPick plugin={ref} at={null} selected={picks[screen]} />
  const v = currentVehicle(data)
  if (screen === "plugin-filled" && v && pickShot) {
    return <FuelForm data={data} vehicle={v} record={null} initialPick={{ plugin: pickShot.plugin, result: { txn: pickShot.txn, parts: pickShot.parts } }} />
  }
  // 2.3.0-beta.2：编辑从示例插件记的加油，最上面一行「来源」（画稿 SvFuelSourceTop；用最近一次加油，只在截图里带上来源）
  const last = v ? fuelRecords(data, v)[0] : undefined
  if (screen === "plugin-fuel-source" && v && last) {
    return <FuelForm data={data} vehicle={v} record={{ ...toFuelData(last), id: last.id, data_source: { id: "example", name: "示例" } }} />
  }
  return null
}

/** 打开一笔费用（带门店；从数据源记的带标题、结算明细和来源） */
function expenseFormOf(data: AppData, v: Vehicle, e: ExpenseRecord): VirtualNode {
  return <ExpenseForm getData={() => data} vehicle={v} record={{
    ...toExpenseData(e), id: e.id, ...(e.store_id ? { store_id: e.store_id } : {}),
    ...(e.settlement ? { settlement: e.settlement } : {}), ...(e.data_source ? { data_source: e.data_source } : {}),
  }}
    maintenance={maintenanceOf(data.ledger.records, e.id)} odometer={null}
    initialCategory={e.category_id} preset={null} stores={benefitStub(data).stores} />
}

/**
 * 用检查用的账本渲染真实页面。
 * 记账（/run/ledger）之后：当前保单的详情和编辑表单、另一辆车的保险页（续保提醒）；
 * 1.6（/run/split）之后：导入的那辆车的油耗、费用、保险三个标签，两个统计页，记费用，某一年的保单详情。
 * 保单详情是推入的一页，这里单独放进 NavigationStack 截图（左上角没有返回）
 */
function screenElement(screen: string): VirtualNode | null {
  let data = loadData().data
  // 当前车辆某一年的保单详情：insurance-<年份>（2021 年平安的两份是抄件）
  const iy = /^insurance-(\d{4})$/.exec(screen)
  if (iy) {
    const cur = currentVehicle(data)
    const y = cur ? insuranceYears(data.ledger.insurance, cur.id).find(x => yearOf(x) === Number(iy[1])) : null
    return y ? <NavigationStack><InsuranceDetail get={() => data} yearId={y.id} actions={detailStub} giftPage={batchStub(data)} addGift={async () => undefined} /></NavigationStack> : null
  }
  if (screen.startsWith("benefit-") || screen === "expense-benefits" || screen.startsWith("store-")) return benefitScreen(screen, data)
  if (screen.startsWith("export-")) return exportScreen(screen, data)
  if (screen.startsWith("service-")) return serviceScreen(screen, data)
  if (screen.startsWith("plugin-")) return pluginScreen(screen, data)
  if (screen.startsWith("map-")) return mapScreen(screen, data)
  // 2.0.0-beta.4：备份与恢复、恢复列表、看一眼再恢复（最新的一份恢复前副本）、备份密码；用记账留下的「恢复前」副本
  if (screen.startsWith("backup-")) {
    const app = { getData: () => data, setData: noop, addVehicle: async () => undefined }
    if (screen === "backup-settings") return <NavigationStack><BackupSettings data={data} app={app} /></NavigationStack>
    if (screen === "backup-restore") return <NavigationStack><RestoreList data={data} app={app} /></NavigationStack>
    const latest = listBackups().restore[0]
    if (screen === "backup-preview" && latest) return <NavigationStack><BackupPreviewPage entry={latest} app={app} /></NavigationStack>
    if (screen === "backup-password") return <BackupPasswordSheet change={false} />
    return null
  }
  // 2.1.0-beta.1：记费用 · 维修保养（新记，里程取最近一次加油的读数，Check 不读车况）、编辑第五次保养、保养项目页
  if (screen.startsWith("maint-")) {
    const cur = currentVehicle(data)
    if (!cur) return null
    const recs = vehicleRecords(data, cur)
    const odo = fuelRecords(data, cur)[0]?.odometer ?? null
    const used = usedItems(data.ledger.records, cur.id)
    if (screen === "maint-new") {
      return <ExpenseForm getData={() => data} vehicle={cur} record={null} maintenance={null} odometer={odo} initialCategory={MAINTENANCE_CATEGORY} preset={null} stores={benefitStub(data).stores} />
    }
    if (screen === "maint-items") return <NavigationStack><MaintenanceItems items={["机油", "机油滤清器"]} used={used} onChange={noop} /></NavigationStack>
    const m = recs.find(r => r.kind === "maintenance" && r.remark === "第五次保养") ?? recs.find(r => r.kind === "maintenance" && !!r.expense_id)
    const e = m && m.kind === "maintenance" ? recs.find((r): r is ExpenseRecord & LedgerRecord => r.kind === "expense" && r.id === m.expense_id) : undefined
    return e ? expenseFormOf(data, cur, e) : null
  }
  if (screen.startsWith("fuel-") || screen.startsWith("expense-") || screen === "insurance-records") {
    const cur = currentVehicle(data)
    if (!cur) return null
    if (screen === "insurance-records") return <InsuranceTab data={data} subtitle={cur.name} actions={insuranceStub(data)} />
    if (screen === "expense-form") {
      return <ExpenseForm getData={() => data} vehicle={cur} record={null} maintenance={null} odometer={null} initialCategory={defaultCategory(expenseEntries(vehicleRecords(data, cur)), categoriesFor(data))}
        preset={null} stores={benefitStub(data).stores} />
    }
    // 统计页是记录页推入的一页，这里单独放进 NavigationStack 截图（左上角没有返回）
    if (screen === "fuel-stats") return <NavigationStack><FuelStats data={data} nav={FUEL_STATS_NAV} /></NavigationStack>
    if (screen === "expense-stats") return <NavigationStack><ExpenseStats data={data} nav={EXPENSE_STATS_NAV} /></NavigationStack>
    return screen.startsWith("fuel-")
      ? <FuelTab data={data} subtitle={cur.name} status={null} openStatus={noop} actions={fuelStub} />
      : <ExpenseTab data={data} subtitle={cur.name} actions={expenseStub} />
  }
  const v = data.ledger.vehicles.find(x => x.name === "检查用车")
  const v2 = data.ledger.vehicles.find(x => x.name === "检查用车（续保提醒）")
  if (!v) return null
  const years = insuranceYears(data.ledger.insurance, v.id)
  const current = currentInsurance(years, Date.now()) ?? years[0] ?? null
  if (screen === "detail" && current) {
    return <NavigationStack><InsuranceDetail get={() => data} yearId={current.id} actions={detailStub} /></NavigationStack>
  }
  if (screen === "form" && current) return <InsuranceForm data={data} vehicle={v} year={current} link={null} />
  if (screen === "renewal" && v2) {
    data = { ...data, ledger: { ...data.ledger, settings: { ...data.ledger.settings, current_vehicle_id: v2.id } } }
    return <InsuranceTab data={data} subtitle={v2.name} actions={insuranceStub(data)} />
  }
  return null
}

async function takeShot(screen: string, scheme: Scheme, height: number): Promise<UIImage | null> {
  const page = screenElement(screen)
  if (!page) return null
  let take: (() => UIImage | null) | null = null
  let close: (() => void) | null = null
  const done = Navigation.present({
    element: <ShotHost scheme={scheme} page={page} height={height} ready={(t, c) => { take = t; close = c }} />,
    modalPresentationStyle: "fullScreen",
  })
  await wait(2600)
  const image = take ? (take as () => UIImage | null)() : null
  if (close) (close as () => void)()
  await done
  await wait(300)
  return image
}

// ---------- 页面和端口 ----------

export function CheckPage() {
  const dismiss = Navigation.useDismiss()
  const [web] = useState(() => new WebViewController())
  const [bridge, setBridge] = useState("http://192.168.10.100:3100")
  const bridgeRef = useRef(bridge)
  const [status, setStatus] = useState("启动中")
  const [last, setLast] = useState("")
  const busy = useRef(false)

  useEffect(() => {
    bridgeRef.current = bridge
  }, [bridge])

  useEffect(() => {
    const server = new HttpServer()
    const guarded = (name: string, run: (req: HttpRequest) => Promise<HttpResponse>) => async (req: HttpRequest) => {
      if (busy.current) return jsonResponse({ error: "正在做别的检查" })
      busy.current = true
      setLast(`${name}：进行中`)
      const t0 = Date.now()
      try {
        const res = await run(req)
        setLast(`${name}：完成（${Math.round((Date.now() - t0) / 1000)} 秒）`)
        return res
      } catch (e) {
        setLast(`${name}：出错 ${errorText(e)}`)
        return jsonResponse({ error: errorText(e) })
      } finally {
        busy.current = false
      }
    }
    server.registerAsyncHandler("/ping", async () => jsonResponse({ stamp: STAMP, data: dataDirectory() }))
    server.registerAsyncHandler("/run/recognize", guarded("识别", async req => {
      const body = bodyJson<{ ids: string[] }>(req)
      return jsonResponse(await runRecognize(bridgeRef.current, body.ids, web))
    }))
    server.registerAsyncHandler("/run/ledger", guarded("记账", async req => jsonResponse(await runLedger(bridgeRef.current, bodyJson<Plan>(req), web))))
    server.registerAsyncHandler("/run/split", guarded("油耗与费用", async req => jsonResponse(await runSplit(bridgeRef.current, bodyJson(req), web))))
    server.registerAsyncHandler("/run/benefits", guarded("权益", async req => jsonResponse(await runBenefits(bodyJson<BenefitsPlan>(req)))))
    server.registerAsyncHandler("/run/export", guarded("导出", async req => jsonResponse(await runExportCheck(bodyJson<ExportBody>(req)))))
    server.registerAsyncHandler("/run/service", guarded("养修", async req => jsonResponse(await runService(bodyJson<ServiceBody>(req)))))
    server.registerAsyncHandler("/run/plugin", guarded("数据源插件", async () => jsonResponse(await runPlugin())))
    server.registerAsyncHandler("/run/map", guarded("地图搜索", async () => jsonResponse(await runMap())))
    server.registerAsyncHandler("/shot", guarded("截图", async req =>
      pngResponse(await takeShot(query(req, "screen"), query(req, "scheme") === "dark" ? "dark" : "light", Number(query(req, "height")) || 0))))
    const error = server.start({ port: PORT, forceIPv4: true })
    setStatus(error ? `启动失败：${error}` : `在 ${PORT} 端口等电脑的请求（STAMP ${STAMP}）`)
    console.log(`[check] ${error ? `启动失败：${error}` : `端口 ${server.port}，STAMP ${STAMP}，数据 ${dataDirectory()}`}`)
    void fetch(`${bridgeRef.current}/check_hello`, {
      method: "POST", headers: { "Content-Type": "application/json" }, timeout: 10, body: JSON.stringify({ port: server.port ?? PORT, stamp: STAMP, error }),
    }).catch(e => console.log(`[check] 报到失败：${errorText(e)}`))
    return () => {
      server.stop()
      web.dispose()
    }
  }, [])

  return <NavigationStack>
    <List navigationTitle="FuelNote Check" navigationBarTitleDisplayMode="inline" toolbar={{ cancellationAction: <Button title="关闭" action={dismiss} /> }}>
      <Section header={<Text>状态</Text>} footer={<Text>保持这一页在屏幕上，屏幕不要锁。电脑会自己发请求，不用点任何东西；数据在单独的文件夹 FuelNoteCheck，不碰油记的数据。</Text>}>
        <Text>{status}</Text>
        {last ? <Text font="footnote" foregroundStyle="secondaryLabel">{last}</Text> : null}
        <TextField title="电脑地址" value={bridge} onChanged={setBridge} autocorrectionDisabled textInputAutocapitalization="never" keyboardType="URL" />
      </Section>
      <Section header={<Text>识别扫描件用（要留在屏幕上）</Text>}>
        <WebView controller={web} frame={{ width: 320, height: 453 }} />
      </Section>
    </List>
  </NavigationStack>
}
