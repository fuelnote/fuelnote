// 记费用 / 编辑费用（设计文档 22.9 节；插件化设计 3.4–3.6 节，画布第十八轮 Ttl*Top、Sv*）：第一行是类别的分段（小熊的类别按 sortId，不含保险和交通规费；车险在「保险」页记），
// 下面的字段按规则变：1.6 每类都是 时间 · 金额 · 备注；1.7 每类加门店，有能用的权益时加「使用权益」和「实付」；2.1 维修保养多一组「保养」（里程、项目）。
// 填了项目才另存一条保养记录（common/maintenance.ts）；带保养记录的费用编辑时类别锁住，备注是保养的说明（导出时小熊的费用备注由它和里程、项目生成）。
// 2.3：最上面一行「标题」，空着时灰字写自动生成的标题（common/expense_title.ts）；从数据源记下的费用编辑时，标题下面一行只读的「来源」，结算明细只读显示。
// 新记时，这辆车关联的数据源提供养修，「自动填写」里有「从<数据源名>选」：选一次进店整次填好（这一笔、另记一笔、先勾的卡、门店、结算明细），
// 金额一栏叫「实付」，用了的权益不从实付里减；保存时每一笔查「可能重复」（插件化设计第 7 节）。
// 超过 4 类时（以后在小熊里再建类别，或编辑一笔保险和交通规费的费用）改成第一组的单选列表。切换类别时已填的内容保留；编辑时也能改类别。
// 「使用权益」列出所有还能用的卡（不按门店、类别筛选，权益设计第 4 节）；「用于记费用」预选的、在使用权益里新勾上的储值，手动改之前抵扣跟着金额走。
// 保存的金额是实付；门店存在费用的 store_id，备注只是用户写的内容（2.0 起；导出到小熊时才把用量和门店写进备注最后一行）。
import {
  Button, DatePicker, Form, HStack, Navigation, NavigationLink, NavigationStack, Picker, Rectangle, Section, Spacer, Text, TextField, Toggle, useEffect, useRef, useState, VStack,
} from "scripting"
import {
  AppData, autoTitle, BJ_OFFSET, categoriesFor, categoryName, checkExpense, DataSource, DataSourceMark, deductOf, ExpenseData, expenseDuplicateText, expenseUses,
  findExpenseDuplicate, fmtTime, followAmount, formCategories, isOilChange, keptNumber, lastStoreFor, MAINTENANCE_CATEGORY, MaintenanceInput, MaintenanceRecord, numText,
  parseNum, perkBook, ServiceDraft, serviceForm, ServiceVisit, Settlement, Store, usablePerks, usedItems, Use, Vehicle, vehicleRecords, yuan,
} from "../common/model"
import { StoreActions } from "./benefit_parts"
import { PerkPick } from "./benefit_pick"
import { FieldRow, SourceTag } from "./components"
import { MaintenanceItems } from "./maintenance_items"
import { serviceDay, ServiceEntry, ServiceFilled, SettlementSection } from "./service_parts"
import { ServicePick } from "./service_pick"
import { StorePicker } from "./store_picker"

/** 分段最多几段：iPhone 上不超过 5 段、各段文字长短相近（HIG · Segmented controls）；类别名长短不一，4 段为止 */
const MAX_SEGMENTS = 4
const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * maintenance：维修保养、填了项目时的「保养」一组，其他情况 null（保存时删掉这笔费用原来的保养记录）。
 * service：从数据源选了进店时，来源、这一笔的结算明细和打开的另记一笔（关掉的不在里面）
 */
export type ExpenseFormResult = {
  expense: ExpenseData; uses: Use[]; store: Store | null; maintenance: MaintenanceInput | null
  service?: { from: DataSourceMark; settlement: Settlement; others: Array<{ expense: ExpenseData; uses: Use[]; settlement: Settlement }> }
}

