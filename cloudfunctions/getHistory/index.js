/**
 * AI政策通 · 查询问答历史 `getHistory`
 *
 * 事件参数：{ limit }（默认 20，最大 50）
 * 说明：不使用 orderBy（避免去控制台建索引），改为拉取后按时间在函数内排序。
 */

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event) => {
  const limit = Math.min(Number((event && event.limit) || 20) || 20, 50)

  try {
    const wxContext = cloud.getWXContext()
    const openid = wxContext.OPENID || ''

    // 先取数量，再分页拉取（单次最多 100）
    const total = await db.collection('conversations').where({ _openid: openid }).count()
    const count = total.total
    const batch = Math.min(count, 100)
    const res = await db
      .collection('conversations')
      .where({ _openid: openid })
      .limit(batch)
      .get()

    // 云数据库拿到的 _id 是 String，Date 类型字段可直接比较
    const list = res.data
      .filter((item) => item && item.question)
      .sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return tb - ta
      })
      .slice(0, limit)
      .map((item) => ({
        _id: item._id,
        question: item.question,
        answer: item.answer,
        hits: item.hits || [],
        createdAt: item.createdAt,
      }))

    return { ok: true, list }
  } catch (e) {
    console.error('getHistory 异常: ', e)
    return { ok: false, error: String(e && e.message).slice(0, 200) }
  }
}
