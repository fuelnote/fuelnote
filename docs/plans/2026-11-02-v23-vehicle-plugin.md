# 油记 2.3：车辆数据走契约，养修挪进记费用，沃尔沃搬成私有插件 — 实施文档

- 设计：`docs/specs/2026-10-27-plugins.md` 的第 2 阶段（第 2–7、9、10 节；D2、D3、D6、D16、D17、D18，用户 2026-11-02 定）。待定的六条在第 14 节最后。
- 沃尔沃插件是私有的：代码、协议、凭据抓取和用真实数据的测试都在插件的私有仓库，它的计划在插件自己的文件夹里（beta.3 开工时建）。本文只写油记这一边，以及两边在哪里对接。
- 约定沿用 `CLAUDE.md` 和 2.2 实施文档：纯逻辑放 `common/`；入口只从一个模块导入；泛型写成函数声明或 `<T,>`；可选属性不传 `undefined`。
- 每个测试版：先写 CHANGELOG → `npm run bump -- x.y.z` → `npm run check` 和 `XXYH_ROOT=E:/GitHub/xxyh npm test` 都退出 0 才提交 → `git tag -s`，不推送 → 跑 FuelNote Check、看完截图 → 再请用户看剩下的项目。
- 验收的原则（D16）：除了加油停车提示和养修（设计 3.4 节），界面和结果都和 2.2 一样。

## 顺序

1. 开工前：用户定设计第 14 节的待定；在手机上量小组件的内存；画第十八轮稿。
2. beta.1：行程、车况走契约，沃尔沃仍是内置；去掉加油停车提示（D2）。没有新界面，不等画稿。
3. beta.2：养修挪进记费用（3.4 节）和费用的「可能重复」（第 7 节）；已记下的养修转换一次（待定第 3 条）。画稿定了再写。
4. beta.3：沃尔沃搬成私有插件。画稿定了再写。
5. 2.3.0：用户说「发版」时发布。

## 开工前

- [ ] 用户定设计第 14 节的待定（六条）。
- [ ] 手机上量小组件（临时代码，量完还原）：油记的小组件读车况前后、再调一次示例插件前后的可用内存。和探针比（探针调完还剩 32–34 MB，设计第 9 节）：够就由小组件调插件；不够就小组件只显示油记上次读到的车况。
- [ ] 画稿第十八轮（浅色、深色，真实数据打码，发画布并渲染 PNG）：
  - beta.2：记费用里的「从沃尔沃选」（还没选、选好、未连接、已过期）；选进店页（列表、读不到、重新连接）；填好的记费用（门店旁标「沃尔沃」、结算明细、另记一笔）；编辑记下的费用（结算明细只读）；保存时的「可能重复」。
  - beta.3：沃尔沃插件的连接页，照 DsEjoyAuto：打开就从 BoxJS 读 `volvo_auth`，读到后列出车辆；连不上 BoxJS、BoxJS 里没有、已过期。设置 › 数据源：沃尔沃和易捷都是插件；待定第 6 条的提示。

## 2.3.0-beta.1：行程、车况走契约（沃尔沃仍是内置）

- [ ] `common/plugin.ts`：契约加 `vehicles`、`trips`、`vehicle_status` 的校验和整理（缺字段或类型不对的项丢掉）；能力检查：有 `trips`、`vehicle_status`、`service` 之一的必须有 `vehicles`；超时按设计 4.3 节。
- [ ] 数据源接口（`providers/types.ts`）：车辆、行程、车况照契约改成 `vehicles`、`trips`、`vehicleStatus`；养修的几个方法 beta.2 再改。内置的沃尔沃按新接口实现，结果和 2.2 相同。`app/plugins.ts` 把插件包成同一个接口（排队、超时用 `common/plugin_source.ts`）。`ProviderId` 改成字符串（数据源的 id），已有数据不用改。
- [ ] `app/vehicle_data.ts`：读行程、车况都经过数据源接口，缓存照旧（待定第 4 条）。能不能读按数据源的能力和连接状态：内置的看凭据在不在，插件看上次调用是不是「未连接」。
- [ ] 去掉加油停车提示（D2）：记录页顶部的提示，`detectOpenStop`、`openStopNow`、`dismissStop`；`settings.dismissed_stops` 去掉（读到时丢掉）；打开油记时不再读行程。记加油「自动填写」照旧用 `openStopIn` 显示最近 2 天没记的加油停车。
- [ ] 设置 › 数据源、车辆的「车辆数据」列出能提供车辆数据的数据源：内置的沃尔沃和带车辆能力的插件。
- [ ] 示例插件（`tools/plugin_example/`）：加上 `vehicles`、`trips`、`vehicle_status`，返回按当前时间生成的假数据；`docs/plugins.md` 写这三个动作和数据。
- [ ] 测试：契约新动作的校验和整理（`tests/plugin.test.ts`）；内置沃尔沃按新接口返回的行程、车况和 2.2 相同；行程回放照样通过；分层测试照旧：只有 `providers/registry.ts` 引用 `providers/volvo_*`。
- [ ] FuelNote Check：记录页（没有加油停车提示）、记加油自动填写截图核对；`plugin` 一项加上用示例插件读车辆、行程、车况。
- [ ] `CHANGELOG.md`、`README.md`、`CLAUDE.md`。

