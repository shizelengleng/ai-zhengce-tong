// chat.js —— 聊天页逻辑
const api = require('../../utils/api.js')

Page({
  data: {
    messages: [],          // 消息列表 [{ id, role: 'user'|'ai', text, sources }]
    inputValue: '',        // 输入框内容
    loading: false,        // 是否正在等待 AI 回复
    scrollToId: '',        // 滚动定位
    quickQuestions: [      // 快捷问题
      '港澳子女怎么入学？',
      '创业补贴怎么申请？',
      '公租房怎么申请？',
      '医保怎么参保？'
    ]
  },

  // 输入框内容变化
  onInput(e) {
    this.setData({ inputValue: e.detail.value })
  },

  // 发送消息
  async onSend() {
    const question = this.data.inputValue.trim()
    if (!question || this.data.loading) return

    // 追加用户气泡
    const userMsg = { id: 'u' + Date.now(), role: 'user', text: question }
    this.setData({
      messages: [...this.data.messages, userMsg],
      inputValue: '',
      loading: true,
      scrollToId: 'msg' + userMsg.id
    })

    try {
      const res = await api.ask({ question })
      const aiMsg = {
        id: 'a' + Date.now(),
        role: 'ai',
        text: res.answer,
        sources: res.sources || []
      }
      this.setData({
        messages: [...this.data.messages, aiMsg],
        loading: false,
        scrollToId: 'msg' + aiMsg.id
      })
    } catch (e) {
      this.setData({
        messages: [...this.data.messages, {
          id: 'a' + Date.now(),
          role: 'ai',
          text: '抱歉，出错了，请稍后重试。',
          sources: []
        }],
        loading: false
      })
    }
  },

  // 点击快捷问题
  onQuickTap(e) {
    const q = e.currentTarget.dataset.q
    this.setData({ inputValue: q }, () => {
      this.onSend()
    })
  },

  // 点击出处链接（静态阶段提示）
  onSourceTap(e) {
    const url = e.currentTarget.dataset.url
    wx.showToast({ title: '出处：' + url, icon: 'none' })
  }
})
