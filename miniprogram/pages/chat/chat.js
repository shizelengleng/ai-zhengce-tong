// chat.js —— 聊天页逻辑（滚动时序修复 + 键盘适配 + 出处复制/拨号）
const api = require('../../utils/api.js')

Page({
  data: {
    messages: [],          // 消息列表 [{ id, role: 'user'|'ai', text, sources }]
    inputValue: '',        // 输入框内容
    loading: false,        // 是否正在等待 AI 回复
    scrollToId: '',        // 滚动定位
    slowToastShown: false,  // 长等待提示是否已显示
    _slowTimer: null,       // 长等待计时器（供清理）
    quickQuestions: [      // 快捷问题（覆盖 8 分类）
      '港澳子女怎么入学？',     // 教育入学
      '医保怎么参保？',         // 医疗保障
      '公租房怎么申请？',       // 住房保障
      '创业补贴怎么申请？',     // 就业创业
      '养老金怎么领？',         // 社保补贴
      '低保怎么申请？',         // 救助福利
      '老年食堂怎么吃？',       // 社区养老
      '居住证怎么办？'          // 政务办事
    ]
  },

  onShow() {
    // 检测从 mine 页"再问一次"传来的问题
    const reask = wx.getStorageSync('reaskQuestion')
    if (reask) {
      wx.removeStorageSync('reaskQuestion')
      this.setData({ inputValue: reask }, () => {
        this.onSend()
      })
    }
  },

  // 输入框内容变化
  onInput(e) {
    this.setData({ inputValue: e.detail.value })
  },

  // 输入框聚焦 → 延迟滚到底，防键盘弹起盖住最后一条
  onInputFocus() {
    setTimeout(() => this._scrollToBottom(), 260)
  },

  // 发送消息（防连点 + 长等待提示 + 失败清理计时器）
  async onSend() {
    const question = this.data.inputValue.trim()
    // 防连点：loading 中 / 正在处理中 / 空内容 → 直接忽略
    if (!question || this.data.loading) return

    // 追加用户气泡
    const userMsg = { id: 'u' + Date.now(), role: 'user', text: question }
    this.setData({
      messages: [...this.data.messages, userMsg],
      inputValue: '',
      loading: true,
      slowToastShown: false
    }, () => {
      this._scrollToBottom('msg' + userMsg.id)
    })

    // 长等待提示：> 4.5s 还没回复时提示用户"正在努力思考…"，避免以为卡死
    if (this._slowTimer) clearTimeout(this._slowTimer)
    this._slowTimer = setTimeout(() => {
      if (this.data.loading && !this.data.slowToastShown) {
        this.setData({ slowToastShown: true })
        wx.showToast({
          title: '正在努力思考，可能需要几秒…',
          icon: 'none',
          duration: 2500
        })
      }
    }, 4500)

    try {
      const res = await api.ask({ question })
      // 成功：清长等待计时器
      if (this._slowTimer) { clearTimeout(this._slowTimer); this._slowTimer = null }
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
      if (this._slowTimer) { clearTimeout(this._slowTimer); this._slowTimer = null }
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

  // 开启新对话：清空当前消息（历史已保存到后端）
  onNewChat() {
    this.setData({ messages: [], inputValue: '' })
    wx.showToast({ title: '已开启新对话', icon: 'none' })
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
