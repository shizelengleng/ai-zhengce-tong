/**
 * AI政策通 · 核心问答云函数 `ask`
 *
 * 流程：
 *   用户提问 → 问题转向量 → 向量检索 Top4（政策库余弦相似度）
 *   → 拼 Prompt → SenseNova（主力）生成，失败自动熔断切智谱 GLM 兜底
 *   → 返回答案 + 出处 + 自动存历史
 *
 * 密钥全部从云开发控制台「环境变量」读取（process.env），
 * 仓库为公开仓库，代码中绝不硬编码任何 Key。
 *
 * 需要在云开发控制台为本函数配置的环境变量（与 .env 同名，值同）：
 *   EMBEDDING_BASE_URL, EMBEDDING_MODEL, EMBEDDING_DIM, DASHSCOPE_API_KEY,
 *   ZHIPU_BASE_URL, ZHIPU_MODEL_MAIN, ZHIPU_MODEL_FAST, ZHIPU_API_KEY,
 *   SENSENOVA_BASE_URL, SENSENOVA_KEYS, SENSENOVA_MODEL_DEEPSEEK, SENSENOVA_MODEL_GLM
 * 可选：PRIMARY_PROVIDER（默认 sensenova；想切智谱主力时设为 zhipu）
 *       MIN_SCORE（相似度阈值，低于则引导 12345，默认 0.4）
 */

const cloud = require('wx-server-sdk')
const axios = require('axios')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const EMBEDDING_BASE_URL = process.env.EMBEDDING_BASE_URL
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-v4'
const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIM) || 1024
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY

const ZHIPU_BASE_URL = process.env.ZHIPU_BASE_URL
const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY
const ZHIPU_MODEL_MAIN = process.env.ZHIPU_MODEL_MAIN || 'glm-4.7-flash'
const ZHIPU_MODEL_FAST = process.env.ZHIPU_MODEL_FAST || 'glm-4-flash'

const SENSENOVA_BASE_URL = process.env.SENSENOVA_BASE_URL
const SENSENOVA_KEYS = (process.env.SENSENOVA_KEYS || '').split(',').filter(Boolean)
const SENSENOVA_MODEL_DEEPSEEK = process.env.SENSENOVA_MODEL_DEEPSEEK || 'deepseek-v4-flash'
const SENSENOVA_MODEL_GLM = process.env.SENSENOVA_MODEL_GLM || 'glm-5.2'

const TOP_K = 4              // 向量检索返回条数
const MIN_SCORE = Number(process.env.MIN_SCORE) || 0.4  // 相似度阈值：top1 低于此视为无匹配，引导 12345
const MAX_TOKENS = 4096      // 生成回答最大 token（5 段结构 + 多处出处，2048 不够用会截断）

// 联网搜索补充（博查 AI Search，https://bochaai.com）
// BOCHA_API_KEY：博查 key（云开发环境变量，勿写入仓库）。未配置则联网兜底自动关闭，行为与之前一致。
const BOCHA_API_KEY = process.env.BOCHA_API_KEY
const BOCHA_SEARCH_URL = process.env.BOCHA_SEARCH_URL || 'https://api.bochaai.com/v1/web-search'

// 信息不足标记：模型判断官方原文缺关键信息时，在回答末尾单独一行输出该标记 → 触发联网补充重答
const MISSING_MARKER = '【信息不足】'

// ---------- 主备模型切换（触发机制） ----------
// 主力：SenseNova（免费网关多 key，主用 glm-5.2，失败换 deepseek-v4-flash）
// 兜底：智谱 GLM（glm-4.7-flash → glm-4-flash）
// 触发规则：主模型连续失败达到阈值 → 触发熔断一段时间，期间直接用兜底；熔断到期自动恢复。
// 冷启动后进程内状态会重置（可接受：最坏多兜底一次）。
const PRIMARY_PROVIDER = (process.env.PRIMARY_PROVIDER || 'sensenova').toLowerCase()
const PROVIDER_ORDER =
  PRIMARY_PROVIDER === 'zhipu' ? ['zhipu', 'sensenova'] : ['sensenova', 'zhipu']
const FAIL_THRESHOLD = 2            // 连续失败 N 次触发熔断
const COOLDOWN_MS = 5 * 60 * 1000   // 熔断时长：5 分钟

