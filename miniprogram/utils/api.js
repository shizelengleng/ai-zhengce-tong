// api.js —— API 封装层（真实云函数版）
// 页面代码统一调用本模块，直接对接微信云开发云函数。

// 统一调用云函数：ok:false 时抛错，由页面 catch 兜底（显示"请稍后重试"）
async function callFn(name, data) {
  const res = await wx.cloud.callFunction({ name, data })
  const r = res && res.result
  if (r && r.ok === false) {
    throw new Error(r.error || name + ' 调用失败')
  }
  return r
}

// 问答（核心）：返回 { answer, sources: [{title, doc_no, source, source_url, phone}] }
async function ask({ question }) {
  return callFn('ask', { question })
}

// 政策列表 / 详情：返回 { policies: [...] }；不传 category 时返回全部
async function getPolicies({ category } = {}) {
  return callFn('getPolicies', { category })
}

// 保存历史：返回 { success }
async function saveHistory({ question, answer }) {
  return callFn('saveHistory', { question, answer })
}

// 读取历史：返回 { history: [{question, answer, create_time}] }
async function getHistory() {
  return callFn('getHistory')
}

module.exports = {
  ask,
  getPolicies,
  saveHistory,
  getHistory
}
