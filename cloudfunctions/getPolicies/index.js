/**
 * AI政策通 · 政策分类/详情云函数 `getPolicies`
 *
 * 调用方式（事件参数）：
 *   { category: 'education' }              → 返回该分类下的政策列表（不含 vector，省流量）
 *   { id: 'policy_id' }                    → 返回单条政策详情（含 vector 之外的完整字段）
 *   { }（什么都不传）                      → 返回 6 个分类及各自数量
 *
 * 分类代码：education 教育 / medical 医疗 / housing 住房
 *           employment 就业创业 / social_security 社保 / gov 政务办事
 */

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const CATEGORY_LABELS = {
  education: '教育入学',
  medical: '医疗保障',
  housing: '住房保障',
  employment: '就业创业',
  social_security: '社保服务',
  gov: '政务办事',
}

function stripVector(list) {
  return list.map(({ vector, ...rest }) => rest)
}

exports.main = async (event) => {
  try {
    const { category, id } = event || {}

    // 1. 按 id 取详情
    if (id) {
      const res = await db.collection('policies').doc(id).get()
      if (!res.data) return { ok: false, error: '未找到该政策' }
      const { vector, ...detail } = res.data
      return { ok: true, data: detail }
    }

    // 2. 按分类取列表
    if (category) {
      const res = await db.collection('policies').where({ category }).limit(100).get()
      return { ok: true, category, data: stripVector(res.data) }
    }

    // 3. 默认返回全部分类及数量
    const total = await db.collection('policies').count()
    const all = await db.collection('policies').field({ category: true }).limit(100).get()
    const countByCat = {}
    for (const item of all.data) {
      const c = item.category || 'other'
      countByCat[c] = (countByCat[c] || 0) + 1
    }
    const categories = Object.keys(CATEGORY_LABELS).map((code) => ({
      code,
      label: CATEGORY_LABELS[code],
      count: countByCat[code] || 0,
    }))
    return { ok: true, categories, total: total.total }
  } catch (e) {
    console.error('getPolicies 异常: ', e)
    return { ok: false, error: String(e && e.message).slice(0, 200) }
  }
}
