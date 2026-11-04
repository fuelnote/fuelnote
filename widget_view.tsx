// 小组件的视图（设计文档 18.2 节「小组件改版（1.4）」，画布「小组件第六轮」）。widget.tsx 只从这里导入，这里只从 common/widget_runtime 导入（打包器的限制，设计文档 9.4 节）。
// 尺寸和 family 由调用方给（小组件里是 Widget.displaySize、Widget.family），FuelNote Check 也能在 App 里画出来截图。
// - 油耗是主体：大数字为最近油耗，下面一行与平均的对比；剩余油量、续航、油费在旁边的数字格里（1.6 起只算加油）。
// - 不用柱状图（用户要求，2026-10-20）；剩余油量是一条横向油量条，油量低时为橙色。
// - 每个尺寸都有横向的「记加油」按钮：小号在底部，中号、大号在左栏底部（不占数字格）。
//   按钮和信息区都用 Link（有 Link 时 widgetURL 会被忽略；Apple 文档：小号也可以有多个点击区域）。
// - 着色外观下底板和按钮底色隐藏（widgetBackground），只把大数字设为强调色（widgetAccentable）。
// - 油量条的宽度按小组件的尺寸算：主屏幕小组件里形状的宽度以 frame 为准（参考本地脚本 SGCC_Mod 的做法）。
// 加满金额（2.4，加满金额设计第 5 节）：油记写进价格，这里按车况的剩余油量算。
// 小组件方案（2.5，小组件方案设计第 2–4 节）：大数字、四格、锁屏圆形中间按方案放内容（common/widget_layout.ts），其余不变。
import {
  AccessoryWidgetBackground, Capsule, Circle, DynamicShapeStyle, Gauge, Group, HStack, Image, Link, ProgressView, Rectangle, Script, Spacer, Text, VirtualNode, VStack, ZStack,
} from "scripting"
import {
  CellText, cellText, circleText, consumptionLevel, consumptionTrend, daysAgoText, drivenSinceFill, fillAmountNow, fillDay, fuelRatio, fuelTone, hasContent, heroText,
  HOME_SLOTS, Placed, placeSlots, WidgetFill, WidgetPreset, WidgetSlot, WidgetSnapshot, WidgetStatus,
} from "./common/widget_runtime"

export { presetFor, readWidgetSnapshot, refreshWidgetStatus, widgetRefreshDate } from "./common/widget_runtime"

const num = (n: number | null | undefined, digits = 2) => (n == null ? "—" : n.toFixed(digits))
// run_single：油记已经打开时不再起第二个实例（文档对需要避免并发执行的脚本的建议）
const addFuelURL = () => Script.createRunSingleURLScheme(Script.name, { action: "add_fuel" })
const openURL = () => Script.createRunSingleURLScheme(Script.name)

/** 配色：浅色、深色模式各一套；青绿为主，橙色表示偏高或油量低 */
const C = {
  sub: { light: "#5F6B66", dark: "#9CA3A1" },
  panel: { light: "#E8F3F0", dark: "#16302C" },
  cell: { light: "#F1F6F5", dark: "#13231F" },
  good: { light: "#15803D", dark: "#86EFAC" },
  bad: { light: "#C2410C", dark: "#FDBA74" },
  fuelIcon: { light: "#0B6B62", dark: "#93E3D8" },
  track: { light: "#DCE7E4", dark: "#24302E" },
  divider: { light: "rgba(0,0,0,0.08)", dark: "rgba(255,255,255,0.08)" },
} as const