## 2.3.0-beta.2：养修挪进记费用

- [ ] 契约 `service`（设计 4.3、4.4 节）：`common/plugin.ts` 校验和整理 `ServiceVisit`（缺字段或类型不对的进店、工单丢掉）；超时按待定第 2 条。
- [ ] 数据源接口：`serviceTitle`、`serviceVisits`、`serviceVisit`、`serviceNaming` 合成 `service`，返回契约的 `ServiceVisit[]`。内置的沃尔沃按它实现：
  - 只返回已结算的；叫法、标题、项目和别名、写进备注的、备注、结算明细、权益提示由它给出，结果和 2.2 相同。用到的沃尔沃规则这一版先留在 `common/service.ts`，只有内置的沃尔沃和下面的转换调用；beta.3 搬进插件。
  - 已结算的明细照旧存在 `service_visits.json`（不进备份），以后只读列表和新结算的。
- [ ] `common/service.ts` 里油记的规则（设计 3.4 节）只用契约的字段：按进店整理表单（这一笔、另记一笔、实付的默认值）；按权益提示挑卡（养-5～养-7）；找门店（养-8～养-10）；合并结算明细；保存（不写 `service_records`，门店不写经销商代码，费用存标题和结算明细）；费用页的标题（待定第 1 条）；第几次保养。去掉 `visitState`、`serviceRecordFor`、`serviceVocabulary`、`serviceOfExpense`。
- [ ] 数据（`common/types.ts`）：`ExpenseRecord` 加可选的 `title`、`settlement`；去掉 `ServiceRecord`、`LedgerFile.service_records`、`Store.dealer`。读账本时校验新字段（`common/ledger_file.ts`）；删除记录、车辆时不再管 `service_records`（`common/ledger.ts`）。
- [ ] 已记下的养修转换一次（待定第 3 条）：读到 `service_records` 时，把结算明细写进记成的费用，没有保养记录的写上标题，删掉 `service_records` 和门店的经销商代码，马上写回账本。转换的代码 beta.3 随沃尔沃的规则删掉，之后读到这两项直接丢掉。
- [ ] 读养修（`app/service.ts`）：只在选进店页读，缓存按设计 3.4 节（`common/plugin_source.ts`）。去掉后台读取：`serviceDue`、`refreshService`、切到费用页时的读取。
- [ ] 页面：
  - 记费用（`pages/expense_form.tsx`）：「从沃尔沃选」一行（按画稿）；选好以后照 2.2 的从养修填写；编辑时去掉来源一行和「实付」的写法，有结算明细时只读显示（标题「结算明细」），使用权益页上面列出其中的券和活动优惠。
  - 新的选进店页（`pages/service_pick.tsx`）：按画稿。
  - 去掉费用页的养修一组（`pages/expense_records.tsx`）、养修记录页（`pages/service_visits.tsx`）、选择门店里的经销商标签（`pages/store_picker.tsx`）、门店详情里的经销商代码（`pages/store_detail.tsx`）。
  - `pages/app.tsx`：去掉 `refreshServiceNow`、`recordVisit`；打开记费用时不再找关联的养修。
- [ ] 费用的「可能重复」（设计第 7 节，费-1～费-7）：`common/form.ts` 找同一辆车、同一天、同一类、同样金额的费用；记费用保存时警告，确认后保存；从养修一次存几笔时每一笔都查。
- [ ] 文案：填表时的「沃尔沃写的自付是 …」用数据源的名称；存下的费用上不写数据源的名称（D17）。
- [ ] 示例插件：加上 `service`，返回按当前时间生成的假进店（一次保养带另记的补漆、一次自付 0 的保修、两种权益提示）；`docs/plugins.md` 写 `service` 和 `ServiceVisit`。
- [ ] 测试：
  - `tests/plugin.test.ts`：`service` 的校验和整理。
  - `tests/service.test.ts`：设计 3.4 节的用例（养-1～养-14）；标题（待定第 1 条）；转换（结算明细和标题写进费用，去掉 `service_records` 和经销商代码）。
  - `tests/core.test.ts`：费用的「可能重复」（费-1～费-7）。
  - `tests/real_data.test.ts`：内置沃尔沃按 `service` 返回的 10 次进店，叫法、标题、项目、备注、结算明细、先勾的卡和 2.2 相同。
  - 用到门店 `dealer`、`service_records` 的测试跟着改（门店、备份、账本、导出、权益）。
