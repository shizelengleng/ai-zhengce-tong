# scripts（辅助脚本）

P3 负责。

- `embed_policies.py` — 读取 `data/policies.json`，逐条调用阿里云百炼 embedding，生成 `vector` 字段后写回（供 RAG 检索）。

运行：`python scripts/embed_policies.py`（需先配置 `.env` 中的 `EMBEDDING_*`）。
