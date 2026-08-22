// detail.js —— 政策详情页逻辑（优先读 category 传来的 storage，秒出不依赖云函数）
const api = require('../../utils/api.js')

const categoryMap = {
  education: '教育入学',
  medical: '医疗保障',
  housing: '住房保障',
  employment: '就业创业',
  social_security: '社保补贴',
  welfare: '救助福利',
  elderly: '社区养老',
  gov: '政务办事'
}

Page({
  data: {
    policy: null,
    categoryName: '',
    loading: true
  },

  async onLoad(options) {
    // 1. 优先读 category 传来的缓存（秒出，不依赖 P3 云函数）
    const cached = wx.getStorageSync('pendingPolicy')
    if (cached && String(cached._id) === String(options.id)) {
      wx.removeStorageSync('pendingPolicy')
      const categoryName = cached.categoryName || categoryMap[cached.category] || ''
      // 兼容字段：如果没有 summary 就兜底 plain_answer
      cached.summary = cached.summary || cached.plain_answer || ''
      cached.source = cached.source || cached.remark || ''
      this.setData({
        policy: cached,
        categoryName: categoryName,
        loading: false
      })
      return
    }

    // 2. 没有缓存 → 走 id 详情模式（兜底，慢）
    try {
      const res = await api.getPolicies({ id: options.id })
      const policy = res.policy || null
      this.setData({
        policy: policy,
        categoryName: policy ? (categoryMap[policy.category] || '') : '',
        loading: false
      })
    } catch (e) {
      console.error('[detail] 加载失败', e)
      this.setData({ loading: false, policy: null })
    }
  },

  // 查看原文 → 复制链接
  onSourceTap() {
    const url = this.data.policy.source_url
    if (!url) {
      wx.showToast({ title: '暂无原文链接', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showToast({ title: '链接已复制，可在浏览器打开', icon: 'none' })
      }
    })
  },

  // 拨打电话（支持多号，取第一个）
  onPhoneTap() {
    const phone = this.data.policy.phone
    if (!phone) return
    const first = String(phone).split(/[、,，\/\s]+/)[0]
    wx.makePhoneCall({
      phoneNumber: first,
      fail: () => wx.showToast({ title: '取消拨号', icon: 'none' })
    })
  }
})
