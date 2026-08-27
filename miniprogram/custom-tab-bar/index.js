// custom-tab-bar/index.js
Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/chat/chat', text: '问答', icon: '💬', activeIcon: '💬' },
      { pagePath: '/pages/category/category', text: '分类', icon: '📂', activeIcon: '📂' },
      { pagePath: '/pages/mine/mine', text: '我的', icon: '👤', activeIcon: '👤' }
    ]
  },
  methods: {
    switchTab(e) {
      const index = e.currentTarget.dataset.index
      const url = this.data.list[index].pagePath
      wx.switchTab({ url })
      this.setData({ selected: index })
    }
  }
})
