import { listRows, saveRows } from './local-store'
import type { ArchivedVersion, EntryRow, ImportFailure, ImportReport } from './types'

const KEY = 'treegrowth'

// 调查文件的标准表头：前五项必填，郁闭度允许留空。
const SURVEY_HEADER = ['样地编号', '林分类型', '平均胸径', '平均树高', '郁闭度', '调查员']
const ARCHIVE_KEY = 'forest-fire-patrol:treegrowth-archive'

// 非浏览器环境（脚本自测）下的内存归档。
let memoryArchive: ArchivedVersion[] = []

/**
 * 林分类型冲突的取舍方案：
 * 同一样地再次导入且林分类型与当前版本不一致时，以「新调查优先」为准——
 * 新调查升为当前版本（版本号 +1，林分字段刷新），旧版本不删除，
 * 归档并在当前行保留「历史林分类型」，让基于旧结论的复核、统计仍可追溯。
 */

type ParsedRow = {
  line: number
  样地编号: string
  林分类型: string
  平均胸径: string
  平均树高: string
  郁闭度: string
  调查员: string
}

function nowLabel(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function pad3(n: number): string {
  return String(n).padStart(4, '0')
}

/** 极简 CSV 解析：去 BOM、兼容 \r\n 与双引号包裹的字段。 */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let field = ''
  let record: string[] = []
  let quoted = false
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i]
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      record.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') {
        i += 1
      }
      record.push(field)
      field = ''
      if (record.some((cell) => cell.trim() !== '')) {
        rows.push(record)
      }
      record = []
    } else {
      field += ch
    }
  }
  record.push(field)
  if (record.some((cell) => cell.trim() !== '')) {
    rows.push(record)
  }
  return rows
}

function toCsvLine(values: Array<string | number | boolean>): string {
  return values
    .map((value) => {
      const text = String(value ?? '')
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    })
    .join(',')
}

function downloadCsv(filename: string, lines: string[]): void {
  const content = `\uFEFF${lines.join('\r\n')}`
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

function readArchive(): ArchivedVersion[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return memoryArchive
  }
  try {
    const raw = window.localStorage.getItem(ARCHIVE_KEY)
    return raw ? (JSON.parse(raw) as ArchivedVersion[]) : []
  } catch {
    return []
  }
}

function pushArchive(items: ArchivedVersion[]): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    memoryArchive = [...items, ...memoryArchive]
    return
  }
  const next = [...items, ...readArchive()]
  window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(next))
}

export function listArchived(): ArchivedVersion[] {
  return readArchive()
}

function archiveRow(row: EntryRow, reason: string, when: string): ArchivedVersion {
  return {
    样地编号: String(row['样地编号'] ?? ''),
    林分类型: String(row['林分类型'] ?? ''),
    平均胸径: String(row['平均胸径'] ?? ''),
    平均树高: String(row['平均树高'] ?? ''),
    郁闭度: String(row['郁闭度'] ?? ''),
    调查员: String(row['调查员'] ?? ''),
    版本号: Number(row['版本号'] ?? 1),
    归档原因: reason,
    归档时间: when,
  }
}

/**
 * 缺少基线标记的林木生长记录，按采集顺序（记录登记的先后）回填：
 * 每个样地最早采集的一条标记为基线版本；同一样地的历史重复登记不保留为当前版本，
 * 归档备查后从当前清单移除，保证「同一样地只保留一个版本」。
 * 返回是否发生了回填/归档。
 */