const BUTTON: DynamicShapeStyle = {
  light: { colors: ["#14937F", "#0B6B62"], startPoint: "top", endPoint: "bottom" },
  dark: { colors: ["#2FA092", "#1B7A70"], startPoint: "top", endPoint: "bottom" },
}
const FILL: Record<"normal" | "low", DynamicShapeStyle> = {
  normal: {
    light: { colors: ["#3FA597", "#0B6B62"], startPoint: "leading", endPoint: "trailing" },
    dark: { colors: ["#93E3D8", "#2A8C82"], startPoint: "leading", endPoint: "trailing" },
  },
  low: {
    light: { colors: ["#F4A35C", "#D2601C"], startPoint: "leading", endPoint: "trailing" },
    dark: { colors: ["#F5A15E", "#C7581A"], startPoint: "leading", endPoint: "trailing" },
  },
}
/** 油耗档位的小圆点：不高于平均青绿，高出 10% 以内黄，再高橙 */
const LEVEL = {
  ok: { light: "#0B6B62", dark: "#2FA092" },
  above: { light: "#E1B60A", dark: "#F5DA4A" },
  high: { light: "#D2601C", dark: "#F5A15E" },
} as const

const PAD = 12
const rounded = (radius: number) => ({ type: "rect" as const, cornerRadius: radius, style: "continuous" as const })

/** FuelNote Check 在 App 里画小组件截图时为 true（WidgetView 的 app）：小组件专用的底色在 App 里不一定画得出来，改用普通的 background */
let inApp = false
/** 底板、数字格、按钮的底色：小组件里用 widgetBackground（着色外观下隐藏），App 里用 background */
function bg(style: DynamicShapeStyle, shape: "capsule" | ReturnType<typeof rounded>) {
  return inApp ? { background: { style, shape } } : { widgetBackground: { style, shape } }
}

/** 点击区域：小组件里是 Link；App 里不用 Link，Link 在 App 里会把文字染成强调色 */
function Tap({ url, children }: { url: string; children: VirtualNode }) {
  return inApp ? <Group>{children}</Group> : <Link url={url}>{children}</Link>
}

function lastFuelText(s: WidgetSnapshot): string {
  return s.last_fuel_ts ? `${daysAgoText(s.last_fuel_ts)}加油` : "还没有加油记录"
}

const litres = (st: WidgetStatus) => (st.fuel_l == null ? "—" : String(Math.round(st.fuel_l)))
const statusOf = (s: WidgetSnapshot) => (s.status_source ? s.status : null)
/** 按方案放好中号、大号的五格（小组件方案设计第 4 节） */
const placeHome = (s: WidgetSnapshot, preset: WidgetPreset) => placeSlots(preset, HOME_SLOTS, c => hasContent(s, c))

/** 大数字和单位，按文字基线对齐；low 时数字用橙色（剩余油量低，和车况详情一样） */
function BigNumber({ value, size, unit, low }: { value: string; size: number; unit?: string; low?: boolean }) {
  return <HStack alignment="lastTextBaseline" spacing={3}>
    <Text font={size} fontWeight="semibold" minScaleFactor={0.6} lineLimit={1} widgetAccentable {...(low ? { foregroundStyle: C.bad } : {})}>{value}</Text>
    {unit ? <Text font={12} foregroundStyle={C.sub} lineLimit={1}>{unit}</Text> : null}
  </HStack>
}

/** 与平均的对比：低于平均为绿，高于平均为橙；还没有对比时写上次加油 */
function TrendLine({ s, size }: { s: WidgetSnapshot; size: number }) {
  const t = consumptionTrend(s.latest_consumption, s.avg_consumption)
  if (!t) return <Text font={size} foregroundStyle={C.sub} lineLimit={1}>{lastFuelText(s)}</Text>
  const color = t.dir === "down" ? C.good : t.dir === "up" ? C.bad : C.sub
  const icon = t.dir === "down" ? "arrow.down.right" : t.dir === "up" ? "arrow.up.right" : "equal"
  return <HStack spacing={3}>
    <Image systemName={icon} font={size - 1} fontWeight="bold" foregroundStyle={color} />
    <Text font={size} fontWeight="semibold" foregroundStyle={color} lineLimit={1}>{t.text}</Text>
  </HStack>
}

/** 大数字下面一行：最近油耗是和平均的对比；其余写相关的一项，写「—」时写原因（小组件方案设计第 3、4 节） */
function HeroLine({ s, line, trend, size }: { s: WidgetSnapshot; line: string; trend: boolean; size: number }) {
  if (trend) return <TrendLine s={s} size={size} />
  return line ? <Text font={size} foregroundStyle={C.sub} lineLimit={1} minScaleFactor={0.8}>{line}</Text> : null
}

