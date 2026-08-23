// api.js —— API 封装层（真实云函数优先 + 客户端15s超时 + 失败降级mock，演示不翻车）
const mock = require('./mock.js')

// 失败自动熔断：连续失败达阈值后，本次运行内直接走 mock
let _cloudFailCount = 0
const CLOUD_FAIL_THRESHOLD = 2
let _forceMock = false

// 客户端超时（毫秒）：不等服务器 60s 超时，15s 内不返回就立刻降级
const CALL_CLIENT_TIMEOUT = 15000
// ask 是慢接口（向量检索+大模型生成+可能的联网补答，云函数超时 60s），给足 59s 让真实答案有机会返回，别再 15s 就降级
const ASK_CLIENT_TIMEOUT = 59000

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function formatTime(t) {
  if (!t) return ''
  const d = t instanceof Date ? t : new Date(t)
  if (isNaN(d.getTime())) return String(t).slice(0, 16)
  const pad = n => (n < 10 ? '0' + n : '' + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 统一调用云函数：可自定义客户端超时 + 失败计数 + 熔断降级 mock
async function callFn(name, data, timeoutMs) {
  if (_forceMock) return { __mock: true }
  if (_cloudFailCount >= CLOUD_FAIL_THRESHOLD) {
    _forceMock = true
    console.warn('[api] 云函数连续失败' + CLOUD_FAIL_THRESHOLD + '次，本次运行降级 mock')
    return { __mock: true }
  }

  const t = timeoutMs || CALL_CLIENT_TIMEOUT

  // Promise.race：云函数调用 vs 客户端超时计时器
  const raceWinner = await Promise.race([
    (async () => {
      try {
        const res = await wx.cloud.callFunction({ name, data })
        const r = res && res.result
        if (r && r.ok === false) {
          throw new Error(r.error || name + ' 返回失败')
        }
        _cloudFailCount = 0
        return { type: 'ok', result: r }
      } catch (e) {
        return { type: 'cloud_error', error: e }
      }
    })(),
    new Promise(resolve => {
      setTimeout(() => resolve({ type: 'client_timeout' }), t)
    })
  ])

  if (raceWinner.type === 'ok') {
    return raceWinner.result
  }

  // 客户端超时：只是响应慢，不代表云函数挂了 → 不记入熔断计数，让调用方自行提示重试
  if (raceWinner.type === 'client_timeout') {
    console.warn('[api] ' + name + ' 客户端超时（>=' + (t / 1000) + 's）')
    return { __mock: true, __timeout: true }
  }

  // 真实云函数错误 → 计数 + 降级
  _cloudFailCount++
  const e = raceWinner.error || {}
  const code = e.errCode ? String(e.errCode) : ''
  const msg = e.message || String(e)
  if (code.includes('-601034') || /没有权限|请先开通云开发/.test(msg)) {
    _forceMock = true
    console.warn('[api] 云开发未开通，永久降级 mock')
  } else {
    console.warn('[api] ' + name + ' 失败（第' + _cloudFailCount + '次），降级 mock：', msg)
  }
  if (_cloudFailCount >= CLOUD_FAIL_THRESHOLD) {
    _forceMock = true
  }
  return { __mock: true }
}

// 问答：返回 { answer, sources: [{title, doc_no, source, source_url, phone}] }
// 注意：ask 超时/失败时绝不返回 mock 假答案（会误导），只如实提示重试。
async function ask({ question }) {
  const r = await callFn('ask', { question }, ASK_CLIENT_TIMEOUT)
  if (r && !r.__mock && !r.__timeout) {
    return {
      answer: r.answer || '',
      sources: (r.sources || []).map(s => ({
        title: s.title || '',
        doc_no: s.doc_no || '',
        source: s.source || '',
        source_url: s.source_url || '',
        phone: s.phone || ''
      }))
    }
  }
  // 超时或失败：如实提示，不返回编造的假政策答案
  const isTimeout = r && r.__timeout
  return {
    answer: isTimeout
      ? '抱歉，服务响应较慢（已等待 60 秒）。请稍后重试，或换个更具体的说法（如直接说出政策名称"公租房""积分入学"）。\n\n如有急事，可拨打广州政务服务热线 020-12345。'
      : '服务暂时不可用，请稍后重试；或拨打广州政务服务热线 020-12345 咨询。',
    sources: []
  }
}

// 政策列表 / 详情：传 id 走详情，传 category 走分类，都不传走全量
// 返回：传 id → { policy }；传 category/无 → { policies: [...] }
async function getPolicies({ category, id } = {}) {
  const data = {}
  if (id) data.id = id
  else if (category) data.category = category
  const r = await callFn('getPolicies', data)

  if (!r.__mock) {
    if (id) {
      const p = r.data || r.policy || null
      if (p) {
        p.summary = p.summary || p.plain_answer || ''
        p.source = p.source || p.remark || ''
        p.source_url = p.source_url || ''
      }
      return { policy: p }
    }
    const list = (r.data || r.policies || []).map(p => ({
      ...p,
      summary: p.summary || p.plain_answer || '',
      source: p.source || p.remark || '',
      source_url: p.source_url || ''
    }))
    return { policies: list }
  }

  // MOCK
  await delay(300)
  if (id) {
    return { policy: mock.mockPolicies.find(p => p._id === id) || null }
  }
  if (category) {
    return { policies: mock.mockPolicies.filter(p => p.category === category) }
  }
  return { policies: mock.mockPolicies }
}

// 保存历史：返回 { success }
async function saveHistory({ question, answer, hits }) {
  const r = await callFn('saveHistory', { question, answer, hits: hits || [] })
  if (!r.__mock) return { success: !!(r.ok !== false) }
  return { success: true }
}

// 读取历史：返回 { history: [{question, answer, sources, create_time}] }
async function getHistory() {
  const r = await callFn('getHistory')
  if (!r.__mock) {
    const list = r.list || r.history || []
    return {
      history: list.map(item => ({
        _id: item._id,
        question: item.question,
        answer: item.answer,
        sources: item.sources || item.hits || [],
        create_time: item.create_time || formatTime(item.createdAt)
      }))
    }
  }
  await delay(300)
  return { history: mock.mockHistory }
}

module.exports = {
  ask,
  getPolicies,
  saveHistory,
  getHistory,
  formatTime
}
