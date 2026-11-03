// 读写账本和小熊状态（2.0：数据都在 ledger2.json，xxyh2.json 只有账号和上次导入、导出的信息）
import { AppData, makeAppData } from "../common/ledger"
import { LedgerFile, Settings } from "../common/types"
import { XxyhState } from "../sync/xxyh/types"
import { removeSecret } from "../platform/secrets"
import { isMainDataRoot, readLedger, readXxyhState, removeCache, removePolicyFiles, saveLedger, saveXxyhState } from "../platform/storage"

/** 页面读写当前数据的入口：取最新的、保存后放回去 */
export type DataRef = { get: () => AppData; set: (d: AppData) => void }

/** 打开油记时读数据；文件坏了时 warnings 里写明 */
export function loadData(): { data: AppData; warnings: string[] } {
  dropBuiltinSource()
  const l = readLedger()
  const x = readXxyhState()
  return { data: makeAppData(l.ledger, x.state), warnings: [l.warning, x.warning].filter((w): w is string => !!w) }
}

/**
 * 2.3.0-beta.3 清理一次（插件化设计第 2 节）：内置的数据源搬成了插件，油记钥匙串里它的凭据和会话、它存的养修明细都不用了。
 * 已经删过时什么都不做。FuelNote Check 的数据文件夹里不碰钥匙串。发 2.3.0 前删掉
 */
function dropBuiltinSource(): void {
  if (!isMainDataRoot()) return
  for (const key of ["provider.volvo_cn", "provider.volvo_cn.session"]) removeSecret(key)
  removeCache("service_visits.json")
}

/** 保存账本（小熊状态不变） */
export function commit(data: AppData, ledger: LedgerFile): AppData {
  saveLedger(ledger)
  return makeAppData(ledger, data.xxyh)
}

/** 保存小熊状态 */
export function commitXxyh(data: AppData, xxyh: XxyhState): AppData {
  saveXxyhState(xxyh)
  return makeAppData(data.ledger, xxyh)
}

/** 删掉一起删除的保险年度的原件 */
export function dropPolicyFiles(ids: string[] | undefined): void {
  for (const id of ids ?? []) removePolicyFiles(id)
}

export function updateSettings(data: AppData, patch: Partial<Settings>): AppData {
  return commit(data, { ...data.ledger, settings: { ...data.ledger.settings, ...patch } })
}

/** 点了「×」的续保提醒（同一年只记一次） */
export function dismissRenewal(data: AppData, yearId: string): AppData {
  const list = data.ledger.settings.dismissed_renewals
  return list.includes(yearId) ? data : updateSettings(data, { dismissed_renewals: [...list, yearId].slice(-20) })
}
