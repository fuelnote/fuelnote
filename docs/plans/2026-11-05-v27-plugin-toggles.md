# 油记 2.7：插件的版本号和逐项开关 — 实施文档

- 设计：`docs/specs/2026-10-27-plugins.md` 5.1、5.2 节（D28、D29，用户 2026-11-05 定，画稿第三十轮）。规则和用例（开-1～开-10）只写在设计里，本文只引用节和用例编号。
- 契约不变：插件不用改就能被逐项关掉。插件自己的页面写版本是给插件作者的建议（示例插件、接入指南）。
- 易捷、沃尔沃插件是私有的：它们的页面在各自仓库里改；提交、推送私有仓库、上传 Secret Gist 前都先问用户。
- 约定沿用 `CLAUDE.md`：纯逻辑放 `common/`；`pages/` 只从 `common/model.ts` 导入；泛型写成函数声明或 `<T,>`；可选属性不传 `undefined`。
- 每个测试版：先写 CHANGELOG → `npm run bump -- x.y.z` → `npm run check` 和 `XXYH_ROOT=E:/GitHub/xxyh npm test` 都退出 0 才提交 → `git tag -s`，不推送 → 跑 FuelNote Check、看完截图 → 再请用户看剩下的项目。
- 写代码按测试先行：先写用例编号对应的测试，看它失败，再写实现。

## 顺序

1. beta.1：油记的版本号和逐项开关；示例插件 1.3.1 的大标题和版本。用示例插件就能验。
2. 易捷插件 0.4.3、沃尔沃插件 0.2.1：自己的页面大标题和版本。
3. 手机上的验收（本文最后一节）。
4. 2.7.0：2026-11-05 用户说「发版」后发布，七个测试版合成一节更新记录；示例插件 1.4.0 同时发布。

## 2.7.0-beta.1

### 逐项开关（纯逻辑，5.2 节）

- [x] `common/types.ts`：`PluginRef` 加可选的 `off`（关掉的几项）。
- [x] `common/plugin.ts`：
  - `usedCapabilities(ref)`：提供的去掉关掉的；行程、车况、养修都不在时去掉「车辆」（开-8）。
  - `capabilitySwitch(ref, cap)`：`fixed`（车辆）、`locked`（只剩这一项开着，开-7）、`on`、`off`。
  - `setCapability(ref, cap, on)`：改 `off`；`fixed`、`locked` 的不改；`off` 空了就去掉这个键。
  - `refreshedRef` 带上 `off`，只留新版本还提供的（开-9）。
  - `sourceCaption(ref, version)`：设置列表那一行「版本 x · 用到的几项」；`pluginSubtitle(ref, version)`：插件详情的副标题「版本 x · 脚本 y」（5.1 节）。版本是空串时不写这一段。
- [x] `common/info_cards.ts`：`infoViews`、`cardTitles` 看用到的项（开-1）。
- [x] 测试：`tests/plugin.test.ts` 开-7、开-8、开-9、两行文字；`tests/info_cards.test.ts` 开-1；`tests/ledger_file.test.ts` `off` 原样保留。

### 用到的项（应用层）

- [x] `app/plugins.ts`：`pluginsWith` 看用到的项（开-1、开-2、开-3：信息卡片、油价、记加油的入口都经过它）。
- [x] `app/data_sources.ts`：数据源的 `capabilities` 是用到的项（开-4、开-5、开-6、开-8：车况、行程、养修、车辆关联都经过它；小组件的 `status_link` 跟着 `hasStatusSource`）。
- [x] `pages/widget_presets.tsx`：菜单的卡片按 `pluginsWith(data, "info")` 列（开-1）。

### 界面（画稿第三十轮）

- [x] `pages/settings.tsx`：每一行下面写 `sourceCaption`（R30Sources A）。
- [x] `pages/plugin_detail.tsx`：副标题写 `pluginSubtitle`；「提供的数据」每项右边一个开关（`fixed` 没有开关，`locked` 是灰的），说明照 R30DetailA；拨了以后存进设置（R30DetailA、R30Toggles）。

### 示例插件 1.3.1（`../FuelNote 示例插件`，公开仓库）

- [x] 自己的页面用大标题，副标题「版本 x」（`Script.metadata.version`，R30Plugins A）。
- [x] README 的接入指南：插件自己的页面写上版本；用户可以在油记里关掉某几项，插件照常回答。
- [x] 版本 1.3.1、CHANGELOG；本地提交、签名标签，推送前问用户。

