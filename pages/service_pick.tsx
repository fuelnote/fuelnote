// 从<数据源名>选（插件化设计 3.4 节，画布第十八轮 SvPick、SvPickStates）：数据源给的已结算的进店，按年分组、新的在前；每行写日期、叫法、到店里程、项目和要记几笔。
// 轻点一次进店就关闭，交回这次进店，记费用整次填好（D18）。不标「可能已记」（D5）。读取中；没有已结算的进店；未连接、已过期给按钮（连接以后重新读）；
// 网络错误「重试」；插件不可用。下拉重新读（不看缓存）。说明文字照记加油的选交易页。
import { Button, ContentUnavailableView, HStack, Label, List, Navigation, NavigationStack, ProgressView, Section, Spacer, Text, useEffect, useState, VirtualNode, VStack } from "scripting"
import { BJ_OFFSET, DataSource, PluginError, readService, ServiceVisit, Vehicle } from "../common/model"
import { VisitRow } from "./service_parts"

const yearOf = (ts: number) => new Date(ts + BJ_OFFSET).getUTCFullYear()

/** 出错时的标题：和记加油的选交易页一样的说法 */
function errorTitle(e: PluginError, name: string): string {
  return e.kind === "network" || e.kind === "timeout" ? `无法连接${name}` : `无法读取${name}`
}

/** source：这辆车关联的、提供养修的数据源；connect：内置的打开凭据页，插件打开它自己的连接页，回来以后重新读 */
export function ServicePick({ source, vehicle, connect }: { source: DataSource; vehicle: Vehicle; connect: () => Promise<void> }) {
  const dismiss = Navigation.useDismiss()
  const [state, setState] = useState<{ list: ServiceVisit[] | null; error: PluginError | null }>({ list: null, error: null })

  async function load(force: boolean) {
    const r = await readService(source, vehicle, force)
    setState(r.ok ? { list: r.value, error: null } : { list: null, error: r.error })
  }

  useEffect(() => { void load(false) }, [])

  async function reconnect() {
    setState({ list: null, error: null })
    await connect()
    await load(true)
  }

  function retry() {
    setState({ list: null, error: null })
    void load(true)
  }

  const name = source.name
  const list = state.list ?? []
  const e = state.error
  let overlay: VirtualNode | null = null
  if (!state.list && !e) {
    overlay = <VStack spacing={10}><ProgressView /><Text foregroundStyle="secondaryLabel">{`正在读取${name}…`}</Text></VStack>
  } else if (e && e.kind === "not_connected") {
    overlay = <ContentUnavailableView label={<Label title={`尚未连接${name}`} systemImage="powerplug" />}
      description={<Text>{`连接后，记费用时可以选择${name}的进店。`}</Text>}
      actions={[<Button title="连接" action={() => { void reconnect() }} buttonStyle="borderedProminent" />]} />
  } else if (e && e.kind === "expired") {
    overlay = <ContentUnavailableView label={<Label title={`${name}需要重新连接`} systemImage="key" />}
      description={<Text>{e.message}</Text>}
      actions={[<Button title="重新连接" action={() => { void reconnect() }} buttonStyle="borderedProminent" />]} />
  } else if (e && e.kind === "unavailable") {
    overlay = <ContentUnavailableView title={`找不到${name}插件`} systemImage="puzzlepiece.extension" description="脚本不存在或没有响应。请在设置 › 数据源中检查。" />
  } else if (e) {
    overlay = <ContentUnavailableView label={<Label title={errorTitle(e, name)} systemImage="exclamationmark.circle" />}
      description={<Text>{e.message}</Text>}
      actions={[<Button title="重试" action={retry} buttonStyle="bordered" />]} />
  } else if (!list.length) {
    overlay = <ContentUnavailableView title="没有已结算的进店" systemImage="wrench.adjustable" description={`${name}里还没有结算过的进店。`} />
  }

  const years: Array<{ year: number; items: ServiceVisit[] }> = []
  for (const v of list) {
    const y = yearOf(v.arrive_ts)
    let g = years[years.length - 1]
    if (!g || g.year !== y) { g = { year: y, items: [] }; years.push(g) }
    g.items.push(v)
  }

  return <NavigationStack>
    <List
      navigationTitle={`从${name}选`}
      navigationBarTitleDisplayMode="inline"
      refreshable={async () => { await load(true) }}
      toolbar={{ cancellationAction: <Button title="取消" action={() => dismiss(null)} /> }}
      {...(overlay ? { overlay } : {})}
    >
      {years.map((g, i) => <Section key={String(g.year)} header={<HStack><Text>{`${g.year} 年`}</Text><Spacer /><Text>{`${g.items.length} 次`}</Text></HStack>}
        {...(i === years.length - 1 ? { footer: <Text>{`只列出${name}里已结算的进店，新的在前。轻点一次进店，这次要记的几笔一起填好；右边是要记几笔。`}</Text> } : {})}>
        {g.items.map(v => <Button key={v.id} action={() => dismiss(v)}>
          <VisitRow visit={v} />
        </Button>)}
      </Section>)}
    </List>
  </NavigationStack>
}
