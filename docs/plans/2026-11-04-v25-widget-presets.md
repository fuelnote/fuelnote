# 油记 2.5：小组件方案 — 实施文档

- 设计：`docs/specs/2026-11-04-presets-and-cards.md` 第 2–6 节（D1–D14 已定，用户 2026-11-04）。规则和用例只写在设计里，本文只引用节和用例编号。第 7 节信息卡片是 2.6，不在本文。
- 约定沿用 `CLAUDE.md`：纯逻辑放 `common/`；`pages/` 只从 `common/model.ts` 导入；泛型写成函数声明或 `<T,>`；可选属性不传 `undefined`。
- 每个测试版：先写 CHANGELOG → `npm run bump -- x.y.z` → `npm run check` 和 `XXYH_ROOT=E:/GitHub/xxyh npm test` 都退出 0 才提交 → `git tag -s`，不推送 → 跑 FuelNote Check、看完截图 → 再请用户看剩下的项目。
- 写代码按测试先行：每一步先写用例编号对应的测试，看它失败，再写实现。

## 顺序

1. beta.1：方案的规则、小组件按方案显示、设置 › 小组件方案、FuelNote Check 画出小组件截图。
2. 手机上的验收（本文最后一节），包括设计里要在手机上看的两件事：锁屏的小组件有没有「参数」，小组件预览能不能在油记里打开。
3. 2.5.0：用户说「发版」时发布。

## 2.5.0-beta.1

### 方案的规则（纯逻辑，设计第 3–5 节）

- [x] `common/widget_data.ts`（照旧不导入别的源文件）：
  - 类型 `WidgetContent`（`latest` 最近油耗、`average` 平均油耗、`fuel` 剩余油量、`range` 续航、`fill` 加满约、`month` 本月油费、`year` 今年油费、`last_fill` 上次加油）、`WidgetSlot`（`hero`、`top_left`、`top_right`、`bottom_left`、`bottom_right`、`circle`）、`WidgetPreset = { name; slots: Partial<Record<WidgetSlot, WidgetContent>> }`。
  - `WidgetSnapshot` 加可选的 `presets`、`prev_month_cost`（2.4 的 `widget.json` 没有）；`EMPTY_WIDGET` 写 `[]`、`0`。
  - `lastMonthCostNow(s, now)`：摘要是这个月写的时用 `prev_month_cost`；是上个月写的时用它的 `month_cost`；更早的是 0（这中间没有加油，不然油记会重写摘要）。
- [x] `common/widget_layout.ts`（新）：
  - 名称表 `CONTENT_TITLES`、`SLOT_TITLES`；每一格放得下的内容 `SLOT_CHOICES`（第 3 节）；自动顺序和总顺序（第 4 节）。
  - `hasContent(s, c)`：剩余油量、续航要有车况；加满约要 `fillAmountNow` 有值；其余都有。
  - `placeSlots(preset, slots, has)`：第 4 节的三条规则，返回每一格放的内容和是不是写「—」（位-1～位-11）。
  - `presetFor(presets, parameter)`：方-1～方-6；`默认` 没存过时是都自动的默认方案。
  - `missingReason(s, c)`：D12 的三种原因。
  - `heroText`、`cellText`、`circleText`：每种格子里写什么（第 3 节的表、第 4 节写「—」时）。
  - 改方案：`presetNameProblem`（名称不能空、不能重复、不能叫「默认」）、`addPreset`、`renamePreset`、`removePreset`、`setPresetSlot`、`resetDefault`；`usedElsewhere(preset, slot)`：大数字和四格里别的格子选了的内容（D13，锁屏圆形自己一组）；`normalizePresets`：读账本时丢掉不认识的格子、内容和放不下的内容，同名只留第一个。
- [x] `common/types.ts`：`Settings.widget_presets?: WidgetPreset[]`；`common/ledger_file.ts` 读账本时 `normalizePresets`。
- [x] 测试 `tests/widget_layout.test.ts`：位-1～位-11、方-1～方-6、D12 的原因、三种格子的文字（真实数据的例子同画稿：剩 47 L、续航 330 km、加满 ¥75、95# 9.41、最近 11.60、平均 12.42、上月 389.24、今年 8,552、23 天前）、改方案和名称的检查、`usedElsewhere`、`normalizePresets`、`lastMonthCostNow`（跨月、隔一个月）。

### 小组件按方案显示

- [x] `widget_view.tsx`（新，根目录）：`widget.tsx` 里的视图搬过来，尺寸和 family 由参数给（`Widget.displaySize` 只在 `widget.tsx` 里读），这样 FuelNote Check 也能画出来。它只从 `common/widget_runtime.ts` 导入；`widget.tsx` 只从它导入（打包器的限制，设计文档 9.4 节）。
  - 小号：主体按 `hero`；主体是剩余油量或没有车况时右上角不显示油量（位-10）。
  - 中号、大号：左栏按 `hero`，四格按 `top_left`…`bottom_right`；「这一箱」、最近加油、记加油不变。
  - 锁屏圆形：中间按 `circle`，圆环照旧；横条、一行不变。
  - 写「—」时：大数字下面写原因，数字格名称照写，圆形下面写名称（第 4 节，`R26Missing`）。
