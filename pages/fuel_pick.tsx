// 选交易（插件化设计第 3 节，画稿 DsPickOne、DsPickMerge、DsPickWarn、DsPickStates）：记加油「自动填写」里的「从<插件名>选」弹出这一页。
// 表单有时间时列前后 1 天的，离它近的在前；没有时列最近 30 天的，新的在前。可以选一笔，也可以选几笔合成一次加油；
// 不能合成时「填入」不可用，用红字写明原因。下拉刷新不看缓存。读取中、没有交易、未连接、已过期、网络错误、插件不可用各有样子。
import {
  Button, ContentUnavailableView, HStack, Image, Label, List, Navigation, NavigationStack, ProgressView, Section, Spacer, Text, useEffect, useState, VirtualNode, VStack,
} from "scripting"
import { connectPlugin, FuelTxn, gradeText, mergeTxns, pickRange, pluginFuel, PluginError, PluginRef, sortTxns, TxnMerge } from "../common/model"
import { money, stopWhen } from "./components"

export type FuelPickResult = { txn: FuelTxn; parts: FuelTxn[] }

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

/**
 * plugin：提供加油交易的插件；at：表单里已有的时间（截图、停车、手动改过的才算，默认的现在不算），没有时 null。
 * selected：先选好的交易（FuelNote Check 截图用）。选好以后关闭并交回合成后的一笔和它是哪几笔
 */
export function FuelPick({ plugin, at, selected: preset }: { plugin: PluginRef; at: number | null; selected?: string[] }) {
  const dismiss = Navigation.useDismiss()
  const [state, setState] = useState<{ list: FuelTxn[] | null; error: PluginError | null }>({ list: null, error: null })
  const [selected, setSelected] = useState<string[]>(preset ?? [])

  async function load(force: boolean) {
    const r = await pluginFuel(plugin, pickRange(at, Date.now()), force)
    setState(r.ok ? { list: sortTxns(r.value, at), error: null } : { list: null, error: r.error })
  }

  useEffect(() => { void load(false) }, [])

  async function connect() {
    setState({ list: null, error: null })
    await connectPlugin(plugin)
    await load(true)
  }

  const toggle = (id: string) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]))
  const list = state.list ?? []
  const picked = list.filter(t => selected.includes(t.id))
  const merge = picked.length ? mergeTxns(picked) : null
  const ok = merge && merge.ok ? merge : null
  const head = at != null ? `${stopWhen(at)} 前后 1 天` : "最近 30 天"
  const name = plugin.name

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
    overlay = <ContentUnavailableView label={<Label title={e.kind === "network" || e.kind === "timeout" ? `无法连接${name}` : `无法读取${name}`} systemImage="exclamationmark.circle" />}
      description={<Text>{e.message}</Text>}
      actions={[<Button title="重试" action={() => { setState({ list: null, error: null }); void load(true) }} buttonStyle="bordered" />]} />
  } else if (!list.length) {
    overlay = <ContentUnavailableView title={`${head}没有加油交易`} systemImage="fuelpump" description="只列出已完成的加油。也可以拍照或选择截图识别。" />
  }

  return <NavigationStack>
    <List
      navigationTitle={`从${name}选`}
      navigationBarTitleDisplayMode="inline"
      refreshable={async () => { await load(true) }}
      toolbar={{
        cancellationAction: <Button title="取消" action={() => dismiss(null)} />,
        confirmationAction: <Button title="填入" disabled={!ok} action={() => { if (ok) dismiss({ txn: ok.txn, parts: ok.parts } as FuelPickResult) }} />,
      }}
      {...(overlay ? { overlay } : {})}
    >
      {list.length ? <Section header={<HStack><Text>{head}</Text><Spacer /><Text>{`${list.length} 笔`}</Text></HStack>}
        footer={<Text>{(at != null ? "按表单中的时间列出，时间近的在前。" : "新的在前。") + PICK_FOOT}</Text>}>
        {list.map(t => <TxnRow key={t.id} t={t} selected={selected.includes(t.id)} onTap={() => toggle(t.id)} />)}
      </Section> : null}
      {picked.length > 1 && merge ? <Section header={<Text>合成</Text>} footer={<Text>{MERGE_FOOT}</Text>}>
        {merge.ok
          ? [...merge.warnings.map((w, i) => <Note key={`w${i}`} text={w} color="systemOrange" systemImage="exclamationmark.triangle.fill" />), <MergedRow key="m" m={merge} />]
          : <Note text={merge.reason} color="systemRed" systemImage="exclamationmark.circle" />}
      </Section> : null}
    </List>
  </NavigationStack>
}
