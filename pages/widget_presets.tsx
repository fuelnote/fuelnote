// 设置 › 小组件 › 方案（docs/specs/2026-11-04-presets-and-cards.md 第 5、6 节，画稿 R26Settings）：
// 方案列表；一套方案的名称、大数字、四格、锁屏圆形、预览、删除（默认方案是还原）。规则在 common/widget_layout.ts。
import { Button, Divider, EnvironmentValuesReader, HStack, Image, List, Menu, NavigationLink, Section, Spacer, Text, TextField, useState, VStack, Widget } from "scripting"
import {
  addPreset, AppData, autoContent, buildWidgetSnapshot, CONTENT_TITLES, DEFAULT_PRESET, presetList, presetNameProblem, removePreset, renamePreset, resetDefault,
  setPresetSlot, SLOT_CHOICES, SLOT_TITLES, updateSettings, usedElsewhere, WidgetContent, WidgetPreset, WidgetSlot, WidgetSnapshot,
} from "../common/model"
import { AppActions, showError } from "./components"

const presetsOf = (data: AppData): WidgetPreset[] => data.ledger.settings.widget_presets ?? []
const CELL_SLOTS: WidgetSlot[] = ["top_left", "top_right", "bottom_left", "bottom_right"]

/** 改了就写账本：setData 里会重写小组件的摘要、刷新小组件 */
function save(app: AppActions, next: WidgetPreset[]) {
  app.setData(updateSettings(app.getData(), { widget_presets: next }))
}

/** 设置页「方案」一行的右边 */
export function presetCountText(data: AppData): string {
  return `${presetList(presetsOf(data)).length} 套`
}

/** 方案列表：默认方案在最前，每套下面写参数怎么填；最后「添加方案」 */
export function WidgetPresetsPage({ data, app }: { data: AppData; app: AppActions }) {
  async function add() {
    const name = await Dialog.prompt({ title: "添加方案", message: "在小组件的「参数」里填这个名称。", placeholder: "例如：花费", confirmLabel: "添加" })
    if (name == null) return
    const problem = presetNameProblem(presetsOf(app.getData()), name)
    if (problem) {
      await Dialog.alert({ title: "不能添加", message: problem })
      return
    }
    save(app, addPreset(presetsOf(app.getData()), name))
  }

  return <List navigationTitle="小组件方案" navigationBarTitleDisplayMode="inline">
    <Section footer={<Text>长按桌面上的小组件，选「编辑小组件」，在「参数」里填方案的名称。不填，或者填的名称没有这套方案时，用默认方案。</Text>}>
      {/* 按位置作 key：改名后推入的那一页还是同一页 */}
      {presetList(presetsOf(data)).map((p, i) => <NavigationLink key={`preset-${i}`} destination={<WidgetPresetPage data={data} app={app} initialName={p.name} />}>
        <VStack alignment="leading" spacing={3}>
          <Text>{p.name}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">{p.name === DEFAULT_PRESET ? "参数空着时用" : `参数填「${p.name}」`}</Text>
        </VStack>
      </NavigationLink>)}
      <Button title="添加方案" systemImage="plus" action={() => { void add() }} />
    </Section>
  </List>
}

/**
 * 一格的菜单（设计第 6 节，D13）：自动（写现在显示的是什么）和这一格放得下的内容；选中的打勾；
 * 大数字和四格里别的格子选了的不能点，写在哪一格
 */
function SlotRow({ preset, slot, snap, onPick }: {
  preset: WidgetPreset
  slot: WidgetSlot
  snap: WidgetSnapshot
  onPick: (slot: WidgetSlot, content: WidgetContent | null) => void
}) {
  const picked = preset.slots[slot] ?? null
  const auto = `自动 · ${CONTENT_TITLES[autoContent(preset, slot, snap)]}`
  const used = usedElsewhere(preset, slot)
  return <Menu label={<HStack foregroundStyle="label">
    <Text>{SLOT_TITLES[slot]}</Text>
    <Spacer />
    <Text foregroundStyle="secondaryLabel" lineLimit={1}>{picked ? CONTENT_TITLES[picked] : auto}</Text>
    <Image systemName="chevron.up.chevron.down" font="footnote" foregroundStyle="secondaryLabel" />
  </HStack>}>
    <Button title={auto} {...(picked ? {} : { systemImage: "checkmark" })} action={() => onPick(slot, null)} />
    <Divider />
    {SLOT_CHOICES[slot].map(c => {
      const other = used[c]
      if (other) return <Button key={c} title={`${CONTENT_TITLES[c]} · ${SLOT_TITLES[other]}`} disabled action={() => undefined} />
      return <Button key={c} title={CONTENT_TITLES[c]} {...(picked === c ? { systemImage: "checkmark" } : {})} action={() => onPick(slot, c)} />
    })}
  </Menu>
}

