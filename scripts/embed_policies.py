# -*- coding: utf-8 -*-
"""
AI政策通 · 数据准备脚本 ②：为政策生成向量（真 RAG 的核心）

输入：data/policies.json（由 csv_to_json.py 生成）
输出：
    data/policies_with_vector.json   （完整数据，含 vector，云数据库导入用）
    data/policies_with_vector.jsonl  （JSON Lines，每行一条，方便逐条导入）

用法（在本目录下，.env 需含真实 Key）：
    python scripts/embed_policies.py

说明：
- 读取根目录 .env 中的 EMBEDDING_BASE_URL / DASHSCOPE_API_KEY /
  EMBEDDING_MODEL / EMBEDDING_DIM（不硬编码密钥）
- 每条政策用「标题 + 通俗答案 + 关键词」拼接成一段文本去向量化
- 默认每批 10 条、批间暂停 1 秒，避免触发限流
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IN_PATH = os.path.join(ROOT, 'data', 'policies.json')
OUT_JSON = os.path.join(ROOT, 'data', 'policies_with_vector.json')
OUT_JSONL = os.path.join(ROOT, 'data', 'policies_with_vector.jsonl')

BATCH_SIZE = 10
SLEEP_SEC = 1.0


def load_env():
    """极简 .env 解析，只读取需要的键。"""
    env = {}
    env_path = os.path.join(ROOT, '.env')
    if os.path.exists(env_path):
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def build_text(p):
    # 新模型：向量化用「标题 + 通俗解答 + 关键词」（plain_answer 取代旧 summary）
    return f"{p.get('title', '')}\n{p.get('plain_answer', '')}\n{'、'.join(p.get('keywords', []))}"


def get_embedding(base_url, api_key, model, dim, texts):
    resp = requests.post(
        f"{base_url}/embeddings",
        headers={'Authorization': f'Bearer {api_key}'},
        json={
            'model': model,
            'input': texts,
            'encoding_format': 'float',
            'dimensions': dim,
        },
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    return [item['embedding'] for item in data['data']]


def main():
    env = load_env()
    base_url = env.get('EMBEDDING_BASE_URL') or env.get('DASHSCOPE_BASE_URL')
    api_key = env.get('DASHSCOPE_API_KEY')
    model = env.get('EMBEDDING_MODEL', 'text-embedding-v4')
    dim = int(env.get('EMBEDDING_DIM', '1024'))

    if not base_url or not api_key:
        print('错误：.env 中缺少 EMBEDDING_BASE_URL 或 DASHSCOPE_API_KEY')
        sys.exit(1)

    with open(IN_PATH, 'r', encoding='utf-8') as f:
        policies = json.load(f)

    print(f'读取到 {len(policies)} 条政策，开始向量化（模型 {model}，维度 {dim}）...')

    for i in range(0, len(policies), BATCH_SIZE):
        batch = policies[i:i + BATCH_SIZE]
        texts = [build_text(p) for p in batch]
        vecs = get_embedding(base_url, api_key, model, dim, texts)
        for p, v in zip(batch, vecs):
            p['vector'] = v
        print(f'  已处理 {min(i + BATCH_SIZE, len(policies))}/{len(policies)}')
        if i + BATCH_SIZE < len(policies):
            time.sleep(SLEEP_SEC)

    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(policies, f, ensure_ascii=False)

    with open(OUT_JSONL, 'w', encoding='utf-8') as f:
        for p in policies:
            f.write(json.dumps(p, ensure_ascii=False) + '\n')

    print(f'完成：{len(policies)} 条已带向量 → {OUT_JSON} / {OUT_JSONL}')


if __name__ == '__main__':
    main()
