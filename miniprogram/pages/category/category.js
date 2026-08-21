// category.js —— 分类页逻辑
const api = require('../../utils/api.js')

Page({
  data: {
    categories: [
      { key: 'education', name: '教育入学', icon: '📚', count: 0 },
      { key: 'medical', name: '医疗保障', icon: '🏥', count: 0 },
      { key: 'housing', name: '住房保障', icon: '🏠', count: 0 },
      { key: 'employment', name: '就业创业', icon: '💼', count: 0 },
      { key: 'social_security', name: '社保补贴', icon: '💳', count: 0 },
      { key: 'gov', name: '政务办事', icon: '🏛️', count: 0 }
    ],
    currentCategory: '',       // 当前选中分类
    currentCategoryName: '',
    currentPolicies: []         // 当前分类下的政策
  },

  onShow() {
    this.loadCounts()
  },

  // 加载各分类条目数
  async loadCounts() {
    const cats = this.data.categories
    for (let i = 0; i < cats.length; i++) {
      const res = await api.getPolicies({ category: cats[i].key })
      cats[i].count = res.policies.length
    }
    this.setData({ categories: cats })
  },

  // 点击分类 → 展示该分类政策
  async onCategoryTap(e) {
    const key = e.currentTarget.dataset.key
    const cat = this.data.categories.find(c => c.key === key)
    const res = await api.getPolicies({ category: key })
    this.setData({
      currentCategory: key,
      currentCategoryName: cat ? cat.name : '',
      currentPolicies: res.policies
    })
  },

  // 点击政策 → 跳详情页
  onPolicyTap(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  }
})
