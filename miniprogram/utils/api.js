// api.js —— API 封装层
// 静态阶段返回 mock 数据；后续接云函数只需把函数体换成 wx.cloud.callFunction
// 页面代码统一调用本模块，替换时无需改动

const mock = require('./mock.js')

// 模拟网络延迟，让"正在思考"加载态可见
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 问答（核心）
async function ask({ question }) {
  await delay(800)
  // TODO 后续替换为：
  // return wx.cloud.callFunction({ name: 'ask', data: { question } }).then(r => r.result)
  return mock.mockAnswer(question)
}

// 政策列表 / 详情
async function getPolicies({ category } = {}) {
  await delay(300)
  // TODO 后续替换为：
  // return wx.cloud.callFunction({ name: 'getPolicies', data: { category } }).then(r => r.result)
  let list = mock.mockPolicies
  if (category) {
    list = list.filter(p => p.category === category)
  }
  return { policies: list }
}

// 保存历史（静态阶段只返回成功，不真存）
async function saveHistory({ question, answer }) {
  // TODO 后续替换为：
  // return wx.cloud.callFunction({ name: 'saveHistory', data: { question, answer } }).then(r => r.result)
  return { success: true }
}

// 读取历史
async function getHistory() {
  await delay(300)
  // TODO 后续替换为：
  // return wx.cloud.callFunction({ name: 'getHistory' }).then(r => r.result)
  return { history: mock.mockHistory }
}

module.exports = {
  ask,
  getPolicies,
  saveHistory,
  getHistory
}
