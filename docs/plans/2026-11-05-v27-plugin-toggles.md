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

## 易捷插件 0.4.3、沃尔沃插件 0.2.1

- [x] 自己的页面用大标题，副标题「版本 x」（R30Plugins A）；版本号，插件计划里记上。
- [x] 本地提交、签名标签 `v0.4.3`、`v0.2.1`（用户同意，2026-11-05）；推送私有仓库、上传 Secret Gist 前先问用户。

## 手机上的验收（2.7）

1. 设置 › 数据源：易捷、沃尔沃两行写「版本 … · …」，和插件的 `script.json` 一样。
2. 插件详情：副标题写「版本 … · 脚本 …」；关掉易捷的「信息」，回到记录页「今日优惠」一组不见了，小组件里放了它的格子回到默认内容；再打开，下次回到前台时查回来。
3. 沃尔沃只剩「车况」开着时，它的开关是灰的，拨不动；「车辆」没有开关。
4. 在 Scripting 里直接打开易捷、沃尔沃、示例插件：大标题下面写版本。
