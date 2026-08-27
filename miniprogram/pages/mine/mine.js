// mine.js —— 我的页逻辑（融合版：用户卡片 + 数据统计 + 历史 + 功能菜单 + 收藏）
const api = require('../../utils/api.js')
const favorite = require('../../utils/favorite.js')

Page({
  data: {
    history: [],
    loading: true,
    expandedId: '',
    showHistory: false,
    favoriteList: [],
    showFavorite: false,

    // 我的数据统计
    myStats: [
      { num: '0', label: '问答次数', icon: '💬' },
      { num: '0', label: '收藏政策', icon: '⭐' },
      { num: '8', label: '浏览分类', icon: '📂' }
    ],

    // 功能菜单
    menuList: [
      { icon: '⭐', name: '我的收藏', desc: '查看收藏的政策', action: 'favorite' },
      { icon: '📋', name: '意见反馈', desc: '告诉我们您的建议', action: 'feedback' },
      { icon: 'ℹ️', name: '关于我们', desc: 'AI政策通 v0.2.0', action: 'about' },
      { icon: '📞', name: '联系客服', desc: '020-12345', action: 'contact' }
    ]
  },

  // 下拉刷新
  async onPullDownRefresh() {
    try {
      const res = await api.getHistory()
      const list = res.history || []
      const stats = this.data.myStats.map((s, i) => {
        if (i === 0) return { ...s, num: String(list.length) }
        return s
      })
      this.setData({
        history: list,
        loading: false,
        expandedId: '',
        myStats: stats
      })
      wx.showToast({ title: '刷新成功', icon: 'success', duration: 1000 })
    } catch (e) {
      console.error('[mine] 刷新失败', e)
      wx.showToast({ title: '刷新失败', icon: 'none' })
    }
    wx.stopPullDownRefresh()
  },

  onToggleHistory() {
    this.setData({ showHistory: !this.data.showHistory })
  },

  // 切换收藏列表显示
  onToggleFavorite() {
    this.setData({ showFavorite: !this.data.showFavorite })
  },

  // 点击收藏项 → 跳详情页
  onFavoriteTap(e) {
    const id = e.currentTarget.dataset.id
    const policy = this.data.favoriteList.find(p => String(p._id) === String(id))
    if (policy) {
      wx.setStorageSync('pendingPolicy', policy)
    }
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },

  // 删除收藏
  onRemoveFavorite(e) {
    const id = e.currentTarget.dataset.id
    favorite.remove(id)
    const favList = favorite.getList()
    const stats = this.data.myStats.map((s, i) => {
      if (i === 1) return { ...s, num: String(favList.length) }
      return s
    })
    this.setData({ favoriteList: favList, myStats: stats })
    wx.showToast({ title: '已取消收藏', icon: 'none' })
  },

  async onShow() {
    // 设置自定义tabBar选中态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
    if (!this.data.history.length) {
      this.setData({ loading: true })
    }
    try {
      const res = await api.getHistory()
      const list = res.history || []
      const favList = favorite.getList()
      const stats = this.data.myStats.map((s, i) => {
        if (i === 0) return { ...s, num: String(list.length) }
        if (i === 1) return { ...s, num: String(favList.length) }
        return s
      })
      this.setData({
        history: list,
        favoriteList: favList,
        loading: false,
        expandedId: '',
        myStats: stats
      })
    } catch (e) {
      console.error('[mine] getHistory 失败', e)
      this.setData({ loading: false })
    }
  },

  onHistoryTap(e) {
    const id = e.currentTarget.dataset.id
    this.setData({
      expandedId: this.data.expandedId === id ? '' : id
    })
  },

  onReaskTap(e) {
    const question = e.currentTarget.dataset.q
    if (!question) return
    wx.setStorageSync('reaskQuestion', question)
    wx.switchTab({ url: '/pages/chat/chat' })
  },

  // 功能菜单点击
  onMenuTap(e) {
    const action = e.currentTarget.dataset.action
    switch (action) {
      case 'favorite':
        wx.showToast({ title: '收藏功能开发中', icon: 'none' })
        break
      case 'feedback':
        wx.showToast({ title: '反馈功能开发中', icon: 'none' })
        break
      case 'about':
        wx.showModal({
          title: '关于AI政策通',
          content: 'AI政策通 · 天河区社区便民政策问答助手\n版本 v0.2.0\n\n基于AI大模型技术，为天河区居民提供便捷的政策查询服务。',
          showCancel: false,
          confirmText: '知道了'
        })
        break
      case 'contact':
        wx.makePhoneCall({
          phoneNumber: '02012345',
          fail: () => wx.showToast({ title: '取消拨号', icon: 'none' })
        })
        break
    }
  }
})