/** 一套方案：名称（默认方案没有）、大数字、四格、锁屏圆形、预览；删除方案，默认方案是还原 */
export function WidgetPresetPage({ data, app, initialName }: { data: AppData; app: AppActions; initialName: string }) {
  const [name, setName] = useState(initialName)
  const [draft, setDraft] = useState(initialName)
  const preset = presetList(presetsOf(data)).find(p => p.name === name)
  if (!preset) return <List navigationTitle="小组件方案"><Text foregroundStyle="secondaryLabel">这套方案已经删除。</Text></List>
  const isDefault = name === DEFAULT_PRESET
  // 菜单里「自动 · …」按当前车辆现在的摘要算（有没有车况、油价）
  const snap = buildWidgetSnapshot(data)

  function pick(slot: WidgetSlot, content: WidgetContent | null) {
    save(app, setPresetSlot(presetsOf(app.getData()), name, slot, content))
  }

  async function saveName() {
    const next = draft.trim()
    if (next === name) {
      setDraft(name)
      return
    }
    const problem = presetNameProblem(presetsOf(app.getData()), next, name)
    if (problem) {
      setDraft(name)
      await Dialog.alert({ title: "不能改名", message: problem })
      return
    }
    save(app, renamePreset(presetsOf(app.getData()), name, next))
    setName(next)
    setDraft(next)
  }

  /** goBack 来自 EnvironmentValuesReader 的 dismiss：只返回上一页（Navigation.useDismiss 会关掉整个油记） */
  async function remove(goBack: () => void) {
    const choice = await Dialog.actionSheet({
      title: `删除「${name}」？`,
      message: "参数填着这个名称的小组件改用默认方案。",
      actions: [{ label: "删除", destructive: true }],
    })
    if (choice !== 0) return
    save(app, removePreset(presetsOf(app.getData()), name))
    goBack()
  }

  /** Scripting 的小组件预览：参数按 JSON 写法传这套方案的名称（方-6） */
  async function preview(family: "systemSmall" | "systemMedium" | "systemLarge") {
    try {
      await Widget.preview({ family, parameters: { options: { [name]: JSON.stringify(name) }, default: name } })
    } catch (e) {
      await showError("打不开预览", e)
    }
  }

  return <EnvironmentValuesReader keys={["dismiss"]}>{env => <List navigationTitle={name} navigationBarTitleDisplayMode="inline">
    {isDefault ? null : <Section key="name" header={<Text>名称</Text>} footer={<Text>小组件「参数」里填的就是这个名称。改名后，填着旧名称的小组件要改参数。</Text>}>
      <TextField title="名称" value={draft} onChanged={setDraft} onBlur={saveName} onSubmit={saveName} />
    </Section>}
    <Section key="hero" header={<Text>大数字</Text>} footer={<Text>小号的主体，中号、大号的左栏。</Text>}>
      <SlotRow preset={preset} slot="hero" snap={snap} onPick={pick} />
    </Section>
    <Section key="cells" header={<Text>四格</Text>} footer={<Text>中号、大号。选的内容暂时没有时（例如还没读到车况）写「—」；自动的格子换成有的内容。</Text>}>
      {CELL_SLOTS.map(slot => <SlotRow key={slot} preset={preset} slot={slot} snap={snap} onPick={pick} />)}
    </Section>
    <Section key="circle" header={<Text>锁屏圆形</Text>}>
      <SlotRow preset={preset} slot="circle" snap={snap} onPick={pick} />
    </Section>
    <Section key="preview" header={<Text>预览</Text>}>
      <Button title="小号" action={() => { void preview("systemSmall") }} />
      <Button title="中号" action={() => { void preview("systemMedium") }} />
      <Button title="大号" action={() => { void preview("systemLarge") }} />
    </Section>
    {isDefault
      ? <Section key="reset" footer={<Text>都是自动时不能还原。</Text>}>
        <Button title="还原" disabled={!Object.keys(preset.slots).length} action={() => save(app, resetDefault(presetsOf(app.getData())))} />
      </Section>
      : <Section key="delete">
        <Button title="删除方案" role="destructive" action={() => { void remove(env.dismiss) }} />
      </Section>}
  </List>}</EnvironmentValuesReader>
}
