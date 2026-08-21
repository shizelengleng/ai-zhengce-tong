// app.js —— 小程序入口
App({
  onLaunch() {
    // 初始化云开发（env 为云环境 ID）
    wx.cloud.init({
      env: 'cloud1-d8g5hsfuke3b9e36e',
      traceUser: true,
    })
  },
  globalData: {
    userInfo: null
  }
})