export function ensureBaselines(): boolean {
  const rows = listRows(KEY)
  if (rows.length === 0 || rows.every((row) => row['基线标记'] === '是')) {
    return false
  }

  const seen = new Set<string>()
  const next: EntryRow[] = []
  const archived: ArchivedVersion[] = []
  const when = nowLabel()

  rows.forEach((row, index) => {
    const plot = String(row['样地编号'] ?? '').trim()
    const filled: EntryRow = {
      ...row,
      采集顺序: Number(row['采集顺序'] ?? index + 1),
      导入时间: row['导入时间'] ? row['导入时间'] : '（历史回填）',
    }
    if (!plot || seen.has(plot)) {
      // 历史重复登记：保留一个版本，旧条目录入归档，历史结论不丢。
      archived.push(archiveRow(filled, '历史重复登记：同一样地按采集顺序只保留一个版本', when))
      return
    }
    seen.add(plot)
    next.push({
      ...filled,
      版本号: Number(filled['版本号'] ?? 1),
      基线标记: '是',
    })
  })

  if (archived.length > 0) {
    pushArchive(archived)
  }
  saveRows(KEY, next)
  return true
}

function isMeasure(text: string): boolean {
  return Number.parseFloat(text) > 0
}

/**
 * 批量导入调查文件。
 * - 文件内同一样地重复出现：按采集顺序以后一条为准，只保留一个版本；
 * - 与库内样地一致：林分类型相同则刷新测树因子，不升版本；
 * - 林分类型冲突：新调查优先升为当前版，旧版归档并兼容历史结论；
 * - 导入即作为已审核基线版本入库，运营图表的已审核数量随之变化。
 */