- [x] `widget.tsx`：读摘要、读车况，`presetFor(s.presets, Widget.parameter)`，交给 `WidgetView`。
- [x] `common/widget_runtime.ts` 转发 `widget_layout` 里小组件要用的。
- [x] `app/widget_snapshot.ts`：拆出 `buildWidgetSnapshot(data, now)`（Check 也用）；摘要多写 `presets`（设置里的方案）和 `prev_month_cost`（上个月的油费，只算加油）。
- [x] 发布包：`.github/workflows/release.yml` 的「Prepare package」加 `widget_view.tsx`；`tools/install_check.mjs` 也复制它。
- [x] 测试：`tests/widget_imports.test.ts` 改成 `widget.tsx` 只导入 `./widget_view`、`widget_view.tsx` 只导入 `./common/widget_runtime`，整条链照旧不含账本和同步；`tests/layers.test.ts`、`tests/syntax.test.ts` 认得 `widget_view.tsx`。

### 设置 › 小组件方案（设计第 6 节，`R26Settings`）

- [x] `pages/widget_presets.tsx`（新）：
  - 方案列表：默认（「参数空着时用」）、其他方案（「参数填「花费」」）、「添加方案」（先填名称）；说明写怎么填参数。回到这一页时重读。
  - 一套方案：名称（轻点改名，默认方案没有）；大数字；四格；锁屏圆形；预览；删除方案（`Dialog.actionSheet` 确认）或还原（都是自动时不能点）。
  - 每一行是 `Menu`：「自动 · 剩余油量」（自动现在显示的是什么，按当前车辆的摘要算）和放得下的内容；选中的打勾；别的格子选了的不能点，写「今年油费 · 左上」（D13）。
  - 预览：`Widget.preview`，参数传这套方案的名称（JSON 写法，方-6）；出错时提示。
  - 改了就 `updateSettings`（写账本、重写小组件的摘要、刷新小组件，`setData` 里已有）。
- [x] `pages/settings.tsx`：「记加油」和「数据」之间加一组「小组件」，一行「方案」，右边写有几套。
- [x] `common/model.ts` 转发页面要用的。

### FuelNote Check：画出小组件

- [x] 新增 `presets` 一项（要在 `fill` 之后，用它的示例车况和油价）：
  - 用 `buildWidgetSnapshot` 拿到摘要，在 App 里按尺寸画出 `WidgetView`（小号 170×170、中号 364×170、大号 364×382、锁屏圆形 76×76）。先试小组件专用的写法（`widgetBackground`、`widgetAccentable`）在 App 里画成什么样，画不出底色时再想办法。
  - 截图：默认方案（和 2.4 一样）、「花费」、小号「车况」、8 种数字格、4 种大数字、3 种圆形、写「—」的几种（位-5～位-9），浅色、深色。和第二十六轮画稿逐张对照。
  - 核对规则：在 Check 的账本里加、改名、删方案，摘要里的方案跟着变；名称检查。
  - STAMP 加一。
- [x] 2026-11-04 跑 `split`、`fill`、`presets`（STAMP 63）：51、8、7 项全部通过；14 张截图和第二十六轮画稿逐张对照，位-1～位-3、位-5～位-7、位-9、位-10 和「花费」「车况」都一致。
  - 在 App 里画的走样，只改 Check：`Link` 在 App 里把文字染成强调色（`WidgetView` 的 `app` 时不用 `Link`）；锁屏圆形按深色画；截图页加底色。`widgetBackground` 换成 `background` 后底色正常。
  - 发现 2.4 的问题：中号「这一箱」在已行驶三位数（270 km）时，左边被截成「剩余 5…」。两段都加 `minScaleFactor` 0.8，放不下时缩小，重跑后完整写出。桌面上要再看一次（验收第 1 条）。

### 文档

- [x] `CHANGELOG.md`：小组件的格子里放什么可以选；每个小组件用「参数」选一套方案；设置 › 小组件 › 方案。
- [x] `README.md`、`CLAUDE.md`（分层：`widget.tsx` → `widget_view.tsx` → `common/widget_runtime.ts`；`common/widget_layout.ts`）；设计文档 18.2 节加一句：2.5 起格子里的内容可以按方案换。

## 手机上的验收（2.5）

2026-11-04 用户在手机上验收 2.5.0-beta.1：下面 7 条都通过。

1. 不改设置：小号、中号、大号、锁屏和 2.4 一样（位-1～位-3）。中号「这一箱」已行驶到三位数时，左右两段都完整（放不下时缩小）。
2. 设置 › 小组件 › 方案：添加「花费」（大数字本月油费，四格今年油费、加满约、平均油耗、上次加油）；在中号小组件的「参数」里填「花费」，显示和 `R26Presets` 一样。
3. 菜单：别的格子选了的内容不能点，写着在哪一格；自动写着现在显示的是什么。
4. 预览：小号、中号、大号都能打开，显示这套方案。打不开就去掉「预览」一组（D11）。
5. 锁屏：编辑锁屏的小组件时有没有「参数」一栏。有的话填「花费」看圆形中间；没有的话改默认方案的圆形中间看锁屏变不变。
6. 改名后，填着旧名称的小组件回到默认方案（方-5）；删掉方案同样。
7. 写「—」：把一格选成加满约，在插件详情里移除易捷再看（还没有油价），看完加回来。
