// api.js —— API 封装层（真实云函数优先 + 客户端15s超时 + 失败降级mock，演示不翻车）
const mock = require('./mock.js')

// 失败自动熔断：连续失败达阈值后，本次运行内直接走 mock
let _cloudFailCount = 0
const CLOUD_FAIL_THRESHOLD = 2
let _forceMock = false

// 客户端超时（毫秒）：不等服务器 60s 超时，15s 内不返回就立刻降级
const CALL_CLIENT_TIMEOUT = 15000

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

// 统一调用云函数：客户端 15s 超时 + 失败计数 + 熔断降级 mock
async function callFn(name, data) {
  if (_forceMock) return { __mock: true }
  if (_cloudFailCount >= CLOUD_FAIL_THRESHOLD) {
    _forceMock = true
    console.warn('[api] 云函数连续失败' + CLOUD_FAIL_THRESHOLD + '次，本次运行降级 mock')
    return { __mock: true }
  }

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
      setTimeout(() => resolve({ type: 'client_timeout' }), CALL_CLIENT_TIMEOUT)
    })
  ])

  if (raceWinner.type === 'ok') {
    return raceWinner.result
  }

  // 失败 / 超时 → 计数 + 降级
  _cloudFailCount++
  if (raceWinner.type === 'client_timeout') {
    console.warn('[api] ' + name + ' 客户端超时（>=' + (CALL_CLIENT_TIMEOUT/1000) + 's），降级 mock')
  } else {
    const e = raceWinner.error || {}
    const code = e.errCode ? String(e.errCode) : ''
    const msg = e.message || String(e)
    if (code.includes('-601034') || /没有权限|请先开通云开发/.test(msg)) {
      _forceMock = true
      console.warn('[api] 云开发未开通，永久降级 mock')
    } else {
      console.warn('[api] ' + name + ' 失败（第' + _cloudFailCount + '次），降级 mock：', msg)
    }
  }
  if (_cloudFailCount >= CLOUD_FAIL_THRESHOLD) {
    _forceMock = true
  }
  return { __mock: true }
}

// 问答：返回 { answer, sources: [{title, doc_no, source, source_url, phone}] }
async function ask({ question }) {
  const r = await callFn('ask', { question })
  if (!r.__mock) {
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
  // MOCK
  await delay(800)
  const m = mock.mockAnswer(question)
  return {
    answer: m.answer,
    sources: (m.sources || []).map(s => ({
      title: s.title,
      doc_no: s.doc_no || '',
      source: s.source || '',
      source_url: s.source_url || '',
      phone: s.phone || ''
    }))
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
