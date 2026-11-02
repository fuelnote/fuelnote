// FuelNote 示例插件：油记数据源契约（docs/plugins.md）的示例实现，返回按当前时间编的加油交易、一辆示例车的行程和车况。写插件时照这个改。
// 被油记调用时 Script.queryParameters 带 fuelnote: 1 和 action；处理完一定 Script.exit(对象)，出错时也一样，否则油记会一直等。
// 自己打开时是连接页：可以切换「已连接」「已过期」「未连接」，用来看油记在出错时的样子。
import { Button, HStack, Image, List, Navigation, NavigationStack, Script, Section, Spacer, Text, useState } from "scripting"

type State = "connected" | "expired" | "disconnected"

const CONTRACT = 1
const STATE_KEY = "example.state"
const ACCOUNT = "示例账号 ****0001"
const LABELS: Record<State, string> = { connected: "已连接", expired: "已过期", disconnected: "未连接" }

function readState(): State {
  const s = Storage.get<string>(STATE_KEY)
  return s === "expired" || s === "disconnected" ? s : "connected"
}

/** status 和 connect 的返回：账号要先打码 */
function status(): Record<string, unknown> {
  const s = readState()
  return { ok: true, connected: s !== "disconnected", expired: s === "expired", account: s === "disconnected" ? null : ACCOUNT }
}

type Station = { code: string; name: string; address: string; province: string; city: string; district: string; lng: number; lat: number }

/** 编的油站，坐标是 WGS-84；世纪公园那个故意偏了约 300 m，用来看油记先按停车认站 */
const STATIONS: Record<"a" | "b" | "c", Station> = {
  a: { code: "EX0001", name: "示例加油站（人民广场）", address: "示例路 1 号", province: "上海市", city: "上海市", district: "黄浦区", lng: 121.4737, lat: 31.2304 },
  b: { code: "EX0002", name: "示例加油站（徐家汇）", address: "示例路 2 号", province: "上海市", city: "上海市", district: "徐汇区", lng: 121.4365, lat: 31.1886 },
  c: { code: "EX0003", name: "示例加油站（世纪公园）", address: "示例路 3 号", province: "上海市", city: "上海市", district: "浦东新区", lng: 121.5545, lat: 31.219 },
}

const two = (n: number) => Math.round(n * 100) / 100

function txn(id: string, ts: number, station: Station, grade: number, price: number, liters: number, discount: number, channel: string) {
  const amount = two(price * liters)
  return { id, ts, liters, price, amount, paid: two(amount - discount), grade, station, channel, plate: null }
}

/**
 * 按当前时间编的交易（同一个小时里不变）。最近一次分两笔付（油卡余额不够，钱包补足），
 * 紧挨着还有一笔单价不同的、一笔在别的站的，用来看哪些能合成
 */
function transactions(now: number) {
  const hour = Math.floor(now / 3600e3) * 3600e3
  const day = 86400e3
  const t = hour - 2 * 3600e3
  return [
    txn("split-1", t, STATIONS.a, 95, 7.82, 30, 5, "油卡"),
    txn("split-2", t + 2 * 60e3, STATIONS.a, 95, 7.82, 12.68, 0, "钱包"),
    txn("other-price", t + 4 * 60e3, STATIONS.a, 95, 7.95, 10, 0, "钱包"),
    txn("other-station", t + 6 * 60e3, STATIONS.b, 95, 7.82, 5, 0, "钱包"),
    txn("d6", hour - 6 * day, STATIONS.b, 95, 7.76, 41.2, 10, "油卡"),
    txn("d13", hour - 13 * day, STATIONS.c, 95, 7.76, 39.8, 0, "钱包"),
    txn("d20", hour - 20 * day, STATIONS.a, 92, 7.28, 44.5, 0, "油卡"),
    txn("d27", hour - 27 * day, STATIONS.b, 98, 8.67, 35.05, 15, "油卡"),
    txn("d45", hour - 45 * day, STATIONS.c, 95, 7.9, 42, 0, "钱包"),
  ]
}

const CAR = { id: "example-car", name: "示例车", detail: "车架号 ••••0001" }
/** 编的住处：每天下午停在这里 */
const HOME = { lng: 121.4512, lat: 31.2268, address: "示例路 100 号", city: "上海市", district: "静安区" }

function placeOf(st: Station) {
  return { lng: st.lng, lat: st.lat, address: st.address, city: st.city, district: st.district }
}

/**
 * 按当前时间编的行程（同一个小时里不变）：每次加油前开到那个油站，熄火 2 分钟后付款（合成的几笔只停一次）；
 * 另外最近 60 天每天下午开一趟回住处。里程一路往上加，id 用熄火时间，换了小时也不变
 */
