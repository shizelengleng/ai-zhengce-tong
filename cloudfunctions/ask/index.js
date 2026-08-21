/**
 * AI政策通 · 核心问答云函数 `ask`
 *
 * 流程：
 *   用户提问 → 问题转向量 → 向量检索 Top4（政策库余弦相似度）
 *   → 拼 Prompt → 智谱 GLM 生成 → 返回答案 + 出处 + 自动存历史
 *
 * 密钥全部从云开发控制台「环境变量」读取（process.env），
 * 仓库为公开仓库，代码中绝不硬编码任何 Key。
 *
 * 需要在云开发控制台为本函数配置的环境变量（与 .env 同名，值同）：
 *   EMBEDDING_BASE_URL, EMBEDDING_MODEL, EMBEDDING_DIM, DASHSCOPE_API_KEY,
 *   ZHIPU_BASE_URL, ZHIPU_MODEL_MAIN, ZHIPU_MODEL_FAST, ZHIPU_API_KEY,
 *   SENSENOVA_BASE_URL, SENSENOVA_KEYS, SENSENOVA_MODEL_DEEPSEEK, SENSENOVA_MODEL_GLM
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
const MAX_TOKENS = 2048      // 生成回答最大 token（glm-4.7-flash 推理型需 1024+）

const SYSTEM_PROMPT =
  '你是一名严谨的天河区政策咨询助手。请严格遵守以下规则：\n' +
  '1. 只能依据"官方原文"中给出的内容回答，不得编造、不得臆测、不得用自身知识补充政策细节。\n' +
  '2. 回答要通俗、分点、口语化，让普通居民一看就懂。\n' +
  '3. 每次回答末尾列出引用出处（官方原文的标题 + 文号）。\n' +
  '4. 若官方原文中没有任何可参考内容，请明确告知"暂未检索到相关政策"，并引导拨打 020-12345（广州政务热线）咨询，不要强行编造答案。\n' +
  '5. 涉及具体金额、年限、条件时，说明"以最新官方公告为准"。'

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
    `- 末尾列出引用出处（标题 + 文号）；`,
    `- 若原文完全无法覆盖问题，请说"暂未检索到相关政策"，并引导拨打 020-12345 咨询。`,
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
  // 兜底网关：随机挑一个 key，主用 deepseek-v4-flash，失败换 glm-5.2
  if (!SENSENOVA_BASE_URL || !SENSENOVA_KEYS.length) throw new Error('SENSENOVA 未配置')
  const shuffled = SENSENOVA_KEYS.slice().sort(() => Math.random() - 0.5)
  const models = [SENSENOVA_MODEL_DEEPSEEK, SENSENOVA_MODEL_GLM]
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
    const questionVec = await getEmbedding(question)
    const hits = await retrieve(questionVec, question)

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildPrompt(question, hits) },
    ]

    let answer
    try {
      answer = await generateWithZhipu(messages)
    } catch (e) {
      console.log('zhipu 全部失败，尝试 sensenova 兜底: ' + e.message)
      answer = await generateWithSensenova(messages)
    }

    // 出处标注：优先官方原文（标题+文号+链接），无原文的条目退回条目自身信息
    const sources = []
    for (const h of hits) {
      const docs = h.docs || []
      if (docs.length) {
        for (const d of docs) {
          sources.push({
            title: d.title,
            doc_no: d.doc_no || '',
            source: d.source || '',
            source_url: d.source_url || '',
            phone: h.phone || '',
          })
        }
      } else {
        sources.push({
          title: h.title,
          doc_no: '',
          source: h.remark || h.source || '',
          source_url: h.source_url || '',
          phone: h.phone || '',
        })
      }
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
