// mock.js —— 静态阶段假数据
// 字段严格对齐 data/policies.template.json 与 docs 接口约定
// 后续接云函数后可删除本文件

const mockPolicies = [
  {
    _id: 'p1', category: 'education', title: '天河区公办小学入学条件',
    keywords: ['小学', '入学', '公办', '港澳', '随迁'],
    summary: '天河区公办小学招生坚持免试就近入学原则。具有天河区户籍的适龄儿童，按地段划分入学；港澳居民子女凭《港澳居民居住证》及相关证明可申请入学；来穗人员随迁子女需满足积分条件。报名一般在每年5月，通过"广州市义务教育学校招生报名系统"进行。',
    source: '天河区教育局', source_url: 'https://www.thnet.gov.cn/edu', phone: '020-38622978'
  },
  {
    _id: 'p2', category: 'education', title: '天河区来穗人员随迁子女积分入学',
    keywords: ['随迁', '积分', '入学', '来穗'],
    summary: '来穗人员随迁子女入读天河区公办学校，按《天河区来穗人员随迁子女积分制入学工作方案》执行，从社保年限、居住年限、学历等维度积分，按积分高低统筹安排学位。',
    source: '天河区教育局', source_url: 'https://www.thnet.gov.cn/edu2', phone: '020-38622978'
  },
  {
    _id: 'p3', category: 'medical', title: '广州市城乡居民医保参保办理',
    keywords: ['医保', '参保', '城乡居民', '医疗'],
    summary: '广州市城乡居民医保按年度缴费，个人缴费标准由市医保局每年公布。可通过"粤医保"小程序、税务部门、银行代扣等方式缴费。新参保人员需先到街道政务中心办理参保登记。',
    source: '广州市医疗保障局', source_url: 'https://www.gz.gov.cn/ylbz', phone: '020-12345'
  },
  {
    _id: 'p4', category: 'medical', title: '广州医保异地就医备案',
    keywords: ['异地', '就医', '备案', '医保', '医疗'],
    summary: '异地长期居住、临时外出等原因需在异地就医的，应先办理异地就医备案。备案可通过"国家医保服务平台"APP、"粤医保"小程序线上办理，备案后可凭社保卡直接结算。',
    source: '广州市医疗保障局', source_url: 'https://www.gz.gov.cn/ylbz2', phone: '020-12345'
  },
  {
    _id: 'p5', category: 'housing', title: '天河区公租房申请指南',
    keywords: ['公租房', '申请', '住房', '保障', '租房'],
    summary: '天河区公共租赁住房面向符合条件的城镇户籍住房困难家庭配租。申请条件包括户籍、住房困难、收入资产限额等，可在户籍所在地街道办政务服务中心提出申请。',
    source: '天河区住建局', source_url: 'https://www.thnet.gov.cn/zj', phone: '020-12345'
  },
  {
    _id: 'p6', category: 'employment', title: '一次性创业补贴申领',
    keywords: ['创业', '补贴', '就业', '一次性'],
    summary: '首次创办小微企业或个体工商户、正常经营满6个月以上的，可申请一次性创业补贴。补贴标准最高10000元，向注册地所在街道政务服务中心提交申请。',
    source: '天河区人力资源和社会保障局', source_url: 'https://www.thnet.gov.cn/rs', phone: '020-12333'
  },
  {
    _id: 'p7', category: 'employment', title: '港澳青年创业扶持政策',
    keywords: ['港澳', '青年', '创业', '扶持', '就业'],
    summary: '天河区支持港澳青年就业创业，符合条件的港澳青年可享受创业担保贷款贴息、创业场地补贴、一次性创业资助等。天河区设有港澳青年创新创业基地，提供孵化服务。',
    source: '天河区人力资源和社会保障局', source_url: 'https://www.thnet.gov.cn/rs2', phone: '020-12333'
  },
  {
    _id: 'p8', category: 'social_security', title: '灵活就业人员参加企业职工基本养老保险',
    keywords: ['灵活就业', '社保', '养老保险', '参保'],
    summary: '无雇工个体工商户、灵活就业人员可在户籍地或就业地参加企业职工基本养老保险，缴费基数在当地上年度全口径城镇单位就业人员平均工资的60%-300%间自行选择，按月缴费。',
    source: '天河区社保经办机构', source_url: 'https://www.thnet.gov.cn/sb', phone: '020-12333'
  },
  {
    _id: 'p9', category: 'social_security', title: '社会保障卡申领与激活',
    keywords: ['社保卡', '申领', '激活', '社保'],
    summary: '广州市社会保障卡可通过"穗好办"APP、银行网点、社保卡服务中心申领。首次申领免费，领取后需到银行网点激活金融功能、到医保定点机构激活医保功能。',
    source: '广州市社会保障卡服务中心', source_url: 'https://www.gz.gov.cn/sbk', phone: '020-12333'
  },
  {
    _id: 'p10', category: 'gov', title: '广东省居住证办理',
    keywords: ['居住证', '办理', '来穗', '政务'],
    summary: '流动人口在居住地居住登记满半年，可申领《广东省居住证》。需提供身份证、居住地住址证明等材料，到居住地街道来穗人员服务管理中心办理，也可"粤省事"小程序线上申报。',
    source: '天河区来穗人员服务管理局', source_url: 'https://www.thnet.gov.cn/lz', phone: '020-12345'
  },
  {
    _id: 'p11', category: 'gov', title: '人才引进入户广州办理',
    keywords: ['入户', '人才引进', '户籍', '政务'],
    summary: '符合广州市人才引进条件的，可申请办理入户。学历入户、职称入户、技能入户等渠道均有相应年龄、社保要求。可在"广州公安"微信公众号或户籍地公安户政窗口办理。',
    source: '广州市公安局户政部门', source_url: 'https://www.gz.gov.cn/ga', phone: '020-12345'
  }
]

const mockHistory = [
  { _id: 'h1', question: '港澳子女在天河怎么入学？', answer: '港澳居民子女凭居住证及相关证明可申请入学…', create_time: '2026-08-21 10:30' },
  { _id: 'h2', question: '一次性创业补贴怎么申请？', answer: '首次创办企业正常经营满6个月可申请…', create_time: '2026-08-21 11:15' },
  { _id: 'h3', question: '公租房申请需要什么条件？', answer: '需户籍、住房困难、收入资产符合限额…', create_time: '2026-08-21 14:20' }
]

// 模拟 RAG：根据问题关键词命中政策，返回 summary 作为答案 + 出处
function mockAnswer(question) {
  const q = question || ''
  let hit = null
  for (const p of mockPolicies) {
    if (p.keywords.some(k => q.includes(k))) {
      hit = p
      break
    }
  }
  if (!hit) hit = mockPolicies[0]
  return {
    answer: hit.summary + '\n\n（以上内容仅供参考，具体以官方最新政策为准，建议拨打 ' + hit.phone + ' 咨询）',
    sources: [{ title: hit.source, source_url: hit.source_url }]
  }
}

module.exports = {
  mockPolicies,
  mockHistory,
  mockAnswer
}
