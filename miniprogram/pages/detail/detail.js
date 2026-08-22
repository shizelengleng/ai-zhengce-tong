// detail.js —— 政策详情页逻辑（改用 id 详情模式，字段兼容后端返回）
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
    categoryName: ''
  },

  async onLoad(options) {
    // 走 id 详情模式：后端 enrichPolicies 会补充出处/链接/文号
    const res = await api.getPolicies({ id: options.id })
    const policy = res.policy || null
    this.setData({
      policy: policy,
      categoryName: policy ? (categoryMap[policy.category] || '') : ''
    })
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
