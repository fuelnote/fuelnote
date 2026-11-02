# 写油记的数据源插件

数据源插件是一个独立的 Scripting 脚本。油记需要数据时用 `Script.run` 调用它，它只回答「有哪些数据」：不写账本，也不知道表单里填了什么。几笔交易合成一次加油、填表、核对都在油记里做；读懂原始数据的事在插件里做，例如把工单整理成要记的几笔费用。

能提供的数据：加油交易（`fuel`）；2.3 起还有车辆、行程、车况（`vehicles`、`trips`、`vehicle_status`）和养修（`service`）。契约的字段以本文为准；为什么这样定，见设计 `docs/specs/2026-10-27-plugins.md` 第 4 节。

## 1. 标记

- 脚本文件夹里放 `fuelnote.json`：`{ "contract": 1 }`。「设置 › 数据源 › 添加插件」只列带这个文件的脚本，不运行其他脚本。
- 列表里的名称、版本、图标取脚本自己的 `script.json`（`localizedNames.zh` 或 `name`、`version`、`icon`、`color`）。

## 2. 调用

```ts
Script.run({ name: 脚本名, queryParameters: { fuelnote: 1, action, ...参数 }, singleMode: true })
```

- `Script.queryParameters` 保留 JSON 的类型，`from`、`to` 是数字。
- 不管成功还是出错，都要 `Script.exit(对象)`，最外层包一层 try/catch。不 exit 时油记会一直等到超时。
- 插件可以弹出自己的页面（连接、填凭据），页面叠在油记上面。
- 油记不会同时给同一个插件发两个请求；`singleMode` 会结束这个插件还挂着的上一次。

## 3. 返回

- 成功：`{ ok: true, ... }`。
- 失败：`{ ok: false, error, message }`。`error` 是 `not_connected`、`expired`、`network`、`unsupported`、`failed` 之一，`message` 直接显示给用户。
- 返回 `null`（没给结果）算插件不可用。
- 不返回一部分数据：有一部分没取到时（例如两种付款方式里一种的凭据过期），整次返回错误。只列出一部分交易，用户会以为那次加油只付了一笔。交易附带的信息（例如油站的地址、坐标）取不到时可以留空，不算出错。

## 4. 动作

| action | 参数 | 返回（ok 之外） | 油记等多久 |
|---|---|---|---|
| `describe` | — | `contract`（1）、`id`、`name`、`version`、`capabilities` | 5 秒 |
| `status` | — | `connected`、`expired`、`account`（打码后的账号，可为 null） | 5 秒 |
| `connect` | — | 弹出插件自己的连接页；返回 `connected`、`account` | 不限 |
| `fuel` | `from`、`to`（毫秒时间戳） | `items`：`FuelTxn[]`（第 5 节） | 20 秒 |
| `vehicles`（2.3 起） | — | `items`：`RemoteVehicle[]`（第 6 节） | 20 秒 |
| `trips`（2.3 起） | `vehicle`、`from`、`to` | `items`：`Trip[]`，按开始时间升序（第 6 节） | 20 秒 |
| `vehicle_status`（2.3 起） | `vehicle` | `status`：`VehicleStatus`（第 6 节） | 10 秒 |
| `service`（2.3 起） | `vehicle` | `items`：`ServiceVisit[]`，新的在前（第 7 节） | 60 秒 |

- `id`：同一个插件始终不变，不能和已有的数据源重复。油记按它关联车辆，记录的来源也存它。
- `name`：设置里显示的名称；从这个插件选来填的记录，来源存的就是保存时的名称。
- `capabilities`：提供的数据，`fuel`；2.3 起还有 `vehicles`、`trips`、`vehicle_status`、`service`。提供 `trips`、`vehicle_status`、`service` 之一的，必须提供 `vehicles`（关联车辆用）。
- `vehicle`：`vehicles` 给的车辆 `id`。
- 超时从油记真正调用时算起。超时后油记不再等，晚回来的结果丢掉。
- 油记按月要交易：`from` 是某个月第一天 0 点，`to` 是某个月最后一刻（北京时间），一次可能跨几个月。结果按月缓存：包含最近 2 天的月份 10 分钟，更早的 1 天；出错不缓存。
- 行程、车况由油记缓存，插件不用另存。
- `service` 第一次要读全部进店的明细，所以油记等 60 秒；插件自己存已结算的明细，以后只读列表和新结算的。油记把结果缓存 10 分钟，选进店页下拉时重读。

## 5. 加油交易

```ts
type FuelTxn = {
  id: string             // 只用来在列表里区分，油记不存
  ts: number             // 付款完成的时间
  liters: number
  price: number          // 单价
  amount: number         // 机显金额（应收）
  paid: number           // 实付（实收）；券全额抵扣时是 0
  grade: number | null   // 92、95、98，柴油是 0；认不出时 null
  station: {
    code: string | null      // 插件这边的站码；同一个油站始终一样
    name: string | null
    address: string | null
    province: string | null
    city: string | null      // 直辖市填省名
    district: string | null
    lng: number | null       // WGS-84
    lat: number | null
  } | null
  channel: string | null // 付款方式，只用来显示，如「油卡」「钱包」
  plate: string | null   // 交易上带的车牌；没有时 null
}
```

- 时间是毫秒时间戳；坐标是 WGS-84，插件自己换算；金额以元、升数以升为单位，各保留两位小数。
- 只返回已完成的加油：退款、撤销、充值、圈存、店内消费都不返回。
- `station` 能给多少给多少。坐标可能不准，油记先看到站停车的位置，再看交易坐标。
- 几笔要合成一次加油时，单价不同、或都有站码而站码不同的，油记不让合成。
- 缺字段或类型不对的项，油记会丢掉；标号不是 92、95、98、0 时按认不出处理。

