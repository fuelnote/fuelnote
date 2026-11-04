// 插件详情（插件化设计第 5 节，画稿 DsDetail，从设置 › 数据源推入）：提供的数据；连接状态和打码的账号，每次打开时问一次插件；
// 管理连接打开插件自己的页面；移除插件只从油记里去掉。
import { Button, EnvironmentValuesReader, HStack, Image, List, ProgressView, Section, Spacer, Text, useState, VStack } from "scripting"
import { CAPABILITY_TITLES, connectPlugin, PluginCapability, pluginsOf, pluginState, pluginStateText, pluginStatus, pluginVersion, removePlugin } from "../common/model"
import { AppActions } from "./components"

const ICONS: Record<PluginCapability, string> = {
  fuel: "doc.text", vehicles: "car.2", trips: "car", vehicle_status: "gauge.with.dots.needle.33percent", service: "wrench.and.screwdriver", fuel_price: "yensign.circle",
  info: "rectangle.stack",
}

function hint(cap: PluginCapability, name: string): string {
  if (cap === "fuel") return `记加油时从${name}选择一笔或几笔`
  if (cap === "vehicles") return "在车辆的「车辆数据」里关联到车"
  if (cap === "trips") return "记加油时按时间配停车、填里程"
  if (cap === "vehicle_status") return "记录页「当前」的油量和里程"
  if (cap === "fuel_price") return "按所在地区的挂牌价算加满要多少钱"
  // 信息卡片（2.6）：只说放在哪，卡片里写什么由插件定
  if (cap === "info") return "车况详情和记录页「当前」里的信息卡片，也能放进小组件"
  return `记费用时从${name}选一次进店，要记的几笔一起填好`
}

export function PluginDetail({ app, pluginId }: { app: AppActions; pluginId: string }) {
  const [view, setView] = useState<{ loading: boolean; account: string | null; error: string | null }>({ loading: true, account: null, error: null })
  const found = pluginsOf(app.getData()).find(p => p.id === pluginId)
  if (!found) return <List navigationTitle="插件"><Text foregroundStyle="secondaryLabel">这个插件已经移除。</Text></List>
  const plugin = found

  async function refresh() {
    setView(v => ({ ...v, loading: true }))
    const r = await pluginStatus(plugin)
    setView(r.ok ? { loading: false, account: r.value.account, error: null } : { loading: false, account: null, error: r.error.message })
  }

  async function manage() {
    setView(v => ({ ...v, loading: true }))
    const r = await connectPlugin(plugin)
    setView(r.ok ? { loading: false, account: r.value.account, error: null } : { loading: false, account: null, error: r.error.message })
  }

  async function remove(close: () => void) {
    const choice = await Dialog.actionSheet({
      title: `移除「${plugin.name}」？`,
      message: "仅从油记中移除，不删除脚本和插件中的凭据。已记录的加油不受影响。",
      actions: [{ label: "移除插件", destructive: true }],
    })
    if (choice !== 0) return
    app.setData(removePlugin(app.getData(), plugin.id))
    close()
  }

  const state = pluginState(plugin.id)
  const warn = !!view.error || state === "expired"
  const version = pluginVersion(plugin.script)
  return <EnvironmentValuesReader keys={["dismiss"]}>{env => <List
    navigationTitle={plugin.name}
    navigationSubtitle={`插件 · ${[plugin.script, version].filter(Boolean).join(" ")}`}
    onAppear={() => { void refresh() }}
  >
    <Section header={<Text>提供的数据</Text>}>
      {plugin.capabilities.map(c => <HStack key={c} spacing={12}>
        <Image systemName={ICONS[c]} font="title3" foregroundStyle="accentColor" frame={{ width: 28 }} />
        <VStack alignment="leading" spacing={2}>
          <Text font="headline">{CAPABILITY_TITLES[c]}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">{hint(c, plugin.name)}</Text>
        </VStack>
      </HStack>)}
    </Section>

    <Section header={<Text>连接</Text>} footer={<Text>连接和断开在插件自己的页面中进行。凭据保存在插件中，油记无法读取，也不在油记的备份里。</Text>}>
      <HStack>
        <Text>状态</Text>
        <Spacer />
        {view.loading
          ? <ProgressView />
          : <Text foregroundStyle={warn ? "systemOrange" : "label"} multilineTextAlignment="trailing">{view.error ?? (state ? pluginStateText(state) : "—")}</Text>}
      </HStack>
      {view.account ? <HStack><Text>账号</Text><Spacer /><Text>{view.account}</Text></HStack> : null}
      <Button action={() => { void manage() }}>
        <HStack>
          <Text foregroundStyle="accentColor">管理连接</Text>
          <Spacer />
          <Image systemName="chevron.right" font="footnote" foregroundStyle="tertiaryLabel" />
        </HStack>
      </Button>
    </Section>

    <Section footer={<Text>仅从油记中移除，不删除脚本和插件中的凭据。已记录的加油不受影响。</Text>}>
      <Button title="移除插件" role="destructive" action={() => { void remove(() => env.dismiss()) }} />
    </Section>
  </List>}</EnvironmentValuesReader>
}