/** 新记时这辆车关联的、提供养修的数据源（「从<数据源名>选」）：连接时内置的打开凭据页，插件打开它自己的连接页。initial：打开时已经选好的进店（FuelNote Check 截图用） */
export type ServiceEntryProps = { source: DataSource; connect: () => Promise<void>; initial?: ServiceVisit | null }

const itemsText = (items: string[]) => (items.length <= 2 ? items.join("、") : `${items[0]} 等 ${items.length} 项`)
const usesSig = (list: Use[]) => list.map(u => `${u.perk_id}:${u.used}`).sort().join("|")

/** 另记一笔（从数据源选了进店时）：开关、标题、实付、使用权益 */
type OtherState = { on: boolean; title: string; amount: string; uses: Use[] }

/** 另记一笔的时间：和进店同一天的只写时刻 */
function otherWhen(ts: number, arrive: number): string {
  const day = (t: number) => Math.floor((t + BJ_OFFSET) / 86400e3)
  return day(ts) === day(arrive) ? fmtTime(ts) : `${serviceDay(ts)} ${fmtTime(ts)}`
}

export function ExpenseForm({ getData, vehicle, record, maintenance, odometer: defaultOdometer, initialCategory, preset, stores, service = null, onSave }: {
  getData: () => AppData
  vehicle: Vehicle
  /** 编辑时的原记录：表单的字段、门店；从数据源记下的还有结算明细和来源（只读显示） */
  record: (ExpenseData & { id: string; store_id?: string; settlement?: Settlement; data_source?: DataSourceMark }) | null
  /** 这笔费用的保养记录（编辑时）；有时类别锁住 */
  maintenance: MaintenanceRecord | null
  /** 新记保养时里程的默认值：车况的里程表；没有时 null */
  odometer: number | null
  /** 新记时默认的类别：最近一笔不是保险和交通规费的费用的类别（common/expense_stats.ts 的 defaultCategory） */
  initialCategory: number
  /** 权益详情「用于记费用」：勾上这一项、预选门店 */
  preset: { use: Use; store: Store | null } | null
  stores: StoreActions
  /** 新记时提供养修的数据源；平时 null */
  service?: ServiceEntryProps | null
  /** 保存时先调它（写进账本、刷新列表），返回 false 时表单不关；不传时把结果交回去（2.1.0-beta.8） */
  onSave?: (r: ExpenseFormResult) => Promise<boolean>
}) {
  const dismiss = Navigation.useDismiss()
  const data = getData()
  const book = perkBook(data.ledger)
  const records = vehicleRecords(data, vehicle)
  const categories = formCategories(categoriesFor(data), record?.category_id ?? null)

  // 打开时的内容：门店取 store_id，用过的权益按这笔费用的 id 找，金额加回抵扣（存的是实付）
  const [opened] = useState(() => {
    if (!record) {
      return { body: "", store: preset?.store ?? lastStoreFor(records, initialCategory, data.ledger.stores), uses: preset ? [preset.use] : [], amount: null as number | null }
    }
    const uses: Use[] = expenseUses(book, vehicle.id, record.id).flatMap(u => {
      const p = book.perks.find(x => x.id === u.perk_id)
      return p ? [{ perk_id: u.perk_id, used: u.used, deduct: deductOf(p, u.used) }] : []
    })
    const amount = round2(record.amount + uses.reduce((t, u) => t + u.deduct, 0))
    const store = record.store_id ? data.ledger.stores.find(s => s.id === record.store_id) ?? null : null
    return { body: maintenance ? maintenance.remark : record.remark, store, uses, amount: amount as number | null }
  })
  const [ts, setTs] = useState(record?.ts ?? Date.now())
  const [category, setCategory] = useState<number>(record?.category_id ?? initialCategory)
  const [title, setTitle] = useState(record?.title ?? "")
  const [amount, setAmount] = useState(opened.amount != null ? numText(opened.amount) : "")
  const [remark, setRemark] = useState(opened.body)
  const [store, setStore] = useState<Store | null>(opened.store)
  const [uses, setUses] = useState<Use[]>(opened.uses)
  // 跟着金额走的储值：「用于记费用」预选的，和在使用权益里新勾上、还没手动改过的（从数据源选了进店的不跟着金额走）
  const [follow, setFollow] = useState<string[]>(() => (preset ? [preset.use.perk_id] : []))
  const openedAmount = useRef(amount)
  const openedOdometer = maintenance ? String(maintenance.odometer) : defaultOdometer != null ? String(Math.floor(defaultOdometer)) : ""
  const [odometer, setOdometer] = useState(openedOdometer)
  const [items, setItems] = useState<string[]>(maintenance?.items ?? [])
  // 从数据源选的进店：整理好的表单内容，和项目页的来源、还没改成项目的说明、另记的几笔
  const [draft, setDraft] = useState<ServiceDraft | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [others, setOthers] = useState<OtherState[]>([])

  /** 选中一次进店：整张表重新填（D18） */
  function fill(visit: ServiceVisit) {
    if (!service) return
    const d = serviceForm(getData(), vehicle, service.source, visit)
    setDraft(d)
    setCategory(MAINTENANCE_CATEGORY)
    setTs(d.main.source.ts)
    setTitle(d.main.title)
    setAmount(d.main.amount != null ? numText(d.main.amount) : "")
    setRemark(d.main.source.remark)
    setStore(d.store)
    setUses(d.main.uses)
    setFollow([])
    setOdometer(d.main.odometer != null ? String(d.main.odometer) : "")
    setItems(d.main.items.map(i => i.name))
    setNotes(d.main.notes)
    setOthers(d.others.map(o => ({ on: true, title: o.title, amount: o.amount != null ? numText(o.amount) : "", uses: o.uses })))
  }

  useEffect(() => { if (service?.initial) fill(service.initial) }, [])

  async function pickVisit() {
    if (!service) return
    const visit = await Navigation.present<ServiceVisit | null>({ element: <ServicePick source={service.source} vehicle={vehicle} connect={service.connect} /> })
    if (visit) fill(visit)
  }

  const linked = !!draft
  const locked = !!maintenance || linked
  const isMaint = category === MAINTENANCE_CATEGORY
  const used = usedItems(data.ledger.records, vehicle.id)
  const catName = categoryName(data, category)

  const usable = usablePerks(book, vehicle.id, ts, record?.id ?? null)
  const value = keptNumber(amount, openedAmount.current, opened.amount ?? undefined)
  // 过期的卡（改了日期）不算；跟着金额走的储值按金额重新分配
  const active = followAmount(uses.filter(u => usable.some(x => x.perk.id === u.perk_id)), linked ? [] : follow, usable, value)
  const deduct = round2(active.reduce((t, u) => t + u.deduct, 0))
  const paid = value == null ? null : linked ? value : round2(value - deduct)
  const usesText = (list: Use[]) => list.map(u => `${u.perk_id}:${u.used}:${u.deduct}`).sort().join("|")
  // 按数据源的提示先勾好、还没改过的标橙（插件化设计 3.4 节）；按经销商找到、还没换过的门店标数据源的名称
  const usesSuggested = !!draft && active.length > 0 && usesSig(active) === usesSig(draft.main.uses)
  const storeFound = !!draft && !!store && store.id === draft.store?.id
  const saveItems = isMaint ? items : []
  const auto = autoTitle(data.ledger, { vehicleId: vehicle.id, maintenanceId: maintenance?.id ?? null, ts, items: saveItems, remark, category: catName })

  // 有改动时禁止下滑关闭（从数据源填好的一打开就算：内容都是填好的）
  const dirty = record
    ? ts !== record.ts || category !== record.category_id || paid !== record.amount || remark !== opened.body || title.trim() !== (record.title ?? "")
      || (store?.id ?? null) !== (opened.store?.id ?? null) || usesText(active) !== usesText(opened.uses)
      || odometer !== openedOdometer || items.join("\n") !== (maintenance?.items ?? []).join("\n")
    : !!(draft || amount || remark.trim() || title.trim() || active.length || items.length)

  function pickChanged(next: Use[], manual: string | null) {
    const added = next.filter(u => !uses.some(x => x.perk_id === u.perk_id)).map(u => u.perk_id)
    setFollow([...follow.filter(id => id !== manual && next.some(u => u.perk_id === id)), ...added.filter(id => usable.find(x => x.perk.id === id)?.perk.kind === "balance")])
    setUses(next)
  }

  function setOther(i: number, patch: Partial<OtherState>) {
    setOthers(others.map((o, j) => (j === i ? { ...o, ...patch } : o)))
  }

  /** 项目页里把说明里的一段改成项目：从「写进说明」里去掉，也从备注里去掉 */
  function noteToItem(note: string) {
    setNotes(notes.filter(n => n !== note))
    setRemark(remark.split("；").filter(x => x.trim() !== note).join("；"))
  }

  /** 打开的另记一笔：时间、备注、结算明细用数据源给的，类别是维修保养；用了的权益只算那一笔的时间还能用的 */
  function otherResults(d: ServiceDraft): Array<{ expense: ExpenseData; uses: Use[]; settlement: Settlement }> {
    return d.others.flatMap((o, i) => {
      const st = others[i]
      if (!st || !st.on) return []
      const usableO = usablePerks(book, vehicle.id, o.source.ts, null)
      return [{
        expense: { ts: o.source.ts, category_id: MAINTENANCE_CATEGORY, amount: parseNum(st.amount) as number, remark: o.source.remark, title: st.title.trim() },
        uses: st.uses.filter(u => usableO.some(x => x.perk.id === u.perk_id)),
        settlement: o.source.settlement,
      }]
    })
  }

  async function save() {
    // 编辑记录但什么都没改：直接关闭，不写数据
    if (record && !dirty) return dismiss(null)
    const errors = checkExpense(value).map(e => (linked ? e.replace("金额", "实付") : e))
    if (!linked && !errors.length && paid != null && paid < 0) errors.push(`权益抵扣合计（${yuan(deduct)}）比金额多，请在「使用权益」里改小。`)
    const odo = odometer.trim() ? Number(odometer.replace(/[,\s]/g, "")) : 0
    if (isMaint && items.length && !(Number.isFinite(odo) && odo >= 0)) errors.push("里程要填数字（公里）。")
    if (draft) {
      draft.others.forEach((o, i) => {
        if (!others[i].on) return
        const e = checkExpense(parseNum(others[i].amount))
        if (e.length) errors.push(`另记的「${others[i].title.trim() || o.source.title}」（${otherWhen(o.source.ts, draft.visit.arrive_ts)} 开单）：${e[0].replace("金额", "实付")}`)
      })
    }
    if (errors.length) {
      await Dialog.alert({ title: "还不能保存", message: errors.join("\n") })
      return
    }
    // 可能重复（插件化设计第 7 节）：同一辆车、同一天、同一类、同样金额已有一笔；从养修一次存几笔时每一笔只和账本里已有的比
    const all = data.ledger.records
    const dups: string[] = []
    const mainDup = findExpenseDuplicate(all, vehicle.id, { ts, category_id: category, amount: paid as number }, record)
    if (mainDup) dups.push(expenseDuplicateText(mainDup, categoryName(data, mainDup.category_id)))
    const otherList = draft ? otherResults(draft) : []
    for (const o of otherList) {
      const dup = findExpenseDuplicate(all, vehicle.id, o.expense)
      if (dup) dups.push(expenseDuplicateText(dup, categoryName(data, dup.category_id)))
    }
    if (dups.length) {
      const i = await Dialog.actionSheet({ title: "请确认", message: dups.join("\n"), actions: [{ label: "仍然保存" }] })
      if (i !== 0) return
    }
    // 备注没改就保留原样（导入的费用备注里有小熊写的「保养里程」「保养项目」两行，保养的说明也照旧）
    const keptRemark = record && remark === opened.body ? record.remark : remark.trim()
    const maintRemark = maintenance && remark === opened.body ? maintenance.remark : remark.trim()
    const result: ExpenseFormResult = {
      expense: { ts, category_id: category, amount: paid as number, remark: keptRemark, title: title.trim() }, uses: active, store,
      maintenance: isMaint && items.length ? { odometer: Math.round(odo), items, remark: maintRemark } : null,
      ...(draft ? { service: { from: draft.from, settlement: draft.main.source.settlement, others: otherList } } : {}),
    }
    // 先写进账本、刷新列表再关表单：表单滑走时下面已经是新的
    if (onSave && !(await onSave(result))) return
    dismiss(result)
  }

  const options = categories.map(c => <Text key={String(c.id)} tag={c.id}>{c.name}</Text>)
  const sourceName = draft ? draft.from.name : ""
  const lockNote = draft ? `从${sourceName}选的进店，类别固定为维修保养。` : "这笔费用带保养记录，类别固定为维修保养。去掉全部项目保存后只留下费用，就能改类别。"
  const own = draft ? draft.main.source.own : null
  const usesValue = active.length ? `${active.length} 项${deduct ? ` · 抵扣 ${yuan(deduct)}` : ""}` : `可用 ${usable.length} 项`
  // 选择门店：从数据源选了进店、还没找到门店时，「附近」按经销商的位置
  const dealerPoint = draft && !store && draft.dealerPoint ? draft.dealerPoint : null
  const dealerName = draft?.visit.dealer ? draft.visit.dealer.short ?? draft.visit.dealer.name : null
  const fieldsFooter = draft
    ? [
      own != null && own !== 0 ? `${sourceName}写的自付是 ${yuan(own)}，请填实际付的钱。` : "",
      usesSuggested ? `使用权益按${sourceName}的提示先勾好了（标橙）。` : "",
    ].join("")
    : active.length ? "保存的金额是实付。导出到小熊油耗时，用了哪些权益和门店写在备注最后一行。" : ""
  // 标题一组的说明（画稿 SvForm、SvFilled、TtlEditTop）
  const oil = isOilChange(saveItems)
  const sourceRow = !draft && record?.data_source ? record.data_source : null
  const titleFooter = [
    draft && oil && !title.trim()
      ? "换了机油的保养不填标题，费用页自动写第几次保养；也可以自己填。"
      : title.trim()
        ? `费用页显示这个标题，可以改；清空后${oil ? "写第几次保养" : "用备注的第一行"}。`
        : "费用页显示这个标题。空着时自动写：换了机油的保养写第几次保养，其余用备注的第一行，都没有时写类别名。",
    sourceRow ? "来源是填入时的数据源，不能改。" : "",
  ].join("")
  const settlement = draft ? draft.main.source.settlement : record?.settlement ?? null
  const refsSource = draft ? sourceName : record?.data_source?.name ?? ""

  return <NavigationStack interactiveDismissDisabled={dirty}>
    <Form
      navigationTitle={record ? "编辑费用" : "记费用"}
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        cancellationAction: <Button title="取消" action={() => dismiss(null)} />,
        confirmationAction: <Button title="保存" action={save} />,
        keyboard: <HStack><Spacer /><Button title="完成" action={() => Keyboard.hide()} /></HStack>,
      }}
    >
      {categories.length <= MAX_SEGMENTS
        // 分段直接放在背景上（与统计页的范围相同）
        ? <Section key="category" {...(locked ? { footer: <Text>{lockNote}</Text> } : {})}>
          <Picker title="类别" value={category} onChanged={(v: number) => setCategory(v)} pickerStyle="segmented" disabled={locked}
            listRowInsets={0} listRowBackground={<Rectangle fill="rgba(0,0,0,0)" />}>
            {options}
          </Picker>
        </Section>
        : <Section key="category" header={<Text>类别</Text>} {...(locked ? { footer: <Text>{lockNote}</Text> } : {})}>
          <Picker title="类别" value={category} onChanged={(v: number) => setCategory(v)} pickerStyle="inline" labelsHidden disabled={locked}>
            {options}
          </Picker>
        </Section>}
      {!record && service ? <Section key="autofill" header={<Text>自动填写</Text>}>
        {draft
          ? <ServiceFilled name={sourceName} visit={draft.visit} onChange={() => { void pickVisit() }} />
          : <ServiceEntry name={service.source.name} state={service.source.state()} onTap={() => { void pickVisit() }} />}
      </Section> : null}
      <Section key="title" footer={<Text>{titleFooter}</Text>}>
        <HStack>
          <Text>标题</Text>
          <TextField title="标题" value={title} onChanged={setTitle} prompt={auto} multilineTextAlignment="trailing" />
        </HStack>
        {sourceRow ? <HStack>
          <Text>来源</Text>
          <Spacer />
          <Text foregroundStyle="secondaryLabel">{sourceRow.name}</Text>
        </HStack> : null}
      </Section>
      <Section key="fields" {...(fieldsFooter ? { footer: <Text>{fieldsFooter}</Text> } : {})}>
        <DatePicker title="时间" value={ts} onChanged={setTs} displayedComponents={["date", "hourAndMinute"]} />
        <NavigationLink destination={<StorePicker getData={getData} selected={store} onPick={setStore} stores={stores}
          near={dealerPoint ? { point: dealerPoint, label: `${dealerName || "经销商"}附近` } : { vehicle, ts }} query="" />}>
          <HStack>
            <Text>门店</Text>
            {storeFound ? <SourceTag title={sourceName} /> : null}
            <Spacer />
            <Text foregroundStyle={store ? "label" : "secondaryLabel"} lineLimit={1}>{store?.name ?? "不选"}</Text>
          </HStack>
        </NavigationLink>
        <FieldRow title={linked ? "实付" : "金额"} unit="元">
          <TextField title={linked ? "实付" : "金额"} value={amount} onChanged={setAmount} prompt={draft && draft.main.amount == null ? "必填" : "0.00"}
            keyboardType="decimalPad" multilineTextAlignment="trailing" />
        </FieldRow>
        {usable.length || active.length
          ? <NavigationLink destination={<PerkPick usable={usable} uses={active} amount={linked ? null : value} onChange={pickChanged}
            {...(settlement && settlement.coupons.length ? { refs: settlement.coupons, refsSource } : {})} {...(linked ? { linked: true } : {})} />}>
            <HStack>
              <Text>使用权益</Text>
              <Spacer />
              <Text foregroundStyle={usesSuggested ? "systemOrange" : "secondaryLabel"}>{usesValue}</Text>
            </HStack>
          </NavigationLink>
          : null}
        {active.length && !linked ? <HStack>
          <Text>实付</Text>
          <Spacer />
          <Text font="headline">{paid != null ? yuan(paid) : "—"}</Text>
        </HStack> : null}
      </Section>
      {isMaint && (!draft || draft.main.items.length || items.length) ? <Section key="maintenance" header={<Text>保养</Text>}
        {...(draft ? {} : { footer: <Text>{locked ? "保养记录和这笔费用一起改。" : "里程默认取车况的里程表。填了项目才另存一条保养记录，费用页里和这笔费用合成一行；不填只记费用。"}</Text> })}>
        <FieldRow title="里程" unit="km">
          <TextField title="里程" value={odometer} onChanged={setOdometer} prompt="0" keyboardType="numberPad" multilineTextAlignment="trailing" />
        </FieldRow>
        <NavigationLink destination={<MaintenanceItems items={items} used={used} onChange={setItems}
          {...(draft ? { sources: Object.fromEntries(draft.main.items.map(i => [i.name, i.from])), notes, onNote: noteToItem } : {})} />}>
          <HStack>
            <Text>项目</Text>
            <Spacer />
            <Text foregroundStyle={items.length ? "label" : "secondaryLabel"} lineLimit={1}>{items.length ? itemsText(items) : "选择项目"}</Text>
          </HStack>
        </NavigationLink>
      </Section> : null}
      {settlement ? <SettlementSection settlement={settlement} note={draft ? "只读，对照着勾使用权益。" : `只读，从${refsSource || "数据源"}填入时存下。`} /> : null}
      {draft ? draft.others.map((o, i) => {
        const st = others[i]
        if (!st) return null
        const usableO = usablePerks(book, vehicle.id, o.source.ts, null)
        const activeO = st.uses.filter(u => usableO.some(x => x.perk.id === u.perk_id))
        const suggested = activeO.length > 0 && usesSig(activeO) === usesSig(o.uses)
        const coupons = o.source.settlement.coupons.map(c => (c.amount != null ? `${c.name} −${yuan(c.amount)}` : c.name))
        const sub = [`${otherWhen(o.source.ts, draft.visit.arrive_ts)} 开单`, ...coupons, `自付 ${yuan(o.source.own)}`].join(" · ")
        const last = i === draft.others.length - 1
        return <Section key={`other-${i}`} {...(i === 0 ? { header: <Text>同一次进店</Text> } : {})}
          {...(last ? { footer: <Text>{`这次进店的其他几笔，各记成一笔维修保养费用：时间、标题和备注按${sourceName}给的，标题可以改。关掉的不记，以后也不再提醒。`}</Text> } : {})}>
          <Toggle value={st.on} onChanged={on => setOther(i, { on })}>
            <VStack alignment="leading" spacing={2}>
              <Text>另记一笔</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">{sub}</Text>
            </VStack>
          </Toggle>
          {st.on ? <HStack>
            <Text>标题</Text>
            <TextField title="标题" value={st.title} onChanged={t => setOther(i, { title: t })} multilineTextAlignment="trailing"
              prompt={autoTitle(data.ledger, { vehicleId: vehicle.id, maintenanceId: null, ts: o.source.ts, items: [], remark: o.source.remark, category: categoryName(data, MAINTENANCE_CATEGORY) })} />
          </HStack> : null}
          {st.on ? <FieldRow title="实付" unit="元">
            <TextField title="实付" value={st.amount} onChanged={a => setOther(i, { amount: a })} prompt={o.amount == null ? "必填" : "0.00"}
              keyboardType="decimalPad" multilineTextAlignment="trailing" />
          </FieldRow> : null}
          {st.on && (usableO.length || activeO.length) ? <NavigationLink destination={<PerkPick usable={usableO} uses={activeO} amount={null} linked
            {...(o.source.settlement.coupons.length ? { refs: o.source.settlement.coupons, refsSource: sourceName } : {})}
            onChange={next => setOther(i, { uses: next })} />}>
            <HStack>
              <Text>使用权益</Text>
              <Spacer />
              <Text foregroundStyle={suggested ? "systemOrange" : "secondaryLabel"}>{activeO.length ? `${activeO.length} 项` : `可用 ${usableO.length} 项`}</Text>
            </HStack>
          </NavigationLink> : null}
        </Section>
      }) : null}
      <Section key="remark" header={<Text>备注</Text>}
        footer={<Text>{locked
          ? "里程和项目不用再写进备注，导出到小熊时油记会自动加上。"
          : record ? "可以改类别。车险在「保险」页记。" : "默认是最近一笔费用的类别和这一类上次的门店；切换类别时，已填的内容保留。车险在「保险」页记。"}</Text>}>
        <TextField title="备注" value={remark} onChanged={setRemark} prompt={isMaint ? "选填" : "项目等"} axis="vertical" lineLimit={{ min: 1, max: 4 }} />
      </Section>
    </Form>
  </NavigationStack>
}