- [ ] FuelNote Check：`service` 一项改成：记费用 → 从沃尔沃选（探测数据）→ 选 2026/4/3 那次 → 核对项目、备注、先勾的卡、门店、结算明细 → 保存 → 再选一次，看「可能重复」→ 删掉。截图：选进店页、填好的记费用、编辑时的结算明细、「可能重复」。
- [ ] `CHANGELOG.md` 写明：养修挪进记费用，费用页的养修一组和养修记录页去掉；费用的「可能重复」；门店不再存经销商代码。`README.md`、`CLAUDE.md`。

## 2.3.0-beta.3：沃尔沃搬成私有插件

- [ ] 插件这边（细节在插件计划）：建私有仓库；`describe`（`id` 是 `volvo_cn`，名称「沃尔沃」，能力 `vehicles`、`trips`、`vehicle_status`、`service`）、`status`、`connect`（照第十八轮稿，打开就从 BoxJS 读）、四个车辆的动作；凭据和会话存插件自己的钥匙串，登录过期时自动从 BoxJS 换（和易捷一样）；已结算的养修明细存在插件里。沃尔沃的代码、规则、探测工具、真实数据的测试都搬过去。
- [ ] 油记删掉：`providers/volvo_cn.ts`、`volvo_service.ts`、`grpc.ts`、`registry.ts` 和内置数据源这条路（设计 4.5 节），`platform/provider_ctx.ts`、`tools/volvo_service_probe.ts`、`pages/provider_settings.tsx`（沃尔沃凭据页），`common/service.ts` 里沃尔沃的规则和 beta.2 的转换；第一次打开时删掉 `service_visits.json`。对应的测试搬到插件。
- [ ] 凭据（待定第 5 条）：`app/backup.ts` 的凭据去掉沃尔沃；第一次打开时删掉钥匙串里沃尔沃的凭据和会话。
- [ ] 小组件：`widget.json` 的车况链接加上插件的脚本名；`common/widget_runtime.ts` 调插件的 `vehicle_status`（10 秒），读不到就显示上次的车况，不再引入数据源的代码。开工前量的内存不够时，改成只显示油记上次读到的。
- [ ] 快捷指令：截屏记加油按付款时间配停车，走插件的 `trips`，和主 App 同一条路。
- [ ] 设置 › 数据源只列插件；车关联的数据源还没添加时的提示（待定第 6 条，按画稿）。
- [ ] 公开文档里不留沃尔沃协议的细节（端点、字段名、签名、gRPC 的读法）：设计文档、2.1 设计（第 3、4 节）、实施文档和 `CLAUDE.md` 里相关的段落搬到插件仓库，留一句指向契约。CHANGELOG 不改。
- [ ] 测试：分层测试改成油记里没有品牌的代码；行程回放和养修的真实数据测试改读插件导出的通用数据（`Trip[]`、`ServiceVisit[]` 的 JSON，放在 `XXYH_ROOT` 下，不进仓库），`tools/device_check.ts` 也改读这份。
- [ ] FuelNote Check：加「什么都不接」场景（设计第 8 节：新装、不接任何数据源，记加油、费用、保养、保险、权益）。只调示例插件，不调真实插件。
- [ ] `CHANGELOG.md` 写明：沃尔沃不再内置，要另装插件；加油停车提示去掉。`README.md`、`CLAUDE.md`。

## 2.3.0 发布

- [ ] 用户说「发版」后：CHANGELOG 合成 2.3.0 一节；设计文档的状态改成第 2 阶段已完成；推送 main 和标签，等发布流程跑完，下载 `FuelNote.zip` 核对版本号。

## 手机上的验收（2.3）

beta.1：

1. 记录页顶部不再有加油停车的提示；「当前」的油量、续航照旧。
2. 记加油「自动填写」照旧列出最近 2 天没记的加油停车；截屏记加油按付款时间配停车、从行程选择照旧。
3. 小组件的车况照旧。

beta.2：

4. 费用页没有「沃尔沃养修」一组；记费用里「从沃尔沃选」列出已结算的进店。
5. 选一次进店：项目、备注、先勾好的权益、另记的工单和 2.2 的记下一样；门店旁标「沃尔沃」；有结算明细。保存后费用页的标题和 2.2 一样。
6. 再选同一次进店、保存：每一笔都提示「可能重复」。
7. 以前记下的养修：费用页的标题照旧，编辑时结算明细只读显示；门店详情里没有经销商代码。

beta.3：

8. 装沃尔沃插件，在设置 › 数据源添加：连接页一打开就从 BoxJS 读到凭据，列出车辆。
9. 已经关联沃尔沃的车不用重选，第 1–7 条照旧；小组件、快捷指令都走插件。
10. 设置 › 备份的凭据里没有沃尔沃了。
11. 移除沃尔沃插件：设置 › 数据源出现提示，记录页没有「当前」，记费用里没有「从沃尔沃选」，记下的养修照旧；再添加回来，一切照旧。
