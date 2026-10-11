# 0005. 启动休眠窗口只由 `onStartup` 打开

- **状态**：已采纳
- **日期**：2026-03-17（回溯记录），2026-10-11 补充不变量测试
- **影响**：启动抢先休眠的全部触发条件

## 背景

启动抢先休眠做的是"在会话恢复的标签页加载之前把它们丢弃"。这是一个**大规模、
不可逆**的批量操作：一旦误触发，用户所有后台标签页会被同时卸载。

因此"什么时候允许这么做"比"怎么做"更关键。可用的信号有几个：

| 信号                         | 何时触发                                  |
| ---------------------------- | ----------------------------------------- |
| `chrome.runtime.onStartup`   | **浏览器（profile）启动时**，每次运行一次 |
| `chrome.runtime.onInstalled` | 扩展安装 / 更新 / 浏览器更新时            |
| Service Worker 冷启动        | 任何事件把它唤醒时，包括扩展重载后        |

注意第三行：**扩展更新会重启 Service Worker，但不会触发 `onStartup`**。
如果实现里用"Worker 启动"作为判断依据，那么"更新扩展"就会等价于
"把所有后台标签页休眠一遍"——这是本项目最危险的一类回归。

## 决策

**启动休眠窗口只能由 `chrome.runtime.onStartup` 打开，没有其他入口。**

配套三条：

1. 窗口截止时间写入 `chrome.storage.session`，Worker 在窗口内重启时**读回**
   截止时间继续清扫，而不是重新计时（见 [ADR-0003](0003-session-storage-for-runtime-state.md)）。
2. `sweepStartupTabs()` 内部额外要求窗口处于打开状态。
   **总开关不是授权，窗口才是授权**——即便设置项为开，没有窗口也不允许丢弃。
3. 用独立进程的测试守护该不变量：
   [`tests/startup-suspend-reload.test.mjs`](../../tests/startup-suspend-reload.test.mjs)
   只触发 `onInstalled` 与消息，断言没有任何标签页被丢弃、也没有写入窗口边界。
   该测试必须独立成文件，因为窗口是每个 Worker 进程只打开一次的。

## 后果

- 正面：
  - 扩展安装/更新绝不会触发批量休眠；
  - 判断依据是浏览器给出的语义信号，而不是时序推测；
  - 不变量有自动化测试，未来重构不易破坏。
- 负面 / 需要接受的代价：
  - **部分自动化环境不派发 `onStartup`**（某些容器、部分 Playwright 场景），
    导致真机冒烟测试无法自然触发窗口。为此保留了唯一的测试钩子
    `TRIGGER_STARTUP_SWEEP` 消息，由测试脚本先写入 `storage.session`
    的窗口边界再手动触发一次清扫。这是产品里唯一的测试后门，已在
    [ARCHITECTURE.md](../ARCHITECTURE.md) 登记。
  - 用户手动重启扩展后，启动休眠不会立即生效——这符合预期，但需要在文档中说明。

## 替代方案

- **用 Worker 首次启动作为信号**：无法区分"浏览器启动"与"扩展更新/重载"，
  会导致更新即批量休眠。否决。
- **用 `chrome.tabs.query` 的标签页状态推断**（例如"同时出现大量 unloaded 标签页"）：
  依赖时序与启发式，误判代价极大。否决。
- **监听 `chrome.windows.onCreated` 作为补充信号**：新开窗口时会触发，
  与"浏览器刚启动"不等价，会把普通新窗口误判为启动。否决。

## 相关

- [0003 运行时状态放入 `chrome.storage.session`](0003-session-storage-for-runtime-state.md)
- [STARTUP-SUSPEND-TEST.md 验收步骤](../STARTUP-SUSPEND-TEST.md)
