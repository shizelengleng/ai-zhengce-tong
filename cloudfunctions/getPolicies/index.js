/**
 * AI政策通 · 政策分类/详情云函数 `getPolicies`
 *
 * 接口约定（与前端 api.js 一致）：
 *   { category: 'education' }  → { ok: true, policies: [...] }   该分类下政策列表（不含 vector）
 *   { id: 'policy_id' }        → { ok: true, policies: [单条] }   政策详情
 *   { }（什么都不传）           → { ok: true, policies: [全部] }   详情页用它 + find 取单条
 *
 * 每条 policy 额外补充（来自关联 documents 原文，供详情页展示）：
 *   summary=plain_answer、source(发文机关)、source_url(出处链接)、doc_no(文号)
 *
 * 分类：education 教育 / medical 医疗 / housing 住房
 *        employment 就业创业 / social_security 社保 / welfare 救助福利
 *        elderly 社区养老 / gov 政务办事
 */

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

function stripVector(list) {
  return list.map(({ vector, ...rest }) => rest)
}

// 按 doc_ids 批量拉 documents，并给政策补展示字段（出处/链接/文号）
async function enrichPolicies(policies) {
  const docIds = []
  const idSet = new Set()
  for (const p of policies) {
    for (const did of p.doc_ids || []) {
      if (!idSet.has(did)) {
        idSet.add(did)
        docIds.push(did)
      }
    }
  }

  const docMap = {}
  if (docIds.length) {
    // documents.id 是 doc_5 这种业务 id（非 _id）
    const res = await db.collection('documents').where({ id: _.in(docIds) }).limit(100).get()
    for (const d of res.data) docMap[d.id] = d
  }

  return policies.map((p) => {
    const first = (p.doc_ids || []).map((id) => docMap[id]).find(Boolean)
    return {
      ...p,
      summary: p.plain_answer || p.summary || '',
      source: first ? first.source : '',
      source_url: first ? first.source_url : '',
      doc_no: first ? first.doc_no : '',
    }
  })
}

exports.main = async (event) => {
  try {
    const { category, id } = event || {}

    // 1. 按 id 取详情
    if (id) {
      const res = await db.collection('policies').doc(id).get()
      if (!res.data) return { ok: false, error: '未找到该政策' }
      const [enriched] = await enrichPolicies([res.data])
      return { ok: true, policies: [enriched] }
    }

    // 2. 按分类取列表
    if (category) {
      const res = await db.collection('policies').where({ category }).limit(100).get()
      const policies = await enrichPolicies(stripVector(res.data))
      return { ok: true, policies }
    }

    // 3. 默认返回全部
    const res = await db.collection('policies').limit(100).get()
    const policies = await enrichPolicies(stripVector(res.data))
    return { ok: true, policies }
  } catch (e) {
    console.error('getPolicies 异常: ', e)
    return { ok: false, error: String(e && e.message).slice(0, 200) }
  }
}
