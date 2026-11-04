// 车况（设计文档 18.2 节）：记录页最上面的「当前」一组（上次加油后正在进行的这一箱），和点开后的详情。
// 「当前」挨着车名、在记录之前，读起来是这辆车现在的状态；浅色底与白色的记录卡片区分。
// 1.2.5–1.3.0 放在标签栏上方的底部配件；1.3.1 测试版试过车辆切换右边的按钮，用户觉得放在顶部不像当前车辆的信息（2026-10-19）。
// 界面见画布「车况放法（第五轮）」B 和「B「当前」卡片的颜色」。
// 2.6 起「当前」是「这一箱，和加这一箱用得上的」：插件的信息卡片有摘要时多一行（D21），车况详情「加满」下面是卡片（小组件方案和信息卡片设计 7.3 节）。
import {
  Button, DynamicShapeStyle, Gauge, HStack, List, Navigation, NavigationStack, ProgressView, Rectangle, Section, ShapeStyle, Spacer, Text, useEffect, useState, VStack, ZStack,
} from "scripting"
import { currentTank, CurrentTank, FillView, fmtDateTime, FuelRecord, fuelLow, fuelRatio, infoSummary, InfoPluginView, StatusSnapshot, statusWhen, watchInfo } from "../common/model"
import { InfoSections, ToneLine } from "./info_cards"

/**
 * 车况的显示状态：snapshot 为 null 表示还没读到过；fill 是「加满」一组（2.4，加满金额设计第 5 节），不知道剩余油量或油箱容量时 null；
 * info 是插件的信息卡片（2.6）
 */
export type StatusView = {
  snapshot: StatusSnapshot | null; tank: number | null; busy: boolean; error: string | null; source: string; fill: FillView | null; info: InfoPluginView[]
}

type Tint = DynamicShapeStyle

const GREEN: Tint = { light: "#10B981", dark: "#34D399" }
const ORANGE: Tint = { light: "#F97316", dark: "#FB923C" }
const GREY: Tint = { light: "#A1A1AA", dark: "#71717A" }

/** 「当前」卡片的颜色（与小组件的配色 B 相同）：底色与白色的记录卡片区分；还没有车况时灰色 */
const TONES: Record<CurrentTank["tone"], { ring: Tint; bg: Tint; text: ShapeStyle | Tint }> = {
  normal: { ring: GREEN, bg: { light: "#DCFCE7", dark: "rgba(74,222,128,0.18)" }, text: "label" },
  low: { ring: ORANGE, bg: { light: "#FFEDD5", dark: "rgba(251,146,60,0.2)" }, text: { light: "#C2410C", dark: "#FDBA74" } },
  none: { ring: GREY, bg: { light: "#E5E7EB", dark: "rgba(255,255,255,0.1)" }, text: "label" },
}

function look(v: StatusView) {
  const st = v.snapshot ? v.snapshot.status : null
  const low = !!st && fuelLow(st.fuel_l, v.tank, st.range_km)
  return {
    st,
    fuel: st && st.fuel_l != null ? String(Math.round(st.fuel_l)) : null,
    ratio: st ? fuelRatio(st.fuel_l, v.tank) : null,
    low,
    tint: low ? ORANGE : GREEN,
  }
}

/** accessoryCircularCapacity 样式的默认直径（pt）：这个样式尺寸固定，按它缩放到需要的大小 */
const GAUGE_SIZE = 58

/**
 * 油量圆环：系统的容量式仪表（Gauge，accessoryCircularCapacity）。Apple HIG · Gauges：accessory 样式也可以用在 App 里；
 * 仪表中间留空，图标、数字叠在上面，不跟着缩放。不知道油箱容量时圆环为空
 */
function FuelRing({ ratio, size, tint, children }: {
  ratio: number | null
  size: number
  tint: Tint
  children: JSX.Element
}) {
  return <ZStack frame={{ width: size, height: size }}>
    <Gauge
      value={ratio ?? 0}
      min={0}
      max={1}
      label={<Text>剩余油量</Text>}
      currentValueLabel={<Text>{""}</Text>}
      gaugeStyle="accessoryCircularCapacity"
      tint={tint}
      scaleEffect={size / GAUGE_SIZE}
    />
    {children}
  </ZStack>
}

/**
 * 记录页最上面的「当前」：剩余油量、续航，上次加油后已行驶的里程；分组标题右边是车况时间；
 * 有加满金额时卡片右边写「¥28 / 加满约」（2.4，画稿 R21Records）；插件的卡片有摘要时多一行（2.6，D21，画稿 R27Current）。
 * 轻点打开车况详情（每种状态都一样）；下拉刷新时重新读取
 */