/** 小号右上角的剩余油量：油量低时图标为橙色 */
function FuelChip({ st }: { st: WidgetStatus }) {
  const low = fuelTone(st) === "low"
  return <HStack spacing={3} padding={{ horizontal: 8, vertical: 3 }} {...bg(C.cell, "capsule")}>
    <Image systemName="fuelpump.fill" font={10} foregroundStyle={low ? C.bad : C.fuelIcon} />
    <Text font={12} fontWeight="semibold" lineLimit={1}>{`${litres(st)} L`}</Text>
  </HStack>
}

/**
 * 横向的「记加油」按钮，占满整行。
 * frame 只能用一种写法：固定的 width/height，或伸缩的 min/max。混写时 Scripting 只按固定尺寸，maxWidth 被忽略，按钮缩成文字宽（1.4.0-beta.1 在手机上如此）
 */
function AddFuelButton({ height }: { height: number }) {
  return <Tap url={addFuelURL()}>
    <HStack spacing={5} frame={{ maxWidth: "infinity", minHeight: height, maxHeight: height }} {...bg(BUTTON, "capsule")}>
      <Image systemName="plus" font={14} fontWeight="bold" foregroundStyle="white" />
      <Text font={15} fontWeight="semibold" foregroundStyle="white">记加油</Text>
    </HStack>
  </Tap>
}

/** 数字格：标签一行，数值和单位一行；数放不下时缩小（最多到 0.7） */
function Cell({ cell, compact }: { cell: CellText; compact: boolean }) {
  return <VStack
    alignment="leading"
    spacing={1}
    padding={{ horizontal: compact ? 10 : 12, vertical: compact ? 5 : 8 }}
    frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }}
    {...bg(C.cell, rounded(12))}
  >
    <Text font={compact ? 11 : 12} foregroundStyle={C.sub} lineLimit={1}>{cell.label}</Text>
    <HStack alignment="lastTextBaseline" spacing={2}>
      <Text font={compact ? 17 : 20} fontWeight="semibold" minScaleFactor={0.7} lineLimit={1}>{cell.value}</Text>
      {cell.unit ? <Text font={11} foregroundStyle={C.sub}>{cell.unit}</Text> : null}
    </HStack>
  </VStack>
}

/**
 * 四格（小组件方案设计第 2–4 节）：按方案放；都是自动时和 2.4 一样——
 * 有车况时上面剩余油量、续航，没有时平均油耗、上次加油；下面有加满金额时加满约、本月油费，没有时本月、今年油费（F6、F13）
 */
function CellGrid({ s, placed, compact }: { s: WidgetSnapshot; placed: Partial<Record<WidgetSlot, Placed>>; compact: boolean }) {
  const gap = compact ? 6 : 8
  const cell = (slot: WidgetSlot) => <Cell cell={cellText(s, placed[slot]!)} compact={compact} />
  return <VStack spacing={gap} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    <HStack spacing={gap}>{cell("top_left")}{cell("top_right")}</HStack>
    <HStack spacing={gap}>{cell("bottom_left")}{cell("bottom_right")}</HStack>
  </VStack>
}

/** 横向油量条：两个胶囊叠在一起，宽度按小组件尺寸算 */
function TankBar({ ratio, low, width, height }: { ratio: number; low: boolean; width: number; height: number }) {
  return <ZStack alignment="leading" frame={{ width, height }}>
    <Capsule fill={C.track} frame={{ width, height }} />
    <Capsule fill={low ? FILL.low : FILL.normal} frame={{ width: Math.max(height, width * ratio), height }} />
  </ZStack>
}

/**
 * 「这一箱：剩余 91%」和油量条；不知道油箱容量时只写升数。右边中号写「已行驶 72 km」，大号写「加满后已行驶 72 km」（加满金额设计 F18）。
 * 放不下时两段都缩小一点（已行驶三位数时，中号左边曾被截成「剩余 5…」）
 */
