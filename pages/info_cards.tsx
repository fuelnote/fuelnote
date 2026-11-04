// 插件的信息卡片（docs/specs/2026-11-04-presets-and-cards.md 7.3 节，画稿第二十七轮）：车况详情里每张卡片一组（R27Sheet）、
// 记录页「当前」多的一行（R27Current，在 pages/fuel_status.tsx）、没有车况的车记录页最上面一组和弹出的一页（R27Bare）。
// 油记只认卡片的字段：文字、语气、图标都由插件给，这里只管样子（D1、D27）。
import {
  Button, DynamicShapeStyle, EnvironmentValuesReader, HStack, Image, List, NavigationStack, ProgressView, Section, Spacer, Text, useEffect, useState, VStack,
} from "scripting"
import { InfoCard, InfoPluginView, InfoTone, InfoTop, progressText, watchInfo } from "../common/model"

/** 语气的颜色（D27）：好是绿色，提醒是橙色；浅色用深一点的，白底上看得清 */
export const TONE_COLORS: Record<InfoTone, DynamicShapeStyle> = {
  good: { light: "#248A3D", dark: "#30D158" },
  warn: { light: "#C93400", dark: "#FF9F0A" },
}

/** 句子没有结尾的标点时补一个句号（插件给的说明、出错的原因接在一起写） */
const sentence = (s: string) => (/[。！？.!?]$/.test(s) ? s : `${s}。`)

/** 一组下面的说明：插件给的 note；出错时写原因（卡-5）；最后「来自 <插件名>」 */
function footerText(view: InfoPluginView, note: string | null): string {
  return [note ? sentence(note) : "", view.error ? sentence(`没有查完：${view.error}`) : "", `来自${view.plugin.name}。`].join("")
}

/** 一行：左边 label、下面 detail，右边 value；语气上色 */
function InfoRowView({ label, value, detail, tone }: { label: string; value: string; detail: string | null; tone: InfoTone | null }) {
  return <HStack spacing={10}>
    <VStack alignment="leading" spacing={2}>
      <Text>{label}</Text>
      {detail ? <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={1}>{detail}</Text> : null}
    </VStack>
    <Spacer minLength={8} />
    <Text {...(tone ? { foregroundStyle: TONE_COLORS[tone], fontWeight: "semibold" as const } : { foregroundStyle: "secondaryLabel" as const })} lineLimit={1}>{value}</Text>
  </HStack>
}

/** 查着时写进度，不查时「重新查」 */
function StatusRow({ view, onRefresh }: { view: InfoPluginView; onRefresh: () => void }) {
  if (view.busy) {
    return <HStack spacing={8}>
      <ProgressView />
      <Text foregroundStyle="secondaryLabel">{progressText(view)}</Text>
    </HStack>
  }
  return <Button title="重新查" systemImage="arrow.clockwise" action={onRefresh} />
}

/** 一张卡片一组：组名 title；每行左边 label、右边 value；没有行时写 empty；插件的最后一组再加进度或「重新查」 */
function CardSection({ view, card, last, header, onRefresh }: { view: InfoPluginView; card: InfoCard; last: boolean; header: boolean; onRefresh: () => void }) {
  return <Section
    {...(header ? { header: <Text>{card.title}</Text> } : {})}
    footer={<Text>{footerText(view, card.note)}</Text>}
  >
    {card.rows.length
      ? card.rows.map((r, i) => <InfoRowView key={`${i}`} label={r.label} value={r.value} detail={r.detail} tone={r.tone} />)
      : card.empty
        ? <Text foregroundStyle="secondaryLabel">{card.empty}</Text>
        // 还没查完、还没有一行：最后一组下面一行本来就写进度
        : last && view.busy ? null : <Text foregroundStyle="secondaryLabel">{view.busy ? progressText(view) : "还没读到"}</Text>}
    {last ? <StatusRow view={view} onRefresh={onRefresh} /> : null}
  </Section>
}

