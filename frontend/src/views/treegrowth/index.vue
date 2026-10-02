<template>
  <section class="page" data-module="treegrowth">
    <header class="page-head">
      <div>
        <h2>林木生长管理</h2>
        <p class="page-desc">调查文件批量导入、基线版本下载与版本管理；同一样地只保留一个版本，林分类型冲突按新调查保留、旧版归档兼容历史结论。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="triggerImport">批量导入调查文件</button>
        <button class="btn" type="button" @click="downloadBaseline">下载基线版本</button>
        <button class="btn ghost" type="button" @click="downloadTemplate">下载导入模板</button>
        <button class="btn ghost" type="button" @click="exportRows">导出林木生长清单</button>
        <input
          ref="fileInput"
          type="file"
          accept=".csv,text/csv"
          hidden
          @change="handleFile"
        />
      </div>
    </header>

    <div v-if="report" class="import-report" :class="{ 'has-error': report.failures.length > 0 }">
      <p class="report-line">
        批次 {{ report.batchNo || '—' }}：共解析 {{ report.total }} 行，成功导入 {{ report.imported }} 条
        （新增样地 {{ report.created }}、同版刷新 {{ report.refreshed }}、冲突换版归档 {{ report.archived }}），
        失败 {{ report.failures.length }} 条；其余模块已联动追加复核待办。
      </p>
      <ul v-if="report.failures.length" class="report-failures">
        <li v-for="failure in report.failures" :key="`${failure.row}-${failure.reason}`">
          第 {{ failure.row || '—' }} 行：{{ failure.reason }}
          <span v-if="failure.raw" class="failure-raw">（{{ failure.raw }}）</span>
        </li>
      </ul>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无林木生长数据，可批量导入调查文件</td>
        </tr>
      </tbody>
    </table>

    <section v-if="archivedRows.length" class="archive-panel">
      <h3>历史版本归档（{{ archivedRows.length }}）</h3>
      <p class="page-desc">林分类型冲突换版或同一样地历史重复登记的旧版本在此留存，历史结论仍可追溯。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in archiveColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in archivedRows" :key="`${item.样地编号}-${item.版本号}-${index}`">
            <td v-for="column in archiveColumns" :key="column">{{ item[column] ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条林木生长记录（同一样地仅保留一个当前版本）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { useReviewStore } from '@/stores/review-todos'
import {
  downloadBaseline as fetchBaseline,
  downloadTemplate as fetchTemplate,
  ensureBaselines,
  importSurveyFile,
  listArchived,
} from '@/data/treegrowth'
import type { ArchivedVersion, EntryRow, ImportReport } from '@/data/types'

const meta = moduleMeta('treegrowth')
const reviewStore = useReviewStore()
const columns = ["记录编号", "样地编号", "林分类型", "平均胸径", "平均树高", "郁闭度", "调查员", "版本号", "基线标记", "历史林分类型"]
const archiveColumns = ["样地编号", "林分类型", "平均胸径", "平均树高", "郁闭度", "调查员", "版本号", "归档原因", "归档时间"]
const actions = ["提交审核", "确认记录", "要求复核"]
const statuses = ["已录入", "已审核", "需复核", "已归档"]

const rows = ref<EntryRow[]>([])
const archivedRows = ref<ArchivedVersion[]>([])
const total = ref(0)
const errorMessage = ref('')
const report = ref<ImportReport | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const filters = ref<Record<string, string>>({})
const filterFields = ["样地编号", "林分类型", "调查员"]
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '样地数量', value: rows.value.length },
  { label: '已审核基线', value: rows.value.filter((row) => String(row.status) === '已审核').length },
  { label: '待审核记录', value: rows.value.filter((row) => row.pending).length },
])

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function downloadBaseline() {
  errorMessage.value = ''
  try {
    fetchBaseline()
    reload()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '基线版本下载失败'
  }
}

function downloadTemplate() {
  fetchTemplate()
}

function triggerImport() {
  errorMessage.value = ''
  report.value = null
  fileInput.value?.click()
}

function handleFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const result = importSurveyFile(String(reader.result ?? ''))
      report.value = result
      if (result.imported > 0) {
        // 导入成功后其余模块联动追加一项复核待办。
        reviewStore.appendFromImport(result)
      }
      if (result.failures.length > 0 && result.imported === 0) {
        errorMessage.value = '导入失败，请按提示修正调查文件后重试'
      }
      reload()
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '调查文件解析失败'
    }
    input.value = ''
  }
  reader.onerror = () => {
    errorMessage.value = '调查文件读取失败，请重新选择'
    input.value = ''
  }
  reader.readAsText(file, 'utf-8')
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    archivedRows.value = listArchived()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '林木生长列表读取失败'
  }
}

onMounted(() => {
  // 缺少基线标记的历史记录按采集顺序回填后再展示。
  ensureBaselines()
  reload()
})
</script>
