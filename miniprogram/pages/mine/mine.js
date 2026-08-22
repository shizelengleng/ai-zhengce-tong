// mine.js —— 我的页逻辑（历史记录显示答案 + 点击跳 chat 重问 + loading 态）
const api = require('../../utils/api.js')

Page({
  data: {
    history: [],
    loading: true,
    expandedId: ''    // 当前展开的历史项 _id，空则全部收起
  },

  async onShow() {
    this.setData({ loading: true })
    try {
      const res = await api.getHistory()
      this.setData({ history: res.history || [], loading: false })
    } catch (e) {
      console.error('[mine] getHistory 失败', e)
      this.setData({ loading: false })
    }
  },

  // 点击历史项 → 展开/收起答案
  onHistoryTap(e) {
    const id = e.currentTarget.dataset.id
    this.setData({
      expandedId: this.data.expandedId === id ? '' : id
    })
  },

  // 点击"再问一次" → 跳到 chat 页并自动发送
  onReaskTap(e) {
    const question = e.currentTarget.dataset.q
    if (!question) return
    // 用 storage 传参给 chat 页（switchTab 不支持 url 参数）
    wx.setStorageSync('reaskQuestion', question)
    wx.switchTab({ url: '/pages/chat/chat' })
  }
})