const providerState = {
  sensenova: { failCount: 0, blockedUntil: 0 },
  zhipu: { failCount: 0, blockedUntil: 0 },
}

function isProviderBlocked(name) {
  return Date.now() < providerState[name].blockedUntil
}

function markProviderSuccess(name) {
  const s = providerState[name]
  if (s.failCount > 0) console.log(`[switch] ${name} 恢复成功，重置失败计数`)
  s.failCount = 0
  s.blockedUntil = 0
}

function markProviderFailure(name) {
  const s = providerState[name]
  s.failCount += 1
  if (s.failCount >= FAIL_THRESHOLD) {
    s.blockedUntil = Date.now() + COOLDOWN_MS
    console.log(`[switch] ${name} 连续失败 ${s.failCount} 次，触发熔断 ${COOLDOWN_MS / 1000}s`)
  }
}

const SYSTEM_PROMPT =
  '你是一名严谨的天河区政策咨询助手。请严格遵守以下规则：\n' +
  '1. 只能依据"官方原文"中给出的内容回答，不得编造、不得臆测、不得用自身知识补充政策细节。\n' +
  '2. 回答要通俗、分点、口语化，让普通居民一看就懂。\n' +
  '3. 回答按固定 5 段结构组织（小标题依次为：谁能办 / 要什么条件 / 怎么办 / 交什么材料 / 注意）。某段原文未提及时写"原文未提及"，不要编造；本次问题不涉及某段时写"本次问题不涉及"。\n' +
  '4. 每次回答末尾列出引用出处（官方原文的标题 + 文号）。\n' +
  '5. 若官方原文中没有任何可参考内容，请明确告知"暂未检索到相关政策"，并引导拨打 020-12345（广州政务热线）咨询，不要强行编造答案。\n' +
  '6. 涉及具体金额、年限、条件时，说明"以最新官方公告为准"。\n' +
  '7. 若命中多份政策原文且条件不一致，以广州市/天河区本地的政策为准作为主答案，广东省/国家层面的政策只作为补充参考，并明确指出两者的差异，避免让用户困惑。\n' +
  '8. 若官方原文缺少回答本题所必需的具体信息（如材料清单、办理时限、咨询电话、办理地点等），在回答的最末尾单独另起一行输出：【信息不足】+ 简要说明缺了什么。若原文已足够作答，则绝不要输出这一行。'

// ---------- 1. 向量化 ----------

async function getEmbedding(text) {
  if (!EMBEDDING_BASE_URL || !DASHSCOPE_API_KEY) {
    throw new Error('缺少 EMBEDDING_BASE_URL 或 DASHSCOPE_API_KEY 环境变量')
  }
  const resp = await axios.post(
    `${EMBEDDING_BASE_URL}/embeddings`,
    {
      model: EMBEDDING_MODEL,
      input: text,
      encoding_format: 'float',
      dimensions: EMBEDDING_DIM,
    },
    {
      headers: { Authorization: `Bearer ${DASHSCOPE_API_KEY}` },
      timeout: 20000,
    }
  )
  const data = resp.data
  if (!data || !data.data || !data.data.length || !data.data[0].embedding) {
    throw new Error('embedding 返回异常: ' + JSON.stringify(data).slice(0, 200))
  }
  return data.data[0].embedding
}

// ---------- 2. 余弦相似度 ----------

