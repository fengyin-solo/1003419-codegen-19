<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>已审核</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.approved }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>

    <section class="todo-panel">
      <header class="todo-head">
        <h3>跨模块复核待办</h3>
        <span class="legend-item">待复核 {{ reviewStore.pendingCount }} 项</span>
      </header>
      <p class="page-desc">林木生长调查文件每次导入成功，其余业务模块会联动追加一项复核待办。</p>
      <div v-if="!reviewStore.todos.length" class="empty-state todo-empty">
        暂无联动复核待办，去「林木生长」导入调查文件试试
      </div>
      <div v-for="group in reviewStore.groups" :key="group.batchNo" class="todo-group">
        <div class="todo-group-head">
          <span>导入批次 {{ group.batchNo }}</span>
          <span>{{ group.createdAt }}</span>
          <span class="todo-pending">待复核 {{ group.pending }}/{{ group.items.length }}</span>
        </div>
        <ul class="todo-list">
          <li v-for="item in group.items" :key="item.id" class="todo-item" :class="{ done: item.done }">
            <label>
              <input type="checkbox" :checked="item.done" @change="reviewStore.toggle(item.id)" />
              <span class="todo-module">{{ item.module }}</span>
              <span class="todo-title">{{ item.title }}</span>
            </label>
            <span class="todo-detail">{{ item.detail }}</span>
          </li>
        </ul>
      </div>
    </section>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { useReviewStore } from '@/stores/review-todos'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const reviewStore = useReviewStore()

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
}

onMounted(refresh)
</script>