/**
 * 车况详情和弹出的那一页里的卡片（7.3 节）：每个插件的每张卡片一组，按添加插件的顺序；
 * 插件还没有卡片时一组写进度、出错的原因或「还没读到」。header 为 false 时只有一张卡片、组名写在标题栏
 */
export function InfoSections({ views, onRefresh, header = true }: { views: InfoPluginView[]; onRefresh: () => void; header?: boolean }) {
  return <>{views.map(v => v.cards.length
    ? v.cards.map((c, i) => <CardSection key={`${v.plugin.id}/${c.id}`} view={v} card={c} last={i === v.cards.length - 1} header={header} onRefresh={onRefresh} />)
    : <Section key={v.plugin.id} {...(header ? { header: <Text>{v.title}</Text> } : {})} footer={<Text>{footerText(v, null)}</Text>}>
      {v.busy || v.error ? null : <Text foregroundStyle="secondaryLabel">还没读到</Text>}
      <StatusRow view={v} onRefresh={onRefresh} />
    </Section>)}</>
}

/** 只有一张卡片（或一个还没有卡片的插件）时，标题栏写它的组名，下面不再写 */
function singleTitle(views: InfoPluginView[]): string | null {
  if (views.length !== 1) return null
  const v = views[0]
  return v.cards.length > 1 ? null : v.cards[0]?.title ?? v.title
}

/** 没有车况的车，记录页最上面那一组点开弹出的一页（D14，R27Bare 右边）：全部的卡片，和车况详情里的一样；查着时跟着更新 */
export function InfoSheet({ get, refresh }: { get: () => InfoPluginView[]; refresh: () => void }) {
  const [views, setViews] = useState(get)
  useEffect(() => watchInfo(() => setViews(get())), [])
  const title = singleTitle(views)
  return <NavigationStack presentationDetents={["medium", "large"]} presentationDragIndicator="visible">
    <EnvironmentValuesReader keys={["dismiss"]}>{env => <List
      navigationTitle={title ?? "信息卡片"}
      navigationBarTitleDisplayMode="inline"
      toolbar={{ cancellationAction: <Button title="关闭" systemImage="xmark" action={() => env.dismiss()} /> }}
    >
      <InfoSections views={views} onRefresh={refresh} header={!title} />
    </List>}</EnvironmentValuesReader>
  </NavigationStack>
}

/** 图标和一行字：语气上色，没有语气时次要的颜色（记录页最上面、「当前」多的一行） */
export function ToneLine({ icon, text, tone, size }: { icon: string | null; text: string; tone: InfoTone | null; size: "caption" | "body" }) {
  const color = tone ? TONE_COLORS[tone] : "secondaryLabel"
  return <HStack spacing={size === "body" ? 8 : 4}>
    {icon ? <Image systemName={icon} font={size === "body" ? "body" : "caption"} foregroundStyle={color} /> : null}
    <Text font={size === "body" ? "body" : "caption"} fontWeight={tone ? "semibold" : "regular"} foregroundStyle={color} lineLimit={1}>{text}</Text>
  </HStack>
}

/** 没有车况的车，记录页最上面、「当前」的位置单独一组（D14，R27Bare 左边）：组名、摘要和「共 N 条」；轻点弹出全部的卡片 */
export function InfoTopSection({ top, onOpen }: { top: InfoTop; onOpen: () => void }) {
  return <Section header={<Text>{top.title}</Text>}>
    <Button action={onOpen}>
      <HStack spacing={8} foregroundStyle="label">
        <ToneLine icon={top.icon} text={top.text} tone={top.tone} size="body" />
        <Spacer />
        {top.count ? <Text foregroundStyle="secondaryLabel">{`共 ${top.count} 条`}</Text> : null}
        <Image systemName="chevron.right" font="footnote" foregroundStyle="tertiaryLabel" />
      </HStack>
    </Button>
  </Section>
}
