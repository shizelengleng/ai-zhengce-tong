/**
 * AI政策通 · 查询问答历史 `getHistory`
 *
 * 接口约定（与前端 api.js 一致）：输入 { limit? } → 输出 { ok, history: [...] }
 * history 每条：{ _id, question, answer, sources[], create_time }（mine 页用 question/create_time）
 * 说明：不使用 orderBy（避免去控制台建索引），改为拉取后按时间在函数内排序。
 */

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

// 云函数默认 UTC，转为北京时间显示：YYYY-MM-DD HH:mm
function fmtTime(d) {
  if (!d) return ''
  const t = d instanceof Date ? d : new Date(d)
  if (isNaN(t.getTime())) return String(d)
  const bj = new Date(t.getTime() + 8 * 3600 * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return (
    bj.getUTCFullYear() + '-' + p(bj.getUTCMonth() + 1) + '-' + p(bj.getUTCDate()) +
    ' ' + p(bj.getUTCHours()) + ':' + p(bj.getUTCMinutes())
  )
}

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
        sources: item.sources || item.hits || [],
        create_time: fmtTime(item.createdAt),
      }))

    return { ok: true, history: list }
  } catch (e) {
    console.error('getHistory 异常: ', e)
    return { ok: false, error: String(e && e.message).slice(0, 200) }
  }
}
