// mine.js —— 我的页逻辑（历史记录显示答案 + 点击跳 chat 重问 + loading 态）
const api = require('../../utils/api.js')

Page({
  data: {
    history: [],
    loading: true,
    expandedId: '',    // 当前展开的历史项 _id，空则全部收起
    showHistory: false  // 历史列表默认收起，点击标题展开
  },

  // 点击标题 → 展开/收起整个历史列表
  onToggleHistory() {
    this.setData({ showHistory: !this.data.showHistory })
  },

  async onShow() {
    // 有缓存先不显示 loading（秒出旧数据），后台静默刷新
    if (!this.data.history.length) {
      this.setData({ loading: true })
    }
    try {
      const res = await api.getHistory()
      const list = res.history || []
      this.setData({
        history: list,
        loading: false,
        expandedId: ''   // 默认全部折叠，点击问题展开答案
      })
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
