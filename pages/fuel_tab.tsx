// 「油耗」标签（设计文档 21.2、21.3 节）：记录页左上角车辆菜单，右上角统计图标和「+」（直接记加油）；统计图标打开「油耗统计」一页。
// 只放加油：费用、保险在「费用」标签（pages/expense_tab.tsx），两边互不读对方的记录。
import { Button, NavigationStack } from "scripting"
import { AppData, currentVehicle, InfoPluginView } from "../common/model"
import { StatsLink, TabNav } from "./components"
import { FuelRecords, FuelRecordsActions } from "./fuel_records"
import { FuelStats } from "./fuel_stats"
import { StatusView } from "./fuel_status"
import { VehicleMenu, VehicleMenuActions } from "./vehicle_menu"

export type FuelTabActions = FuelRecordsActions & VehicleMenuActions & { addFuel: () => void }

/** 统计页是推入的一页：左上角是返回，不放车辆菜单和「+」 */
export const FUEL_STATS_NAV: TabNav = { title: "油耗统计", toolbar: {} }

export function FuelTab({ data, subtitle, status, openStatus, info, openInfo, actions }: {
  data: AppData
  /** 记录页的副标题：车辆名，或保存后的临时提示 */
  subtitle: string | null
  status: StatusView | null
  openStatus: () => void
  /** 插件的信息卡片（2.6）：没有车况的车放在记录页最上面 */
  info: InfoPluginView[]
  openInfo: () => void
  actions: FuelTabActions
}) {
  const vehicle = currentVehicle(data)
  // 没有车辆时只留车辆菜单（用来添加车辆）
  const nav: TabNav = {
    title: "油耗",
    toolbar: {
      topBarLeading: <VehicleMenu data={data} actions={actions} />,
      ...(vehicle ? {
        topBarTrailing: [
          <StatsLink key="stats" page={<FuelStats data={data} nav={FUEL_STATS_NAV} />} />,
          <Button key="add" title="记加油" systemImage="plus" action={actions.addFuel} />,
        ],
      } : {}),
    },
  }
  return <NavigationStack>
    <FuelRecords data={data} nav={nav} subtitle={subtitle} status={status} openStatus={openStatus} info={info} openInfo={openInfo} actions={actions} />
  </NavigationStack>
}
