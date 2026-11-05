// 插件详情（插件化设计第 5 节，画稿 DsDetail，从设置 › 数据源推入）：提供的数据；连接状态和打码的账号，每次打开时问一次插件；
// 管理连接打开插件自己的页面；移除插件只从油记里去掉。
// 2.7（5.1、5.2 节，画稿第三十轮 R30DetailA，第三十一轮 R31Choices A）：副标题写版本和脚本名；提供的数据轻点一行勾上或取消，不用的一项变灰；
// 车辆没有勾，只剩一项时勾是灰的、点了没反应。beta.1 用的是开关，iOS 26 的开关太宽，和两行字的行不协调（D29）。
import { Button, EnvironmentValuesReader, HStack, Image, List, ProgressView, Section, Spacer, Text, useState, VStack } from "scripting"
import {
  CAPABILITY_TITLES, CapabilitySwitch, capabilitySwitch, connectPlugin, PluginCapability, pluginsOf, pluginState, pluginStateText, pluginStatus, pluginSubtitle, pluginVersion, removePlugin,
  setPluginCapability,
} from "../common/model"
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
  if (cap === "info") return "记录页「当前」下面的信息卡片，也能放进小组件"
  return `记费用时从${name}选一次进店，要记的几笔一起填好`
}

const CAPS_FOOT = "轻点勾上或取消。不勾的一项，油记不再向插件要这项数据，用到它的地方也不再显示；已记的记录不受影响。至少留一项，都不用时移除插件。"
const VEHICLES_FOOT = "「车辆」用来关联车，行程、车况、养修都要用到，没有勾。"

/** 一项：图标、名称和说明，右边的勾（画稿 R31Choices A）。不用的一项图标和名称变灰；只剩一项时勾是灰的；车辆没有勾 */
function CapabilityRow({ cap, name, state }: { cap: PluginCapability; name: string; state: CapabilitySwitch }) {
  const dim = state === "off"
  return <HStack spacing={12}>
    <Image systemName={ICONS[cap]} font="title3" foregroundStyle={dim ? "secondaryLabel" : "accentColor"} frame={{ width: 28 }} />
    <VStack alignment="leading" spacing={2}>
      <Text font="headline" foregroundStyle={dim ? "secondaryLabel" : "label"}>{CAPABILITY_TITLES[cap]}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel">{hint(cap, name)}</Text>
    </VStack>
    <Spacer />
    {state === "on" || state === "locked"
      ? <Image systemName="checkmark" font="body" fontWeight="semibold" foregroundStyle={state === "on" ? "accentColor" : "tertiaryLabel"} />
      : null}
  </HStack>
}

export function PluginDetail({ app, pluginId }: { app: AppActions; pluginId: string }) {
  const [view, setView] = useState<{ loading: boolean; account: string | null; error: string | null }>({ loading: true, account: null, error: null })
  const [, setTick] = useState(0)
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

  /** 勾上或取消一项：存进设置，这一页跟着重画；车辆、只剩的一项不变（setCapability 里挡住） */
  function toggle(cap: PluginCapability, on: boolean) {
    app.setData(setPluginCapability(app.getData(), plugin.id, cap, on))
    setTick(t => t + 1)
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
    navigationSubtitle={pluginSubtitle(plugin, version)}
    onAppear={() => { void refresh() }}
  >
    <Section header={<Text>提供的数据</Text>} footer={<Text>{(plugin.capabilities.includes("vehicles") ? VEHICLES_FOOT : "") + CAPS_FOOT}</Text>}>
      {plugin.capabilities.map(c => {
        const sw = capabilitySwitch(plugin, c)
        if (sw === "fixed") return <CapabilityRow key={c} cap={c} name={plugin.name} state={sw} />
        return <Button key={c} action={() => { if (sw !== "locked") toggle(c, sw === "off") }}>
          <CapabilityRow cap={c} name={plugin.name} state={sw} />
        </Button>
      })}
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
