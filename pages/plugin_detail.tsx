// 插件详情（插件化设计第 5 节，画稿 DsDetail，从设置 › 数据源推入）：提供的数据；连接状态和打码的账号，每次打开时问一次插件；
// 管理连接打开插件自己的页面；移除插件只从油记里去掉。
// 2.7（5.1、5.2 节，画稿第三十轮 R30DetailA，第三十三轮 R33One，第三十四轮 R34Cards）：副标题写版本和脚本名；提供的数据轻点一行启用或停用：
// 启用的打勾，停用的图标和名称变灰（D29）；可以全部停用，插件暂停（D31）；「车辆」不列，写在说明里（D32）。声明了卡片时「信息」换成每张卡片一行（D30）。
import { Button, EnvironmentValuesReader, HStack, Image, List, ProgressView, Section, Spacer, Text, useState, VStack } from "scripting"
import {
  connectPlugin, ItemSwitch, itemSwitch, PluginCapability, PluginItem, pluginItems, pluginsOf, pluginState, pluginStateText, pluginStatus, pluginSubtitle, pluginVersion,
  refreshPlugins, removePlugin, setPluginItem,
} from "../common/model"
import { AppActions } from "./components"

const ICONS: Record<PluginCapability, string> = {
  fuel: "doc.text", vehicles: "car.2", trips: "car", vehicle_status: "gauge.with.dots.needle.33percent", service: "wrench.and.screwdriver", fuel_price: "yensign.circle",
  info: "rectangle.stack",
}

/** 每一项用在哪里（2.7.0-beta.4 起用正式的产品用语） */
function hint(cap: PluginCapability, name: string): string {
  if (cap === "fuel") return `记加油时，从${name}选择一笔或多笔交易填入`
  if (cap === "vehicles") return "在车辆设置的「车辆数据」中关联车辆"
  if (cap === "trips") return "记加油时，按付款时间匹配停车记录并填入里程"
  if (cap === "vehicle_status") return "在记录页「当前」显示剩余油量和里程"
  if (cap === "fuel_price") return "按所在地区的挂牌价计算加满金额"
  // 信息卡片（2.6）：只说放在哪，卡片里写什么由插件定；声明了卡片时每张一行，名称是卡片的标题（D30）
  if (cap === "info") return "在记录页「当前」下方显示信息卡片，可添加到小组件"
  return `记费用时，从${name}选择一次进店，填入需记录的各笔费用`
}

/** 「提供的数据」下面的说明（画稿 R33One；可以全部停用，D31；「车辆」写在这里，D32）：没有车辆的插件不写车辆那一句 */
function capsFooter(hasVehicles: boolean): string {
  return "轻点以启用或停用。停用后，油记不再向插件请求该项数据，相关功能随之隐藏；已有记录不受影响。全部停用时，油记不再运行该插件，设置保留，可随时启用。"
    + (hasVehicles ? "行程、车况、养修需要先在车辆设置的「车辆数据」中关联车辆。" : "")
}

/** 一张卡片那一行的说明（画稿 R34Cards） */
const CARD_HINT = "信息卡片，显示在记录页「当前」下方，可添加到小组件"

/** 一项（画稿 R33One、R34Cards）：图标、名称和说明，右边启用的打勾；停用的图标和名称变灰 */
function ItemRow({ item, name, state }: { item: PluginItem; name: string; state: ItemSwitch }) {
  const dim = state === "off"
  return <HStack spacing={12}>
    <Image systemName={ICONS[item.cap]} font="title3" foregroundStyle={dim ? "secondaryLabel" : "accentColor"} frame={{ width: 28 }} />
    <VStack alignment="leading" spacing={2}>
      <Text font="headline" foregroundStyle={dim ? "secondaryLabel" : "label"}>{item.title}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel">{item.card ? CARD_HINT : hint(item.cap, name)}</Text>
    </VStack>
    <Spacer />
    {state === "on" ? <Image systemName="checkmark" font="body" fontWeight="semibold" foregroundStyle="accentColor" /> : null}
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
    // 全部停用的插件打开油记时不读说明（D31）；点进详情时插件更新了就读一次，列出新的项（新的项照旧停用）
    const next = await refreshPlugins(app.getData, plugin.id)
    if (next) {
      app.setData(next)
      setTick(t => t + 1)
    }
    const r = await pluginStatus(plugin)
    setView(r.ok ? { loading: false, account: r.value.account, error: null } : { loading: false, account: null, error: r.error.message })
  }

  async function manage() {
    setView(v => ({ ...v, loading: true }))
    const r = await connectPlugin(plugin)
    setView(r.ok ? { loading: false, account: r.value.account, error: null } : { loading: false, account: null, error: r.error.message })
  }

  /** 启用或停用一项：存进设置，这一页跟着重画 */
  function toggle(key: string, on: boolean) {
    app.setData(setPluginItem(app.getData(), plugin.id, key, on))
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
    <Section header={<Text>提供的数据</Text>} footer={<Text>{capsFooter(plugin.capabilities.includes("vehicles"))}</Text>}>
      {pluginItems(plugin).map(item => {
        const sw = itemSwitch(plugin, item.key)
        return <Button key={item.key} action={() => toggle(item.key, sw === "off")}>
          <ItemRow item={item} name={plugin.name} state={sw} />
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
