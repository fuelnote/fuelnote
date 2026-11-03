// 车辆数据提供方接口。界面和停车识别只通过这个接口使用各品牌，不认识具体品牌。
import { ProviderId, Settlement } from "../common/types"
import { Http } from "../platform/http"

export type Place = {
  /** WGS-84 */
  lng: number
  lat: number
  address: string
  city: string
  district: string
}

export type Trip = {
  id: string
  start_ts: number
  end_ts: number
  start_odometer_km: number | null
  end_odometer_km: number
  distance_km: number | null
  fuel_l: number | null
  start: Place | null
  end: Place | null
}

/** 车况（设计文档 18.1 节）：车上报的最后状态，通常是停车熄火时 */
export type VehicleStatus = {
  /** 车况时间（毫秒） */
  ts: number | null
  /** 剩余油量（升） */
  fuel_l: number | null
  /** 续航（km） */
  range_km: number | null
  /** 车机平均油耗（L/100km） */
  avg_consumption: number | null
  /** 里程表（km） */
  odometer_km: number | null
}

export type CredentialField = {
  key: string
  label: string
  placeholder?: string
  hint?: string
  multiline?: boolean
}

export type RemoteVehicle = { id: string; name: string; detail: string }

/** 提供方的会话缓存（一段文本），应用层存进钥匙串，冷启动时少换一次会话 */
export type SessionStore = { get(): string | null; set(value: string | null): void }

export type ProviderContext = { http: Http; now: () => number; sessionStore?: SessionStore }

export type Credential = Record<string, string>

export class ProviderError extends Error {
  kind: "auth" | "network" | "server"
  constructor(kind: ProviderError["kind"], message: string) {
    super(message)
    this.name = "ProviderError"
    this.kind = kind
  }
}

/** 先勾哪张卡的提示（docs/plugins.md 第 7 节）：储值的找那一期车险赠送的储值卡，次数的找名字带 name 的次数卡 */
export type PerkHint =
  | { kind: "balance"; origin: "insurance"; amount: number }
  | { kind: "count"; name: string; used: number }

/** 一次进店要记的一笔费用（docs/plugins.md 第 7 节，插件化设计 D19） */
export type ServiceExpense = {
  ts: number
  /** 费用页上的名字，用户可以改；换了机油的保养油记自己写「第 N 次保养」 */
  title: string
  /** 备注；带保养记录时是说明 */
  remark: string
  /** 自付；不一定是实付 */
  own: number
  /** 保养项目（和它来自哪一项）、说明里可以改成项目的几段；只有第一笔可以带 */
  maintenance: { items: Array<{ name: string; from: string }>; notes: string[] } | null
  settlement: Settlement
  perk_hints: PerkHint[]
}

/** 一次已结算的进店（docs/plugins.md 第 7 节）：编号只用来在列表里区分，油记不存 */
export type ServiceVisit = {
  id: string
  arrive_ts: number
  /** 到店里程 */
  odometer: number | null
  /** 这次进店的叫法，如「保养 · 补漆」 */
  title: string
  /** 经销商：全称、简称、位置（WGS-84） */
  dealer: { name: string | null; short: string | null; lng: number | null; lat: number | null } | null
  /** 要记的几笔，至少一笔 */
  expenses: ServiceExpense[]
}

/** 养修明细的存取（内置的数据源用）：已结算的明细存下来，以后只读列表和新结算的；不进备份 */
export type ServiceStore = { load(): unknown; save(value: unknown): void }

export type VehicleDataProvider = {
  id: ProviderId
  name: string
  description: string
  credentialFields: CredentialField[]
  /** 整理用户粘贴的内容，例如从 BoxJS 的 JSON 里取出需要的字段；缺少必填项时抛错 */
  normalizeCredential(input: Credential): Credential
  /** 读取账号下的车辆，同时用来校验凭据 */
  vehicles(ctx: ProviderContext, cred: Credential): Promise<RemoteVehicle[]>
  /** 时间范围内的行程，按开始时间升序 */
  trips(ctx: ProviderContext, cred: Credential, vehicleId: string, range: { from: number; to: number }): Promise<Trip[]>
  /** 车况（剩余油量等）；不支持的提供方不实现 */
  vehicleStatus?(ctx: ProviderContext, cred: Credential, vehicleId: string): Promise<VehicleStatus>
  /** 养修：已结算的进店和要记的几笔费用，新的在前；不支持养修的提供方不实现 */
  service?(ctx: ProviderContext, cred: Credential, vehicleId: string, store: ServiceStore): Promise<ServiceVisit[]>
}