function cosineSimilarity(a, b) {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// ---------- 3. 加载政策库 + 检索 ----------

async function loadAllPolicies() {
  // 云数据库单次最多取 100 条，知识库几十条，分页拉全量，避免重复查询
  const MAX_PER_QUERY = 100
  const all = []
  const total = await db.collection('policies').count()
  const count = total.total
  const batch = Math.ceil(count / MAX_PER_QUERY)
  for (let i = 0; i < batch; i++) {
    const res = await db
      .collection('policies')
      .skip(i * MAX_PER_QUERY)
      .limit(MAX_PER_QUERY)
      .get()
    all.push(...res.data)
  }
  return all
}

// 原文锁定：按 doc_ids 从 documents 集合取官方原文
async function loadDocuments(docIds) {
  const ids = (docIds || []).filter(Boolean)
  if (!ids.length) return []
  const _ = db.command
  const res = await db.collection('documents').where({ id: _.in(ids) }).limit(50).get()
  return res.data || []
}

async function retrieve(questionVec, questionText) {
  const policies = await loadAllPolicies()
  const scored = policies
    .map((p) => {
      const v = p.vector || []
      if (!v.length) return { policy: p, score: 0 }
      return { policy: p, score: cosineSimilarity(questionVec, v) }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K)

  // 一次性收集 Top4 涉及的 doc_ids，去重后查 documents，再按序挂到每条命中上
  const wantedIds = [...new Set(scored.flatMap((s) => s.policy.doc_ids || []))]
  const docRows = await loadDocuments(wantedIds)
  const docById = {}
  for (const d of docRows) docById[d.id] = d

  return scored.map((s) => {
    const p = s.policy
    const docs = (p.doc_ids || []).map((id) => docById[id]).filter(Boolean)
    return {
      ...p,
      score: s.score,
      docs,
      _text: `${p.title}\n${p.plain_answer || p.summary || ''}\n${(p.keywords || []).join('、')}`,
    }
  })
}

// ---------- 4. 拼 Prompt ----------

function buildPrompt(question, hits) {
  const parts = []
  let docIndex = 0
  for (const h of hits) {
    const docs = h.docs || []
    const head = [`【政策条目】\n标题：${h.title}`]
    if (h.phone) head.push(`咨询电话：${h.phone}`)
    if (h.venue) head.push(`办理地点：${h.venue}`)
    const block = [head.join('\n')]
    if (docs.length) {
      for (const d of docs) {
        docIndex++
        const meta = [
          d.title,
          d.doc_no ? `文号：${d.doc_no}` : '',
          d.source ? `发文机关：${d.source}` : '',
          d.publish_date ? `发布日期：${d.publish_date}` : '',
        ]
          .filter(Boolean)
          .join('；')
        block.push(
          `【官方原文${docIndex}】\n${meta}\n原文正文：\n${d.original_text || '（本文档暂未收录原文正文，请勿据此作答）'}`
        )
      }
    } else {
      block.push('（该条目暂无官方原文，仅作提示，不作为回答依据）')
    }
    parts.push(block.join('\n\n'))
  }
  return [
    `【政策资料（唯一事实来源：官方原文）】\n${parts.join('\n\n')}`,
    `【用户问题】\n${question}`,
    `请根据上面的官方原文回答用户问题，注意：`,
    `- 只能依据官方原文中的内容回答；原文未提及的，不要推测；`,
    `- 回答要通俗、分点、口语化；`,
    `- 按 5 段结构组织，小标题依次为：谁能办 / 要什么条件 / 怎么办 / 交什么材料 / 注意；原文未提的写"原文未提及"，本次问题不涉及的写"本次问题不涉及"；`,
    `- 末尾列出引用出处（标题 + 文号）；`,
    `- 若原文完全无法覆盖问题，请说"暂未检索到相关政策"，并引导拨打 020-12345 咨询；`,
    `- 多份原文条件不一致时，以广州市/天河区本地政策为准，广东省/国家政策作补充并说明差异；`,
    `- 若原文缺少回答本题必需的具体信息（材料清单、办理时限、咨询电话等），请在回答末尾单独另起一行输出：【信息不足】+ 缺什么；原文足够则不要输出该行。`,
  ].join('\n\n')
}

// ---------- 5. 大模型生成 ----------

async function chatCompletion(baseURL, apiKey, model, messages) {
  const resp = await axios.post(
    `${baseURL}/chat/completions`,
    {
      model,
      messages,
      temperature: 0.3,
      max_tokens: MAX_TOKENS,
    },
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 60000,
    }
  )
  const content = resp.data && resp.data.choices && resp.data.choices[0]
    ? resp.data.choices[0].message && resp.data.choices[0].message.content
    : null
  if (!content) {
    throw new Error('模型返回为空（resp: ' + JSON.stringify(resp.data).slice(0, 200) + '）')
  }
  return content.trim()
}

async function generateWithZhipu(messages) {
  // 主力：推理模型 glm-4.7-flash（慢但准）；失败降级：glm-4-flash（快）
  const models = [ZHIPU_MODEL_MAIN, ZHIPU_MODEL_FAST]
  let lastErr = null
  for (const model of models) {
    try {
      return await chatCompletion(ZHIPU_BASE_URL, ZHIPU_API_KEY, model, messages)
    } catch (e) {
      lastErr = e
      console.log(`[zhipu] ${model} 失败: ${e.message}`)
    }
  }
  throw lastErr
}

async function generateWithSensenova(messages) {
  // 主力网关：随机挑一个 key，主用 glm-5.2（质量好），失败换 deepseek-v4-flash
  if (!SENSENOVA_BASE_URL || !SENSENOVA_KEYS.length) throw new Error('SENSENOVA 未配置')
  const shuffled = SENSENOVA_KEYS.slice().sort(() => Math.random() - 0.5)
  const models = [SENSENOVA_MODEL_GLM, SENSENOVA_MODEL_DEEPSEEK]
  let lastErr = null
  for (const key of shuffled) {
    for (const model of models) {
      try {
        return await chatCompletion(SENSENOVA_BASE_URL, key, model, messages)
      } catch (e) {
        lastErr = e
        console.log(`[sensenova] ${model} 失败: ${e.message}`)
      }
    }
  }
  throw lastErr
}

// 按主备顺序调度：跳过处于熔断期的 provider；全部熔断时强制重试主力，避免无人可用
async function generateWithProvider(messages) {
  let order = PROVIDER_ORDER.filter((name) => !isProviderBlocked(name))
  if (!order.length) order = [PRIMARY_PROVIDER]

  let lastErr = null
  for (const name of order) {
    try {
      const answer =
        name === 'sensenova'
          ? await generateWithSensenova(messages)
          : await generateWithZhipu(messages)
      markProviderSuccess(name)
      return answer
    } catch (e) {
      lastErr = e
      markProviderFailure(name)
      console.log(`[switch] ${name} 本次失败: ${e.message}`)
    }
  }
  throw lastErr
}

// ---------- 6. 存历史（尽力而为，失败不影响主流程） ----------

async function saveHistorySafe(openid, question, answer, sources) {
  try {
    await db.collection('conversations').add({
      data: {
        _openid: openid,
        question,
        answer,
        sources,
        createdAt: db.serverDate(),
      },
    })
  } catch (e) {
    console.log('saveHistory 失败（忽略）: ' + e.message)
  }
}

// ---------- 7. 联网搜索补充（博查） ----------

// 博查搜索：返回官方优先的结果（gov.cn 排前，非官方最多 2 条作补充）。
// 只用返回的 summary+snippet，不抓正文（博查摘要已足够详实，且避免被政府站反爬拦截）。
// 结果排序（本地优先，避免混入泉州/闽清等其他省市的内容）：
// 0=广州/天河 gov.cn 官网；1=广州/天河 非官网；2=其他省市 gov.cn（作最后补充）；3=无关 → 丢弃
function localScore(r) {
  const text = `${r.name || ''} ${r.snippet || ''} ${r.summary || ''}`
  const url = r.url || ''
  const isGov = url.includes('gov.cn')
  const local =
    /广州|天河|广东|广州市|天河区|guangdong/.test(text) ||
    /(gz|tianhe|thnet|gd)\.gov\.cn/.test(url)
  if (isGov && local) return 0
  if (!isGov && local) return 1
  if (isGov) return 2
  return 3
}

// 把"缺什么"映射成更利于检索官方资料的关键词
function mapHintToQuery(hint) {
  if (!hint) return ''
  if (/材料|证件|证明|资料|证件照/.test(hint)) return '申请材料 需要什么材料'
  if (/电话|咨询|联系/.test(hint)) return '咨询电话 联系方式'
  if (/流程|怎么办|办理|步骤/.test(hint)) return '办理流程 怎么申请'
  if (/条件|资格|要求/.test(hint)) return '申请条件 需要什么条件'
  return '官方 政策 指南'
}

// 一次博查查询，返回已按本地优先排序的结果。超时 8s，防止拖垮云函数 60s 上限。
async function searchOnce(query) {
  const resp = await axios.post(
    BOCHA_SEARCH_URL,
    { query, summary: true, count: 8 },
    { headers: { Authorization: `Bearer ${BOCHA_API_KEY}` }, timeout: 8000 }
  )
  const web = resp.data && resp.data.data && resp.data.data.webPages
  if (!web || !web.value) return []
  return web.value
    .map((r) => ({ r, s: localScore(r) }))
    .filter((x) => x.s <= 2)
    .sort((a, b) => a.s - b.s)
    .slice(0, 4)
    .map((x) => x.r)
}

// 多查询合并检索：用 2 个带"广州天河区"前缀的句式，并行执行，提高命中本地官方来源的概率
async function searchWeb(question, hint) {
  if (!BOCHA_API_KEY || !question) return []
  const q = (question || '').replace(/\s+/g, ' ').slice(0, 30)
  const mapped = mapHintToQuery(hint)
  const queries = mapped
    ? [`广州天河区 ${q} ${mapped}`, `${q} ${mapped} 官方 政策`]
    : [`广州天河区 ${q}`, `${q} 天河区 官方 政策`]
  const settled = await Promise.allSettled(queries.map((query) => searchOnce(query)))
  const seen = {}
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue
    for (const item of r.value) {
      if (!seen[item.url]) seen[item.url] = item
    }
  }
  return Object.values(seen)
    .map((r) => ({ r, s: localScore(r) }))
    .sort((a, b) => a.s - b.s)
    .slice(0, 4)
    .map((r) => ({
      title: r.name || '',
      url: r.url || '',
      siteName: r.siteName || '',
      isGov: (r.url || '').includes('gov.cn'),
      snippet: r.snippet || '',
      summary: r.summary || '',
      _text: `${r.summary || ''}\n${r.snippet || ''}`.trim(),
    }))
}

