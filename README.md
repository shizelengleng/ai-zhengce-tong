# AI政策通

天河区政策问答微信小程序 ——「2026 年青AI天河人工智能协作创新大赛」板块二·方向1（社区便民）参赛作品。

居民用日常口语提问，AI 基于天河区真实政策知识库回答，答案附官方出处与办事入口。

## 技术栈

- 前端：微信原生小程序（微信开发者工具）
- 后端：微信云开发（云函数 + 云数据库）
- AI：向量检索 RAG（阿里云百炼 text-embedding-v4）+ 智谱 GLM 生成

## 目录结构

```
docs/               项目文档（流程说明、团队分工）
data/               政策知识库（policies.json）
scripts/            向量化脚本
miniprogram/        小程序前端（页面）
cloudfunctions/     云函数（ask / getPolicies / saveHistory / getHistory）
.env                ⚠️ 本地机密配置，勿提交
```

## 文档

- [项目流程说明](docs/AI政策通-项目流程说明.md)
- [团队分工与开发路径](docs/团队分工与开发路径.md)

## 开发约定

- 提交前先 `git pull`，只提交自己负责的文件（见分工文档第七章）
- `.env`、`node_modules` 等永不提交
- 里程碑红线见分工文档附录
