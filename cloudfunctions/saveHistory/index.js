/**
 * AI政策通 · 保存问答历史 `saveHistory`
 *
 * 独立云函数，供前端在「纯浏览」场景手动保存（ask 内部已自动保存，一般无需前端再调）。
 * 事件参数：{ question, answer, hits: [{title, source, source_url, phone}] }
 */

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event) => {
  const question = (event && event.question ? String(event.question) : '').trim()
  const answer = (event && event.answer ? String(event.answer) : '').trim()

  if (!question || !answer) {
    return { ok: false, error: '缺少 question 或 answer' }
  }

  try {
    const wxContext = cloud.getWXContext()
    const hits = Array.isArray(event.hits)
      ? event.hits.slice(0, 10).map((h) => ({
          title: String(h.title || ''),
          source: String(h.source || ''),
          source_url: String(h.source_url || ''),
          phone: String(h.phone || ''),
        }))
      : []

    await db.collection('conversations').add({
      data: {
        _openid: wxContext.OPENID || '',
        question,
        answer,
        hits,
        createdAt: db.serverDate(),
      },
    })

    return { ok: true }
  } catch (e) {
    console.error('saveHistory 异常: ', e)
    return { ok: false, error: String(e && e.message).slice(0, 200) }
  }
}
