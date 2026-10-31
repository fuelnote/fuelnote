# 写油记的数据源插件

数据源插件是一个独立的 Scripting 脚本。油记需要数据时用 `Script.run` 调用它，它只回答「这段时间里有哪些数据」：不写账本，也不知道表单里填了什么。合成、填表、核对都在油记里做。

现在能提供的数据是加油交易（`fuel`）。设计见 `docs/specs/2026-10-27-plugins.md` 第 4 节；本文是写插件时要遵守的部分。

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
| `fuel` | `from`、`to`（毫秒时间戳） | `items`：`FuelTxn[]` | 20 秒 |

- `id`：同一个插件始终不变，不能和内置的数据源（`volvo_cn`）重复。
- `capabilities`：提供的数据。现在只认 `fuel`；`trips`、`vehicle_status`、`service` 以后开放。
- 超时从油记真正调用时算起。超时后油记不再等，晚回来的结果丢掉。
- 油记按月要交易：`from` 是某个月第一天 0 点，`to` 是某个月最后一刻（北京时间），一次可能跨几个月。结果按月缓存：包含最近 2 天的月份 10 分钟，更早的 1 天；出错不缓存。

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

## 6. 凭据

- 凭据存在插件自己的钥匙串里，油记读不到，油记的备份里也没有。
- `status`、`connect` 返回的账号要先打码。

## 7. 示例插件

`tools/plugin_example/` 是完整的示例：返回按当前时间编的交易（有一组分两笔付的，旁边还有单价不同、油站不同的各一笔），自己打开时可以切换已连接、已过期、未连接。

- `npm run plugin:install` 装到 `../FuelNote 示例插件`。第一次要在手机上新建同名的空脚本，再在开发服务器页面里选它。
- 在油记的「设置 › 数据源 › 添加插件」里添加它。

## 8. 版本

- 以后加可选字段不升 `contract`，改了已有字段的含义才升。
- `contract` 不是 1 的插件，油记显示「插件版本不兼容」，不调用。
