// mine.js —— 我的页逻辑
const api = require('../../utils/api.js')

Page({
  data: {
    history: []
  },

  async onShow() {
    // 每次进入页面刷新历史
    const res = await api.getHistory()
    this.setData({ history: res.history })
  }
})