function buildSupplement(webResults) {
  const head =
    '【网络检索补充资料】（系统联网检索而来，仅供参考；gov.cn 官网优先，其余来源需谨慎）'
  const items = webResults.map((r, i) => {
    const tag = r.isGov ? '【官方来源】' : '【其他来源】'
    return (
      `【检索结果${i + 1}】${tag}\n` +
      `标题：${r.title}\n` +
      `网址：${r.url}\n` +
      `来源：${r.siteName}\n` +
      `内容摘要：\n${(r._text || '').slice(0, 900)}`
    )
  })
  return `${head}\n\n${items.join('\n\n')}`
}

function webSources(webResults) {
  return webResults.slice(0, 3).map((r) => ({
    title: r.title,
    doc_no: '',
    source: r.isGov ? '网络检索·' + (r.siteName || '政府官网') : '网络检索（非官方，仅供参考）·' + (r.siteName || '网络'),
    source_url: r.url,
    phone: '',
  }))
}

function stripMarker(s) {
  return (s || '')
    .split('\n')
    .filter((l) => !l.includes(MISSING_MARKER))
    .join('\n')
    .trim()
}

// 从标记行后面提取"缺什么"（如：【信息不足】缺材料清单 → 返回"缺材料清单"），用于更精准的补充搜索
function parseMissingHint(answer) {
  const idx = (answer || '').indexOf(MISSING_MARKER)
  if (idx === -1) return ''
  return (answer.slice(idx + MISSING_MARKER.length, idx + MISSING_MARKER.length + 40) || '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
}

// ---------- 主入口 ----------

exports.main = async (event) => {
  const question = (event && event.question ? String(event.question) : '').trim()
  if (!question) {
    return { ok: false, error: '缺少问题：请传入 question 字段' }
  }
  if (question.length > 2000) {
    return { ok: false, error: '问题过长，请控制在 2000 字以内' }
  }

  try {
    const t0 = Date.now()
    const questionVec = await getEmbedding(question)
    const hits = await retrieve(questionVec, question)

    const topScore = hits.length ? hits[0].score : 0
    console.log(`[score] 问题="${question.slice(0, 30)}" top1=${topScore.toFixed(3)} hits=${hits.length}`)

    // 联网搜索与主流程并行启动（用于"原文信息不足"或"无匹配"兜底；未配 key 时立即返回空）
    const webPromise = searchWeb(question).catch(() => [])

    // 无本地匹配兜底：先试着联网搜官方/权威来源，搜到就用它答；联网也没有再引导 12345
    if (!hits.length || topScore < MIN_SCORE) {
      const webResults = await webPromise
      if (webResults.length) {
        try {
          const supplement = buildSupplement(webResults)
          const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content:
                `【政策资料（联网检索的官方/权威来源，非本地知识库）】\n${supplement}\n\n` +
                `【用户问题】\n${question}\n\n` +
                `请依据上面的检索资料回答；若资料仍不足以回答，请明确告知"暂未检索到相关政策"，并引导拨打 020-12345。`,
            },
          ]
          const answer = stripMarker(await generateWithProvider(messages))
          const sources = webSources(webResults)
          const wxContext = cloud.getWXContext()
          await saveHistorySafe(wxContext.OPENID || '', question, answer, sources)
          return { ok: true, answer, sources, hits: sources }
        } catch (e) {
          console.log('[bocha] 联网兜底回答失败，退回 12345: ' + e.message)
        }
      }
      const answer =
        '暂时没检索到与您的问题直接相关的天河区政策。\n\n' +
        '建议您拨打广州政务服务热线 **020-12345** 咨询，或换个说法再问一次（例如直接说出政策名称，如"公租房""积分入学"）。'
      const wxContext = cloud.getWXContext()
      await saveHistorySafe(wxContext.OPENID || '', question, answer, [])
      return { ok: true, answer, sources: [], hits: [] }
    }

    const dbUserContent = buildPrompt(question, hits)
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: dbUserContent },
    ]

    // 首答与联网检索并行；命中【信息不足】标记且有检索结果 → 拼接补充资料后重答一次
    const [firstAnswer, webResults] = await Promise.all([
      generateWithProvider(messages),
      webPromise,
    ])

    let answer = firstAnswer
    let extraSources = []
    if (answer.includes(MISSING_MARKER)) {
      // 优先用首答时并行的检索结果；若为空再补一次定向检索（快速超时）
      let supplementResults = webResults
      if (!supplementResults.length) {
        const hint = parseMissingHint(answer)
        supplementResults = hint ? await searchWeb(question, hint).catch(() => []) : []
      }
      if (supplementResults.length && Date.now() - t0 < 40000) {
        try {
          const retryMessages = [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content:
                `之前的回答（已去掉【信息不足】标记）：\n${stripMarker(firstAnswer)}\n\n` +
                `${buildSupplement(supplementResults)}\n\n` +
                `【用户问题】\n${question}\n\n` +
                `请只用一小段话，补充之前缺失的具体信息（材料清单/咨询电话/办理时限等），依据上面的网络检索补充资料作答；不要重复已回答的内容，不要用五段结构。若补充资料也没有相关内容，就写"官方原文未提及，建议拨打020-12345咨询"。`,
            },
          ]
          const supplement = stripMarker(await generateWithProvider(retryMessages))
          answer = stripMarker(firstAnswer) + '\n\n**联网补充**\n' + supplement
          extraSources = webSources(supplementResults)
        } catch (e) {
          console.log('[retry] 联网补充失败，退回首答: ' + e.message)
          answer = stripMarker(firstAnswer)
        }
      } else {
        answer = stripMarker(answer)
      }
    } else {
      answer = stripMarker(answer)
    }

    // 出处标注：优先官方原文（标题+文号+链接），无原文的条目退回条目自身信息；按标题去重（同一细则可能被多条政策引用）
    const sources = []
    const seenTitles = new Set()
    for (const h of hits) {
      const docs = h.docs || []
      if (docs.length) {
        for (const d of docs) {
          if (seenTitles.has(d.title)) continue
          seenTitles.add(d.title)
          sources.push({
            title: d.title,
            doc_no: d.doc_no || '',
            source: d.source || '',
            source_url: d.source_url || '',
            phone: h.phone || '',
          })
        }
      } else {
        if (seenTitles.has(h.title)) continue
        seenTitles.add(h.title)
        sources.push({
          title: h.title,
          doc_no: '',
          source: h.remark || h.source || '',
          source_url: h.source_url || '',
          phone: h.phone || '',
        })
      }
    }
    // 追加联网检索到的补充出处（标为"网络检索"）
    for (const ws of extraSources) {
      if (seenTitles.has(ws.title)) continue
      seenTitles.add(ws.title)
      sources.push(ws)
    }

    const wxContext = cloud.getWXContext()
    await saveHistorySafe(wxContext.OPENID || '', question, answer, sources)

    return { ok: true, answer, sources, hits: sources }
  } catch (e) {
    console.error('ask 云函数异常: ', e)
    return {
      ok: false,
      error: '服务暂时不可用，请稍后再试',
      detail: String(e && e.message).slice(0, 300),
    }
  }
}