## 6. 车辆、行程、车况（2.3 起）

```ts
type RemoteVehicle = {
  id: string             // 插件这边的车辆标识；同一辆车始终一样
  name: string           // 车名
  detail: string         // 名称下面的一行，例如打码的车架号
}

type Place = {
  lng: number            // WGS-84
  lat: number
  address: string
  city: string
  district: string
}

type Trip = {
  id: string                       // 只用来区分，油记不存
  start_ts: number
  end_ts: number                   // 熄火的时间
  start_odometer_km: number | null
  end_odometer_km: number          // 熄火时的里程表
  distance_km: number | null
  fuel_l: number | null            // 这一趟用了多少油（升）
  start: Place | null
  end: Place | null                // 停车的位置
}

type VehicleStatus = {
  ts: number | null                // 车况的时间，通常是最后一次熄火
  fuel_l: number | null            // 剩余油量（升）
  range_km: number | null          // 续航
  avg_consumption: number | null   // 车机平均油耗（L/100km）
  odometer_km: number | null       // 里程表
}
```

- `trips` 给 `from`、`to` 之间的行程。油记按熄火的时间和停车的位置配加油，里程用熄火时的里程表。
- 里程以公里为单位；时间、坐标同第 5 节。
- 缺字段或类型不对的车辆、行程，油记会丢掉。

## 7. 养修（2.3 起）

```ts
type ServiceVisit = {
  id: string                 // 只用来在列表里区分，油记不存
  arrive_ts: number          // 到店时间
  odometer: number | null    // 到店里程
  title: string              // 这次进店的叫法，如「保养 · 补漆」
  dealer: {
    name: string | null      // 全称
    short: string | null     // 简称
    lng: number | null       // WGS-84
    lat: number | null
  } | null
  expenses: ServiceExpense[] // 要记的几笔，至少一笔
}

type ServiceExpense = {
  ts: number                 // 这一笔的时间
  title: string              // 费用的标题，如「补漆 · 后保、左后叶」
  remark: string             // 备注；带保养记录时是说明
  own: number                // 自付；不一定是实付
  maintenance: {             // 带保养记录时有；只有第一笔可以带
    items: { name: string; from: string }[]   // 保养项目，和它来自哪一项（例如工时的名称）
    notes: string[]          // 说明里可以改成保养项目的几段（检查、问题）
  } | null
  settlement: {
    lines: { label: string; amount: number }[]           // 原价为正，减免和优惠为负，抹零可正可负
    note: string                                         // 结算备注
    coupons: { name: string; amount: number | null }[]   // 这一笔的券和活动优惠；不知道金额时 null
  }
  perk_hints: PerkHint[]     // 先勾哪张卡的提示
}

type PerkHint =
  | { kind: "balance"; origin: "insurance"; amount: number }  // 那一期车险赠送的储值卡，用这个金额
  | { kind: "count"; name: string; used: number }             // 名字带 name 的次数卡，用 used 次
```

- 只返回已结算的进店：已取消的、还没结算的、数据源已不保留的都不返回。
- 第一笔填进油记的记费用表单，其余各「另记一笔」，用户可以关掉不记。哪几张工单合成一笔、哪一笔在前，都由插件定；油记不认识工单。
- 只有第一笔可以带 `maintenance`：油记再写一条保养记录，里程用 `odometer`。其余笔带了，油记也不用。
- `title`：这一笔在费用页上的名字，用户可以改。换了机油的保养（项目里有「机油」或「机油 <标号>」），油记自己写「第 N 次保养」，不用 `title`。
- `remark`：填进费用的备注，带保养记录时填进说明。`notes` 的每一段在 `remark` 里用「；」隔开；用户在保养项目页把一段改成项目时，油记把它从说明里去掉。
- `settlement.lines` 加起来等于 `own`；几张工单合成一笔时，同名的行相加。`coupons` 列在使用权益页上面，给用户对照着勾。
- `perk_hints`：油记在这一笔的时间有效、还有剩余的卡里找。储值的提示找那一期车险赠送的储值卡，剩余不少于金额；次数的提示找名字带 `name` 的次数卡，剩余不少于次数。对得上的正好一张时先勾好。
- 油记存下每一笔的标题、结算明细和对照，不存进店和工单的编号。
- 缺字段或类型不对的进店、费用，油记会丢掉；一次进店没有一笔能用的，整次丢掉。

## 8. 凭据

- 凭据存在插件自己的钥匙串里，油记读不到，油记的备份里也没有。
- `status`、`connect` 返回的账号要先打码。

## 9. 示例插件

`tools/plugin_example/` 是完整的示例：返回按当前时间编的交易（有一组分两笔付的，旁边还有单价不同、油站不同的各一笔），以及一辆示例车的行程（每次加油前开到那个油站，另外每天一趟）和车况；自己打开时可以切换已连接、已过期、未连接。

- `npm run plugin:install` 装到 `../FuelNote 示例插件`。第一次要在手机上新建同名的空脚本，再在开发服务器页面里选它。
- 在油记的「设置 › 数据源 › 添加插件」里添加它。

## 10. 版本

- 以后加可选字段不升 `contract`，改了已有字段的含义才升。
- `contract` 不是 1 的插件，油记显示「插件版本不兼容」，不调用。
