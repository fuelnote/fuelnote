// 数据源插件（插件化设计第 5 节）：已装的插件（带 fuelnote.json 的脚本）、添加和移除、状态、连接、读加油交易。
// 排队、超时和缓存在 common/plugin_source.ts，这里注入 Script.run 和缓存文件。FuelNote Check 的数据文件夹里只放行示例插件。
import { joinPath } from "../common/files"
import { AppData } from "../common/ledger"
import { addProblem, FuelTxn, PLUGIN_MARKER, pluginRef, PluginResult, PluginState, PluginStatus } from "../common/plugin"
import { createPluginSource, PluginCacheFile } from "../common/plugin_source"
import { PluginCapability, PluginRef } from "../common/types"
import { callPlugin } from "../platform/plugin_bridge"
import { isMainDataRoot, readCache, writeCache } from "../platform/storage"
import { PROVIDERS } from "../providers/registry"
import { VehicleDataProvider } from "../providers/types"
import { updateSettings } from "./store"

/** 示例插件的脚本名（tools/plugin_example）：Check 的数据文件夹里只调它 */
export const EXAMPLE_PLUGIN = "FuelNote 示例插件"
const CACHE_FILE = "plugins.json"

const allowed = (script: string) => isMainDataRoot() || script === EXAMPLE_PLUGIN

const source = createPluginSource({
  call: (script, action, params) => (allowed(script) ? callPlugin(script, action, params) : Promise.resolve(null)),
  load: () => readCache<PluginCacheFile>(CACHE_FILE),
  save: f => writeCache(CACHE_FILE, f),
  now: () => Date.now(),
  sleep: ms => new Promise<void>(resolve => setTimeout(() => resolve(), ms)),
})

export type InstalledPlugin = { script: string; title: string; version: string; icon: string | null; color: string | null }

function scriptMeta(script: string): Record<string, any> | null {
  try {
    return JSON.parse(FileManager.readAsStringSync(joinPath(FileManager.scriptsDirectory, script, "script.json")))
  } catch {
    return null
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)

/** 已装的脚本里带 fuelnote.json 的（D8）：名称、版本、图标取它的 script.json，不运行它们。Check 的数据文件夹里只列示例插件 */
export function installedPlugins(): InstalledPlugin[] {
  let names: string[]
  try {
    names = FileManager.readDirectorySync(FileManager.scriptsDirectory).map(p => p.split("/").pop() || p)
  } catch {
    return []
  }
  return names
    .filter(n => allowed(n) && FileManager.existsSync(joinPath(FileManager.scriptsDirectory, n, PLUGIN_MARKER)))
    .map(script => {
      const m = scriptMeta(script) ?? {}
      return { script, title: str(m.localizedNames?.zh) ?? str(m.name) ?? script, version: str(m.version) ?? "", icon: str(m.icon), color: str(m.color) }
    })
    .sort((a, b) => a.title.localeCompare(b.title, "zh"))
}

/** 插件现在的版本（插件详情的副标题，插件更新后跟着变） */
export function pluginVersion(script: string): string {
  return str(scriptMeta(script)?.version) ?? ""
}

export const pluginsOf = (data: AppData): PluginRef[] => data.ledger.settings.plugins

export function pluginsWith(data: AppData, cap: PluginCapability): PluginRef[] {
  return pluginsOf(data).filter(p => p.capabilities.includes(cap))
}

/** 内置数据源提供的数据：行程都有，车况、养修看提供方实现了没有 */
export function providerCapabilities(p: VehicleDataProvider): PluginCapability[] {
  const caps: PluginCapability[] = ["trips"]
  if (p.vehicleStatus) caps.push("vehicle_status")
  if (p.serviceVisits) caps.push("service")
  return caps
}

/** 添加：先调 describe 确认版本和提供的数据，再检查 id；不能加时抛出给用户看的原因 */
export async function addPlugin(getData: () => AppData, script: string): Promise<AppData> {
  const r = await source.describe(script)
  if (!r.ok) throw new Error(r.error.message)
  const data = getData()
  const problem = addProblem(r.value, pluginsOf(data), PROVIDERS.map(p => p.id))
  if (problem) throw new Error(problem)
  return updateSettings(data, { plugins: [...pluginsOf(data), pluginRef(script, r.value)] })
}

/** 移除：只从油记里去掉，清掉它的缓存；不删脚本，也不动插件里的凭据，已记的加油不受影响 */
export function removePlugin(data: AppData, id: string): AppData {
  source.forget(id)
  return updateSettings(data, { plugins: pluginsOf(data).filter(p => p.id !== id) })
}

export const pluginStatus = (ref: PluginRef): Promise<PluginResult<PluginStatus>> => source.status(ref)
export const connectPlugin = (ref: PluginRef): Promise<PluginResult<PluginStatus>> => source.connect(ref)
export const pluginState = (id: string): PluginState | null => source.lastState(id)

export function pluginFuel(ref: PluginRef, range: { from: number; to: number }, force = false): Promise<PluginResult<FuelTxn[]>> {
  return source.fuel(ref, range, { force })
}
