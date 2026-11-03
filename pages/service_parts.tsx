// 养修页面共用的部件（插件化设计 3.4 节，画布第十八轮 Sv*）：记费用里「从<数据源名>选」一行和选好以后的一行、选进店页的一次进店、结算明细一组。
import { Button, DynamicShapeStyle, HStack, Image, Section, Spacer, Text, VStack } from "scripting"
import { BJ_OFFSET, PluginState, ServiceVisit, Settlement, yuan } from "../common/model"
import { km } from "./components"

/** 维修保养的颜色（同费用页、费用统计） */
const MAINTENANCE_COLOR: DynamicShapeStyle = { light: "#AF52DE", dark: "#BF5AF2" }

/** 「2026/4/3」（北京时间） */
export function serviceDay(ts: number): string {
  const d = new Date(ts + BJ_OFFSET)
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

/** 选进店页的第二行：到店里程 · 保养项目（第一笔不带保养记录时写各笔的备注） */
function visitSub(v: ServiceVisit): string {
  const m = v.expenses[0].maintenance
  const items = m ? m.items.map(i => i.name) : []
  const what = items.length ? items.join("、") : v.expenses.map(e => e.remark).filter(Boolean).join("、")
  return [v.odometer ? km(v.odometer) : "", what].filter(Boolean).join(" · ")
}

/** 选进店页的一次进店：扳手图标（维修保养的颜色）、日期 · 叫法，第二行里程和项目，右边要记几笔 */
export function VisitRow({ visit }: { visit: ServiceVisit }) {
  return <HStack spacing={12} foregroundStyle="label">
    <Image systemName="wrench.adjustable" foregroundStyle={MAINTENANCE_COLOR} frame={{ width: 24 }} />
    <VStack alignment="leading" spacing={3}>
      <Text font="body">{`${serviceDay(visit.arrive_ts)} · ${visit.title}`}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{visitSub(visit)}</Text>
    </VStack>
    <Spacer />
    <Text foregroundStyle="secondaryLabel" monospacedDigit>{`${visit.expenses.length} 笔`}</Text>
  </HStack>
}

/** 记费用里还没选时：「从<数据源名>选」，右边按上次调用的结果写「未连接」（灰）「已过期」（橙），都可以点开，在选进店页中连接 */
export function ServiceEntry({ name, state, onTap }: { name: string; state: PluginState | null; onTap: () => void }) {
  return <Button action={onTap}>
    <HStack spacing={10}>
      <Image systemName="wrench.adjustable" foregroundStyle="accentColor" />
      <Text foregroundStyle="accentColor">{`从${name}选`}</Text>
      <Spacer />
      {state === "not_connected" ? <Text foregroundStyle="secondaryLabel">未连接</Text> : null}
      {state === "expired" ? <HStack spacing={4}>
        <Image systemName="exclamationmark.triangle.fill" font="footnote" foregroundStyle="systemOrange" />
        <Text foregroundStyle="systemOrange">已过期</Text>
      </HStack> : null}
    </HStack>
  </Button>
}

/** 选好以后：「已填入<数据源名> · 到店日期」，第二行是叫法、到店里程和要记几笔，右边「更换」重新选一次进店、整张表重新填 */
export function ServiceFilled({ name, visit, onChange }: { name: string; visit: ServiceVisit; onChange: () => void }) {
  return <HStack spacing={12}>
    <Image systemName="wrench.adjustable" font="title3" foregroundStyle="accentColor" />
    <VStack alignment="leading" spacing={2}>
      <Text font="subheadline" fontWeight="semibold" lineLimit={2}>{`已填入${name} · ${serviceDay(visit.arrive_ts)}`}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
        {[visit.title, visit.odometer ? km(visit.odometer) : "", `${visit.expenses.length} 笔`].filter(Boolean).join(" · ")}
      </Text>
    </VStack>
    <Spacer />
    <Button title="更换" action={onChange} buttonStyle="bordered" controlSize="small" />
  </HStack>
}

function MoneyLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <HStack>
    <Text>{label}</Text>
    <Spacer />
    <Text {...(strong ? { font: "headline" } : {})}>{value}</Text>
  </HStack>
}

/** 一行的金额：减免和优惠「−¥957.00」；原价照写；后面的正数（抹零往上）「+¥0.50」 */
function lineValue(amount: number, first: boolean): string {
  if (amount < 0) return `−${yuan(-amount)}`
  return first ? yuan(amount) : `+${yuan(amount)}`
}

/** 结算明细一组（只读）：数据源给的各行，最后是自付（各行加起来），下面写说明和结算备注 */
export function SettlementSection({ settlement, note }: { settlement: Settlement; note: string }) {
  const own = Math.round(settlement.lines.reduce((t, l) => t + l.amount, 0) * 100) / 100
  return <Section key="settlement" header={<Text>结算明细</Text>}
    footer={<Text>{[note, settlement.note ? `结算备注：${settlement.note}` : ""].filter(Boolean).join("")}</Text>}>
    {settlement.lines.map((l, i) => <MoneyLine key={`l${i}`} label={l.label} value={lineValue(l.amount, i === 0)} />)}
    <MoneyLine label="自付" value={yuan(own)} strong />
  </Section>
}
