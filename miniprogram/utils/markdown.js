// utils/markdown.js —— 轻量Markdown转HTML（用于rich-text渲染）

/**
 * 将Markdown文本转换为HTML字符串
 * 支持：加粗、斜体、行内代码、链接、无序列表、有序列表、换行、标题
 * @param {string} text - Markdown文本
 * @returns {string} HTML字符串
 */
function parse(text) {
  if (!text) return ''
  
  let html = text
  
  // 转义HTML特殊字符（先转义，避免XSS）
  html = html.replace(/&/g, '&amp;')
             .replace(/</g, '&lt;')
             .replace(/>/g, '&gt;')
  
  // 标题 ### → <h3>
  html = html.replace(/^### (.+)$/gm, '<h3 style="font-size:16px;font-weight:600;margin:12px 0 8px;color:#1A1A1A;">$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2 style="font-size:18px;font-weight:600;margin:14px 0 10px;color:#1A1A1A;">$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1 style="font-size:20px;font-weight:bold;margin:16px 0 12px;color:#1A1A1A;">$1</h1>')
  
  // 行内代码 `code` → <code>
  html = html.replace(/`([^`]+)`/g, '<code style="background:#F0F2F5;padding:2px 6px;border-radius:4px;font-size:13px;color:#1565C0;font-family:monospace;">$1</code>')
  
  // 加粗 **text** → <strong>
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong style="font-weight:600;color:#1A1A1A;">$1</strong>')
  
  // 斜体 *text* → <em>（注意不要和加粗冲突）
  html = html.replace(/\*([^*]+)\*/g, '<em style="font-style:italic;">$1</em>')
  
  // 链接 [text](url) → <a>
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#1E88E5;text-decoration:underline;">$1</a>')
  
  // 分割线 --- → <hr>
  html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #EEE;margin:16px 0;">')
  
  // 处理列表（需要逐行处理）
  const lines = html.split('\n')
  const result = []
  let inUl = false
  let inOl = false
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    
    // 无序列表 - 或 *
    if (/^[-*]\s+/.test(trimmed)) {
      if (!inUl) {
        if (inOl) { result.push('</ol>'); inOl = false }
        result.push('<ul style="margin:8px 0;padding-left:20px;">')
        inUl = true
      }
      result.push('<li style="margin:4px 0;line-height:1.6;">' + trimmed.replace(/^[-*]\s+/, '') + '</li>')
      continue
    }
    
    // 有序列表 1. 2. 等
    if (/^\d+\.\s+/.test(trimmed)) {
      if (!inOl) {
        if (inUl) { result.push('</ul>'); inUl = false }
        result.push('<ol style="margin:8px 0;padding-left:20px;">')
        inOl = true
      }
      result.push('<li style="margin:4px 0;line-height:1.6;">' + trimmed.replace(/^\d+\.\s+/, '') + '</li>')
      continue
    }
    
    // 普通行，关闭列表
    if (inUl) { result.push('</ul>'); inUl = false }
    if (inOl) { result.push('</ol>'); inOl = false }
    
    // 空行
    if (trimmed === '') {
      result.push('')
      continue
    }
    
    // 普通段落
    result.push('<p style="margin:6px 0;line-height:1.7;">' + line + '</p>')
  }
  
  if (inUl) result.push('</ul>')
  if (inOl) result.push('</ol>')
  
  html = result.join('\n')
  
  // 移除多余的空p标签
  html = html.replace(/<p style="margin:6px 0;line-height:1.7;"><\/p>/g, '')
  
  return html
}

module.exports = { parse }
