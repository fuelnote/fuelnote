// 桌面与锁屏小组件：显示 App 写的 widget.json，视图在 widget_view.tsx（设计文档 18.2 节「小组件改版（1.4）」）。
// 车况超过 1 小时时，小组件用油记的凭据自己读一次再显示（设计文档 18.3 节第 2 步）；数据要在 Widget.present 之前准备好（Scripting 文档）。
// 显示车况的 1 小时后刷新，其他的每天零点后刷新。只从 widget_view 导入（打包器的限制，设计文档 9.4 节）。
// 小组件方案（2.5，小组件方案设计第 5 节）：「参数」填方案的名称，空着或没有这套方案时用默认方案。
import { Widget } from "scripting"
import { presetFor, readWidgetSnapshot, refreshWidgetStatus, widgetRefreshDate, WidgetView } from "./widget_view"

const family = Widget.family
const cached = readWidgetSnapshot()
refreshWidgetStatus(cached, family)
  .catch(() => cached)
  .then(s => Widget.present(
    <WidgetView s={s} family={family} size={Widget.displaySize} preset={presetFor(s.presets, Widget.parameter)} />,
    { policy: "after", date: widgetRefreshDate(s, family) }
  ))