### Check、文档

- [x] FuelNote Check 新增 `toggles`（在 `info` 之后）：开-1～开-10 逐条在手机上走一遍（示例插件、`fill` 的示例车）；截图：设置列表、插件详情（全开、关了「信息」、只剩一项）。STAMP 加一（71）。`tools/device_check.ts` 加这一项。
- [x] `docs/plugins.md`：第 1 节写插件页面的版本；第 12 节写用户可以关掉某几项。
- [x] `CHANGELOG.md`、`CLAUDE.md`（版本的路线图写 2.7；插件一段写用到的项）。
- [x] 在手机上跑 Check 的 `fill`、`info`、`toggles`，看完截图（2026-11-05：fill 8/8、info 10/10、toggles 13/13；开-2 先按「不显示加满」核对，和显-5 不符，检查改成「只写升数、不算金额」，STAMP 72）。

## 2.7.0-beta.2

用户 2026-11-05 看了 beta.1 的 Check 截图：开关太大、不协调，选了画稿第三十一轮 R31Choices A（设计 5.2 节、D29）。

- [x] `pages/plugin_detail.tsx`：每项是一行按钮，右边打勾（`checkmark`），轻点勾上或取消；不用的一项图标和名称变灰；只剩一项时勾是灰的、点了没反应；车辆没有勾，行程、车况、养修都不勾时也变灰（Check 截图里发现还是蓝的，同一个 beta.2 里改了）。说明照画稿。
- [x] 设计 5.2 节、D29，CHANGELOG、README、`CLAUDE.md` 跟着改。
- [x] FuelNote Check 的 `toggles` 截图（STAMP 73），看完截图：只剩一项时车辆还是蓝的，同一个 beta.2 里改成变灰。

## 2.7.0-beta.3

用户 2026-11-05 看了 beta.2 的样子：车辆和仅剩的一项点了没反应，像坏了；「在用」「不用」太口语。看了第三十二、三十三轮，选了 R33One（设计 5.2 节、D29）。

- [x] `pages/plugin_detail.tsx`：启用的打勾；停用的图标和名称变灰；不能停用的（车辆、仅剩的一项）右侧灰色的锁，这一行不是按钮。说明照画稿，没有车辆的插件不写车辆那一句。
- [x] 设计 5.2 节、D29，CHANGELOG、README、`CLAUDE.md` 跟着改。
- [x] FuelNote Check 的 `toggles` 截图（STAMP 74），看完截图（13/13；仅剩「油价」时油价带锁，车辆不在用、变灰不带锁；停用「信息」时车辆带锁），和 R33One 对过。

## 2.7.0-beta.4

用户 2026-11-05：每一项的说明（「也能放进小组件」「要记的几笔一起填好」）改成正式用语。

- [x] `pages/plugin_detail.tsx` 的 `hint`：七项的说明改写，画稿第三十三轮的四张跟着改。
- [x] FuelNote Check 的 `toggles` 截图（STAMP 75），看完截图（13/13，七项的说明都是新写法）。

## 2.7.0-beta.5

用户 2026-11-05：易捷的「今日优惠」是一种信息栏，油记应该读出它是什么；以后多一张卡片时不能合成一行「信息」。定了先讨论、并入 2.7；每张卡片一行；只请求启用的卡片；没声明的卡片不显示（设计 5.2 节、D30，画稿第三十四轮 R34Cards）。

