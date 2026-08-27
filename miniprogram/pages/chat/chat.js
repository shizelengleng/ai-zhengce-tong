// chat.js —— 聊天页逻辑（融合版UI + Markdown + 语音 + 智能追问）
const api = require('../../utils/api.js')
const markdown = require('../../utils/markdown.js')

// 录音管理器
const recorderManager = wx.getRecorderManager()
// 音频播放器
const innerAudioContext = wx.createInnerAudioContext()

Page({
  data: {
    messages: [],          // 消息列表 [{ id, role: 'user'|'ai', text, sources }]
    inputValue: '',        // 输入框内容
    loading: false,        // 是否正在等待 AI 回复
    scrollToId: '',        // 滚动定位
    slowToastShown: false,  // 长等待提示是否已显示
    _slowTimer: null,       // 长等待计时器（供清理）
    searchValue: '',        // 搜索框内容
    navTotalHeight: 88,     // 导航栏总高度（状态栏+导航栏），用于fixed布局偏移
    isRecording: false,      // 是否正在录音
    recordingTime: 0,        // 录音时长
    _recordTimer: null,      // 录音计时器
    playingId: '',            // 正在播放的消息ID

    // 快捷问题（覆盖 8 分类）
    quickQuestions: [
      '港澳子女怎么入学？',
      '医保怎么参保？',
      '公租房怎么申请？',
      '创业补贴怎么申请？',
      '养老金怎么领？',
      '低保怎么申请？',
      '老年食堂怎么吃？',
      '居住证怎么办？'
    ],

    // 数据看板（静态数据，后续可对接接口）
    statsData: [
      { num: '1,286', label: '累计问答' },
      { num: '358', label: '政策库' },
      { num: '98%', label: '好评率' }
    ],

    // 热门问题（2列网格展示）
    hotQuestions: [
      { q: '小学入学报名流程', icon: '🎒' },
      { q: '居民医保报销比例', icon: '💊' },
      { q: '高龄补贴申请条件', icon: '👴' },
      { q: '公租房申请指南', icon: '🏠' },
      { q: '居住证办理流程', icon: '📋' },
      { q: '创业补贴怎么领', icon: '💼' }
    ],

    // 最近问答（静态示例，后续可对接历史接口）
    recentChats: [
      { id: 'r1', question: '天河区小学报名需要什么材料？', time: '2小时前' },
      { id: 'r2', question: '居民医保门诊报销比例是多少？', time: '昨天' },
      { id: 'r3', question: '80岁以上老人有什么补贴？', time: '3天前' }
    ],

    // 智能追问预设（根据回答内容推荐）
    followUpPresets: [
      '需要什么材料？',
      '办理流程是什么？',
      '办理地点在哪里？',
      '有时间限制吗？',
      '还有什么注意事项？'
    ]
  },

  onLoad() {
    // 获取导航栏总高度，用于fixed布局偏移
    const sysInfo = wx.getSystemInfoSync()
    const statusBarHeight = sysInfo.statusBarHeight || 20
    let menuButtonInfo = { height: 32, top: statusBarHeight + 6 }
    try { menuButtonInfo = wx.getMenuButtonBoundingClientRect() } catch (e) {}
    const navBarHeight = (menuButtonInfo.top - statusBarHeight) * 2 + menuButtonInfo.height
    this.setData({ navTotalHeight: statusBarHeight + navBarHeight })

    // 初始化录音管理器
    recorderManager.onStart(() => {
      console.log('录音开始')
      this.setData({ isRecording: true, recordingTime: 0 })
      this._recordTimer = setInterval(() => {
        this.setData({ recordingTime: this.data.recordingTime + 1 })
      }, 1000)
    })
    recorderManager.onStop((res) => {
      console.log('录音结束', res)
      if (this._recordTimer) {
        clearInterval(this._recordTimer)
        this._recordTimer = null
      }
      this.setData({ isRecording: false })
      // 语音识别（需接入第三方语音识别服务，此处用占位提示）
      wx.showModal({
        title: '语音识别',
        content: '录音完成（' + this.data.recordingTime + '秒）。\n\n语音识别功能需接入第三方服务（如微信同声传译插件、百度AI等）。\n\n是否手动输入问题？',
        confirmText: '去输入',
        cancelText: '取消',
        success: (modalRes) => {
          if (modalRes.confirm) {
            // 聚焦输入框
          }
        }
      })
    })
    recorderManager.onError((err) => {
      console.error('录音错误', err)
      if (this._recordTimer) {
        clearInterval(this._recordTimer)
        this._recordTimer = null
      }
      this.setData({ isRecording: false })
      wx.showToast({ title: '录音失败，请检查权限', icon: 'none' })
    })
  },

  onShow() {
    // 设置自定义tabBar选中态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    // 检测从 mine 页"再问一次"传来的问题
    const reask = wx.getStorageSync('reaskQuestion')
    if (reask) {
      wx.removeStorageSync('reaskQuestion')
      this.setData({ inputValue: reask }, () => {
        this.onSend()
      })
    }
  },

  // 导航栏搜索图标点击 → 聚焦到底部输入框
  onSearchTap() {
    wx.showToast({ title: '请在底部输入问题', icon: 'none' })
  },

  // 搜索框输入
  onSearchInput(e) {
    this.setData({ searchValue: e.detail.value })
  },

  // 搜索确认 → 直接作为问题发送
  onSearchConfirm() {
    const q = this.data.searchValue.trim()
    if (q) {
      this.setData({ inputValue: q, searchValue: '' }, () => {
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

    // 长等待提示：> 4.5s 还没回复时提示用户"正在努力思考…"
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
        html: markdown.parse(res.answer),
        sources: res.sources || [],
        followUp: this._generateFollowUp(res.answer)
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
          html: markdown.parse('（' + errMsg + '）请稍后再试，或拨打 020-12345 直接咨询。'),
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

  // 点击热门问题
  onHotTap(e) {
    const q = e.currentTarget.dataset.q
    this.setData({ inputValue: q }, () => {
      this.onSend()
    })
  },

  // 点击最近问答 → 填入输入框（不自动发送，让用户确认）
  onRecentTap(e) {
    const q = e.currentTarget.dataset.q
    this.setData({ inputValue: q })
    wx.showToast({ title: '已填入问题，点击发送', icon: 'none' })
  },

  // 生成智能追问（基于回答内容关键词匹配，否则随机选3个）
  _generateFollowUp(answer) {
    if (!answer) return []
    const presets = this.data.followUpPresets
    const matched = []
    // 关键词匹配
    if (answer.indexOf('材料') > -1 || answer.indexOf('准备') > -1) {
      matched.push('还有什么补充材料？')
    }
    if (answer.indexOf('流程') > -1 || answer.indexOf('步骤') > -1) {
      matched.push('每一步需要多久？')
    }
    if (answer.indexOf('地点') > -1 || answer.indexOf('地址') > -1) {
      matched.push('工作时间是几点？')
    }
    if (answer.indexOf('时间') > -1 || answer.indexOf('期限') > -1) {
      matched.push('逾期了怎么办？')
    }
    // 补全到3个
    const shuffled = presets.sort(() => Math.random() - 0.5)
    const result = [...matched]
    for (const item of shuffled) {
      if (result.length >= 3) break
      if (!result.includes(item)) result.push(item)
    }
    return result.slice(0, 3)
  },

  // 点击智能追问 → 直接发送
  onFollowUpTap(e) {
    const q = e.currentTarget.dataset.q
    this.setData({ inputValue: q }, () => {
      this.onSend()
    })
  },

  // 开始/停止录音
  onVoiceTap() {
    if (this.data.isRecording) {
      recorderManager.stop()
    } else {
      wx.authorize({
        scope: 'scope.record',
        success: () => {
          recorderManager.start({
            duration: 60000,
            sampleRate: 16000,
            numberOfChannels: 1,
            encodeBitRate: 48000,
            format: 'mp3'
          })
        },
        fail: () => {
          wx.showModal({
            title: '需要麦克风权限',
            content: '请在设置中开启麦克风权限以使用语音输入',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) wx.openSetting()
            }
          })
        }
      })
    }
  },

  // 语音播报AI回答
  onPlayVoice(e) {
    const id = e.currentTarget.dataset.id
    const text = e.currentTarget.dataset.text
    if (!text) return

    // 如果正在播放同一条，则停止
    if (this.data.playingId === id) {
      innerAudioContext.stop()
      this.setData({ playingId: '' })
      return
    }

    // 停止之前的播放
    innerAudioContext.stop()

    // 语音播报（TTS）需接入第三方服务，此处用系统提示占位
    wx.showToast({
      title: '语音播报功能需接入TTS服务',
      icon: 'none',
      duration: 2000
    })

    // 实际接入TTS后，用以下代码播放：
    // innerAudioContext.src = ttsAudioUrl
    // innerAudioContext.play()
    // this.setData({ playingId: id })
    // innerAudioContext.onEnded(() => { this.setData({ playingId: '' }) })
  },

  // 统一滚到底
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