export function CurrentSection({ view, last, onOpen }: { view: StatusView; last: FuelRecord | null; onOpen: () => void }) {
  const c = currentTank(view.snapshot ? view.snapshot.status : null, view.tank, last, view)
  const t = TONES[c.tone]
  const summary = infoSummary(view.info)
  return <Section header={<HStack><Text>当前</Text><Spacer />{c.when ? <Text>{c.when}</Text> : null}</HStack>}>
    <Button action={onOpen} listRowBackground={<Rectangle fill={t.bg} />}>
      <HStack spacing={14} foregroundStyle="label">
        <FuelRing ratio={c.ratio} size={46} tint={t.ring}>
          <Text font={12} fontWeight="bold" fontDesign="rounded">{c.center}</Text>
        </FuelRing>
        <VStack alignment="leading" spacing={3}>
          <Text font="headline" foregroundStyle={t.text}>{c.main}</Text>
          {c.detail ? <Text font="caption" foregroundStyle="secondaryLabel">{c.detail}</Text> : null}
          {summary ? <ToneLine icon={summary.card.icon} text={summary.card.summary!} tone={summary.card.tone} size="caption" /> : null}
        </VStack>
        <Spacer />
        {view.fill && view.fill.amount != null
          ? <VStack alignment="trailing" spacing={3}>
            <Text font="headline" foregroundStyle={t.text}>{`¥${view.fill.amount}`}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">加满约</Text>
          </VStack>
          : null}
      </HStack>
    </Button>
  </Section>
}

/**
 * 车况详情：大圆环、续航、车机平均油耗、里程表、车况时间；「加满」一组（2.4，画稿 R22Region）；右上角重新读取；
 * 「加满」下面是插件的信息卡片（2.6，画稿 R27Sheet），查着时跟着更新，「重新查」是 refreshInfo
 */
export function StatusSheet({ get, refresh, refreshInfo }: { get: () => StatusView; refresh: () => Promise<string | null>; refreshInfo: () => void }) {
  const dismiss = Navigation.useDismiss()
  const [view, setView] = useState(get)
  // 卡片一批一批地到：只换卡片，车况读取的状态留着
  useEffect(() => watchInfo(() => setView(v => ({ ...v, info: get().info }))), [])
  const l = look(view)
  async function reload() {
    setView({ ...view, busy: true, error: null })
    const error = await refresh()
    setView({ ...get(), busy: false, error })
  }
  const fmt = (n: number | null | undefined, unit: string, d = 1) => (n == null ? "—" : `${n.toFixed(d)} ${unit}`)
  return <NavigationStack presentationDetents={["medium", "large"]} presentationDragIndicator="visible">
    <List
      navigationTitle="车况"
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        cancellationAction: <Button title="关闭" systemImage="xmark" action={() => dismiss()} />,
        primaryAction: view.busy ? <ProgressView /> : <Button title="重新读取" systemImage="arrow.clockwise" action={reload} />,
      }}
    >
      <Section>
        {/* 大圆环不要卡片背景（与统计页的范围选择相同的做法） */}
        <VStack spacing={8} frame={{ maxWidth: "infinity" }} listRowInsets={0} listRowBackground={<Rectangle fill="rgba(0,0,0,0)" />}>
          <FuelRing ratio={l.ratio} size={150} tint={l.tint}>
            <VStack spacing={0}>
              <Text font={44} fontWeight="bold" fontDesign="rounded" {...(l.low ? { foregroundStyle: ORANGE } : {})}>{l.fuel ?? "—"}</Text>
              <Text font="footnote" foregroundStyle="secondaryLabel">{view.tank ? `/ ${view.tank} L` : "L"}</Text>
            </VStack>
          </FuelRing>
          {l.st && l.st.range_km != null ? <Text font="subheadline" foregroundStyle="secondaryLabel">{`约可行驶 ${l.st.range_km} km`}</Text> : null}
        </VStack>
      </Section>
      <Section
        footer={<Text>{`车况在停车熄火时上报，来自${view.source}。`}</Text>}
      >
        <HStack><Text>车机平均油耗</Text><Spacer /><Text foregroundStyle="secondaryLabel">{fmt(l.st?.avg_consumption, "L/100km")}</Text></HStack>
        <HStack><Text>里程表</Text><Spacer /><Text foregroundStyle="secondaryLabel">{l.st && l.st.odometer_km != null ? `${Math.floor(l.st.odometer_km).toLocaleString("en-US")} km` : "—"}</Text></HStack>
        <HStack>
          <Text>车况时间</Text>
          <Spacer />
          <Text foregroundStyle="secondaryLabel">{l.st && l.st.ts ? fmtDateTime(l.st.ts) : "—"}</Text>
        </HStack>
        {view.snapshot ? <HStack><Text>读取时间</Text><Spacer /><Text foregroundStyle="secondaryLabel">{statusWhen(view.snapshot.read_at)}</Text></HStack> : null}
        {view.error ? <Text font="footnote" foregroundStyle="systemRed">{`读取失败：${view.error}`}</Text> : null}
      </Section>
      {view.fill ? <FillSection fill={view.fill} /> : null}
      <InfoSections views={view.info} onRefresh={refreshInfo} />
    </List>
  </NavigationStack>
}

/** 「加满」一组：加满约 ¥28 · 3 L、95# 挂牌价 9.41 元/升；没有金额时只写升数；说明写按哪里、哪天的价算（显-1～显-8） */
function FillSection({ fill }: { fill: FillView }) {
  return <Section header={<Text>加满</Text>} footer={<Text>{fill.note}</Text>}>
    <HStack>
      <Text>加满约</Text>
      <Spacer />
      <Text foregroundStyle="secondaryLabel">{fill.amount != null ? `¥${fill.amount} · ${fill.litres} L` : `${fill.litres} L`}</Text>
    </HStack>
    {fill.priceLabel && fill.price != null
      ? <HStack><Text>{fill.priceLabel}</Text><Spacer /><Text foregroundStyle="secondaryLabel">{`${fill.price.toFixed(2)} 元/升`}</Text></HStack>
      : null}
  </Section>
}
