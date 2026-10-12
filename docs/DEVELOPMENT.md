# 开发指南 / Development

## 1. 工具链

| 需要                | 版本    | 说明                                            |
| ------------------- | ------- | ----------------------------------------------- |
| Node.js             | ≥ 20.11 | `.nvmrc` 固定为 20；CI 覆盖 20 / 22 / 24        |
| Chromium 内核浏览器 | ≥ 102   | `manifest.json` 声明了 `minimum_chrome_version` |
| Python + Playwright | 可选    | 只有真机冒烟脚本需要                            |

```bash
npm ci        # 安装 eslint / prettier（约 4 个直接依赖）
```

**扩展本身零运行时依赖、无构建步骤**：`src/` 目录就是最终产物。

## 2. 加载与调试

### 加载

1. `chrome://extensions/`（Edge：`edge://extensions/`）→ 打开**开发者模式**
2. **加载已解压的扩展程序** → 选择仓库里的 **`src/`** 目录
3. 修改代码后点扩展卡片上的刷新按钮

> 常见错误：选到了仓库根目录。根目录没有 `manifest.json`，加载会失败。

### 调试

| 想看什么            | 怎么看                                                        |
| ------------------- | ------------------------------------------------------------- |
| Service Worker 日志 | `chrome://extensions/` → 扩展卡片上的 **service worker** 链接 |
| 弹窗日志            | 右键扩展图标 → **检查弹出内容**                               |
| 选项页日志          | 选项页内右键 → 检查                                           |
| 存储内容            | Worker DevTools → Application → Storage → Extension Storage   |
| 内存对比            | `Shift+Esc` 打开 Chrome 任务管理器，观察各标签页的渲染进程    |

所有日志都带 `[Dozetabs]` 前缀，便于过滤。

**调试 Service Worker 生命周期**：MV3 的 Worker 空闲约 30 秒会被回收。要观察
"状态在 Worker 重启后是否还在"，可以在 Worker DevTools 中手动点
**Service Worker → Stop**，或等待自动回收后再触发一次事件。

## 3. 日常命令

```bash
npm run check          # 提交前必跑（格式 + lint + 校验 + 测试）
npm run format         # Prettier 全量格式化
npm run lint:fix       # ESLint 自动修复
npm test               # 测试
npm run validate       # manifest / 多语言 / 消息协议校验
npm run build          # 打包为 dist/dozetabs-v<version>.zip
```

## 4. 代码约定

- **缩进 2 空格、单引号、必须有分号、行宽 100**；由 Prettier 统一，不要手工对抗。
- 注释解释**为什么**，不复述代码。涉及取舍的地方请指向对应的 ADR。
- 模块内不做 `console.log` 级别以下的噪音输出；关键生命周期日志保留 `[Dozetabs]` 前缀。
- 不引入运行时依赖。`src/` 中出现的任何第三方代码都需要一次 ADR 讨论。

### 命名

| 对象       | 约定                          | 例子                |
| ---------- | ----------------------------- | ------------------- |
| 存储键     | 小驼峰，集中在 `constants.js` | `sleepingTabs`      |
| 消息类型   | `MESSAGE_TYPES.大写下划线`    | `SLEEP_ALL_OTHER`   |
| 失败原因   | 小驼峰的稳定代码              | `alreadySleeping`   |
| locale key | 小驼峰，`reason*` 前缀表原因  | `reasonWhitelisted` |
| 事件监听   | 只写在 `service-worker.js`    | —                   |

## 5. MV3 常见陷阱

| 陷阱                        | 表现                          | 正确做法                                                                   |
| --------------------------- | ----------------------------- | -------------------------------------------------------------------------- |
| Worker 被回收               | 内存里的计数器/计时器神秘归零 | 状态写 `chrome.storage.session`                                            |
| `setTimeout` 不保证存活     | 长定时器在 Worker 回收后消失  | 关键周期任务用 `chrome.alarms`（最小周期 30s）；短窗口任务要能自我恢复     |
| `discard()` 拒绝活动标签页  | 休眠当前页静默失败            | 先 `switchAwayFromTab()`                                                   |
| 注入函数必须自包含          | 注入后报 `x is not defined`   | 注入的函数不能 `import`、不能引用模块变量（`src/background/tab-state.js`） |
| 注入函数不能引用外部变量    | 注入后报 `x is not defined`   | 注入的函数必须完全自包含                                                   |
| `chrome.storage` 并发写覆盖 | 统计数比实际少                | 走 `withStorageLock()`                                                     |
| 扩展更新会重载 Worker       | 误把"重载"当成"浏览器启动"    | 只认 `chrome.runtime.onStartup`                                            |

## 6. 提交前自查

```bash
npm run check
```

如果你是第一次在这个仓库提交，建议同时手动过一遍：

- 加载扩展，确认 Worker 无报错；
- 打开一个有 10 个以上标签页的窗口，点一次「休眠其他页」再点一次「刷新」；
- 点击一个休眠的标签页，确认它恢复了，并且滚动位置还在。

## 7. 相关文档

- [ARCHITECTURE.md](ARCHITECTURE.md) — 模块职责与关键流程
- [TESTING.md](TESTING.md) — 测试分层与真机验收
- [RELEASING.md](RELEASING.md) — 发版流程
- [../CONTRIBUTING.md](../CONTRIBUTING.md) — 贡献流程与硬性约定
