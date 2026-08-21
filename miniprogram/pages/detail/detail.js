// detail.js —— 政策详情页逻辑
const api = require('../../utils/api.js')

const categoryMap = {
  education: '教育入学',
  medical: '医疗保障',
  housing: '住房保障',
  employment: '就业创业',
  social_security: '社保补贴',
  gov: '政务办事'
}

Page({
  data: {
    policy: null,
    categoryName: ''
  },

  async onLoad(options) {
    // 根据 id 从 mock 拉取政策
    const res = await api.getPolicies({})
    const policy = res.policies.find(p => p._id === options.id)
    this.setData({
      policy: policy,
      categoryName: policy ? categoryMap[policy.category] || '' : ''
    })
  },

  // 查看原文（静态阶段复制链接到剪贴板）
  onSourceTap() {
    const url = this.data.policy.source_url
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showToast({ title: '链接已复制，可在浏览器打开', icon: 'none' })
      }
    })
  },

  // 拨打电话
  onPhoneTap() {
    const phone = this.data.policy.phone
    if (!phone) return
    wx.makePhoneCall({ phoneNumber: phone })
  }
})
