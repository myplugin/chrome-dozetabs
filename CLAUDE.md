# CLAUDE.md

本仓库给 AI 编码助手的项目须知统一维护在 **[AGENTS.md](AGENTS.md)**，请以那份文档为准。

架构、模块职责与关键流程见 **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**。

快速开始：

```bash
npm ci          # 仅安装 eslint / prettier，测试零依赖
npm run check   # 提交前必跑：格式 + lint + 一致性校验 + 测试
npm run build   # 产出 dist/dozetabs-v<version>.zip
```

加载扩展：`chrome://extensions/` → 开发者模式 → 加载已解压的扩展程序 → 选择 **`src/`**。
本项目无构建步骤，`src/` 即最终产物。

> 为什么这里只有一句话：项目对人类的开发文档在 `docs/`，对 AI 助手的约束在
> `AGENTS.md`。把同一份内容复制到多个文件，最终一定会有版本漂移。