function TankCell({ s, st, barWidth, compact }: { s: WidgetSnapshot; st: WidgetStatus; barWidth: number; compact: boolean }) {
  const ratio = fuelRatio(st.fuel_l, st.tank_l)
  const driven = drivenSinceFill(s)
  const after = s.last_fuel_full ? "加满后" : "加油后"
  const right = driven == null ? "" : compact ? `已行驶 ${driven} km` : `${after}已行驶 ${driven} km`
  return <VStack
    alignment="leading"
    spacing={compact ? 6 : 8}
    padding={{ horizontal: compact ? 10 : 12, vertical: compact ? 7 : 9 }}
    frame={{ maxWidth: "infinity", alignment: "leading" }}
    {...bg(C.cell, rounded(12))}
  >
    <HStack>
      <Text font={compact ? 11 : 12} foregroundStyle={C.sub} lineLimit={1} minScaleFactor={0.8}>{ratio == null ? `这一箱：剩余 ${litres(st)} L` : `这一箱：剩余 ${Math.round(ratio * 100)}%`}</Text>
      <Spacer minLength={4} />
      {right ? <Text font={compact ? 11 : 12} foregroundStyle={C.sub} lineLimit={1} minScaleFactor={0.8}>{right}</Text> : null}
    </HStack>
    {ratio == null ? null : <TankBar ratio={ratio} low={fuelTone(st) === "low"} width={barWidth} height={compact ? 6 : 8} />}
  </VStack>
}

/** 中号、大号的左栏：大数字（默认是最近油耗和对比，右上角是那次加油的日期），底部「记加油」 */
function LeftPanel({ s, hero, width, size }: { s: WidgetSnapshot; hero: Placed; width: number; size: number }) {
  const h = heroText(s, hero)
  return <VStack
    alignment="leading"
    spacing={8}
    padding={{ top: 11, leading: 12, trailing: 12, bottom: 10 }}
    frame={{ minWidth: width, maxWidth: width, maxHeight: "infinity", alignment: "topLeading" }}
    {...bg(C.panel, rounded(14))}
  >
    <Tap url={openURL()}>
      <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}>
        <HStack>
          <Text font={13} foregroundStyle={C.sub}>{h.label}</Text>
          <Spacer />
          {h.corner ? <Text font={12} foregroundStyle={C.sub}>{h.corner}</Text> : null}
        </HStack>
        <BigNumber value={h.value} size={size} unit={h.leftUnit} low={h.low} />
        <HeroLine s={s} line={h.line} trend={h.trend} size={11} />
      </VStack>
    </Tap>
    <AddFuelButton height={32} />
  </VStack>
}

/** 小号：主体是大数字（默认是最近油耗和对比），右上角剩余油量（主体就是剩余油量时不显示，位-10）；底部「记加油」 */
function Small({ s, preset }: { s: WidgetSnapshot; preset: WidgetPreset }) {
  const st = statusOf(s)
  const hero = placeSlots(preset, ["hero"], c => hasContent(s, c)).hero!
  const h = heroText(s, hero)
  return <VStack spacing={10} padding={14}>
    <Tap url={openURL()}>
      <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}>
        <HStack>
          <Text font={13} foregroundStyle={C.sub}>{h.label}</Text>
          <Spacer />
          {st && hero.content !== "fuel" ? <FuelChip st={st} /> : null}
        </HStack>
        <Spacer />
        <BigNumber value={h.value} size={34} unit={h.unit} low={h.low} />
        <HeroLine s={s} line={h.line} trend={h.trend} size={12} />
      </VStack>
    </Tap>
    <AddFuelButton height={34} />
  </VStack>
}

