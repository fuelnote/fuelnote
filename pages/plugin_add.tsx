// 添加插件（插件化设计第 5 节，画稿 DsAdd、第二十轮 R20AddA，从设置 › 数据源弹出）：只列已装的脚本里带 fuelnote.json 的（D8），不运行其他脚本；
// 分成「未添加」「已添加」两组，未添加在上（D26）。选中后运行一次这个插件（describe），确认版本和提供的数据后存进设置，先更新设置页再关上。
import { Button, HStack, Image, List, Navigation, NavigationStack, ProgressView, RoundedRectangle, Section, Spacer, Text, useState, VirtualNode, VStack } from "scripting"
import { addPlugin, AppData, InstalledPlugin, installedPlugins, pluginsOf } from "../common/model"
import { errorMessage } from "./components"

function PluginIcon({ plugin }: { plugin: InstalledPlugin }) {
  return <Image systemName={plugin.icon ?? "puzzlepiece.extension.fill"} font="body" foregroundStyle="white"
    frame={{ width: 32, height: 32 }} background={<RoundedRectangle cornerRadius={8} fill={(plugin.color ?? "systemGray") as any} />} />
}

/** 一行：图标、名称、脚本名 · 版本；accessory 是行尾的「+」或转圈，已添加的没有 */
function PluginRow({ plugin, accessory }: { plugin: InstalledPlugin; accessory: VirtualNode | null }) {
  return <HStack spacing={12}>
    <PluginIcon plugin={plugin} />
    <VStack alignment="leading" spacing={2}>
      <Text>{plugin.title}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel">{[plugin.script, plugin.version].filter(Boolean).join(" · ")}</Text>
    </VStack>
    <Spacer />
    {accessory}
  </HStack>
}

export function PluginAdd({ getData, onAdded }: { getData: () => AppData; onAdded: (data: AppData) => void }) {
  const dismiss = Navigation.useDismiss()
  const [list] = useState(() => installedPlugins())
  const [busy, setBusy] = useState<string | null>(null)
  const added = new Set(pluginsOf(getData()).map(p => p.script))
  const todo = list.filter(p => !added.has(p.script))
  const done = list.filter(p => added.has(p.script))

  async function add(p: InstalledPlugin) {
    setBusy(p.script)
    try {
      onAdded(await addPlugin(getData, p.script))
      dismiss()
    } catch (e) {
      setBusy(null)
      await Dialog.alert({ title: `没有添加「${p.title}」`, message: errorMessage(e) })
    }
  }

  return <NavigationStack>
    <List navigationTitle="添加插件" navigationBarTitleDisplayMode="inline" toolbar={{ cancellationAction: <Button title="取消" action={() => dismiss()} /> }}>
      <Section
        header={<Text>未添加</Text>}
        footer={<Text>仅列出带有油记插件标记（fuelnote.json）的脚本，不运行其他脚本。选择后，油记运行一次该插件，确认版本和提供的数据后再添加。</Text>}
      >
        {todo.length ? todo.map(p => <PluginRow key={p.script} plugin={p} accessory={busy === p.script
          ? <ProgressView />
          : <Button buttonStyle="borderless" disabled={!!busy} action={() => { void add(p) }}><Image systemName="plus" font="title3" /></Button>} />)
          : <Text foregroundStyle="secondaryLabel">{list.length ? "已装的插件都已添加。" : "没有找到带油记插件标记的脚本。"}</Text>}
      </Section>
      {done.length ? <Section header={<Text>已添加</Text>}>
        {done.map(p => <PluginRow key={p.script} plugin={p} accessory={null} />)}
      </Section> : null}
    </List>
  </NavigationStack>
}
