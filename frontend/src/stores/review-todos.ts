import { defineStore } from 'pinia'

import { MODULES } from '@/data/modules'
import type { ImportReport } from '@/data/types'

// 复核待办跨模块联动：林木生长调查文件导入成功后，
// 其余每个业务模块都联动追加一项复核待办，数据持久化在本机。
const STORAGE_KEY = 'forest-fire-patrol:review-todos'
const SOURCE_KEY = 'treegrowth'

export type ReviewTodo = {
  id: number
  batchNo: string
  sourceModule: string
  module: string
  title: string
  detail: string
  done: boolean
  createdAt: string
}

type ReviewGroup = {
  batchNo: string
  createdAt: string
  sourceModule: string
  items: (ReviewTodo & { id: number })[]
  pending: number
}

function nowLabel(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function readTodos(): ReviewTodo[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ReviewTodo[]) : []
  } catch {
    return []
  }
}

function persist(todos: ReviewTodo[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(todos))
  }
}

export const useReviewStore = defineStore('review-todos', {
  state: () => ({
    todos: readTodos(),
  }),
  getters: {
    pendingCount: (state) => state.todos.filter((item) => !item.done).length,
    groups(state): ReviewGroup[] {
      const map = new Map<string, ReviewGroup>()
      for (const item of state.todos) {
        let group = map.get(item.batchNo)
        if (!group) {
          group = {
            batchNo: item.batchNo,
            createdAt: item.createdAt,
            sourceModule: item.sourceModule,
            items: [],
            pending: 0,
          }
          map.set(item.batchNo, group)
        }
        group.items.push(item)
        if (!item.done) {
          group.pending += 1
        }
      }
      return [...map.values()]
    },
  },
  actions: {
    /** 林木生长导入成功后联动追加：除来源模块外，每个模块追加一项复核待办。 */
    appendFromImport(report: ImportReport) {
      if (report.imported === 0) {
        return
      }
      const source = MODULES.find((item) => item.key === SOURCE_KEY)
      const sourceName = source ? source.name : '林木生长'
      const when = nowLabel()
      const nextId = this.todos.reduce((max, item) => Math.max(max, item.id), 0)
      const detail =
        `批次 ${report.batchNo}：新增 ${report.created} 个样地、` +
        `刷新 ${report.refreshed} 个样地、冲突换版归档 ${report.archived} 个旧版本`
      const linked = MODULES.filter((item) => item.key !== SOURCE_KEY).map((item, index) => ({
        id: nextId + index + 1,
        batchNo: report.batchNo,
        sourceModule: sourceName,
        module: item.name,
        title: `${item.name}联动复核：${sourceName}基线已更新`,
        detail,
        done: false,
        createdAt: when,
      }))
      this.todos = [...linked, ...this.todos]
      persist(this.todos)
    },
    toggle(id: number) {
      this.todos = this.todos.map((item) =>
        item.id === id ? { ...item, done: !item.done } : item,
      )
      persist(this.todos)
    },
  },
})