/** 中号：左栏大数字和「记加油」；右边四格，有车况时最下面是这一箱的油量条 */
function Medium({ s, preset, width }: { s: WidgetSnapshot; preset: WidgetPreset; width: number }) {
  const st = statusOf(s)
  const placed = placeHome(s, preset)
  const inner = width - PAD * 2
  const leftW = Math.round(inner * 0.4)
  const rightW = inner - leftW - 10
  return <HStack spacing={10} padding={PAD}>
    <LeftPanel s={s} hero={placed.hero!} width={leftW} size={30} />
    <Tap url={openURL()}>
      <VStack spacing={6} frame={{ minWidth: rightW, maxWidth: rightW, maxHeight: "infinity" }}>
        <CellGrid s={s} placed={placed} compact />
        {st ? <TankCell s={s} st={st} barWidth={rightW - 20} compact /> : null}
      </VStack>
    </Tap>
  </HStack>
}

/** 大号「最近加油」的一行：日期、升数·油号·油站；金额、油耗和档位圆点 */
function FillRow({ f, avg }: { f: WidgetFill; avg: number | null }) {
  const level = consumptionLevel(f.consumption, avg)
  const detail = [`${f.liters.toFixed(2)} L`, f.grade ? `${f.grade}#` : "", f.station || ""].filter(Boolean).join(" · ")
  return <HStack spacing={10}>
    <VStack alignment="leading" spacing={1}>
      <Text font={14}>{fillDay(f.ts)}</Text>
      <Text font={11} foregroundStyle={C.sub} lineLimit={1}>{detail}</Text>
    </VStack>
    <Spacer minLength={6} />
    <VStack alignment="trailing" spacing={1}>
      <Text font={14}>{`¥${f.paid.toFixed(2)}`}</Text>
      <HStack spacing={4}>
        {level ? <Circle fill={LEVEL[level]} frame={{ width: 6, height: 6 }} /> : null}
        <Text font={11} foregroundStyle={C.sub}>{f.consumption == null ? "—" : `${f.consumption.toFixed(2)} L/100km`}</Text>
      </HStack>
    </VStack>
  </HStack>
}

/** 大号「最近加油」：最近 3 次，行间细线 */
function RecentFills({ s, width }: { s: WidgetSnapshot; width: number }) {
  return <VStack
    alignment="leading"
    spacing={5}
    padding={{ top: 9, leading: 14, trailing: 14, bottom: 8 }}
    frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
    {...bg(C.cell, rounded(14))}
  >
    <HStack>
      <Text font={12} foregroundStyle={C.sub}>最近加油</Text>
      <Spacer />
      {s.last_fuel_ts ? <Text font={12} foregroundStyle={C.sub}>{daysAgoText(s.last_fuel_ts)}</Text> : null}
    </HStack>
    {s.recent.length
      ? s.recent.map((f, i) => <VStack key={String(f.ts)} spacing={5}>
        {i ? <Rectangle fill={C.divider} frame={{ width: width - 28, height: 0.5 }} /> : null}
        <FillRow f={f} avg={s.avg_consumption} />
      </VStack>)
      : <Text font={13} foregroundStyle={C.sub}>还没有加油记录</Text>}
    <Spacer minLength={0} />
  </VStack>
}

/** 大号：上面同中号（左栏和四格），中间这一箱的油量条，下面最近 3 次加油 */
function Large({ s, preset, width }: { s: WidgetSnapshot; preset: WidgetPreset; width: number }) {
  const st = statusOf(s)
  const placed = placeHome(s, preset)
  const inner = width - PAD * 2
  const leftW = Math.round(inner * 0.43)
  return <VStack spacing={8} padding={PAD}>
    <HStack spacing={10} frame={{ height: 140 }}>
      <LeftPanel s={s} hero={placed.hero!} width={leftW} size={32} />
      <Tap url={openURL()}>
        <CellGrid s={s} placed={placed} compact={false} />
      </Tap>
    </HStack>
    <Tap url={openURL()}>
      <VStack spacing={8}>
        {st ? <TankCell s={s} st={st} barWidth={inner - 24} compact={false} /> : null}
        <RecentFills s={s} width={inner} />
      </VStack>
    </Tap>
  </VStack>
}

/**
 * 锁屏圆形：圆环是剩余油量；中间按方案（默认有加满金额时写金额，F11，画稿 R24Circular，否则写最近油耗）；
 * 没有车况或不知道油箱容量时没有圆环
 */
