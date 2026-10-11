# 启动抢先休眠 — 验收测试指南

> 这是本项目最核心、也最容易出事故的能力。本文档给出它的机制、自动化测试覆盖
> 与真机验收步骤。机制的设计理由见
> [ADR-0005](adr/0005-startup-window-owned-by-onstartup.md)。

## 机制概述

| 组件       | 说明                                                                                                                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 抢先丢弃   | `chrome.tabs.onCreated`：会话恢复的标签页先以 `status === 'unloaded'` 创建、随后才被加载。在这个瞬间 `chrome.tabs.discard()` 即可拦下；普通新开标签页不受影响（active/pinned/autoDiscardable 检查）                        |
| 事件兜底   | `chrome.tabs.onUpdated` 中 `status === 'loading'` 的非活动标签立即 discard，覆盖 Worker 尚在启动时漏掉的情况                                                                                                               |
| 周期清扫   | 浏览器启动后 45 秒内每 750ms 全窗口扫描一次，连「已经加载完」的恢复标签页也一并丢弃（快速恢复场景）                                                                                                                        |
| 窗口判定   | 窗口**只由 `chrome.runtime.onStartup` 打开**（浏览器启动的规范信号）。窗口截止时间存 `chrome.storage.session`：Worker 在窗口内被回收 → 读回截止时间继续清扫；扩展安装/更新触发的重载**不触发** `onStartup`，所以不会误开窗 |
| 授权边界   | `sweepStartupTabs()` 自身也要求窗口处于打开状态。**总开关不是授权，窗口才是授权**                                                                                                                                          |
| 不会被误伤 | 每个窗口当前正在查看的标签页、用户本次会话点击过的标签页、白名单域名、被锁定的标签页、固定标签页（默认，可配置）                                                                                                           |
| 设置       | `startupSuspendEnabled`（默认开）、`startupIncludePinned`（默认关）                                                                                                                                                        |
| 兼容性     | 只用原生 `chrome.tabs.discard()`，不关标签重开、不替换 DOM；权限无新增（沿用原有 `tabs`/`storage`）；Edge/Chrome 通用                                                                                                      |

## 自动化测试

### 单元 / 集成测试（可靠，无需浏览器）

用 `tests/helpers/chrome-mock.js` 模拟 chrome API，**真实加载 Service Worker 模块**
并直接驱动它注册的监听器与消息处理器：

```bash
npm test                    # 全部 120 项断言
npm run test:startup        # 只跑启动休眠相关的两组
```

| 文件                                    | 项数 | 覆盖                                                                                                                                 |
| --------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/startup-suspend.test.mjs`        | 20   | `onCreated` 抢先拦截、active/pinned/白名单/`autoDiscardable=false`/已完成 的过滤、`onUpdated` 兜底、清扫、设置完整性、消息路由与鉴权 |
| `tests/startup-suspend-reload.test.mjs` | 3    | **扩展安装/更新绝不打开窗口、绝不丢弃任何标签页**（必须独立进程才能观察）                                                            |
| `tests/tab-lifecycle.test.mjs`          | 18   | 休眠/唤醒/状态领取、批量休眠、锁与关闭清理、存储读取次数                                                                             |

`npm run test:startup` 之外的其他测试（存储并发、设置清洗、休眠判定矩阵等）见
[TESTING.md](TESTING.md)。

### 真实浏览器验证

```bash
# A. 可在自动化环境稳定通过：扩展加载、默认值、弹窗/选项页渲染、采集与恢复握手
python scripts\verify-in-browser.py

# B. 需要真机桌面 + 人工判断
python scripts\smoke-test.py --tabs 12          # 12 标签 A/B 内存对照
.\scripts\measure-memory.ps1 -Browser msedge -WaitSeconds 30
```

> **为什么 A 不含 discard**：实测确认，一旦 `chrome.tabs.discard()` 丢弃了 Playwright
> 正在接管的标签页，整个浏览器进程会退出。因此 `smoke-test.py` 在遇到这种情况时
> **以退出码 2 报告"环境限制"**，而不是抛堆栈或假装通过。
> 详见 [TESTING.md 第 2.3 节 C](TESTING.md#23-真机验证-scripts)。

**已验证的证据**：

| 验证项                                      | 方法                                                                  | 结果                                                                                                         |
| ------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 扩展在真实 Edge 干净加载、设置默认值正确    | `scripts/verify-in-browser.py`                                        | 38 项断言全部通过：manifest 可加载、10 项设置默认值、白名单 16 条、`storage.session` 可用、无未捕获页面错误  |
| 弹窗与选项页在真实浏览器里渲染              | `scripts/verify-in-browser.py`                                        | 弹窗行/按钮数与标签数一致、i18n 生效；选项页 9 个开关（含"休眠前确认"）、页脚版本取自 manifest、白名单 16 行 |
| 状态采集正确（且不含密码）                  | `scripts/verify-in-browser.py`（真实 `captureTabState`）              | 滚动位置、input/textarea/select 全部采集；密码字段被排除                                                     |
| 唤醒恢复握手（休眠时落盘 → 页面一次性领取） | `scripts/verify-in-browser.py`                                        | 重新加载后滚动位置与表单值全部还原；状态被领取一次后删除；后续重新加载不会重放旧输入                         |
| `chrome.tabs.discard` 原语安全              | 最小扩展对照实验：一个不含任何产品代码的 MV3 扩展从 Worker 调 discard | 成功且浏览器存活 —— 证明产品的基础操作不会导致浏览器崩溃                                                     |
| 会话恢复后浏览器 + 扩展页稳定               | kill → 重启 → 驱动页轮询 60s                                          | 16 个标签持续稳定，无 target 丢失                                                                            |

> **CDP 下的已知限制（非产品缺陷）**：Playwright 接管的标签页一旦被 discard，
> 浏览器进程会退出；`executeScript` 在部分受限环境中也会干扰渲染器。
> 所以 discard 与内存收益只能在真实桌面按下面的正式验收步骤执行，
> 逻辑正确性由单元/集成测试与上面的 A 类验证共同保证。

## 正式验收（200 标签真实数据）

### 步骤

1. 在 `chrome://extensions` 重新加载扩展（改代码后必须）。
2. 打开约 200 个真实网页标签（模拟日常工作负载）。
3. **改造前基线**：设置里关闭「启动时抢先休眠恢复的标签页」，然后：
   - 强杀浏览器（任务管理器结束进程，或直接关机重启）；
   - 重启浏览器等待自动恢复；
   - 重启后 **30 秒**，运行测量脚本（见下），记录基线数据。
