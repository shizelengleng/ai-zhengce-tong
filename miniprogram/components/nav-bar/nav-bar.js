// components/nav-bar/nav-bar.js
Component({
  properties: {
    title: {
      type: String,
      value: ''
    },
    // 背景类型：gradient(渐变蓝) / white(白色) / transparent(透明)
    bgType: {
      type: String,
      value: 'gradient'
    },
    // 是否显示返回按钮
    showBack: {
      type: Boolean,
      value: true
    },
    // 右侧图标（emoji或文字）
    rightIcon: {
      type: String,
      value: ''
    },
    // 右侧文字
    rightText: {
      type: String,
      value: ''
    }
  },

  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    menuButtonRight: 10,
    menuButtonWidth: 87
  },

  lifetimes: {
    attached() {
      // 获取状态栏高度
      const sysInfo = wx.getSystemInfoSync()
      const statusBarHeight = sysInfo.statusBarHeight || 20
      
      // 获取胶囊按钮位置
      let menuButtonInfo = { right: 10, width: 87, height: 32, top: statusBarHeight + 6 }
      try {
        menuButtonInfo = wx.getMenuButtonBoundingClientRect()
      } catch (e) {}

      const navBarHeight = (menuButtonInfo.top - statusBarHeight) * 2 + menuButtonInfo.height
      
      this.setData({
        statusBarHeight,
        navBarHeight,
        menuButtonRight: sysInfo.windowWidth - menuButtonInfo.right,
        menuButtonWidth: menuButtonInfo.width
      })
    }
  },

  methods: {
    onBack() {
      const pages = getCurrentPages()
      if (pages.length > 1) {
        wx.navigateBack()
      } else {
        // 如果是首页，返回tabBar首页
        wx.switchTab({ url: '/pages/chat/chat' })
      }
      this.triggerEvent('back')
    },
    onRightTap() {
      this.triggerEvent('righttap')
    }
  }
})
