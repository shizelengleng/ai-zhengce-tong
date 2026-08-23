// category.js —— 分类页逻辑（count 一次全量加载 + loading 态）
const api = require('../../utils/api.js')

Page({
  data: {
    categories: [
      { key: 'education', name: '教育入学', icon: '📚', count: 0 },
      { key: 'medical', name: '医疗保障', icon: '🏥', count: 0 },
      { key: 'housing', name: '住房保障', icon: '🏠', count: 0 },
      { key: 'employment', name: '就业创业', icon: '💼', count: 0 },
      { key: 'social_security', name: '社保补贴', icon: '💳', count: 0 },
      { key: 'welfare', name: '救助福利', icon: '🛟', count: 0 },
      { key: 'elderly', name: '社区养老', icon: '👴', count: 0 },
      { key: 'gov', name: '政务办事', icon: '🏛️', count: 0 }
    ],
    currentCategory: '',       // 当前选中分类
    currentCategoryName: '',
    currentPolicies: [],        // 当前分类下的政策
    allPolicies: [],            // 全量政策缓存（用于点击分类时本地筛选）
    loading: true               // count 加载中
  },

  onShow() {
    // 已有缓存则不重新加载，避免切换页面回来要等5秒、列表残留
    if (this.data.allPolicies.length) return
    this.loadCounts()
  },

  // 一次全量调用，本地按 category 统计 count（8 次 → 1 次）
  async loadCounts() {
    this.setData({ loading: true })
    try {
      const res = await api.getPolicies()
      const all = res.policies || []
      // 按 category 统计 count
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

  // 点击分类 → 从本地缓存筛选（不再调云函数）
  onCategoryTap(e) {
    const key = e.currentTarget.dataset.key
    const cat = this.data.categories.find(c => c.key === key)
    const policies = this.data.allPolicies.filter(p => p.category === key)
    this.setData({
      currentCategory: key,
      currentCategoryName: cat ? cat.name : '',
      currentPolicies: policies
    })
  },

  // 点击政策 → 跳详情页（先存 policy 到 storage，detail 直接用，不再等云函数）
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
