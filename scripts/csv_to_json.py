# -*- coding: utf-8 -*-
"""
AI政策通 · 数据准备脚本 ①：两张 CSV → policies.json + documents.json

输入：
  data/知识条目表.csv   → data/policies.json   （居民场景条目，含 doc_ids 关联官方原文）
  data/官方文件表.csv   → data/documents.json  （官方原文，回答的"事实来源"）

用法（在项目根目录下）：
  python scripts/csv_to_json.py

说明：
- documents：doc_序号 为 id，原文关键条款(逐字摘录) → original_text
- policies：关键词列以 逗号/顿号/分号/空格 分隔；
  关联文档(分号分隔) 按标题归一化（去文号、去括号、去空白）匹配 documents，
  匹配到的写入 doc_ids；匹配不到的记录在 docs/_match_report.txt 供人工核查。
"""

import csv
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P_CSV = os.path.join(ROOT, 'data', '知识条目表.csv')
D_CSV = os.path.join(ROOT, 'data', '官方文件表.csv')
OUT_P = os.path.join(ROOT, 'data', 'policies.json')
OUT_D = os.path.join(ROOT, 'data', 'documents.json')
REPORT = os.path.join(ROOT, 'docs', '_match_report.txt')

SPLIT_RE = re.compile(r'[,，、;；\s]+')


def split_keywords(text):
    return [k for k in SPLIT_RE.split(text or '') if k]


def split_docs(text):
    # 关联文档以分号分隔
    return [s.strip() for s in (text or '').split(';') if s.strip()]


def norm(t):
    # 标题归一化：去括号及其中文号/说明，去空白
    t = t or ''
    t = re.sub(r'[（(][^）)]*[）)]', '', t)
    t = re.sub(r'\s+', '', t)
    return t


def main():
    # 1. 官方文件表 → documents
    documents = []
    with open(D_CSV, 'r', encoding='utf-8-sig', newline='') as f:
        for row in csv.DictReader(f):
            title = (row.get('文档标题') or '').strip()
            if not title:
                continue
            documents.append({
                'id': 'doc_%s' % (row.get('序号') or '').strip(),
                'title': title,
                'source': (row.get('发文机关') or '').strip(),
                'doc_no': (row.get('文号') or '').strip(),
                'publish_date': (row.get('发布日期') or '').strip(),
                'source_url': (row.get('出处链接') or '').strip(),
                'original_text': (row.get('原文关键条款(逐字摘录)') or '').strip(),
                'remark': (row.get('备注') or '').strip(),
            })

    doc_by_norm = {}
    for d in documents:
        doc_by_norm.setdefault(norm(d['title']), []).append(d)

    # 2. 知识条目表 → policies，关联文档匹配成 doc_ids
    policies = []
    unmatched = []
    no_doc = []
    with open(P_CSV, 'r', encoding='utf-8-sig', newline='') as f:
        for row in csv.DictReader(f):
            title = (row.get('标题') or '').strip()
            if not title:
                continue
            doc_ids = []
            for ref in split_docs(row.get('关联文档(分号分隔)')):
                cands = doc_by_norm.get(norm(ref))
                if cands:
                    for d in cands:
                        if d['id'] not in doc_ids:
                            doc_ids.append(d['id'])
                else:
                    unmatched.append((title, ref))
            policies.append({
                'title': title,
                'category': (row.get('分类') or '').strip(),
                'keywords': split_keywords(row.get('关键词')),
                'doc_ids': doc_ids,
                'plain_answer': (row.get('通俗解答(5段标准)') or '').strip(),
                'phone': (row.get('咨询电话') or '').strip(),
                'venue': (row.get('办理地点') or '').strip(),
                'remark': (row.get('备注(责任部门/查找提示)') or '').strip(),
            })
            if not doc_ids:
                no_doc.append(title)

    with open(OUT_P, 'w', encoding='utf-8') as f:
        json.dump(policies, f, ensure_ascii=False, indent=2)
    with open(OUT_D, 'w', encoding='utf-8') as f:
        json.dump(documents, f, ensure_ascii=False, indent=2)

    report = []
    report.append('policies: %d 条 | documents: %d 篇' % (len(policies), len(documents)))
    report.append('未匹配到官方文件的关联文档 %d 处：' % len(unmatched))
    for t, ref in unmatched:
        report.append('  [%s] => %s' % (t, ref))
    report.append('没有任何 doc_ids 的条目 %d 条：' % len(no_doc))
    for t in no_doc:
        report.append('  %s' % t)
    with open(REPORT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(report))
    print('done')


if __name__ == '__main__':
    main()
