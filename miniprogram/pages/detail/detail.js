// detail.js —— 政策详情页逻辑（融合版：独立卡片分区 + 双按钮 + 收藏 + 海报 + 订阅）
const api = require('../../utils/api.js')
const favorite = require('../../utils/favorite.js')

// 订阅消息模板ID（需在微信公众平台配置后替换）
const SUBSCRIBE_TEMPLATE_ID = 'REPLACE_WITH_YOUR_TEMPLATE_ID'

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
    loading: true,
    isFavorited: false,
    showPoster: false,
    posterImage: '',
    isSubscribed: false
  },

  async onLoad(options) {
    // 1. 优先读 category 传来的缓存（秒出）
    const cached = wx.getStorageSync('pendingPolicy')
    if (cached && String(cached._id) === String(options.id)) {
      wx.removeStorageSync('pendingPolicy')
      const categoryName = cached.categoryName || categoryMap[cached.category] || ''
      cached.summary = cached.summary || cached.plain_answer || ''
      cached.source = cached.source || cached.remark || ''
      this.setData({
        policy: cached,
        categoryName: categoryName,
        loading: false,
        isFavorited: favorite.isFavorite(cached._id),
        isSubscribed: wx.getStorageSync('subscribed_' + cached._id) || false
      })
      return
    }

    // 2. 没有缓存 → 走 id 详情模式
    try {
      const res = await api.getPolicies({ id: options.id })
      const policy = res.policy || null
      this.setData({
        policy: policy,
        categoryName: policy ? (categoryMap[policy.category] || '') : '',
        loading: false,
        isFavorited: policy ? favorite.isFavorite(policy._id) : false,
        isSubscribed: policy ? (wx.getStorageSync('subscribed_' + policy._id) || false) : false
      })
    } catch (e) {
      console.error('[detail] 加载失败', e)
      this.setData({ loading: false, policy: null })
    }
  },

  // 导航栏分享按钮
  onShareTap() {
    wx.showToast({ title: '点击右上角分享', icon: 'none' })
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

  // 拨打电话
  onPhoneTap() {
    const phone = this.data.policy.phone
    if (!phone) return
    const first = String(phone).split(/[、,，\/\s]+/)[0]
    wx.makePhoneCall({
      phoneNumber: first,
      fail: () => wx.showToast({ title: '取消拨号', icon: 'none' })
    })
  },

  // 在线咨询AI → 跳问答页并自动填入政策相关问题
  onAskAI() {
    const policy = this.data.policy
    if (!policy) return
    const question = '关于「' + policy.title + '」，我想了解更多详情'
    wx.setStorageSync('reaskQuestion', question)
    wx.switchTab({ url: '/pages/chat/chat' })
  },

  // 收藏/取消收藏
  onToggleFavorite() {
    const policy = this.data.policy
    if (!policy) return
    const isFav = favorite.toggle({ ...policy, categoryName: this.data.categoryName })
    this.setData({ isFavorited: isFav })
    wx.showToast({
      title: isFav ? '已收藏' : '已取消收藏',
      icon: 'none',
      duration: 1000
    })
  },

  // 生成分享海报
  onGeneratePoster() {
    const policy = this.data.policy
    if (!policy) return
    wx.showLoading({ title: '生成海报中...' })

    const ctx = wx.createCanvasContext('posterCanvas', this)
    const W = 600, H = 900

    // 背景
    ctx.setFillStyle('#F5F7FA')
    ctx.fillRect(0, 0, W, H)

    // 顶部蓝色区域
    const grad = ctx.createLinearGradient(0, 0, 0, 280)
    grad.addColorStop(0, '#1565C0')
    grad.addColorStop(1, '#1E88E5')
    ctx.setFillStyle(grad)
    ctx.fillRect(0, 0, W, 280)

    // 标题
    ctx.setFillStyle('#fff')
    ctx.setFontSize(22)
    ctx.fillText('AI政策通', 40, 60)

    // 政策标题（自动换行）
    ctx.setFontSize(28)
    ctx.setFillStyle('#fff')
    const title = policy.title || ''
    const titleLines = this._wrapText(ctx, title, 24, W - 80)
    titleLines.slice(0, 3).forEach((line, i) => {
      ctx.fillText(line, 40, 120 + i * 40)
    })

    // 分类标签
    if (this.data.categoryName) {
      ctx.setFillStyle('rgba(255,255,255,0.25)')
      ctx.fillRect(40, 230, 120, 36)
      ctx.setFillStyle('#fff')
      ctx.setFontSize(18)
      ctx.fillText(this.data.categoryName, 60, 254)
    }

    // 白色内容卡片
    ctx.setFillStyle('#fff')
    ctx.fillRect(30, 310, W - 60, 440)

    // 政策解读
    ctx.setFillStyle('#888')
    ctx.setFontSize(20)
    ctx.fillText('📖 政策解读', 50, 360)

    const summary = (policy.summary || '').replace(/\n/g, ' ')
    const summaryLines = this._wrapText(ctx, summary, 20, W - 120)
    ctx.setFillStyle('#333')
    ctx.setFontSize(20)
    summaryLines.slice(0, 10).forEach((line, i) => {
      ctx.fillText(line, 50, 400 + i * 30)
    })

    // 底部信息
    ctx.setFillStyle('#999')
    ctx.setFontSize(16)
    ctx.fillText('来源：' + (policy.source || '天河区政府'), 50, 700)
    if (policy.phone) {
      ctx.fillText('咨询电话：' + policy.phone, 50, 730)
    }

    // 底部品牌区
    ctx.setFillStyle('#1565C0')
    ctx.fillRect(0, H - 80, W, 80)
    ctx.setFillStyle('#fff')
    ctx.setFontSize(20)
    ctx.fillText('AI政策通 · 天河区便民政策问答助手', 40, H - 35)
    ctx.setFontSize(14)
    ctx.fillText('长按识别小程序码', W - 200, H - 35)

    ctx.draw(false, () => {
      wx.canvasToTempFilePath({
        canvasId: 'posterCanvas',
        success: (res) => {
          this.setData({ posterImage: res.tempFilePath, showPoster: true })
          wx.hideLoading()
        },
        fail: (err) => {
          wx.hideLoading()
          wx.showToast({ title: '生成失败', icon: 'none' })
        }
      }, this)
    })
  },

  // 文本自动换行
  _wrapText(ctx, text, fontSize, maxWidth) {
    ctx.setFontSize(fontSize)
    const lines = []
    let line = ''
    for (const char of text) {
      const testLine = line + char
      if (ctx.measureText(testLine).width > maxWidth && line) {
        lines.push(line)
        line = char
      } else {
        line = testLine
      }
    }
    if (line) lines.push(line)
    return lines
  },

  // 保存海报到相册
  onSavePoster() {
    if (!this.data.posterImage) return
    wx.saveImageToPhotosAlbum({
      filePath: this.data.posterImage,
      success: () => {
        wx.showToast({ title: '已保存到相册', icon: 'success' })
      },
      fail: (err) => {
        if (err.errMsg.indexOf('auth deny') > -1) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中开启相册权限以保存海报',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) wx.openSetting()
            }
          })
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' })
        }
      }
    })
  },

  // 关闭海报预览
  onClosePoster() {
    this.setData({ showPoster: false })
  },

  // 订阅政策更新通知
  onSubscribe() {
    const policy = this.data.policy
    if (!policy) return

    // 如果已订阅，则取消
    if (this.data.isSubscribed) {
      wx.removeStorageSync('subscribed_' + policy._id)
      this.setData({ isSubscribed: false })
      wx.showToast({ title: '已取消关注', icon: 'none' })
      return
    }

    // 请求订阅消息
    if (SUBSCRIBE_TEMPLATE_ID === 'REPLACE_WITH_YOUR_TEMPLATE_ID') {
      // 未配置模板ID，用本地存储模拟
      wx.setStorageSync('subscribed_' + policy._id, true)
      this.setData({ isSubscribed: true })
      wx.showModal({
        title: '关注成功',
        content: '已关注该政策更新。\n\n注意：实际推送功能需在微信公众平台配置订阅消息模板，并在云函数中实现推送逻辑。',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }

    wx.requestSubscribeMessage({
      tmplIds: [SUBSCRIBE_TEMPLATE_ID],
      success: (res) => {
        if (res[SUBSCRIBE_TEMPLATE_ID] === 'accept') {
          wx.setStorageSync('subscribed_' + policy._id, true)
          this.setData({ isSubscribed: true })
          wx.showToast({ title: '关注成功，有更新将通知您', icon: 'success' })
        } else {
          wx.showToast({ title: '已取消关注', icon: 'none' })
        }
      },
      fail: (err) => {
        console.error('订阅失败', err)
        wx.showToast({ title: '订阅失败，请稍后重试', icon: 'none' })
      }
    })
  }
})
