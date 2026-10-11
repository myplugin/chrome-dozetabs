# 贡献指南 / Contributing

感谢你有兴趣改进 Tab Sleep。本文档说明**如何搭建环境、代码怎么组织、一个改动要通过哪些关卡**。

> English speakers: the essentials are in [For English contributors](#for-english-contributors) at the end.

---

## 1. 环境准备

只需要 **Node.js ≥ 20.11**（`.nvmrc` 固定为 20）和任意 Chromium 内核浏览器。

```bash
git clone <repo>
cd tab-sleep
npm ci          # 仅安装 eslint / prettier，测试不依赖任何 npm 包
```

扩展本身**没有构建步骤**：`src/` 就是最终产物，原生 ES Module 直接被浏览器加载。

### 加载到浏览器

1. 打开 `chrome://extensions/`（Edge 为 `edge://extensions/`），打开右上角**开发者模式**。
2. 点**加载已解压的扩展程序**，选择本仓库的 **`src`** 目录（不是仓库根目录）。
3. 改完代码后，在扩展卡片上点刷新按钮即可生效。

---

## 2. 提交前必须通过的四道关卡

```bash
npm run check
```

它依次执行：

| 关卡       | 命令                   | 检查什么                                     |
| ---------- | ---------------------- | -------------------------------------------- |
| 格式       | `npm run format:check` | Prettier 风格是否一致                        |
| 静态检查   | `npm run lint`         | ESLint 规则（含未使用变量、未定义全局变量）  |
| 一致性校验 | `npm run validate`     | manifest 引用、多语言 key 对齐、消息协议闭环 |
| 测试       | `npm test`             | 120 项单元 + 集成断言（`node:test`，零依赖） |

单独运行某一项也是可以的，例如 `npm test`、`node tool/validate.js --only i18n`。

改了 `scripts/` 下的真机脚本时再跑这两项（Python 可选，见 `scripts/requirements-dev.txt`）：

```bash
python -m pip install -r scripts/requirements-dev.txt
npm run lint:py                       # pyflakes：抓未定义变量一类的错误
python scripts/verify-in-browser.py   # 真机验证：加载 / UI 渲染 / 采集与恢复（38 项断言）
```

`verify-in-browser.py` 是**唯一**能在自动化环境稳定跑通的真机检查：改动任何 UI 或
状态保持逻辑后都应跑一次。它刻意不使用 `discard()`
（原因见 [docs/TESTING.md 第 2.3 节](docs/TESTING.md#23-真机验证-scripts)）。

新增或修改文件后，请用 `npm run format` 统一格式，不要手工对齐空格。

---

## 3. 代码组织

```
src/
  manifest.json          扩展清单（权限、入口、快捷键的唯一事实来源）
  background/            Service Worker：所有业务逻辑
    service-worker.js      仅做事件接线，不含业务规则
    router.js              chrome.runtime.onMessage 的唯一入口
    sleep.js               单个标签页的休眠 / 唤醒
    batch.js               "休眠其他标签页" 批处理状态机
    auto-sleep.js          基于空闲时长的自动休眠
    startup-suspend.js     启动抢先休眠（本项目最核心的能力）
    badge.js / favicon.js / menus.js / tab-state.js
  utils/                 两端（SW 与 UI）共享的纯逻辑
  popup/ options/ content/ UI 与内容脚本
tests/                   node:test 测试与共享 chrome mock
tool/                    打包、校验脚本
docs/                    架构、测试、发布、ADR
```

完整说明见 **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**。

### 三条硬性约定

1. **业务规则只写一次。** 白名单匹配、内部页面判定、空标签页判定都在
   `src/utils/whitelist.js`；休眠判定只在 `src/utils/tab-manager.js:canSleepTab()`。
   UI 不得复制这些规则。
2. **模块不在导入时产生副作用。** 事件监听只允许写在 `background/service-worker.js`，
   其他模块导出函数、由入口接线。这样测试才能直接驱动它们。
3. **磁盘上的状态键与跨进程的消息类型只在 `src/utils/constants.js` 定义。**
   内容脚本因为不能 `import`，是唯一例外——它使用的字面量必须与常量一致，
   `npm run validate` 会检查这一点。

---

## 4. 常见改动的标准步骤

### 新增一个设置项

1. `src/utils/constants.js` → 加入 `DEFAULT_SETTINGS`。
2. `src/options/options.html` → 加一个带 `data-i18n` 的开关（或输入框）。
3. `src/options/options.js` → 在 `toggles` 表里登记；`collectSettings()` 会自动带上。
4. 消费方读取：SW 用 `getSettings()`，UI 用 `GET_SETTINGS` 消息。
5. 两个语言的 locale 文件都加上 `key` 与 `keyDesc`。
6. `tests/unit/constants.test.js` 里有一份设置键名清单，需要同步更新。

> 设置对象是**扁平**的，且 `sanitizeSettings()` 会按默认值的类型强制转换，
> 所以新增布尔/数字项不需要额外代码。

### 新增一个消息类型

1. `constants.js` → 加入 `MESSAGE_TYPES`。
2. `background/router.js` → 在 `handlers` 表里加一条处理函数。
3. 调用方 `sendMessage({ type: MESSAGE_TYPES.X, payload })`。
4. 给这个类型加一条测试（`tests/startup-suspend.test.mjs` 的 "message routing" 一节）。

> `npm run validate` 会失败，如果某个消息类型**声明了却没有在 router 里处理**。

### 新增一条文案

1. 同时写入 `src/_locales/en/messages.json` 与 `src/_locales/zh_CN/messages.json`。
2. JS 中 `t('key')`，HTML 中 `data-i18n="key"`（提示文字用 `data-i18n-title`，
   占位符用 `data-i18n-placeholder`）。
3. `npm run validate` 会检查两种语言 key 是否完全对齐。

---

## 5. 提交规范

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

```
feat(popup): 批量休眠支持中途取消
fix(startup): 扩展更新不再误触发启动休眠
docs(readme): 补充与同类扩展的对比
chore(deps): 升级 eslint
```

允许的类型：`feat` `fix` `docs` `refactor` `test` `chore` `perf` `build` `ci`。

### 分支与 PR

- 从 `main` 切出短期分支：`feat/xxx`、`fix/xxx`、`docs/xxx`。
- 一个 PR 只做一件事；大改动请先开 issue 对齐设计。
- PR 描述请按模板填写，特别是**如何验证**。
- 任何触及权限（`manifest.json` 的 `permissions` / `host_permissions`）的改动，
  必须在 PR 里说明为什么无法避免——这会影响所有已有用户的安装提示。

### 版本与发布

版本号唯一来源是 `src/manifest.json`，`package.json` 必须与之一致
（`npm run validate` 会强制）。发布流程见 [docs/RELEASING.md](docs/RELEASING.md)。

---

## 6. 行为准则

参与本项目即表示你同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

---

## For English contributors

- **Toolchain**: Node ≥ 20.11, plus any Chromium browser. `npm ci` installs only
  ESLint and Prettier — the test suite runs on Node's built-in test runner with
  zero dependencies.
- **Load the extension**: `chrome://extensions/` → Developer mode → _Load
  unpacked_ → pick the **`src/`** folder. There is no build step.
- **Before pushing**: run `npm run check` (format, lint, manifest/locale/message
  validation, tests).
- **Three hard rules**: business rules live in exactly one module; modules must
  not have import-time side effects; storage keys and message types are declared
  only in `src/utils/constants.js`.
- **Docs are Chinese-first**, with English summaries on the outward-facing
  files. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the place to start.
- **Commits**: Conventional Commits. **PRs**: fill in the template, especially
  the verification section.
- Issues and PRs in English are perfectly welcome.
