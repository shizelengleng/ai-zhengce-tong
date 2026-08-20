# cloudfunctions（云函数）

P3 负责。每个子目录是一个云函数（`index.js` + `package.json`）。

| 云函数 | 职责 |
|---|---|
| `ask` | 向量检索 + Prompt + 调大模型，返回答案与出处 |
| `getPolicies` | 分类列表 / 政策详情 |
| `saveHistory` | 保存问答历史 |
| `getHistory` | 读取问答历史 |

在微信开发者工具中右键"云函数目录 → 上传并部署：云端安装依赖"。
