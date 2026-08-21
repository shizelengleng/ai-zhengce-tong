// app.js —— 小程序入口
App({
  onLaunch() {
    // 静态阶段不初始化云开发，避免未配环境报错
    // 后续接后端时取消下方注释，填入云环境 ID
    // wx.cloud.init({
    //   env: 'your-env-id',
    //   traceUser: true,
    // })
  },
  globalData: {
    userInfo: null
  }
})
