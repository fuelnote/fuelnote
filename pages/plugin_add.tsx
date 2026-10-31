// 添加插件（插件化设计第 5 节，画稿 DsAdd，从设置 › 数据源弹出）：只列已装的脚本里带 fuelnote.json 的（D8），不运行其他脚本；
// 选中后运行一次这个插件（describe），确认版本和提供的数据后存进设置，先更新设置页再关上。
import { Button, HStack, Image, List, Navigation, NavigationStack, ProgressView, RoundedRectangle, Section, Spacer, Text, useState, VStack } from "scripting"
import { addPlugin, AppData, InstalledPlugin, installedPlugins, pluginsOf } from "../common/model"
import { errorMessage } from "./components"

function PluginIcon({ plugin }: { plugin: InstalledPlugin }) {
  return <Image systemName={plugin.icon ?? "puzzlepiece.extension.fill"} font="body" foregroundStyle="white"
    frame={{ width: 32, height: 32 }} background={<RoundedRectangle cornerRadius={8} fill={(plugin.color ?? "systemGray") as any} />} />
}

export function PluginAdd({ getData, onAdded }: { getData: () => AppData; onAdded: (data: AppData) => void }) {
  const dismiss = Navigation.useDismiss()
  const [list] = useState(() => installedPlugins())
  const [busy, setBusy] = useState<string | null>(null)
  const added = new Set(pluginsOf(getData()).map(p => p.script))

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
        header={<HStack><Text>已装的插件</Text><Spacer /><Text>{`${list.length} 个`}</Text></HStack>}
        footer={<Text>仅列出带有油记插件标记（fuelnote.json）的脚本，不运行其他脚本。选择后，油记运行一次该插件，确认版本和提供的数据后再添加。</Text>}
      >
        {list.length ? list.map(p => <HStack key={p.script} spacing={12}>
          <PluginIcon plugin={p} />
          <VStack alignment="leading" spacing={2}>
            <Text>{p.title}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">{[p.script, p.version].filter(Boolean).join(" · ")}</Text>
          </VStack>
          <Spacer />
          {added.has(p.script)
            ? <Text font="subheadline" foregroundStyle="secondaryLabel">已添加</Text>
            : busy === p.script
              ? <ProgressView />
              : <Button buttonStyle="borderless" disabled={!!busy} action={() => { void add(p) }}><Image systemName="plus" font="title3" /></Button>}
        </HStack>) : <Text foregroundStyle="secondaryLabel">没有找到带油记插件标记的脚本。</Text>}
      </Section>
    </List>
  </NavigationStack>
}
