// category.js —— 分类页逻辑（融合版：搜索 + 分类网格 + 热门TOP5 + 政策列表）
const api = require('../../utils/api.js')

Page({
  data: {
    categories: [
      { key: 'education', name: '教育入学', icon: '🎒', count: 0, color: '#1565C0', update: 3 },
      { key: 'medical', name: '医疗保障', icon: '💊', count: 0, color: '#43A047', update: 2 },
      { key: 'housing', name: '住房保障', icon: '🏠', count: 0, color: '#00ACC1', update: 1 },
      { key: 'employment', name: '就业创业', icon: '💼', count: 0, color: '#FB8C00', update: 4 },
      { key: 'social_security', name: '社保补贴', icon: '💳', count: 0, color: '#8E24AA', update: 2 },
      { key: 'welfare', name: '救助福利', icon: '🤝', count: 0, color: '#E91E63', update: 1 },
      { key: 'elderly', name: '社区养老', icon: '👴', count: 0, color: '#FF9800', update: 2 },
      { key: 'gov', name: '政务办事', icon: '🏛️', count: 0, color: '#52C41A', update: 3 }
    ],
    currentCategory: '',
    currentCategoryName: '',
    currentPolicies: [],
    allPolicies: [],
    loading: true,
    searchValue: '',
    searchFocus: false,

    // 热门政策TOP5（静态示例，后续可对接接口）
    hotPolicies: [
      { rank: 1, title: '天河区2024年小学招生工作方案', source: '天河区教育局', views: '1.2k' },
      { rank: 2, title: '广州市居民基本医疗保险参保指南', source: '天河区医保局', views: '986' },
      { rank: 3, title: '天河区高龄老人津贴发放管理办法', source: '天河区民政局', views: '756' },
      { rank: 4, title: '天河区公共租赁住房保障制度实施细则', source: '天河区住建局', views: '623' },
      { rank: 5, title: '天河区居住证办理流程及所需材料', source: '天河区公安分局', views: '512' }
    ]
  },

  onShow() {
    // 设置自定义tabBar选中态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    if (this.data.allPolicies.length) return
    this.loadCounts()
  },

  // 搜索框输入
  onSearchInput(e) {
    const val = e.detail.value
    this.setData({ searchValue: val })
    // 实时筛选政策
    if (val.trim()) {
      const filtered = this.data.allPolicies.filter(p =>
        (p.title && p.title.indexOf(val) > -1) ||
        (p.summary && p.summary.indexOf(val) > -1) ||
        (p.keywords && p.keywords.join('').indexOf(val) > -1)
      )
      this.setData({
        currentCategory: 'search',
        currentCategoryName: '搜索结果',
        currentPolicies: filtered
      })
    } else {
      this.setData({
        currentCategory: '',
        currentCategoryName: '',
        currentPolicies: []
      })
    }
  },

  // 搜索清除
  onSearchClear() {
    this.setData({
      searchValue: '',
      currentCategory: '',
      currentCategoryName: '',
      currentPolicies: []
    })
  },

  // 下拉刷新
  async onPullDownRefresh() {
    this.setData({ allPolicies: [], currentCategory: '', currentPolicies: [] })
    try {
      await this.loadCounts()
      wx.showToast({ title: '刷新成功', icon: 'success', duration: 1000 })
    } catch (e) {
      wx.showToast({ title: '刷新失败', icon: 'none' })
    }
    wx.stopPullDownRefresh()
  },

  // 一次全量调用，本地按 category 统计 count
  async loadCounts() {
    this.setData({ loading: true })
    try {
      const res = await api.getPolicies()
      const all = res.policies || []
      const cats = this.data.categories.map(c => ({
        ...c,
        count: all.filter(p => p.category === c.key).length
      }))
      this.setData({ categories: cats, allPolicies: all, loading: false })
    } catch (e) {
      console.error('[category] loadCounts 失败', e)
      this.setData({ loading: false })
    }
  },

  // 点击分类 → 从本地缓存筛选
  onCategoryTap(e) {
    const key = e.currentTarget.dataset.key
    const cat = this.data.categories.find(c => c.key === key)
    const policies = this.data.allPolicies.filter(p => p.category === key)
    this.setData({
      currentCategory: key,
      currentCategoryName: cat ? cat.name : '',
      currentPolicies: policies,
      searchValue: ''
    })
  },

  // 点击热门政策 → 跳详情
  onHotPolicyTap(e) {
    const title = e.currentTarget.dataset.title
    const policy = this.data.allPolicies.find(p => p.title === title)
    if (policy) {
      wx.setStorageSync('pendingPolicy', {
        ...policy,
        categoryName: (this.data.categories.find(c => c.key === policy.category) || {}).name || ''
      })
      wx.navigateTo({ url: '/pages/detail/detail?id=' + policy._id })
    } else {
      wx.showToast({ title: '政策详情加载中', icon: 'none' })
    }
  },

  // 点击政策 → 跳详情页
  onPolicyTap(e) {
    const id = e.currentTarget.dataset.id
    const policy = this.data.allPolicies.find(p => p._id === id)
    if (policy) {
      wx.setStorageSync('pendingPolicy', {
        ...policy,
        categoryName: (this.data.categories.find(c => c.key === policy.category) || {}).name || ''
      })
    }
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  }
})