- [x] `common/plugin.ts`：`pluginItems`（能力或 `card:<id>`）、`itemSwitch`、`setItem`、`enabledCards`、`cardShown`；`usedCapabilities`、`sourceCaption`、`refreshedRef` 按项。`PluginRef.off` 存项的 key。测试 `tests/plugin.test.ts`（开-7～开-9、开-11）。
- [x] `common/info_cards.ts`：只显示声明过、启用的卡片；还没查到的卡片每张一组（`pending`，按声明的顺序）；参数带 `cards`，变了重查；小组件和方案菜单只有启用的卡片。测试 `tests/info_cards.test.ts`（开-1、开-11、D30）。
- [x] `app/info_cards.ts`：每个插件的参数加上启用的卡片，`info` 传 `cards`；`infoKey` 带启用的卡片。`app/plugins.ts` `setPluginItem`。
- [x] `pages/plugin_detail.tsx` 按 `pluginItems` 列，卡片一行写卡片名称；`pages/widget_presets.tsx` 菜单只列启用的卡片。
- [x] 示例插件 1.4.0：多声明「示例公告」（第二批才给），只给 `cards` 里的卡片；README、CHANGELOG。
- [x] 契约 `docs/plugins.md` 第 4、9、11、13 节；设计 5.2 节、D30；小组件方案和信息卡片设计 7.3 节；CHANGELOG、README、`CLAUDE.md`。
- [x] FuelNote Check：`toggles` 改成按项（停用「示例公告」后插件只收到「示例卡片」、两张都停用、重新启用、升级多一张卡片），`info` 改成两张卡片；STAMP 76。在手机上跑 `fill`、`info`、`toggles`，看完截图（2026-11-05：fill 8/8、info 10/10、toggles 16/16；开-11 交给插件 `["sample"]`，插件只给了示例卡片，说明 `Script.run` 传数组参数没问题）。

## 2.7.0-beta.6

用户 2026-11-05 问「为什么一定要留一个选项」：可以全部停用，全部停用就是暂停；设置列表右边写「已停用」，油记不再运行插件（设计 5.2 节、D31）。

- [x] `common/plugin.ts`：`itemSwitch` 去掉 `locked`；`pluginPaused`；`sourceCaption` 全部停用时写「已全部停用」；`refreshedRef` 暂停的插件新的项也停用。测试 `tests/plugin.test.ts`（开-7、开-12）。
- [x] `app/plugins.ts`：`refreshPlugins` 跳过暂停的插件，`only` 时只读这一个（插件详情用）。
- [x] `pages/settings.tsx`：暂停的插件右边写「已停用」，不问连接状态。`pages/plugin_detail.tsx`：只有车辆带锁；说明改写；打开时读这个插件的说明（插件更新了）。
- [x] 设计 5.2 节、D29、D31，契约第 13 节，CHANGELOG、README、`CLAUDE.md`。
- [x] FuelNote Check：`toggles` 的开-7 改成仅剩一项也能停用，加开-12（全部停用、暂停时插件更新、启用一项恢复）；截图加设置列表和插件详情的全部停用；STAMP 77。在手机上跑，看完截图（2026-11-05：19/19；设置列表写「版本 1.4.0 · 已全部停用」、右边「已停用」）。

## 2.7.0-beta.7

用户 2026-11-05 问「车辆带锁，为什么其他选项关闭了，也算停用呢」：「车辆」不列为一项，写在说明里（设计 5.2 节、D32）。

- [x] `common/plugin.ts`：`pluginItems` 不列 `vehicles`；`usedCapabilities` 在行程、车况、养修有一项启用时带上 `vehicles`；`itemSwitch` 只有 `on`、`off`；`setItem` 不是一项的照原样返回。测试 `tests/plugin.test.ts`。
- [x] `pages/plugin_detail.tsx`：每一行都是按钮，没有锁；有车辆数据的插件说明里写关联车辆那一句。
- [x] 设计 5.2 节、D32，契约第 13 节，CHANGELOG、README、`CLAUDE.md`。
- [x] FuelNote Check：设置列表那一行不写「车辆」，开-8 检查「车辆」不是一项；STAMP 78。在手机上跑 `toggles`，看完截图（2026-11-05：19/19，插件详情没有「车辆」一行、没有锁）。

## 易捷插件 0.4.3、沃尔沃插件 0.2.1

- [x] 自己的页面用大标题，副标题「版本 x」（R30Plugins A）；版本号，插件计划里记上。
- [x] 本地提交、签名标签 `v0.4.3`、`v0.2.1`（用户同意，2026-11-05）；推送私有仓库、上传 Secret Gist 前先问用户。

## 手机上的验收（2.7）

用户 2026-11-05 看完 beta.7 后说「发版」。

1. 设置 › 数据源：易捷、沃尔沃两行写「版本 … · …」，和插件的 `script.json` 一样。
2. 插件详情：副标题写「版本 … · 脚本 …」；停用易捷的「信息」，回到记录页「今日优惠」一组不见了，小组件里放了它的格子回到默认内容；再打开，下次回到前台时查回来。
3. 沃尔沃仅「车况」启用时，车况和车辆右侧是锁，按下没有反应也不高亮。
4. 在 Scripting 里直接打开易捷、沃尔沃、示例插件：大标题下面写版本。
