# 测试指南 / Testing

本项目的测试策略围绕一条主线：**能被自动化的逻辑尽量自动化，只在真正需要的地方
动用真实浏览器**。

```
       覆盖范围 / 成本
  高 ┌────────────────────────────────────────────┐
     │ 单元测试 (node:test)                        │  129 项断言
     │ tests/unit/**                               │  零依赖，毫秒级
     ├────────────────────────────────────────────┤
     │ 集成测试 (node:test + chrome mock)          │  驱动真实 Service Worker
     │ tests/*.test.mjs                            │  事件与消息走真链路
     ├────────────────────────────────────────────┤
     │ 真机冒烟 (Playwright + 桌面 Edge/Chrome)    │  页面上下文、权限、
     │ scripts/*.py                                │  会话恢复等只能真机验证
  低 └────────────────────────────────────────────┘
```

---

## 1. 一条命令

```bash
npm test          # node --test  —— 全部 129 项断言
npm run check     # 格式 + lint + 一致性校验 + 测试
```

测试**零运行时依赖**：使用 Node 内置的 `node:test`，不需要 vitest/jest，
也不需要 `npm install` 就能跑（只有 lint/format 需要装 eslint/prettier）。

```bash
node --test                                   # 全部（自动发现 tests/**/*.test.*）
node --test "tests/unit/**/*.test.js"         # 只跑单元测试（注意要引号 + glob）
node --test tests/tab-lifecycle.test.mjs   # 只跑一个文件
node --test --experimental-test-coverage      # 附带覆盖率
```

### 受限环境提示

`node --test` 默认**为每个测试文件派生一个子进程**。在没有子进程权限的沙箱
（例如某些 CI 容器或本地受限终端）中会以 `spawn EPERM` 失败。此时逐个文件运行：

```bash
node --test --experimental-test-isolation=none tests/unit/storage.test.js
```

效果等价（每个文件依然在独立进程中），只是需要自己遍历文件。

---

## 2. 测试分层

### 2.1 单元测试 `tests/unit/`

纯逻辑，不需要 Service Worker：

| 文件                  | 覆盖内容                                                              |
| --------------------- | --------------------------------------------------------------------- |
| `constants.test.js`   | 存储键唯一性、设置键清单、消息值稳定性、时间常量取值范围              |
| `whitelist.test.js`   | 域名提取/规范化、通配匹配、子域边界、内部页与空标签页判定、增删白名单 |
| `storage.test.js`     | 默认值合并、`initializeStorage` 幂等、**并发读改写不丢更新**、锁管理  |
| `settings.test.js`    | `sanitizeSettings()` 的未知键丢弃与类型强转                           |
| `tab-manager.test.js` | `canSleepTab()` 判定矩阵、context 复用契约、窗口内计数                |

### 2.2 集成测试 `tests/*.test.mjs`

用 `tests/helpers/chrome-mock.js` 模拟 `chrome.*` API，**真实加载 Service Worker
模块**，然后直接触发它注册的监听器与消息处理器：

| 文件                              | 覆盖内容                                                       |
| --------------------------------- | -------------------------------------------------------------- |
| `startup-suspend.test.mjs`        | 启动抢先休眠三层机制、各项排除规则、设置完整性、消息路由与鉴权 |
| `startup-suspend-reload.test.mjs` | **扩展更新不得触发启动休眠**（必须独立进程才能观察）           |
| `tab-lifecycle.test.mjs`          | 休眠/唤醒/状态领取、批量休眠、锁与关闭标签页清理、存储读取次数 |

chrome mock 的设计要点（也是对它的信任边界）：

- `storage` 在读写时**深拷贝**，与真实 API 一致——否则
  `deepEqual(settings, before)` 这类断言会因为拿到同一个对象引用而恒真。
- `tabs.query()` **真实响应** `active` / `windowId` / `currentWindow` 过滤条件，
  查询条件写错能被测出来。
- 存储写入会触发 `onChanged`，与 Service Worker 的缓存失效逻辑形成真实回路。
- `scripting.executeScript` 是**桩**（没有 DOM），返回 `undefined`。
  **页面上下文的行为不在单测覆盖范围内**——见下节。

### 2.3 真机验证 `scripts/`

单元测试里的 `executeScript` 是桩，页面上下文、manifest 能否被真实浏览器加载、
UI 是否真的渲染，这些只能靠真机跑。脚本分两类：

**A. 可在自动化环境稳定运行（推荐）**