4. **改造后**：设置里重新打开「启动时抢先休眠恢复的标签页」，重复强杀 → 重启。
5. 重启后 30 秒测量，并人工核对：
   - 点扩展图标：「休眠中」计数 ≈ 199，「活跃」= 1；
   - 点击任意「休眠中」标签，应正常加载；
   - `Shift+Esc` 任务管理器里几乎没有网页渲染进程。

### 测量脚本

重启浏览器后，另开一个 PowerShell 窗口：

```powershell
.\scripts\measure-memory.ps1 -Browser msedge -WaitSeconds 30
# 或 Chrome:
.\scripts\measure-memory.ps1 -Browser chrome -WaitSeconds 30
```

输出浏览器全部进程总内存（工作集/私有）与进程数，并打印可直接粘贴进对比表的记录行。

> 注意：该脚本统计的是机器上**所有**同族浏览器进程，如果同时开着多个
> profile/实例会高估。做对比时请保持两组环境一致。

### 对比表模板（填入实测数据）

| 指标                                   | 改造前（关闭启动休眠） | 改造后（开启启动休眠） | 目标   |
| -------------------------------------- | ---------------------- | ---------------------- | ------ |
| 30 秒后总内存（工作集）                | ~22 GB                 | \_\_ GB                | < 5 GB |
| 加载中的标签数                         | ~200                   | 1（仅当前标签）        | 1      |
| 点击其他标签能否加载                   | —                      | 能/否                  | 能     |
| 内存峰值（重启过程中，任务管理器观察） | ~22 GB                 | \_\_ GB                | < 5 GB |

> 注：如果浏览器自身开启了 Edge「休眠标签页/效率模式」或 Chrome「内存节省程序」，
> 它们会在后台慢慢丢弃标签，导致改造前基线偏低；做对比时建议两组使用相同浏览器设置，
> 以扩展的「启动抢先休眠」为准。

## 已知边界

- 兜底窗口内（启动后 ~45 秒）新开/后台打开的标签也会被抢先休眠（点击即加载，行为一致）；
  窗口过后恢复常态。**用户实际点击过的标签、各窗口当前正在查看的标签不会被误伤。**
- 白名单域名、锁定的标签不会被启动休眠；固定标签默认不休眠，可在设置中改为包含。
- 扩展安装/更新触发的 Worker 重载**不会**误开窗 —— 开窗只认
  `chrome.runtime.onStartup`（真正浏览器启动才触发），彻底避免「更新扩展 =
  休眠所有后台标签」。该不变量由 `tests/startup-suspend-reload.test.mjs` 守护。
- `chrome.storage.session` 需要 Chromium 102+（Edge/Chrome 现代版本均满足，
  manifest 已声明 `minimum_chrome_version: 102`）；更低版本自动退化为纯内存存储
  （功能仍可用，但 Worker 回收即丢失窗口状态）。
- 周期清扫依赖 `setTimeout`，而 Worker 可能被回收。窗口内 Worker 重启会读回截止时间
  并恢复清扫，但存在最长约 750ms 的空档。

---

## English summary

**Startup suspend** keeps session-restored tabs unloaded so a restart with hundreds
of tabs costs about one page load. It uses three layers: intercepting tabs created
with `status === 'unloaded'`, a listener fallback on `loading` background tabs, and
a periodic full sweep for 45 seconds after startup.

The 45-second window is opened **only** by `chrome.runtime.onStartup` — the
browser's real "just started" signal — and its deadline is kept in
`chrome.storage.session` so a recycled service worker resumes instead of re-arming.
Reloading or updating the extension never fires `onStartup`, so it can never
mass-discard your background tabs; `tests/startup-suspend-reload.test.mjs` guards
that invariant in its own process.

Automated coverage: `npm test` (120 assertions) and `npm run test:startup`.
The real-browser scripts under `scripts/` currently have known defects (see
[ROADMAP N2](ROADMAP.md)) — do not treat their exit codes as acceptance evidence
until that is fixed. The manual 200-tab A/B procedure above remains the source of
truth for real-world memory behaviour.
