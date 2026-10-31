// 调用数据源插件：只有 Script.run 这一行（插件化设计第 4.1 节）。排队、超时和缓存在 common/plugin_source.ts。
import { Script } from "scripting"
import { PluginAction } from "../common/plugin"

/** 插件在任何情况下都应 Script.exit(对象)；脚本不在或没有给结果时是 null。singleMode：会结束这个插件还挂着的上一次 */
export function callPlugin(script: string, action: PluginAction, params: Record<string, unknown>): Promise<unknown> {
  return Script.run({ name: script, queryParameters: { fuelnote: 1, action, ...params }, singleMode: true })
}
