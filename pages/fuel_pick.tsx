// 选交易（插件化设计第 3 节，画稿 DsPickOne、DsPickMerge、DsPickWarn、DsPickStates、第十七轮 DsPickMore）：记加油「自动填写」里的「从<插件名>选」弹出这一页。
// 表单有时间时列前后 1 天的，离它近的在前；没有时按月分组、新的在前，一开始列本月和上月，最下面「加载更早的交易」一次往前一个月。
// 可以选一笔，也可以选几笔合成一次加油；不能合成时「填入」不可用，用红字写明原因。下拉刷新不看缓存（没有时间时只重读本月和上月）。
// 读取中、没有交易、未连接、已过期、网络错误、插件不可用各有样子；加载更早的出错时只在那一行写明，已经列出的不动。
import {
  Button, ContentUnavailableView, HStack, Image, Label, List, Navigation, NavigationStack, ProgressView, Section, Spacer, Text, useEffect, useState, VirtualNode, VStack,
} from "scripting"
import {
  appendTxns, connectPlugin, firstMonth, FuelTxn, gradeText, groupByMonth, mergeTxns, monthRange, monthsDown, pickMonthTitle, pickRange, pluginFuel, PluginError, PluginRef, prevMonth,
  replaceRecent, sortTxns, TxnMerge,
} from "../common/model"
import { money, stopWhen } from "./components"

/** start：选的时候列到的最早月份（「更换」时加载回这里）；有时间时只列前后 1 天，是 null */
export type FuelPickResult = { txn: FuelTxn; parts: FuelTxn[]; start?: string | null }

const PICK_FOOT = "可以选一笔，也可以选几笔合成一次加油，例如油卡余额不足、再用钱包补足。"
const MERGE_FOOT = "单价相同、在同一个油站的几笔才能合成：升数、机显金额和实付分别相加，时间取最早一笔；标号不同时不填。"

const detailLine = (t: { liters: number; grade: number | null; price: number }) =>
  [`${t.liters.toFixed(2)} L`, t.grade != null ? gradeText(t.grade) : "", `${t.price.toFixed(2)} 元/升`].filter(Boolean).join(" · ")

function Amounts({ t, bold }: { t: { paid: number; amount: number }; bold?: boolean }) {
  return <VStack alignment="trailing" spacing={2}>
    <Text font="body" fontWeight={bold ? "semibold" : "regular"}>{money(t.paid)}</Text>
    {Math.abs(t.amount - t.paid) > 0.005 ? <Text font="caption" foregroundStyle="secondaryLabel">{`机显 ${money(t.amount)}`}</Text> : null}
  </VStack>
}

/** 付款方式（插件给的，例如「油卡」「钱包」） */
function Channel({ text }: { text: string }) {
  return <Text font="caption2" foregroundStyle="secondaryLabel" padding={{ horizontal: 6, vertical: 1 }}
    background={{ style: "quaternarySystemFill", shape: { type: "rect", cornerRadius: 8 } }}>{text}</Text>
}

function TxnRow({ t, selected, onTap }: { t: FuelTxn; selected: boolean; onTap: () => void }) {
  return <Button action={onTap}>
    <HStack spacing={12} foregroundStyle="label">
      <Image systemName={selected ? "checkmark.circle.fill" : "circle"} font="title3" foregroundStyle={selected ? "accentColor" : "tertiaryLabel"} />
      <VStack alignment="leading" spacing={2}>
        <HStack spacing={6}>
          <Text>{stopWhen(t.ts)}</Text>
          {t.channel ? <Channel text={t.channel} /> : null}
        </HStack>
        <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={1}>{t.station?.name ?? "没有站名"}</Text>
        <Text font="footnote" foregroundStyle="secondaryLabel">{detailLine(t)}</Text>
      </VStack>
      <Spacer />
      <Amounts t={t} />
    </HStack>
  </Button>
}

/** 合成后的一行：第二行写是哪几笔 */
function MergedRow({ m }: { m: Extract<TxnMerge, { ok: true }> }) {
  const parts = m.parts.map(p => `${p.channel ?? ""} ${p.liters.toFixed(2)} L`.trim()).join(" + ")
  return <HStack spacing={12}>
    <Image systemName="doc.text" font="title3" foregroundStyle="accentColor" />
    <VStack alignment="leading" spacing={2}>
      <HStack spacing={6}>
        <Text>{stopWhen(m.txn.ts)}</Text>
        <Channel text={`合成 ${m.parts.length} 笔`} />
      </HStack>
      <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={1}>{parts}</Text>
      <Text font="footnote" foregroundStyle="secondaryLabel">{detailLine(m.txn)}</Text>
    </VStack>
    <Spacer />
    <Amounts t={m.txn} bold />
  </HStack>
}

function Note({ text, color, systemImage }: { text: string; color: "systemRed" | "systemOrange"; systemImage: string }) {
  return <HStack spacing={8} alignment="top">
    <Image systemName={systemImage} font="subheadline" foregroundStyle={color} />
    <Text font="subheadline" foregroundStyle={color === "systemRed" ? "systemRed" : "label"}>{text}</Text>
  </HStack>
}