| 脚本                           | 用途                                                              |
| ------------------------------ | ----------------------------------------------------------------- |
| `scripts/verify-in-browser.py` | 38 项断言：扩展加载、设置默认值、弹窗与选项页渲染、采集、恢复握手 |

```bash
python scripts/verify-in-browser.py          # 退出码 0 才代表通过
python scripts/verify-in-browser.py --keep-open   # 跑完把浏览器留 60 秒供人工查看
```

它**刻意不调用 `chrome.tabs.discard()`**——见下面 C 节的说明——因此可以在
任何有桌面浏览器和 Playwright 的环境里稳定通过，是"改动有没有破坏真机行为"的
第一道防线。

**B. 需要真机桌面 + 人工判断**

| 脚本                         | 用途                                                                    |
| ---------------------------- | ----------------------------------------------------------------------- |
| `scripts/smoke-test.py`      | 12 标签 A/B 对照：基线与开启启动休眠后的内存与加载数对比                |
| `scripts/measure-memory.ps1` | 重启后按 profile 测量浏览器内存（验收用，支持 `-MaxWorkingSetGb` 阈值） |

完整验收步骤见 [STARTUP-SUSPEND-TEST.md](STARTUP-SUSPEND-TEST.md)。

**C. 为什么 discard 不能在 Playwright 里跑**

在这些脚本上实测过：一旦 `chrome.tabs.discard()` 真的丢弃了 Playwright 正在接管的
标签页，浏览器进程会整体退出（CDP 连接断开）。因此：

- `smoke-test.py` 检测到这种情况时会**以退出码 2 报告"环境限制"**，而不是抛
  Playwright 堆栈或假装通过；
- discard / 唤醒路径的正确性由单元与集成测试保证，内存收益由上面的人工验收保证。

**共享实现**在 `scripts/_browser.py`（启动、按 profile 杀进程、找 Service Worker、
本地 HTTP 服务、退出码汇总）。它内置两条教训：

- **不要持有 Playwright 的 `Worker` 对象**：MV3 Service Worker 空闲即被回收，
  句柄随即失效。所有交互走 `open_driver()` 打开的扩展页面（稳定目标，且同样能调用
  `chrome.*`）。
- **未知的 Chromium 开关会被静默忽略**：只有 `--load-extension` +
  `--disable-extensions-except` 这一对真正加载未打包扩展。

**Python 静态检查**（可选，改动 `scripts/` 时请跑）：

```bash
python -m pip install -r scripts/requirements-dev.txt
npm run lint:py
```

`pyflakes` 能在不启动浏览器的情况下抓出未定义变量一类的错误——这正是当年让
`popup-e2e-probe.py` 每次运行都崩溃的原因。CI 里有对应步骤。

---

## 3. 一致性校验（不是测试，但同样会挂 CI）

```bash
npm run validate            # 全部
node tool/validate.js --only i18n
node tool/validate.js --json
```

`tool/validate.js` 检查四类「浏览器只会在运行时才发现」的错误：

1. **manifest 引用**：`background.service_worker`、`action.default_popup`、
   `options_page`、`content_scripts[].js/css`、`icons` 指向的文件是否存在且非空。
2. **版本一致性**：`src/manifest.json` 与 `package.json` 的 `version` 必须相同
   （版本号唯一来源是 manifest）。
3. **多语言对齐**：各语言 key 集合必须完全一致；代码/HTML/manifest 中引用的
   key 必须已定义（支持 `data-i18n`、`data-i18n-title`、`data-i18n-placeholder`、
   `t('…')`、`getMessage('…')`、`__MSG_x__`）。定义了但从未引用只报 warn。
4. **消息协议闭环**：`MESSAGE_TYPES` 中声明的每一项都必须在 `router.js` 中有处理
   函数（反之亦然），并且内容脚本里写死的字面量与常量一致。

---

## 4. 写测试时的约定

- 需要 Service Worker 的测试：先建 mock 并挂到 `globalThis.chrome`，
  **再** `await import('../src/background/service-worker.js')`（导入顺序决定监听器
  绑定到哪个 mock）。
- 每个测试文件用**自己的** mock 实例；`node:test` 默认一文件一进程，天然隔离。
- 断言用 `node:assert/strict`。
- 修 bug 时先写一个**会失败**的测试，再改代码。仓库里已有的回归测试都带有
  「Regression:」注释，说明它守护的是哪一类问题。
- 不要在测试里依赖 `setTimeout` 的固定延时来"等它稳定"；改为断言最终状态。
  产品代码里的定时器都经过 `setUnrefTimeout()`，不会让测试进程挂住。
