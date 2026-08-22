// mock.js —— 本地兜底数据（云函数失败时降级使用，保证页面不白屏）
// 数据来源：data/policies.json 精简版

const mockPolicies = [
  {
    _id: 'mock_1',
    title: '天河区公办小学入学（人户一致）',
    category: 'education',
    keywords: ['小学', '公办', '入学', '户籍', '人户一致'],
    summary: '具有广州市天河区户籍、按"人户一致"地段入读公办小学的适龄儿童。5月7-11日登录广州市义务教育学校招生报名系统网报，5月16-18日到校审核，6月17日发录取通知。',
    source: '穗天教〔2026〕2号 / 天河区教育局',
    source_url: 'https://zs.gzeducms.cn',
    phone: '020-12345',
    venue: '广州市义务教育学校招生报名系统 zs.gzeducms.cn',
    remark: '小学5月7-11日网报；5月16-18日审核；6月17日发录取通知'
  },
  {
    _id: 'mock_2',
    title: '来穗人员随迁子女积分入学',
    category: 'education',
    keywords: ['随迁子女', '积分入学', '非本地户籍', '居住证'],
    summary: '非广州户籍、持天河区居住证的来穗人员随迁子女。6月27日-7月1日登录天河区积分制入学申请系统填报1-19个志愿，按"积分优先、遵循志愿"录取。',
    source: '穗天教规字〔2024〕1号 / 天河区教育局',
    source_url: 'http://39.107.105.7/tianhejf/',
    phone: '020-38622512',
    venue: '广州市天河区来穗人员随迁子女积分制入学申请系统',
    remark: '2026年计划1023个学位（小学563、初中460）'
  },
  {
    _id: 'mock_3',
    title: '港澳居民子女在广州就读',
    category: 'education',
    keywords: ['港澳', '子女', '就读', '大湾区', '公办学校'],
    summary: '持有效港澳通行证的港澳居民随迁子女。6月2日-5日登录天河区港澳居民随迁子女积分制入学申请系统填报1-2个志愿，6月12日公布结果。',
    source: '天河区教育局 / 2026年港澳随迁子女入学指引',
    source_url: 'http://39.107.105.7/tianhejf-gangao/',
    phone: '020-38622512',
    venue: '天河区港澳积分制入学申请系统 + 南国学校等港澳子弟班',
    remark: '2026年计划135个（小学45、初中90），南国学校设港澳子弟班'
  },
  {
    _id: 'mock_4',
    title: '天河区公租房申请',
    category: 'housing',
    keywords: ['公租房', '住房保障', '申请', '低收入'],
    summary: '天河区户籍低收入住房困难家庭可申请公租房。向户籍所在地街道办提交申请，区住房保障办审核公示后轮候配租。',
    source: '《广州市公共租赁住房保障办法》 / 天河区住房保障办',
    source_url: '',
    phone: '020-38622018',
    venue: '户籍所在地街道办事处',
    remark: '需提供户籍、收入、住房情况证明'
  },
  {
    _id: 'mock_5',
    title: '一次性创业补贴',
    category: 'employment',
    keywords: ['创业', '补贴', '一次性', '应届', '大学生'],
    summary: '毕业年度高校毕业生在天河区首次创办企业正常运营满6个月，可申请一次性创业补贴10000元。向区人社局提交申请。',
    source: '《广州市创业带动就业补贴办法》 / 天河区人社局',
    source_url: '',
    phone: '020-38622391',
    venue: '天河区人社局就业促进科',
    remark: '需营业执照、纳税证明、社保缴纳记录'
  },
  {
    _id: 'mock_6',
    title: '城乡居民医保参保',
    category: 'medical',
    keywords: ['医保', '参保', '城乡居民', '缴费'],
    summary: '广州市户籍非职工医保参保人员及在校生可参加城乡居民医保。每年9-12月缴费，次年享受待遇。可通过"粤医保"小程序或街道办办理。',
    source: '《广州市城乡居民社会医疗保险办法》 / 广州市医保局',
    source_url: 'https://www.gdzwfw.gov.cn',
    phone: '020-12345',
    venue: '粤医保小程序 / 户籍所在地街道办',
    remark: '2026年度个人缴费标准380元/人'
  }
]

const mockHistory = [
  {
    _id: 'h1',
    question: '港澳子女怎么入学？',
    answer: '港澳居民随迁子女可走积分制入学。6月2日-5日登录天河区港澳积分制入学申请系统填报1-2个志愿，6月12日公布结果。',
    sources: [],
    create_time: '2026-08-20 10:30'
  },
  {
    _id: 'h2',
    question: '公租房怎么申请？',
    answer: '天河区户籍低收入住房困难家庭可申请公租房，向户籍所在地街道办提交申请。',
    sources: [],
    create_time: '2026-08-20 14:15'
  },
  {
    _id: 'h3',
    question: '创业补贴怎么申请？',
    answer: '毕业年度高校毕业生首次创办企业满6个月可申请一次性创业补贴10000元，向区人社局提交申请。',
    sources: [],
    create_time: '2026-08-21 09:45'
  }
]

// 简单关键词匹配 mock 问答
function mockAnswer(question) {
  const q = question.toLowerCase()
  let hit = null
  for (const p of mockPolicies) {
    if (p.keywords.some(k => q.includes(k.toLowerCase()))) {
      hit = p
      break
    }
  }
  if (!hit) hit = mockPolicies[0]

  return {
    answer: hit.summary + '\n\n建议拨打 ' + hit.phone + ' 咨询详情。',
    sources: [{
      title: hit.title,
      doc_no: '',
      source: hit.source,
      source_url: hit.source_url,
      phone: hit.phone
    }]
  }
}

module.exports = {
  mockPolicies,
  mockHistory,
  mockAnswer
}
