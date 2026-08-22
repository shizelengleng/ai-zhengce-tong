// chat.js —— 聊天页逻辑（滚动时序修复 + 键盘适配 + 出处复制/拨号）
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

  // 输入框聚焦 → 延迟滚到底，防键盘弹起盖住最后一条
  onInputFocus() {
    setTimeout(() => this._scrollToBottom(), 260)
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
      loading: true
    }, () => {
      this._scrollToBottom('msg' + userMsg.id)
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
        loading: false
      }, () => {
        this._scrollToBottom('msg' + aiMsg.id)
      })

      // 保存历史（忽略失败）
      try {
        await api.saveHistory({ question, answer: res.answer, hits: res.sources || [] })
      } catch (_) {}

    } catch (e) {
      const errMsg = (e && e.message) || '抱歉，出错了'
      this.setData({
        messages: [...this.data.messages, {
          id: 'a' + Date.now(),
          role: 'ai',
          text: '（' + errMsg + '）请稍后再试，或拨打 020-12345 直接咨询。',
          sources: []
        }],
        loading: false
      }, () => {
        this._scrollToBottom()
      })
      wx.showToast({ title: errMsg, icon: 'none' })
    }
  },

  // 点击快捷问题
  onQuickTap(e) {
    const q = e.currentTarget.dataset.q
    this.setData({ inputValue: q }, () => {
      this.onSend()
    })
  },

  // 统一滚到底：先清空 scrollToId 再重设，触发小程序真滚动；80ms 后兜底一次
  _scrollToBottom(targetId) {
    const id = targetId || (this.data.messages.length
      ? 'msg' + this.data.messages[this.data.messages.length - 1].id
      : '')
    if (!id) return
    this.setData({ scrollToId: '' }, () => {
      this.setData({ scrollToId: id })
      setTimeout(() => {
        if (this.data.scrollToId !== id) this.setData({ scrollToId: id })
      }, 80)
    })
  },

  // 点击出处 → 复制链接 / 拨号 / 展示详情
  onSourceTap(e) {
    const src = e.currentTarget.dataset.src || {}
    if (src.source_url) {
      wx.setClipboardData({
        data: src.source_url,
        success: () => {
          const title = src.doc_no ? src.title + '（' + src.doc_no + '）' : src.title
          wx.showToast({ title: title + ' 链接已复制', icon: 'none' })
        }
      })
    } else if (src.phone) {
      const first = String(src.phone).split(/[、,，\/\s]+/)[0]
      wx.makePhoneCall({
        phoneNumber: first,
        fail: () => wx.showToast({ title: '取消拨号', icon: 'none' })
      })
    } else {
      const detail = [src.title, src.doc_no, src.source].filter(Boolean).join(' · ')
      wx.showToast({ title: detail || '暂无详情', icon: 'none' })
    }
  }
})
