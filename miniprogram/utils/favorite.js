// utils/favorite.js —— 政策收藏管理（本地存储）

const STORAGE_KEY = 'favoritePolicies'

/**
 * 获取收藏列表
 * @returns {Array} 收藏的政策列表
 */
function getList() {
  try {
    return wx.getStorageSync(STORAGE_KEY) || []
  } catch (e) {
    return []
  }
}

/**
 * 检查是否已收藏
 * @param {string} id - 政策ID
 * @returns {boolean}
 */
function isFavorite(id) {
  const list = getList()
  return list.some(item => String(item._id) === String(id))
}

/**
 * 添加收藏
 * @param {Object} policy - 政策对象
 */
function add(policy) {
  const list = getList()
  if (!list.some(item => String(item._id) === String(policy._id))) {
    list.unshift({
      _id: policy._id,
      title: policy.title,
      source: policy.source,
      category: policy.category,
      categoryName: policy.categoryName || '',
      summary: policy.summary || '',
      phone: policy.phone || '',
      venue: policy.venue || '',
      source_url: policy.source_url || '',
      add_time: new Date().toLocaleString('zh-CN')
    })
    wx.setStorageSync(STORAGE_KEY, list)
    return true
  }
  return false
}

/**
 * 取消收藏
 * @param {string} id - 政策ID
 */
function remove(id) {
  const list = getList()
  const newList = list.filter(item => String(item._id) !== String(id))
  wx.setStorageSync(STORAGE_KEY, newList)
  return newList
}

/**
 * 切换收藏状态
 * @param {Object} policy - 政策对象
 * @returns {boolean} 当前是否收藏
 */
function toggle(policy) {
  if (isFavorite(policy._id)) {
    remove(policy._id)
    return false
  } else {
    add(policy)
    return true
  }
}

/**
 * 获取收藏数量
 * @returns {number}
 */
function count() {
  return getList().length
}

module.exports = { getList, isFavorite, add, remove, toggle, count }
