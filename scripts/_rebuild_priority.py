# -*- coding: utf-8 -*-
"""一次性任务：把演示重点 10 篇的 original_text 从 policy_sources 完整正文重建，
写入 data/documents.json（数组，供参考）与 data/documents_import.json（JSONL，供云导入）。
"""
import re
import html as html_mod
import json
import io
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

SRC_DIR = 'docs/policy_sources'
DOCS_JSON = 'data/documents.json'
IMPORT_JSON = 'data/documents_import.json'

PRIORITY = {
    'doc_8':  ('03_港澳子女入学指引_2026.html', None),
    'doc_6':  ('02_积分入学指引_2026.html', None),
    'doc_1':  ('11_公共租赁住房保障办法_穗府办规2024-13号.html', '第一章'),
    'doc_2':  ('11b_2025年第一批户籍家庭公租房常态分配房源通告.html', None),
    'doc_3':  ('06_城乡居民医保集中参保缴费通告.html', None),
    'doc_17': ('16_一次性创业补贴_市人社局.html', None),
    'doc_13': ('12_天河人才公寓申请公告_2025.html', None),
    'doc_4':  ('34_电子居住证申领指南.html', None),
    'doc_36': ('36_积分制入户2025年度热点13问.html', '热点13问'),
    'doc_34': ('33_广州市老年人优待办法_政府令179号.html', '第一条'),
}

NAV_WORDS = [
    '首页', 'Home', 'About', 'E-services', 'Login', '无障碍', '长者助手', '繁体', '简体', 'English',
    'EN', '搜索热词', '网站支持', '政务公开', '政务服务', '互动交流', '政务动态', '魅力广州',
    '营商环境', '市民网页', '收藏', '分享', '字号', '打印', '关闭', '浏览量', '点击', '热门',
    '推荐', '上一篇', '下一篇', '音频解读', '一图读懂', '政策解读', '常见问题', '办事指南',
    '申请流程', '您当前所在', '当前位置', '网站地图', '联系我们', '设为首页', '版权', '主办',
    '承办', '技术支持', '备案', '友情链接', 'Copyright', 'window', 'function', 'script',
    '公告公示', 'Local News', 'Government Affairs', 'Business & Investment', 'Enquiries',
    'Government Agencies', '走进天河', '天河动态', 'About Tianhe', '工作机构', '在线咨询',
    '微博', '微信', '手机版', '手机端', '用户登录', '市民', '退出', '登录', '长者专区',
    '网站助手', '公安', '旧版网站', '温馨提示',
]

FOOTER_ONLY = ['粤ICP', '粤公网安备', '网站标识码', 'ICP备案', '备案序号', '扫一扫',
               '主办：', '承办：', 'Copyright', '保留所有权利', '公安备案']

META_PREFIX = ('时间：', '来源：', '发布日期：', '发表时间：', '更新时间：', '字体', '浏览',
               '信息来源', '文章来源', '录入时间', '发布者', '作者：')

DATE_LINE = re.compile(r'^\d{4}[-/]\d{1,2}[-/]\d{1,2}[ 0-9:]*$')


def is_nav(line):
    s = line.strip()
    if not s or len(s) <= 2:
        return True
    if len(s) <= 8:
        return True
    hits = sum(1 for w in NAV_WORDS if w in s)
    return len(s) <= 45 and hits >= 1


def clean_lines(path):
    raw = open(path, encoding='utf-8', errors='ignore').read()
    raw = re.sub(r'<script[\s\S]*?</script>', ' ', raw)
    raw = re.sub(r'<style[\s\S]*?</style>', ' ', raw)
    raw = re.sub(r'</(p|div|li|tr|h\d|br|td)>', '\n', raw)
    raw = re.sub(r'<(br|/br)[^>]*>', '\n', raw)
    raw = re.sub(r'<[^>]+>', ' ', raw)
    txt = html_mod.unescape(raw)
    lines = []
    for seg in txt.split('\n'):
        s = re.sub(r'\s+', ' ', seg).strip()
        s = re.sub(r'[ 　]+', ' ', s)
        if s and not is_nav(s):
            lines.append(s)
    return lines


def build_original(lines, anchor):
    if anchor:
        occ = [i for i, ln in enumerate(lines) if anchor in ln]
        if occ:
            best, best_score = occ[0], -1
            for i in occ:
                score = sum(1 for ln in lines[i + 1:] if len(ln) >= 20)
                if score > best_score:
                    best_score, best = score, i
            start = best + 1
        else:
            start = 0
    else:
        start = 0
    body = lines[start:]
    body = [ln for ln in body if not ln.startswith(META_PREFIX) and not DATE_LINE.match(ln)]
    cut = len(body)
    for i, ln in enumerate(body):
        if any(f in ln for f in FOOTER_ONLY):
            cut = i
            break
    body = body[:cut]
    while body and len(body[-1]) <= 8:
        body.pop()
    return '\n'.join(body).strip()


# 读现有 documents（数组）与导入文件（JSONL）
docs = json.load(open(DOCS_JSON, encoding='utf-8'))
by_id = {d['id']: d for d in docs}

import_lines = open(IMPORT_JSON, encoding='utf-8').read().strip().split('\n')
import_objs = {json.loads(l)['id']: json.loads(l) for l in import_lines if l.strip()}

changed = []
for doc_id, (fname, fallback) in PRIORITY.items():
    path = f'{SRC_DIR}/{fname}'
    lines = clean_lines(path)
    anchor = fallback or by_id[doc_id]['title']
    new_text = build_original(lines, anchor)
    old_len = len(by_id[doc_id].get('original_text') or '')
    by_id[doc_id]['original_text'] = new_text
    import_objs[doc_id]['original_text'] = new_text
    changed.append((doc_id, old_len, len(new_text)))

with open(DOCS_JSON, 'w', encoding='utf-8') as w:
    json.dump(docs, w, ensure_ascii=False, indent=2)

with open(IMPORT_JSON, 'w', encoding='utf-8') as w:
    w.write('\n'.join(json.dumps(import_objs[d['id']], ensure_ascii=False) for d in docs) + '\n')

print('重建完成，共更新 %d 篇：' % len(changed))
for doc_id, old, new in changed:
    print(f'  {doc_id}: {old}字 → {new}字')
