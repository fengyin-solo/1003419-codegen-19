import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  TreegrowthImportResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 林木生长调查文件的固定列：批量导入与基线版本下载共用这一份口径。
const SURVEY_COLUMNS = ['样地编号', '林分类型', '平均胸径', '平均树高', '调查员']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

function downloadFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  downloadFile(filename, content)
}

// 解析调查文件：优先按表头名列对齐，没有表头就按固定列序取前五列。
function parseSurveyRows(content: string): Record<string, string>[] {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const splitCells = (line: string) =>
    line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''))
  if (lines.length === 0) {
    return []
  }
  const firstCells = splitCells(lines[0])
  const headerIndex = SURVEY_COLUMNS.map((column) => firstCells.indexOf(column))
  const hasHeader = headerIndex.every((index) => index >= 0)
  const dataLines = hasHeader ? lines.slice(1) : lines
  return dataLines
    .map((line) => {
      const cells = splitCells(line)
      const record: Record<string, string> = {}
      SURVEY_COLUMNS.forEach((column, position) => {
        record[column] = hasHeader ? (cells[headerIndex[position]] ?? '') : (cells[position] ?? '')
      })
      return record
    })
    .filter((record) => record['样地编号'] !== '')
}

// 林木生长调查文件批量导入：
// - 同一样地重复导入只保留一个版本，以最新导入为准；
// - 新旧林分类型冲突时保留新版本，旧类型写入「历史林分类型」兼容历史结论，记录转「需复核」；
// - 缺少基线的记录按采集顺序（存量按 id、新增按文件顺序）回填基线版本；
// - 导入成功后其余每个模块联动追加一条复核待办。
export function importTreegrowthEntries(content: string): TreegrowthImportResult {
  const empty = { created: 0, updated: 0, conflicts: 0, duplicated: 0, backfilled: 0, linked: 0 }
  const surveys = parseSurveyRows(content)
  if (surveys.length === 0) {
    return { ok: false, message: '调查文件里没有可导入的样地记录', ...empty }
  }

  // 文件内部同一样地只保留最后一条（最新采集为准）。
  const byPlot = new Map<string, Record<string, string>>()
  let duplicated = 0
  for (const survey of surveys) {
    if (byPlot.has(survey['样地编号'])) {
      duplicated += 1
    }
    byPlot.set(survey['样地编号'], survey)
  }

  const rows = listRows('treegrowth').map((row) => ({ ...row }))

  // 基线版本号顺延已有最大值，缺基线的先按采集顺序回填。
  let baselineSeq = rows.reduce((seq, row) => {
    const match = /^BASE-(\d+)$/.exec(String(row['基线版本'] ?? ''))
    return match ? Math.max(seq, Number(match[1])) : seq
  }, 0)
  const nextBaseline = () => `BASE-${String((baselineSeq += 1)).padStart(4, '0')}`
  let backfilled = 0
  const byCollected = rows
    .map((row, index) => index)
    .sort((a, b) => Number(rows[a].id) - Number(rows[b].id))
  for (const index of byCollected) {
    if (String(rows[index]['基线版本'] ?? '') === '') {
      rows[index]['基线版本'] = nextBaseline()
      backfilled += 1
    }
  }

  let created = 0
  let updated = 0
  let conflicts = 0
  let idSeq = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  let codeSeq = rows.reduce((max, row) => {
    const match = /^TREE-(\d+)$/.exec(String(row['记录编号'] ?? ''))
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)

  for (const survey of byPlot.values()) {
    const plot = survey['样地编号']
    const index = rows.findIndex((row) => String(row['样地编号']) === plot)
    if (index < 0) {
      idSeq += 1
      codeSeq += 1
      rows.push({
        id: idSeq,
        status: '已审核',
        pending: true,
        abnormal: false,
        记录编号: `TREE-${String(codeSeq).padStart(4, '0')}`,
        样地编号: plot,
        林分类型: survey['林分类型'],
        平均胸径: survey['平均胸径'],
        平均树高: survey['平均树高'],
        郁闭度: '',
        调查员: survey['调查员'],
        记录状态: '已审核',
        基线版本: nextBaseline(),
        历史林分类型: '',
      })
      created += 1
      backfilled += 1
      continue
    }
    const existing = rows[index]
    const oldType = String(existing['林分类型'] ?? '')
    const newType = survey['林分类型']
    const conflict = oldType !== '' && newType !== '' && oldType !== newType
    rows[index] = {
      ...existing,
      林分类型: newType || oldType,
      平均胸径: survey['平均胸径'] || existing['平均胸径'],
      平均树高: survey['平均树高'] || existing['平均树高'],
      调查员: survey['调查员'] || existing['调查员'],
      历史林分类型: conflict ? oldType : existing['历史林分类型'],
      status: conflict ? '需复核' : existing.status,
      记录状态: conflict ? '需复核' : existing['记录状态'],
      pending: true,
    }
    if (conflict) {
      conflicts += 1
    } else {
      updated += 1
    }
  }
  saveRows('treegrowth', rows)

  // 联动：其余每个模块追加一条复核待办，运营概览的待处理数同步 +1。
  let linked = 0
  for (const other of MODULE_BY_KEY.values()) {
    if (other.key === 'treegrowth') {
      continue
    }
    const otherRows = listRows(other.key).map((row) => ({ ...row }))
    const linkedId = otherRows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
    const linkedRow: EntryRow = {
      id: linkedId,
      status: other.statuses[0],
      pending: true,
      abnormal: false,
    }
    other.fields.forEach((field, position) => {
      linkedRow[field] =
        position === 0 ? `LINK-${String(linkedId).padStart(4, '0')}` : '林木生长导入联动复核'
    })
    otherRows.push(linkedRow)
    saveRows(other.key, otherRows)
    linked += 1
  }

  return {
    ok: true,
    message: `导入完成：新增 ${created} 条、更新 ${updated} 条、林分类型冲突 ${conflicts} 条（已转需复核）、文件内去重 ${duplicated} 条、回填基线 ${backfilled} 条，其余模块各追加 1 项复核待办`,
    created,
    updated,
    conflicts,
    duplicated,
    backfilled,
    linked,
  }
}

// 基线版本下载：每个样地一条当前生效记录，列口径与调查文件一致，可直接回填后再导入。
export function exportTreegrowthBaseline(): { filename: string; content: string } {
  const header = [...SURVEY_COLUMNS, '基线版本']
  const lines = [header.join(',')]
  const rows = [...listRows('treegrowth')].sort((a, b) => Number(a.id) - Number(b.id))
  for (const row of rows) {
    lines.push(header.map((column) => row[column] ?? '').join(','))
  }
  return { filename: '林木生长-基线版本.csv', content: `\uFEFF${lines.join('\n')}` }
}

export function downloadTreegrowthBaseline(): void {
  const { filename, content } = exportTreegrowthBaseline()
  downloadFile(filename, content)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
      reviewed: entries.filter((row) => String(row.status) === '已审核').length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '已审核', value: modules.reduce((sum, item) => sum + item.reviewed, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
