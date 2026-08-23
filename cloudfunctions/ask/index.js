/**
 * AI政策通 · 核心问答云函数 `ask`
 *
 * 流程：
 *   用户提问 → （若为追问，自动合并上一轮问题）→ 问题转向量
 *   → 向量检索 Top4（政策库余弦相似度）
 *   → 按问题类型路由（内容/元数据/个人情形/单点事实/比较）选回答结构
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

// ---------- 0. 问题类型路由（问答智能化） ----------
// 同一套检索，但先判断"用户问的是哪类问题"，换不同的回答结构，避免所有问题一律套 5 段模板。
// 优先级：比较 > 元数据 > 个人情形 > 单点事实 > 内容（默认）。
// 纯正则判断，零额外模型调用、近零延迟。判定是否准确靠预览 Console 的 [ask] type= 日志核对。
function classifyQuestion(question) {
  const q = question || ''
  if (/区别|对比|有什么不同|哪个好|能同时|可以同时|同时.*吗/.test(q)) return 'compare'
  if (/文号|发文|发布|哪个部门|哪个局|哪个机关|实施|生效|有效|失效|有效期|截止|到期|什么时候开始(实施|生效|实行)|何时发布|原文|链接|网址|文件名称|文件名叫|被.*替代|有没有更新/.test(q)) return 'meta'
  // 个人情形只认"具体事实"（户籍/来穗/社保/孩子/爸妈/年龄/毕业/住地等），不认"我想了解一下"这类客套
  if (/我是.*户口|我.*户口|我有.*户口|我来广州|我住在|我住天河|我在广州|我在天河|我社保|我医保|我交满|我交了|我交够|我孩子|我小孩|我儿子|我女儿|我爸妈|我父母|我爸|我妈|我老公|我老婆|我今年|我年龄|我.*岁|我刚毕业|我今年毕业|我毕业|我目前|我现在|我家|老人家/.test(q)) return 'personal'
  if (/电话|联系方式|在哪|在哪里|哪个街道|哪个区|地址|材料|什么时候|多久|多长时间|时限|几天|流程|操作|步骤/.test(q)) return 'fact'
  return 'content'
}

const PROMPT_HEAD =
  '你是一名严谨的天河区政策咨询助手。请严格遵守以下规则：\n' +
  '1. 只能依据"官方原文"中给出的内容回答，不得编造、不得臆测、不得用自身知识补充政策细节。\n' +
  '2. 回答要通俗、分点、口语化，让普通居民一看就懂。\n'

// 规则 3：按问题类型换回答结构（规则 1/2/4-8 各类型共用）
const RULE3_CONTENT =
  '3. 回答按固定 5 段结构组织（小标题依次为：谁能办 / 要什么条件 / 怎么办 / 交什么材料 / 注意）。某段原文未提及时写"原文未提及"，不要编造；本次问题不涉及某段时写"本次问题不涉及"。\n'
const RULE3_META =
  '3. 用户询问的是政策文件本身的元数据（发文部门、文号、实施/生效日期、失效日期、有效期、原文链接、文件名称、是否被新文件替代等），直接逐一回答这些问题；原文未收录的信息如实写"未收录"，不得编造文号或日期，不要套用 5 段结构。\n'
const RULE3_PERSONAL =
  '3. 用户提供了自身具体情况（如户籍、来穗年限、社保、年龄、子女情况等），请逐条对照官方原文判断：① 明确符合条件的信息→明确说"你符合"并引用原文依据；② 原文未写明、无法替他确认的信息→明确说"这一条原文未明确，建议向 020-12345 或相关部门确认"，不要替用户下结论；③ 明显不符合→明确告知差在哪一项。判断之后用简短一段补充"怎么办 / 要什么材料"的要点即可，不要重复整篇政策的完整 5 段结构。\n'
const RULE3_FACT =
  '3. 用户只询问单一信息点（咨询电话、办理地点、所需材料、办理时限等），用一两句话直接给出，不要展开成 5 段结构。\n'
const RULE3_COMPARE =
  '3. 用户询问两项政策/两种方式之间的区别、或能否同时享受，用对比形式分点回答：相同点、不同点（或能否同时）、各自向谁申请。\n'

const PROMPT_TAIL =
  '4. 每次回答末尾列出引用出处（官方原文的标题 + 文号）。\n' +
  '5. 若官方原文中没有任何可参考内容，请明确告知"暂未检索到相关政策"，并引导拨打 020-12345（广州政务热线）咨询，不要强行编造答案。\n' +
  '6. 涉及具体金额、年限、条件时，说明"以最新官方公告为准"。\n' +
  '7. 若命中多份政策原文且条件不一致，以广州市/天河区本地的政策为准作为主答案，广东省/国家层面的政策只作为补充参考，并明确指出两者的差异，避免让用户困惑。\n' +
  '8. 若官方原文缺少回答本题所必需的具体信息（如材料清单、办理时限、咨询电话、办理地点等），在回答的最末尾单独另起一行输出：【信息不足】+ 简要说明缺了什么。若原文已足够作答，则绝不要输出这一行。\n' +
  '9. 若问题明显针对某一特定政策或特定人群（如含"港澳"就用港澳随迁子女指引、含"积分入学"就用积分入学政策、含"公租房"就用公租房政策），必须以该特定政策为主要依据；不要用一般性政策（如"人户一致"公办入学）替代或抢占特定政策的回答位置。'

const TYPE_PROMPTS = {
  content: PROMPT_HEAD + RULE3_CONTENT + PROMPT_TAIL,
  meta: PROMPT_HEAD + RULE3_META + PROMPT_TAIL,
  personal: PROMPT_HEAD + RULE3_PERSONAL + PROMPT_TAIL,
  fact: PROMPT_HEAD + RULE3_FACT + PROMPT_TAIL,
  compare: PROMPT_HEAD + RULE3_COMPARE + PROMPT_TAIL,
}

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

// 关键词加权：问题文本命中政策 keywords 越多越偏向该政策。
// 修掉"港澳子女怎么入学"被一般性"人户一致"带偏——港澳政策 keywords 命中 2 个，人户一致只命中 1 个，加权后主命中明确是港澳。
function keywordBoost(question, policy) {
  const q = question || ''
  const kws = policy.keywords || []
  if (!kws.length) return 1
  let matched = 0
  for (const kw of kws) {
    if (kw && q.includes(kw)) matched++
  }
  return matched ? 1 + Math.min(matched, 3) * 0.15 : 1
}

async function retrieve(questionVec, questionText) {
  const policies = await loadAllPolicies()
  const scored = policies
    .map((p) => {
      const v = p.vector || []
      if (!v.length) return { policy: p, score: 0 }
      return { policy: p, score: cosineSimilarity(questionVec, v) * keywordBoost(questionText, p) }
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

// 用户消息里的"回答结构"那一行，按问题类型切换（与 TYPE_PROMPTS 规则 3 对应）
function structureLine(type) {
  switch (type) {
    case 'meta':
      return '- 只回答文件元数据（部门/文号/日期/原文链接/是否被替代），原文未收录的写"未收录"，不要套用 5 段结构；'
    case 'personal':
      return '- 先逐条对照用户自身情况判断（符合 / 原文未明确需确认 / 不符合差在哪），再简短补充"怎么办 / 要什么材料"要点，不要重复整篇 5 段结构；'
    case 'fact':
      return '- 只直接回答该单一信息点（电话/地点/材料/时限），一两句话即可，不要展开；'
    case 'compare':
      return '- 用对比形式回答：相同点、不同点（或能否同时）、各自向谁申请；'
    default:
      return '- 按 5 段结构组织，小标题依次为：谁能办 / 要什么条件 / 怎么办 / 交什么材料 / 注意；原文未提的写"原文未提及"，本次问题不涉及的写"本次问题不涉及"；'
  }
}

function buildPrompt(question, hits, type) {
  const parts = []
  let docIndex = 0
  const blockFor = (h, label) => {
    const docs = h.docs || []
    const head = [`【政策条目·${label}】\n标题：${h.title}`]
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
    return block.join('\n\n')
  }
  // 主依据 = 检索得分最高的一条，回答以它为准；其余是次要参考，只作补充，避免被一般性政策带偏
  if (hits.length) parts.push(blockFor(hits[0], '主依据'))
  for (let i = 1; i < hits.length; i++) parts.push(blockFor(hits[i], '次要参考'))
  return [
    `【政策资料】"主依据"是回答最主要的事实来源，请以它为准；"次要参考"仅当主依据信息不足时补充使用，不要用次要参考替换或抢占主依据的位置。\n${parts.join('\n\n')}`,
    `【用户问题】\n${question}`,
    `请根据上面的官方原文回答用户问题，注意：`,
    `- 只能依据官方原文中的内容回答；原文未提及的，不要推测；`,
    `- 回答要通俗、分点、口语化；`,
    structureLine(type),
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

async function generateWithZhipu(messages, fast) {
  // 主力：推理模型 glm-4.7-flash（慢但准）；失败降级：glm-4-flash（快）。fast=true 只走快模型（用于联网补充等二次生成，压缩耗时）
  const models = fast ? [ZHIPU_MODEL_FAST] : [ZHIPU_MODEL_MAIN, ZHIPU_MODEL_FAST]
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

async function generateWithSensenova(messages, fast) {
  // 主力网关：随机挑一个 key，主用 glm-5.2（质量好），失败换 deepseek-v4-flash。fast=true 只走 deepseek-v4-flash
  if (!SENSENOVA_BASE_URL || !SENSENOVA_KEYS.length) throw new Error('SENSENOVA 未配置')
  const shuffled = SENSENOVA_KEYS.slice().sort(() => Math.random() - 0.5)
  const models = fast ? [SENSENOVA_MODEL_DEEPSEEK] : [SENSENOVA_MODEL_GLM, SENSENOVA_MODEL_DEEPSEEK]
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

// 按主备顺序调度：跳过处于熔断期的 provider；全部熔断时强制重试主力，避免无人可用。
// fast=true 时只走各 provider 的快模型（用于联网补充/重答等二次生成，压缩总耗时）。
async function generateWithProvider(messages, fast) {
  let order = PROVIDER_ORDER.filter((name) => !isProviderBlocked(name))
  if (!order.length) order = [PRIMARY_PROVIDER]

  let lastErr = null
  for (const name of order) {
    try {
      const answer =
        name === 'sensenova'
          ? await generateWithSensenova(messages, fast)
          : await generateWithZhipu(messages, fast)
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

// ---------- 6.5 多轮追问上下文 ----------

// 读该用户最近 N 轮对话（时间正序）。不用 orderBy（避免去控制台建索引），取回后内存里按时间排序。
async function loadRecentHistory(openid, limit = 2) {
  if (!openid) return []
  try {
    const res = await db.collection('conversations').where({ _openid: openid }).limit(20).get()
    const rows = (res.data || []).slice()
    rows.sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt || 0).getTime()
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt || 0).getTime()
      return ta - tb
    })
    return rows.slice(-limit)
  } catch (e) {
    console.log('loadRecentHistory 失败（忽略）: ' + e.message)
    return []
  }
}

// 追问判定：短句（≤15 字）+ 强指代/承接词（那/这/它/上面/刚才/然后/具体/呢等）→ 大概率是接着上一轮问。
// 只认强指代信号，避免把"咨询电话是多少""我想了解一下积分入学"这类独立问题误判成追问。
function isFollowUp(q) {
  const s = (q || '').trim()
  if (!s || s.length > 15) return false
  return /那|这|它|上面|刚才|之前|然后|还有|具体|呢/.test(s)
}

// ---------- 6.6 通用常识问答（纯规则，零检索、零联网） ----------
// 只对"本地无政策命中"的泛泛问题生效（点名具体政策的问题有本地命中，走正常 RAG）。
// 目的：避免"咨询电话是多少"这类问题走联网拿一堆无关出处，直接给稳妥的通用答复。
const GENERIC_QA = [
  {
    re: /(咨询|政务|服务|联系).{0,4}(电话|热线|联系方式)|电话.{0,4}(是多少|多少)|怎么联系|如何联系/,
    answer:
      '广州政务服务热线是 **020-12345**（广州市统一的政务咨询电话），天河区的政策咨询一般都可以先打这个电话，工作人员会根据您的问题转接到对应部门。\n\n' +
      '如果您想问的是某个具体政策（如"公租房""积分入学"）的咨询电话，请把政策名称告诉我，我直接帮您查。',
  },
  {
    re: /(在哪|在哪里|去哪|哪个地方|什么地方|地址).{0,6}(办|办理|申请|领)|(办|办理|申请|领).{0,4}(在哪|在哪里|去哪|哪个地方|什么地方)/,
    answer:
      '办理地点取决于具体政策：有的在线上就能办（如"穗好办""粤省事"小程序），有的需要到**天河区政务服务中心**或所在街道的政务服务中心现场办理。\n\n' +
      '请把政策名称告诉我（如"公租房""积分入学"），我帮您查具体的办理地点和渠道；或拨打广州政务服务热线 **020-12345** 咨询。',
  },
]

function matchGenericQA(question) {
  const q = (question || '').trim()
  // "12345" 泛问：只当整句很短（≤12 字）且含热线号时接管，避免误伤"公积金有 12345 元"这类含数字长句
  if (q.length <= 12 && /1\s*2\s*3\s*4\s*5/.test(q)) return GENERIC_QA[0].answer
  for (const g of GENERIC_QA) {
    if (g.re.test(q)) return g.answer
  }
  return ''
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

// 联网结果是否可作为出处：有标题 + 有网址即可（前端展示为可点击链接，用户自己核实）。
// 站点名可空——空时标"网络检索（非官方，仅供参考）"，但不该因此把真实链接丢掉。
// "没政策的答案不带出处"由各分支的 noPolicy/hardGap 判断兜底，不靠这里过滤。
function isCiteable(r) {
  return !!(r.url && r.title)
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
  return webResults.filter(isCiteable).slice(0, 3).map((r) => ({
    title: r.title,
    doc_no: '',
    source: r.isGov
      ? '网络检索·' + (r.siteName || '政府官网')
      : '网络检索（非官方，仅供参考）' + (r.siteName ? '·' + r.siteName : ''),
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

// 首答是否"硬缺口"：模型明确判"暂未检索到（…）相关政策" → 本地原文没答出来，需要用联网结果重答而不是拼接补充。
// 只匹配前缀"暂未检索到"，因为模型可能写成"暂未检索到关于「来穗人员」的相关政策"。
function isHardGap(s) {
  return /暂未检索到/.test(s || '')
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
    const type = classifyQuestion(question)
    console.log(`[ask] type=${type} 问题="${question.slice(0, 30)}"`)

    // 多轮追问：上一轮有对话 + 当前问题是短句带指代/承接词（如"那材料呢"）→ 合并上一轮问题再检索，
    // 让追问能接到上文的政策话题，而不是当成无头问题重新搜。前端无需改动。
    const openid = cloud.getWXContext().OPENID || ''
    const recent = await loadRecentHistory(openid, 2)
    const prev = recent.length ? recent[recent.length - 1] : null
    const followUp = !!(prev && isFollowUp(question))
    let searchText = question
    if (followUp) {
      searchText = `${prev.question} ${question}`
      console.log(`[ask] 追问：合并上一轮 → "${searchText.slice(0, 40)}"`)
    }

    const questionVec = await getEmbedding(searchText)
    const hits = await retrieve(questionVec, searchText)

    const topScore = hits.length ? hits[0].score : 0
    console.log(`[score] 问题="${question.slice(0, 30)}" top1=${topScore.toFixed(3)} hits=${hits.length}`)

    // 联网搜索与主流程并行启动（用于"原文信息不足"或"无匹配"兜底；未配 key 时立即返回空）
    const webPromise = searchWeb(searchText).catch(() => [])

    // 无本地匹配兜底：① 通用常识直接答（纯规则，避免泛泛问题走联网拿无关出处）；
    // ② 联网搜官方/权威来源作答，但只有真实可引用的来源才作为出处展示；
    // ③ 回答仍判"没政策"或联网全是垃圾 → 不附出处，引导 12345。
    if (!hits.length || topScore < MIN_SCORE) {
      const generic = matchGenericQA(question)
      if (generic) {
        await saveHistorySafe(openid, question, generic, [])
        return { ok: true, answer: generic, sources: [], hits: [] }
      }

      const webResults = await webPromise
      if (webResults.length) {
        try {
          const usable = webResults.filter(isCiteable)
          // 生成时尽量喂真实来源；若全是垃圾，仍用全部结果尝试（模型会自行判断并给澄清/引导）
          const feed = usable.length ? usable : webResults
          const supplement = buildSupplement(feed)
          const messages = [
            { role: 'system', content: TYPE_PROMPTS[type] },
            {
              role: 'user',
              content:
                `【政策资料（联网检索的官方/权威来源，非本地知识库）】\n${supplement}\n\n` +
                `【用户问题】\n${searchText}\n\n` +
                `请依据上面的检索资料回答；若资料仍不足以回答，请明确告知"暂未检索到相关政策"，并引导拨打 020-12345。`,
            },
          ]
          const answer = stripMarker(await generateWithProvider(messages))
          // 回答仍判"没政策"时不要附无关出处；只有真用了网页内容答出实质答案才给出处
          const noPolicy = /暂未检索到相关政策/.test(answer)
          const sources = noPolicy ? [] : webSources(feed)
          await saveHistorySafe(openid, question, answer, sources)
          return { ok: true, answer, sources, hits: sources }
        } catch (e) {
          console.log('[bocha] 联网兜底回答失败，退回 12345: ' + e.message)
        }
      }
      const answer =
        '暂时没检索到与您的问题直接相关的天河区政策。\n\n' +
        '建议您拨打广州政务服务热线 **020-12345** 咨询，或换个说法再问一次（例如直接说出政策名称，如"公租房""积分入学"）。'
      await saveHistorySafe(openid, question, answer, [])
      return { ok: true, answer, sources: [], hits: [] }
    }

    let dbUserContent = buildPrompt(question, hits, type)
    // 追问时带上上一轮问答，让模型明白"那材料呢"指代上一轮讨论的政策话题
    if (followUp && prev) {
      dbUserContent =
        `【对话上下文（上一轮）】\n用户：${(prev.question || '').slice(0, 200)}\n` +
        `助手：${(prev.answer || '').slice(0, 400)}\n\n` +
        `（当前问题若指代上文内容，请结合上文与本次检索到的政策资料回答；"主依据"仍以本次检索到的政策为准）\n\n` +
        dbUserContent
    }
    const messages = [
      { role: 'system', content: TYPE_PROMPTS[type] },
      { role: 'user', content: dbUserContent },
    ]

    // 首答与联网检索并行。本地原文没答出来时（命中【信息不足】标记 / 模型判"暂未检索到相关政策" /
    // 5 段里 ≥4 段"原文未提及"），用联网结果补/重答：硬缺口用联网重答，其余拼接补充。
    const [firstAnswer, webResults] = await Promise.all([
      generateWithProvider(messages),
      webPromise,
    ])

    let answer = firstAnswer
    let extraSources = []
    const missCount = (answer.match(/原文未提及/g) || []).length
    const hardGap = isHardGap(answer)
    // 硬缺口（模型明确说没政策）时出处置换为联网来源，不再展示"原文均未提及"的本地出处
    const webOnly = hardGap
    const needsWeb = answer.includes(MISSING_MARKER) || hardGap || missCount >= 4
    if (needsWeb) {
      // 优先用首答时并行的检索结果；为空再补一次定向检索（快速超时）
      let supplementResults = webResults
      if (!supplementResults.length) {
        const hint = parseMissingHint(answer)
        supplementResults = hint
          ? await searchWeb(searchText, hint).catch(() => [])
          : await searchWeb(searchText).catch(() => [])
      }
      const usable = supplementResults.filter(isCiteable)
      const feed = usable.length ? usable : supplementResults
      // 二次生成用快模型（deepseek-v4-flash / glm-4-flash），且必须在 30s 内开始，避免两次调用加起来超前端等待
      if (feed.length && Date.now() - t0 < 30000) {
        try {
          const retryMessages = [
            { role: 'system', content: TYPE_PROMPTS[type] },
            {
              role: 'user',
              content:
                `之前的回答：\n${stripMarker(firstAnswer)}\n\n` +
                `【补充资料】\n${buildSupplement(feed)}\n\n` +
                `【用户问题】\n${question}\n\n` +
                (hardGap
                  ? `请根据上面的【补充资料】重新回答用户问题，把之前没答出来的信息（政策定义/认定标准、申请材料、咨询电话、办理时限等）讲清楚。要求：\n` +
                    `- 用正常、清楚的书面语言直接给出可用的回答，不要出现"联网补充""网络检索""原文未提及""暂未检索到相关政策"这类内部说法；\n` +
                    `- 补充资料里有官方信息的，直接写"根据官方信息，……"；\n` +
                    `- 补充资料里确实没提到的，写"具体细节建议拨打 020-12345 确认"。`
                  : `请接着上面的回答，把之前缺失的具体信息（如申请材料、咨询电话、办理时限等）补充清楚。要求：\n` +
                    `- 用正常、清楚的书面语言作答，不要出现"联网补充""网络检索""官方原文未提及"这类内部说法；\n` +
                    `- 补充资料里有官方信息的，直接写"根据官网信息，需要……"；\n` +
                    `- 补充资料里确实没提到的，写"具体细节建议拨打 020-12345 确认"；\n` +
                    `- 用一小段话补充即可，不要重复前面已回答的内容。`),
            },
          ]
          const retried = stripMarker(await generateWithProvider(retryMessages, true))
          console.log(`[retry] 联网${hardGap ? '重答' : '补充'}完成，总耗时 ${Date.now() - t0}ms`)
          if (hardGap) {
            // 硬缺口：重答有新内容才替换；重答仍没答出来 → 保持首答，交给下方兜底
            answer = isHardGap(retried) ? stripMarker(firstAnswer) : retried
            if (!isHardGap(answer)) extraSources = webSources(feed)
          } else {
            answer = stripMarker(firstAnswer) + '\n\n' + retried
            extraSources = webSources(feed)
          }
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

    // 兜底：重答/首答后仍明确"没政策" → 给诚实引导，不带出处
    if (isHardGap(answer)) {
      answer =
        '暂时没检索到与您的问题直接相关的天河区政策。\n\n' +
        '建议您拨打广州政务服务热线 **020-12345** 咨询，或换个说法再问一次（例如直接说出政策名称，如"公租房""积分入学"）。'
      extraSources = []
    }

    // 出处标注：优先官方原文（标题+文号+链接），无原文的条目退回条目自身信息；按标题去重（同一细则可能被多条政策引用）。
    // 硬缺口（本地原文被判"未提及"）时出处置换为联网来源，不展示本地出处。
    const sources = []
    const seenTitles = new Set()
    if (!webOnly) {
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
    }
    // 追加联网检索到的补充出处（标为"网络检索"）
    for (const ws of extraSources) {
      if (seenTitles.has(ws.title)) continue
      seenTitles.add(ws.title)
      sources.push(ws)
    }

    await saveHistorySafe(openid, question, answer, sources)

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
