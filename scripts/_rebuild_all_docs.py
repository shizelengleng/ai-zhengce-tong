# -*- coding: utf-8 -*-
"""一次性任务：把全部 37 篇 documents 的 original_text 从 policy_sources 完整官方页面重建，
写入 data/documents.json（数组）与 data/documents_import.json（JSONL，供云导入）。
MAPPING：doc_id -> (源文件名, 备用锚点)。锚点用于定位正文起点，办法/条例类用"第一条/第一章"。
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
MAX_CHARS = 8000  # 单篇原文上限，防 Prompt 超长

# 全部 37 篇：doc_id -> (源文件, 备用锚点)。None 则用标题派生锚点。
MAPPING = {
    'doc_1':  ('11_公共租赁住房保障办法_穗府办规2024-13号.html', '第一章'),
    'doc_2':  ('11b_2025年第一批户籍家庭公租房常态分配房源通告.html', None),
    'doc_3':  ('06_城乡居民医保集中参保缴费通告.html', None),
    'doc_4':  ('34_电子居住证申领指南.html', None),
    'doc_5':  ('01b_天河招生细则新闻稿.html', None),
    'doc_6':  ('02_积分入学指引_2026.html', None),
    'doc_7':  ('05_幼儿园招生方案_2026.html', None),
    'doc_8':  ('03_港澳子女入学指引_2026.html', None),
    'doc_9':  ('07_异地就医备案_穗好办.html', None),
    'doc_10': ('08_家庭医生实施方案_穗卫函2023-1930号.html', None),
    'doc_11': ('09_生育津贴直接发放个人_2025.html', None),
    'doc_12': ('10_广东医保新措_大病保险门特结算.html', None),
    'doc_13': ('12_天河人才公寓申请公告_2025.html', None),
    'doc_14': ('13_户籍家庭住房保障通知_穗建规字2024-5号.html', None),
    'doc_15': ('14_房屋租赁登记备案攻略_天河.html', None),
    'doc_16': ('15_创业担保贷款常见问题_2025.html', None),
    'doc_17': ('16_一次性创业补贴_市人社局.html', None),
    'doc_18': ('17_天河港澳青年办法_穗天科工信规字2023-1号.html', None),
    'doc_19': ('18b_广东高校毕业生就业创业扶持政策清单_2026.html', None),
    'doc_20': ('19_广州失业保险常见问题解答_2025-11版.html', None),
    'doc_21': ('20_广州劳动仲裁网上申请流程_市人社局.html', None),
    'doc_22': ('21_灵活就业人员参加养老保险简介_市人社局.html', None),
    'doc_23': ('22_怎么申领广州市社会保障卡_2026.html', None),
    'doc_24': ('23_企业职工基本养老金申领详解_2025.html', None),
    'doc_25': ('24_养老保险待遇资格认证通告_2025.html', None),
    'doc_26': ('25_企业基本养老保险转移问答_2025.html', None),
    'doc_27': ('26_最低生活保障及相关社会救助标准通知_穗民规字2025-2号.html', None),
    'doc_28': ('27_残疾人两项补贴标准_2026.html', None),
    'doc_29': ('28_特困人员救助供养通知_穗府办规2021-7号.html', None),
    'doc_30': ('29_广州市临时救助实施细则_穗府办规2021-19号.html', None),
    'doc_31': ('30_老年人助餐配餐服务管理办法_穗民规字2024-3号.html', '第一条'),
    'doc_32': ('31_居家社区养老服务管理办法_穗府办规2022-13号.html', '第一条'),
    'doc_33': ('32_长期护理保险试行办法_穗医保规字2024-1号.html', '第一条'),
    'doc_34': ('33_广州市老年人优待办法_政府令179号.html', '第一条'),
    'doc_35': ('35_引进人才入户管理办法_穗府办规2020-10号.html', '第一条'),
    'doc_36': ('36_积分制入户2025年度热点13问.html', '热点13问'),
    'doc_37': ('37_市场主体登记管理条例_国务院令746号.html', '第一条'),
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
    '网站助手', '公安', '旧版网站', '温馨提示', '政府信息公开', '办事服务',
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


def make_anchor(title):
    t = re.sub(r'[，。？！、""「」（）\s·—-]+', '', title)
    return t[-12:] if len(t) >= 12 else t


def build_original(lines, anchors):
    # anchors: 依次尝试的正文起点锚点（如 ['第一条', '标题派生锚点']）
    start, used = 0, None
    for anchor in anchors:
        occ = [i for i, ln in enumerate(lines) if anchor and anchor in ln]
        if occ:
            best, best_score = occ[0], -1
            for i in occ:
                score = sum(1 for ln in lines[i + 1:] if len(ln) >= 20)
                if score > best_score:
                    best_score, best = score, i
            start, used = best + 1, anchor
            break
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
    out = '\n'.join(body).strip()
    return out[:MAX_CHARS]


docs = json.load(open(DOCS_JSON, encoding='utf-8'))
by_id = {d['id']: d for d in docs}

import_lines = open(IMPORT_JSON, encoding='utf-8').read().strip().split('\n')
import_objs = {json.loads(l)['id']: json.loads(l) for l in import_lines if l.strip()}

changed, skipped = [], []
for doc_id in docs:
    entry = MAPPING.get(doc_id['id'])
    if not entry:
        skipped.append((doc_id['id'], '无映射'))
        continue
    fname, fallback = entry
    path = f'{SRC_DIR}/{fname}'
    try:
        lines = clean_lines(path)
    except Exception as e:
        skipped.append((doc_id['id'], f'源读取失败: {e}'))
        continue
    anchors = [fallback] if fallback else []
    anchors.append(make_anchor(doc_id['title']))
    new_text = build_original(lines, anchors)
    old_len = len(doc_id.get('original_text') or '')
    if not new_text:
        skipped.append((doc_id['id'], '提取为空'))
        continue
    doc_id['original_text'] = new_text
    import_objs[doc_id['id']]['original_text'] = new_text
    changed.append((doc_id['id'], old_len, len(new_text)))

with open(DOCS_JSON, 'w', encoding='utf-8') as w:
    json.dump(docs, w, ensure_ascii=False, indent=2)
with open(IMPORT_JSON, 'w', encoding='utf-8') as w:
    w.write('\n'.join(json.dumps(import_objs[d['id']], ensure_ascii=False) for d in docs) + '\n')

print(f'重建 {len(changed)} 篇，跳过/失败 {len(skipped)} 篇：')
for doc_id, old, new in changed:
    print(f'  {doc_id}: {old}字 → {new}字')
for doc_id, reason in skipped:
    print(f'  !!! {doc_id}: {reason}')