function Circular({ s, preset }: { s: WidgetSnapshot; preset: WidgetPreset }) {
  const st = s.status_source ? s.status : null
  const ratio = st ? fuelRatio(st.fuel_l, st.tank_l) : null
  const t = circleText(s, placeSlots(preset, ["circle"], c => hasContent(s, c)).circle!)
  const center = <VStack spacing={0}>
    <Text font="headline" fontDesign="rounded" minScaleFactor={0.6} lineLimit={1} widgetAccentable>{t.value}</Text>
    <Text font={8} foregroundStyle="secondaryLabel">{t.caption}</Text>
  </VStack>
  if (ratio == null) {
    return <ZStack widgetURL={addFuelURL()}>
      <AccessoryWidgetBackground />
      {center}
    </ZStack>
  }
  return <ZStack widgetURL={addFuelURL()}>
    <Gauge value={ratio} min={0} max={1} label={<Text>油量</Text>} currentValueLabel={center} gaugeStyle="accessoryCircularCapacity" />
  </ZStack>
}

/** 锁屏横条：车名、最近油耗；有车况时下面是油量条和剩余油量，有加满金额时跟在后面（F14，画稿 R23Lock），否则是上次加油 */
function Rectangular({ s }: { s: WidgetSnapshot }) {
  const st = s.status_source ? s.status : null
  const ratio = st ? fuelRatio(st.fuel_l, st.tank_l) : null
  const fill = fillAmountNow(s)
  return <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }} widgetURL={addFuelURL()}>
    <HStack spacing={4}>
      <Image systemName="fuelpump.fill" font="caption" />
      <Text font="caption" fontWeight="semibold" lineLimit={1}>{s.vehicle || "油记"}</Text>
    </HStack>
    <HStack alignment="lastTextBaseline" spacing={3}>
      <Text font="title3" fontWeight="bold" fontDesign="rounded" widgetAccentable lineLimit={1}>{num(s.latest_consumption)}</Text>
      <Text font="caption">L/100km</Text>
    </HStack>
    {st
      ? <HStack spacing={6}>
        {ratio != null ? <ProgressView value={ratio} /> : null}
        <Text font="caption" fontDesign="rounded" lineLimit={1}>{fill != null ? `${litres(st)} L · 加满 ¥${fill}` : `${litres(st)} L`}</Text>
      </HStack>
      : <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{lastFuelText(s)}</Text>}
  </VStack>
}

/** 锁屏一行：最近油耗；有加满金额时后面写金额，换掉剩余油量（F14，画稿 R23Lock） */
function Inline({ s }: { s: WidgetSnapshot }) {
  const st = s.status_source ? s.status : null
  const fill = fillAmountNow(s)
  const tail = fill != null ? ` · 加满 ¥${fill}` : st ? ` · 余 ${litres(st)} L` : s.last_fuel_ts ? ` · ${daysAgoText(s.last_fuel_ts)}` : ""
  return <HStack widgetURL={addFuelURL()}>
    <Image systemName="fuelpump.fill" />
    <Text>{`${num(s.latest_consumption, 1)} L/100km${tail}`}</Text>
  </HStack>
}

/**
 * 按尺寸画小组件：family、size 在小组件里是 Widget.family、Widget.displaySize；preset 是参数选的方案（小组件方案设计第 5 节）；
 * app 是 FuelNote Check 在 App 里画（底色用 background）
 */
export function WidgetView({ s, family, size, preset, app }: { s: WidgetSnapshot; family: string; size: { width: number; height: number }; preset: WidgetPreset; app?: boolean }) {
  inApp = !!app
  switch (family) {
    case "systemMedium": return <Medium s={s} preset={preset} width={size.width} />
    case "systemLarge":
    case "systemExtraLarge": return <Large s={s} preset={preset} width={size.width} />
    case "accessoryRectangular": return <Rectangular s={s} />
    case "accessoryCircular": return <Circular s={s} preset={preset} />
    case "accessoryInline": return <Inline s={s} />
    default: return <Small s={s} preset={preset} />
  }
}
