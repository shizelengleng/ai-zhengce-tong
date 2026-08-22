// custom-tab-bar/index.js
Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/chat/chat', text: '问答', icon: '💬' },
      { pagePath: '/pages/category/category', text: '分类', icon: '📂' },
      { pagePath: '/pages/mine/mine', text: '我的', icon: '👤' }
    ]
  },
  methods: {
    switchTab(e) {
      const { path, index } = e.currentTarget.dataset
      wx.switchTab({ url: path })
      this.setData({ selected: Number(index) })
    }
  }
})