export function importSurveyFile(text: string): ImportReport {
  const grid = parseCsv(text)
  if (grid.length === 0) {
    return {
      total: 0,
      imported: 0,
      created: 0,
      refreshed: 0,
      archived: 0,
      batchNo: '',
      failures: [{ row: 0, reason: '文件为空，没有可导入的调查记录', raw: '' }],
    }
  }

  const header = grid[0].map((cell) => cell.trim())
  const missing = SURVEY_HEADER.filter((name) => !header.includes(name))
  if (missing.length > 0) {
    return {
      total: 0,
      imported: 0,
      created: 0,
      refreshed: 0,
      archived: 0,
      batchNo: '',
      failures: [{ row: 1, reason: `表头缺少必填列：${missing.join('、')}`, raw: header.join(',') }],
    }
  }
  const col = (name: string) => header.indexOf(name)

  // 先校验，再按样地归并（文件内重复以后一条为准）。
  const failures: ImportFailure[] = []
  const latest = new Map<string, ParsedRow>()
  let dataRows = 0
  let validRows = 0
  for (let r = 1; r < grid.length; r += 1) {
    const cells = grid[r]
    const rawLine = cells.join(',')
    if (cells.every((cell) => cell.trim() === '')) {
      continue
    }
    dataRows += 1
    const item: ParsedRow = {
      line: r + 1,
      样地编号: (cells[col('样地编号')] ?? '').trim(),
      林分类型: (cells[col('林分类型')] ?? '').trim(),
      平均胸径: (cells[col('平均胸径')] ?? '').trim(),
      平均树高: (cells[col('平均树高')] ?? '').trim(),
      郁闭度: (cells[col('郁闭度')] ?? '').trim(),
      调查员: (cells[col('调查员')] ?? '').trim(),
    }
    const reasons: string[] = []
    if (!item.样地编号) reasons.push('样地编号为空')
    if (!item.林分类型) reasons.push('林分类型为空')
    if (!isMeasure(item.平均胸径)) reasons.push('平均胸径需为大于 0 的数值')
    if (!isMeasure(item.平均树高)) reasons.push('平均树高需为大于 0 的数值')
    if (!item.调查员) reasons.push('调查员为空')
    if (reasons.length > 0) {
      failures.push({ row: item.line, reason: reasons.join('；'), raw: rawLine })
      continue
    }
    validRows += 1
    latest.set(item.样地编号, item)
  }

  const report: ImportReport = {
    total: dataRows,
    imported: validRows,
    created: 0,
    refreshed: 0,
    archived: 0,
    failures,
    batchNo: `IMP-${Date.now().toString().slice(-8)}`,
  }
  if (latest.size === 0) {
    return report
  }

  ensureBaselines()
  const rows = listRows(KEY)
  const when = nowLabel()
  const archived: ArchivedVersion[] = []
  let nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  let order = rows.reduce((max, row) => Math.max(max, Number(row['采集顺序']) || 0), 0)

  const next = rows.map((row) => ({ ...row }))
  latest.forEach((item) => {
    const index = next.findIndex((row) => String(row['样地编号']).trim() === item.样地编号)
    if (index < 0) {
      nextId += 1
      order += 1
      // 新样地：导入即审核通过的首版基线。
      next.push({
        id: nextId,
        status: '已审核',
        pending: false,
        abnormal: false,
        记录编号: `TREE-${pad3(nextId)}`,
        样地编号: item.样地编号,
        林分类型: item.林分类型,
        平均胸径: item.平均胸径,
        平均树高: item.平均树高,
        郁闭度: item.郁闭度,
        调查员: item.调查员,
        记录状态: '已审核',
        版本号: 1,
        基线标记: '是',
        采集顺序: order,
        导入批次: report.batchNo,
        导入时间: when,
      })
      report.created += 1
      return
    }

    const current = next[index]
    const previousType = String(current['林分类型'] ?? '')
    const history = String(current['历史林分类型'] ?? '')
      .split('、')
      .map((value) => value.trim())
      .filter(Boolean)
    if (previousType === item.林分类型) {
      // 同版复测：只刷新测树因子与调查员，不产生新版本；导入记录视为已审核。
      next[index] = {
        ...current,
        status: '已审核',
        pending: false,
        记录状态: '已审核',
        平均胸径: item.平均胸径,
        平均树高: item.平均树高,
        郁闭度: item.郁闭度 || String(current['郁闭度'] ?? ''),
        调查员: item.调查员,
        导入批次: report.batchNo,
        导入时间: when,
      }
      report.refreshed += 1
      return
    }

    // 林分类型冲突：新调查优先保留为当前版，旧版归档兼容历史结论。
    archived.push(
      archiveRow(
        current,
        `林分类型冲突：旧「${previousType}」→ 新「${item.林分类型}」，按新调查保留当前版`,
        when,
      ),
    )
    next[index] = {
      ...current,
      status: '已审核',
      pending: false,
      记录状态: '已审核',
      林分类型: item.林分类型,
      平均胸径: item.平均胸径,
      平均树高: item.平均树高,
      郁闭度: item.郁闭度 || String(current['郁闭度'] ?? ''),
      调查员: item.调查员,
      历史林分类型: [...history, previousType].join('、'),
      版本号: Number(current['版本号'] ?? 1) + 1,
      基线标记: '是',
      导入批次: report.batchNo,
      导入时间: when,
    }
    report.archived += 1
    report.refreshed += 1
  })

  if (archived.length > 0) {
    pushArchive(archived)
  }
  saveRows(KEY, next)
  return report
}

/** 下载基线版本：每个样地当前保留的唯一版本即现行基线。 */
export function downloadBaseline(): void {
  ensureBaselines()
  const header = [...SURVEY_HEADER, '版本号', '基线标记']
  const lines = [header.map((name) => toCsvLine([name])).join(',')]
  for (const row of listRows(KEY)) {
    lines.push(
      toCsvLine([
        String(row['样地编号'] ?? ''),
        String(row['林分类型'] ?? ''),
        String(row['平均胸径'] ?? ''),
        String(row['平均树高'] ?? ''),
        String(row['郁闭度'] ?? ''),
        String(row['调查员'] ?? ''),
        Number(row['版本号'] ?? 1),
        '是',
      ]),
    )
  }
  downloadCsv(`林木生长-基线版本.csv`, lines)
}

/** 下载导入模板，表头与批量导入要求一致。 */
export function downloadTemplate(): void {
  const lines = [
    toCsvLine(SURVEY_HEADER),
    toCsvLine(['YD-0001', '针叶林', '14.2', '12.6', '0.75', '张调查']),
    toCsvLine(['YD-0002', '阔叶林', '16.8', '14.1', '', '李调查']),
  ]
  downloadCsv('林木生长调查文件-模板.csv', lines)
}
