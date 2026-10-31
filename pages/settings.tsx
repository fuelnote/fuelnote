// 设置
import { Button, Capsule, HStack, List, Navigation, NavigationLink, NavigationStack, Script, Section, Spacer, Text, Toggle, useState, VStack } from "scripting"
import {
  AppData, capabilityLine, currentVehicle, OCR_ENGINE_TITLES, pluginsOf, pluginState, pluginStateText, pluginStatus, providerCapabilities, PROVIDERS,
  providerCredential, searcherName, updateSettings, Vehicle,
} from "../common/model"
import { CaptureSettings } from "./capture_settings"
import { BackupRowLabel, BackupSettings } from "./backup_settings"
import { AppActions } from "./components"
import { PluginAdd } from "./plugin_add"
import { PluginDetail } from "./plugin_detail"
import { ProviderSettings } from "./provider_settings"
import { RecognizeSettings } from "./recognize_settings"
import { StationSearchSettings } from "./station_search_settings"
import { VehicleEdit } from "./vehicle_edit"
import { xxyhRowDetail, XxyhSettings } from "./xxyh_settings"

function Detail({ title, detail }: { title: string; detail: string }) {
  return <HStack foregroundStyle="label">
    <Text>{title}</Text>
    <Spacer />
    <Text foregroundStyle="secondaryLabel" lineLimit={1}>{detail}</Text>
  </HStack>
}

/** 数据源一行（画稿 DsSettings）：名称，下面写内置或插件、提供的数据；右边是连接状态 */
function SourceRow({ title, detail, state, warn }: { title: string; detail: string; state: string; warn: boolean }) {
  return <HStack foregroundStyle="label">
    <VStack alignment="leading" spacing={3}>
      <Text>{title}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel">{detail}</Text>
    </VStack>
    <Spacer />
    <Text foregroundStyle={warn ? "systemOrange" : "secondaryLabel"}>{state}</Text>
  </HStack>
}

function VehicleRow({ data, app, vehicle, current }: { data: AppData; app: AppActions; vehicle: Vehicle; current: boolean }) {
  const caption = [vehicle.provider ? vehicle.provider.name : "", vehicle.xxyh_car ? "导出到小熊油耗" : ""].filter(Boolean).join(" · ")
  return <NavigationLink destination={<VehicleEdit data={data} app={app} vehicleId={vehicle.id} />}>
    <VStack alignment="leading" spacing={3}>
      <HStack spacing={8}>
        <Text foregroundStyle={vehicle.hidden ? "secondaryLabel" : "label"}>{vehicle.name}</Text>
        {current ? <Text font="caption" fontWeight="semibold" foregroundStyle="systemGreen" padding={{ horizontal: 8, vertical: 2 }} background={<Capsule fill="rgba(52,199,89,0.16)" />}>当前</Text> : null}
      </HStack>
      {caption ? <Text font="caption" foregroundStyle="secondaryLabel">{caption}</Text> : null}
    </VStack>
  </NavigationLink>
}

export function SettingsPage({ data, app }: { data: AppData; app: AppActions }) {
  const current = currentVehicle(data)
  const shown = data.ledger.vehicles.filter(v => !v.hidden)
  const hidden = data.ledger.vehicles.filter(v => v.hidden)

  const xxyhDetail = xxyhRowDetail(data)
  const plugins = pluginsOf(data)
  const [, setTick] = useState(0)
  /** 每次回到设置页问一次各个插件的状态 */
  const refreshPlugins = () => { for (const p of plugins) void pluginStatus(p).then(() => setTick(t => t + 1)) }
  const openAdd = () => Navigation.present({ element: <PluginAdd getData={app.getData} onAdded={app.setData} /> })

  return <NavigationStack>
    <List navigationTitle="设置" onAppear={refreshPlugins}>
      <Section title="车辆">
        {shown.map(v => <VehicleRow key={v.id} data={data} app={app} vehicle={v} current={v.id === current?.id} />)}
        <Button title="添加车辆" systemImage="plus" action={() => { app.addVehicle() }} />
      </Section>

      {hidden.length ? <Section key="hidden" header={<Text>已隐藏</Text>} footer={<Text>隐藏的车辆不出现在车辆菜单、统计和小组件里，记录照常保留。点进去可以取消隐藏。</Text>}>
        {hidden.map(v => <VehicleRow key={v.id} data={data} app={app} vehicle={v} current={false} />)}
      </Section> : null}

      <Section header={<Text>小熊油耗</Text>} footer={<Text>数据都存在油记里；小熊油耗只在第一次连接时导入，以后由你手动导出。</Text>}>
        <NavigationLink destination={<XxyhSettings data={data} app={app} />}>
          <Detail title="导入和导出" detail={xxyhDetail} />
        </NavigationLink>
      </Section>

      <Section header={<Text>数据源</Text>} footer={<Text>插件是独立的 Scripting 脚本，只提供数据；记账和核对都在油记中完成。插件的凭据保存在插件中，不在油记的备份里。</Text>}>
        {PROVIDERS.map(p => <NavigationLink key={p.id} destination={<ProviderSettings data={data} app={app} provider={p} />}>
          <SourceRow title={p.name} detail={`内置 · ${capabilityLine(providerCapabilities(p))}`} state={providerCredential(p.id) ? "已连接" : "未连接"} warn={false} />
        </NavigationLink>)}
        {plugins.map(p => {
          const state = pluginState(p.id)
          return <NavigationLink key={p.id} destination={<PluginDetail app={app} pluginId={p.id} />}>
            <SourceRow title={p.name} detail={`插件 · ${capabilityLine(p.capabilities)}`} state={state ? pluginStateText(state) : ""} warn={state === "expired"} />
          </NavigationLink>
        })}
        <Button title="添加插件" systemImage="plus" action={() => { void openAdd() }} />
      </Section>

      <Section header={<Text>识别</Text>} footer={<Text>加油截图，和添加权益时的文字、截图，都用这里选的方式。</Text>}>
        <NavigationLink destination={<RecognizeSettings data={data} app={app} />}>
          <Detail title="识别方式" detail={OCR_ENGINE_TITLES[data.ledger.settings.ocr_engine]} />
        </NavigationLink>
      </Section>

      <Section title="记加油">
        <NavigationLink destination={<StationSearchSettings data={data} app={app} />}>
          <Detail title="油站搜索" detail={searcherName(data)} />
        </NavigationLink>
        <NavigationLink destination={<CaptureSettings />}>
          <Text>截屏记加油</Text>
        </NavigationLink>
        <Toggle title="默认加满" value={data.ledger.settings.default_full} onChanged={v => app.setData(updateSettings(app.getData(), { default_full: v }))} />
      </Section>

      <Section title="数据">
        <NavigationLink destination={<BackupSettings data={data} app={app} />}>
          <BackupRowLabel data={data} />
        </NavigationLink>
      </Section>

      <Section>
        <Detail title="版本" detail={Script.metadata.version} />
      </Section>
    </List>
  </NavigationStack>
}
