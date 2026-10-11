# AGENTS.md

> 给 AI 编码助手（Claude Code、Codex、Cursor 等）的项目须知。
> 人类贡献者请看 [CONTRIBUTING.md](CONTRIBUTING.md)；架构细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 项目是什么

Tab Sleep 是一个 Chrome/Edge **Manifest V3 扩展**，用 Chrome 原生的
`chrome.tabs.discard()` 把不用的标签页「休眠」以释放内存与 CPU。**没有构建步骤**：
`src/` 目录就是最终产物，原生 ES Module，直接被浏览器加载。

最核心的差异化能力是**启动抢先休眠**：浏览器重启恢复上百个标签页时，
让它们保持未加载状态，点击才加载。这是 `docs/ARCHITECTURE.md` 里最值得先读的一节。

## 命令

```bash
npm ci                 # 仅安装 eslint / prettier（测试零依赖）
npm run check          # 提交前必跑：格式 + lint + manifest/多语言/协议校验 + 测试
npm test               # node:test 测试套件（120 项断言）
npm run test:startup   # 只跑启动休眠相关的两组测试
npm run validate       # 只跑一致性校验
npm run lint:py        # 检查 scripts/*.py（需 pip install -r scripts/requirements-dev.txt）
python scripts/verify-in-browser.py   # 真机验证：加载/UI 渲染/采集与恢复（38 项断言）
npm run build          # 产出 dist/tab-sleep-v<version>.zip
npm run format         # Prettier 全量格式化
```

手动验证：`chrome://extensions/` → 开发者模式 → 加载已解压的扩展程序 → 选 **`src/`**。

## 五条硬性规则

1. **业务规则只写一次。** 白名单/域名匹配、浏览器内部页面判定、空标签页判定全部在
   `src/utils/whitelist.js`；「这个标签页能休眠吗」只在 `src/utils/tab-manager.js` 的
   `canSleepTab()`。**不要**在 popup/options 里复制任何判定逻辑。
2. **模块不得在导入时产生副作用。** `chrome.*.addListener` 只允许出现在
   `src/background/service-worker.js`。其余模块导出函数，由入口接线——否则测试无法驱动它们。
3. **存储键与消息类型只在 `src/utils/constants.js` 定义。** 唯一例外是内容脚本
   （classic script，不能用 `import`）；它使用的字面量必须与常量一致，
   `npm run validate` 会检查。
4. **所有跨进程 `read-modify-write` 必须走 `withStorageLock()`。**
   批量休眠是 10 路并发的，裸 `get` → 改 → `set` 会丢更新。
5. **不要新增浏览器权限**，除非在 PR 里论证无法避免。权限变化会影响所有
   已安装用户的更新提示。

## 改动影响面自查

| 你改了什么                   | 必须同步                                                       |
| ---------------------------- | -------------------------------------------------------------- |
| `DEFAULT_SETTINGS` 增删键    | `tests/unit/constants.test.js` 的键名清单                      |
| `MESSAGE_TYPES` 增删         | `src/background/router.js` 的 `handlers`（否则 validate 失败） |
| 任何用户可见文案             | `src/_locales/en` **与** `src/_locales/zh_CN` 同步             |
| `manifest.json` 的 `version` | `package.json` 的 `version`（否则 validate 失败）              |
| 设计决策                     | 在 `docs/adr/` 新增一条 ADR                                    |
| 任何变更                     | `CHANGELOG.md` 的 `[Unreleased]`                               |

## 验证要求

- 逻辑改动必须有测试。测试用 `node:test` + `tests/helpers/chrome-mock.js`。
- `chrome.scripting.executeScript` 在 mock 中是**桩**（没有 DOM），
  页面上下文的行为只能靠真机冒烟测试覆盖：见 [docs/TESTING.md](docs/TESTING.md)。
- 报告完成前请实际运行 `npm run check` 并给出结果，不要假设它通过。

## 常见坑

- MV3 Service Worker 约 30 秒空闲即被回收：**任何**依赖内存状态跨事件存活的逻辑
  都必须落到 `chrome.storage.session`（见 `src/utils/session-store.js`）。
- `setTimeout` 在浏览器里返回 number，在 Node 里返回对象。用
  `setUnrefTimeout`（`src/utils/timers.js`）以免测试进程挂住。
- `chrome.tabs.discard()` 对当前活动标签页会失败，休眠前必须先切走
  （`src/background/sleep.js:switchAwayFromTab()`）。
- 内容脚本**不能** `import` 任何模块；不要试图「顺手复用」`utils/`。
- 不要给测试脚本或调试代码留产品后门；唯一的测试钩子是
  `TRIGGER_STARTUP_SWEEP`（真机冒烟测试在用，已在架构文档中登记）。