/** 加载更早的交易：读取中、出错（已经列出的不动）、刚加载的那个月没有交易 */
type More = { loading: boolean; error: PluginError | null; empty: string | null }
const MORE_IDLE: More = { loading: false, error: null, empty: null }

/** 出错时的标题：和整页的说法一样 */
function errorTitle(e: PluginError, name: string): string {
  if (e.kind === "expired") return `${name}需要重新连接`
  if (e.kind === "not_connected") return `尚未连接${name}`
  return e.kind === "network" || e.kind === "timeout" ? `无法连接${name}` : `无法读取${name}`
}

/**
 * plugin：提供加油交易的插件；at：表单里已有的时间（截图、停车、手动改过的才算，默认的现在不算），没有时 null。
 * back：没有时间时一开始就加载到的月份（「更换」时是上次加载到的，common/fuel_pick.ts 的 pickOpening），没有时只列本月和上月。
 * selected：先勾上的交易（「更换」时是原来选的几笔；FuelNote Check 截图也用）。选好以后关闭并交回合成后的一笔、它是哪几笔、列到的最早月份
 */
export function FuelPick({ plugin, at, back, selected: preset }: { plugin: PluginRef; at: number | null; back?: string | null; selected?: string[] }) {
  const dismiss = Navigation.useDismiss()
  // start：没有时间时已经列出的最早一个月。一起变的放在一个状态里，await 之后一次更新
  const [state, setState] = useState<{ list: FuelTxn[] | null; error: PluginError | null; start: string | null; more: More }>(
    { list: null, error: null, start: null, more: MORE_IDLE })
  const [selected, setSelected] = useState<string[]>(preset ?? [])

  /** 第一次读、重试、连接以后：有时间时读前后 1 天；没有时读本月和上月，再一个月一个月加载到 back */
  async function load(force: boolean) {
    const now = Date.now()
    const r = await pluginFuel(plugin, pickRange(at, now), force)
    setState(r.ok
      ? { list: sortTxns(r.value, at), error: null, start: at == null ? firstMonth(now) : null, more: MORE_IDLE }
      : { list: null, error: r.error, start: null, more: MORE_IDLE })
    if (r.ok && at == null && back) await loadTo(firstMonth(now), back)
  }

  /** 从 from 往前一个月一个月加载到 target：每个月一次调用（当天读过的用缓存），出错就停在这一行 */
  async function loadTo(from: string, target: string) {
    for (const month of monthsDown(from, target)) {
      setState(s => ({ ...s, more: { loading: true, error: null, empty: null } }))
      const r = await pluginFuel(plugin, monthRange(month), false)
      if (!r.ok) {
        setState(s => ({ ...s, more: { loading: false, error: r.error, empty: null } }))
        return
      }
      setState(s => ({ ...s, list: sortTxns(appendTxns(s.list ?? [], r.value), null), start: month, more: { loading: false, error: null, empty: r.value.length ? null : month } }))
    }
  }

  /** 下拉刷新：有时间时重读前后 1 天；没有时只重读本月和上月，更早加载过的留着（一次重读很多个月会超时） */
  async function refresh() {
    if (at != null || !state.list) return load(true)
    const now = Date.now()
    const first = firstMonth(now)
    const r = await pluginFuel(plugin, pickRange(null, now), true)
    setState(s => (r.ok && s.list
      ? { ...s, list: sortTxns(replaceRecent(s.list, r.value, first), null), error: null, more: MORE_IDLE }
      : r.ok ? s : { ...s, more: { loading: false, error: r.error, empty: null } }))
  }

  /** 加载更早的交易：一次一个月，正好是插件的一次调用、油记的一个缓存单位 */
  async function loadMore() {
    const start = state.start
    if (!start || state.more.loading) return
    await loadTo(start, prevMonth(start))
  }

  useEffect(() => { void load(false) }, [])

  async function connect() {
    setState({ list: null, error: null, start: null, more: MORE_IDLE })
    await connectPlugin(plugin)
    await load(true)
  }

  /** 加载更早的时登录过期：打开插件的页面，回来以后接着加载这个月 */
  async function reconnectMore() {
    await connectPlugin(plugin)
    await loadMore()
  }

  const toggle = (id: string) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]))
  const list = state.list ?? []
  const picked = list.filter(t => selected.includes(t.id))
  const merge = picked.length ? mergeTxns(picked) : null
  const ok = merge && merge.ok ? merge : null
  const name = plugin.name
  const now = Date.now()

  let overlay: VirtualNode | null = null
  const e = state.error
  if (!state.list && !e) {
    overlay = <VStack spacing={10}><ProgressView /><Text foregroundStyle="secondaryLabel">{`正在读取${name}…`}</Text></VStack>
  } else if (e && e.kind === "not_connected") {
    overlay = <ContentUnavailableView label={<Label title={`尚未连接${name}`} systemImage="powerplug" />}
      description={<Text>{`连接后，记加油时可以选择${name}的加油交易。`}</Text>}
      actions={[<Button title="连接" action={() => { void connect() }} buttonStyle="borderedProminent" />]} />
  } else if (e && e.kind === "expired") {
    overlay = <ContentUnavailableView label={<Label title={`${name}需要重新连接`} systemImage="key" />}
      description={<Text>{e.message}</Text>}
      actions={[<Button title="重新连接" action={() => { void connect() }} buttonStyle="borderedProminent" />]} />
  } else if (e && e.kind === "unavailable") {
    overlay = <ContentUnavailableView title={`找不到${name}插件`} systemImage="puzzlepiece.extension"
      description={`脚本「${plugin.script}」不存在或没有响应。请在设置 › 数据源中检查。`} />
  } else if (e) {
    overlay = <ContentUnavailableView label={<Label title={errorTitle(e, name)} systemImage="exclamationmark.circle" />}
      description={<Text>{e.message}</Text>}
      actions={[<Button title="重试" action={() => { setState({ list: null, error: null, start: null, more: MORE_IDLE }); void load(true) }} buttonStyle="bordered" />]} />
  } else if (!list.length && at != null) {
    overlay = <ContentUnavailableView title={`${stopWhen(at)} 前后 1 天没有加油交易`} systemImage="fuelpump" description="只列出已完成的加油。也可以拍照或选择截图识别。" />
  }

  // 表单有时间时：一组，离它近的在前
  const near = at != null && list.length
    ? <Section header={<HStack><Text>{`${stopWhen(at)} 前后 1 天`}</Text><Spacer /><Text>{`${list.length} 笔`}</Text></HStack>}
      footer={<Text>{"按表单中的时间列出，时间近的在前。" + PICK_FOOT}</Text>}>
      {list.map(t => <TxnRow key={t.id} t={t} selected={selected.includes(t.id)} onTap={() => toggle(t.id)} />)}
    </Section>
    : null

  // 没有时间时：按月分组，最下面「加载更早的交易」（画稿 DsPickMore、DsPickMoreStates）
  let months: VirtualNode[] = []
  let moreSection: VirtualNode | null = null
  if (at == null && state.list && state.start) {
    months = groupByMonth(list).map(g => <Section key={g.month}
      header={<HStack><Text>{pickMonthTitle(g.month, now)}</Text><Spacer /><Text>{`${g.items.length} 笔`}</Text></HStack>}>
      {g.items.map(t => <TxnRow key={t.id} t={t} selected={selected.includes(t.id)} onTap={() => toggle(t.id)} />)}
    </Section>)
    const next = pickMonthTitle(prevMonth(state.start), now)
    const m = state.more
    const listed = list.length ? `已列出 ${pickMonthTitle(state.start, now)} 1 日以后的交易。` : `${pickMonthTitle(state.start, now)} 1 日以后没有加油交易。`
    const foot = listed + (m.empty ? `${pickMonthTitle(m.empty, now)}没有加油交易。` : "") + "新的在前，每次往前加载一个月。" + PICK_FOOT
    const relink = !!m.error && (m.error.kind === "expired" || m.error.kind === "not_connected")
    moreSection = <Section key="more" footer={<Text>{foot}</Text>}>
      {m.loading
        ? <HStack spacing={8}><ProgressView /><Text foregroundStyle="secondaryLabel">{`正在读取 ${next}…`}</Text></HStack>
        : m.error
          ? [<Text key="err" font="footnote" foregroundStyle="systemRed">{`${errorTitle(m.error, name)}：${m.error.message}`}</Text>,
            <Button key="retry" title={relink ? "重新连接" : "重试"} systemImage="arrow.clockwise" action={() => { void (relink ? reconnectMore() : loadMore()) }} />]
          : <Button action={() => { void loadMore() }}>
            <HStack spacing={12}>
              <Image systemName="clock.arrow.circlepath" foregroundStyle="accentColor" />
              <VStack alignment="leading" spacing={1}>
                <Text foregroundStyle="accentColor">加载更早的交易</Text>
                <Text font="footnote" foregroundStyle="secondaryLabel">{next}</Text>
              </VStack>
            </HStack>
          </Button>}
    </Section>
  }

  return <NavigationStack>
    <List
      navigationTitle={`从${name}选`}
      navigationBarTitleDisplayMode="inline"
      refreshable={async () => { await refresh() }}
      toolbar={{
        cancellationAction: <Button title="取消" action={() => dismiss(null)} />,
        confirmationAction: <Button title="填入" disabled={!ok} action={() => { if (ok) dismiss({ txn: ok.txn, parts: ok.parts, start: state.start } as FuelPickResult) }} />,
      }}
      {...(overlay ? { overlay } : {})}
    >
      {near}
      {months}
      {moreSection}
      {picked.length > 1 && merge ? <Section header={<Text>合成</Text>} footer={<Text>{MERGE_FOOT}</Text>}>
        {merge.ok
          ? [...merge.warnings.map((w, i) => <Note key={`w${i}`} text={w} color="systemOrange" systemImage="exclamationmark.triangle.fill" />), <MergedRow key="m" m={merge} />]
          : <Note text={merge.reason} color="systemRed" systemImage="exclamationmark.circle" />}
      </Section> : null}
    </List>
  </NavigationStack>
}
