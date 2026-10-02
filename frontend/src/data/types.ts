/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; approved: number; abnormal: number }[]
}

/** 调查文件批量导入的逐行结果与汇总。 */
export type ImportFailure = {
  row: number
  reason: string
  raw: string
}

export type ImportReport = {
  total: number
  imported: number
  created: number
  refreshed: number
  archived: number
  failures: ImportFailure[]
  batchNo: string
}

/** 林分类型发生冲突被换版时，旧版本会归档保留，历史结论仍可追溯。 */
export type ArchivedVersion = {
  样地编号: string
  林分类型: string
  平均胸径: string
  平均树高: string
  郁闭度: string
  调查员: string
  版本号: number
  归档原因: string
  归档时间: string
  [field: string]: string | number
}