function trips(now: number) {
  const hour = Math.floor(now / 3600e3) * 3600e3
  const extra = new Set(["split-2", "other-price", "other-station"])
  const stops = [
    ...transactions(now).filter(t => !extra.has(t.id)).map(t => ({ end: t.ts - 2 * 60e3, place: placeOf(t.station) })),
    ...Array.from({ length: 60 }, (_, i) => ({ end: hour - i * 86400e3 - 5 * 3600e3, place: HOME })),
  ].filter(x => x.end <= now).sort((a, b) => a.end - b.end)
  let km = 82000
  return stops.map((x, i) => {
    const dist = 12 + (i % 5) * 3
    const start = km
    km = two(km + dist)
    return {
      id: `trip-${x.end}`, start_ts: x.end - 30 * 60e3, end_ts: x.end, start_odometer_km: start, end_odometer_km: km,
      distance_km: dist, fuel_l: two(dist * 0.09), start: null, end: x.place,
    }
  })
}

/** 车况：最后一趟熄火时上报的 */
function vehicleStatus(now: number) {
  const last = trips(now).pop()
  return { ts: last ? last.end_ts : now, fuel_l: 32.5, range_km: 380, avg_consumption: 9.2, odometer_km: last ? last.end_odometer_km : 82000 }
}

/** 未连接、已过期时数据动作都返回错误 */
function blocked(): Record<string, unknown> | null {
  const s = readState()
  if (s === "disconnected") return { ok: false, error: "not_connected", message: "示例插件未连接，请在插件的页面里连接" }
  if (s === "expired") return { ok: false, error: "expired", message: "示例插件的凭据已过期，请在插件的页面里重新连接" }
  return null
}

function ConnectPage() {
  const dismiss = Navigation.useDismiss()
  const [state, setState] = useState(readState())
  const choose = (s: State) => {
    Storage.set(STATE_KEY, s)
    setState(s)
  }
  return <NavigationStack>
    <List navigationTitle="FuelNote 示例插件" navigationBarTitleDisplayMode="inline" toolbar={{ confirmationAction: <Button title="完成" action={() => dismiss()} /> }}>
      <Section header={<Text>连接状态</Text>} footer={<Text>示例插件不连任何服务，交易、行程和车况都是按当前时间编的。切换状态，可以看油记在未连接、凭据过期时的样子。</Text>}>
        {(["connected", "expired", "disconnected"] as State[]).map(s => <Button key={s} action={() => choose(s)}>
          <HStack>
            <Text foregroundStyle="label">{LABELS[s]}</Text>
            <Spacer />
            {state === s ? <Image systemName="checkmark" foregroundStyle="accentColor" /> : null}
          </HStack>
        </Button>)}
      </Section>
      <Section header={<Text>账号</Text>}>
        <Text>{state === "disconnected" ? "—" : ACCOUNT}</Text>
      </Section>
    </List>
  </NavigationStack>
}

async function handle(action: string, q: Record<string, any>): Promise<unknown> {
  if (action === "describe") {
    return { ok: true, contract: CONTRACT, id: "example", name: "示例", version: Script.metadata.version, capabilities: ["fuel", "vehicles", "trips", "vehicle_status"] }
  }
  if (action === "status") return status()
  if (action === "connect") {
    await Navigation.present({ element: <ConnectPage /> })
    return status()
  }
  const known = ["fuel", "vehicles", "trips", "vehicle_status"]
  if (!known.includes(action)) return { ok: false, error: "unsupported", message: `示例插件不支持「${action}」` }
  const err = blocked()
  if (err) return err
  const now = Date.now()
  if (action === "vehicles") return { ok: true, items: [CAR] }
  if ((action === "trips" || action === "vehicle_status") && q.vehicle !== CAR.id) return { ok: false, error: "failed", message: "示例插件没有这辆车" }
  if (action === "vehicle_status") return { ok: true, status: vehicleStatus(now) }
  const from = Number(q.from)
  const to = Number(q.to)
  if (action === "trips") return { ok: true, items: trips(now).filter(t => t.start_ts <= to && t.end_ts >= from) }
  return { ok: true, items: transactions(now).filter(t => t.ts >= from && t.ts <= to) }
}

async function run() {
  const q = (Script.queryParameters ?? {}) as Record<string, any>
  if (q.fuelnote) {
    let result: unknown
    try {
      result = await handle(String(q.action), q)
    } catch (e) {
      result = { ok: false, error: "failed", message: e instanceof Error ? e.message : String(e) }
    }
    Script.exit(result)
    return
  }
  await Navigation.present({ element: <ConnectPage /> })
  Script.exit()
}

void run()
