# 0008. 移除常驻内容脚本，改为按需注入

- **状态**：已采纳（取代 [0004](0004-page-context-code-sharing.md)）
- **日期**：2026-10-11
- **影响**：`manifest.json`、`src/background/tab-state.js`、`src/background/sleep.js`、`src/background/service-worker.js`；删除 `src/content/`

## 背景

自项目建立起，`content/content-script.js` 就通过 manifest 的 `content_scripts` 被
**注入到用户访问的每一个网页**。它每次页面加载都执行一次，做的唯一一件事是问
Service Worker「这个标签页有保存的状态要恢复吗？」——绝大多数时候答案是「没有」。

这项设计带来三个持续成本：

1. **每个页面都要跑我们的代码**，即使这个标签页从未被休眠过；
2. 为了这一点功能，`content-script.js` 与 `background/tab-state.js` **各写了一份
   表单字段的读写逻辑**。[ADR-0004](0004-page-context-code-sharing.md) 专门记录了
   这个重复是内容脚本不能 `import` 造成的，并把它列为「必须接受的代价」；
3. 隐私叙事变差：扩展默认存在于每一个页面里，而不是只在你主动使用时出现。

真正卡住我们的是**注入时机**——[ADR-0004](0004-page-context-code-sharing.md) 的
时代没有可靠的办法在"正确的时刻"注入，所以选择了一个不依赖时序的方案
（脚本常驻、自己来问）。

## 决策

**从 `manifest.json` 移除 `content_scripts`，删除 `src/content/`。**

恢复逻辑改为**由 Service Worker 在标签页加载完成时注入**：

```
chrome.tabs.onUpdated (status === 'complete')
  → sleep.js: restoreIntoTab(tabId)
      → 该标签页在 sleepingTabs 里有状态吗？没有就结束
      → chrome.scripting.executeScript({ target, func: restoreTabState, args: [state] })
      → 注入成功后才删除存储条目
```

`captureTabState` 与 `restoreTabState` 现在同住在 `src/background/tab-state.js`：
两者都是自包含的页面函数，由同一个 `executeScript` 机制注入。
**ADR-0004 记录的那处重复因此彻底消失。**

### 为什么必须是 `status === 'complete'`

这是本决策唯一需要实证的地方，我们做了测量（详见 [ROADMAP L1](../ROADMAP.md)）：

| 注入时机                          | 成功落地率                                                |
| --------------------------------- | --------------------------------------------------------- |
| 察觉唤醒后立刻注入                | **1 / 25（4%）**——失败信息 `Frame with ID 0 was removed.` |
| 等 `status === 'complete'` 后注入 | **25 / 25（100%）**                                       |

危险之处在于失败是**静默的**：`executeScript` 抛错、页面照常打开，只是滚动位置与
表单内容悄悄没了。所以"等加载完成"不是优化，而是正确性要求。

### 失败不丢数据

`restoreIntoTab()` 只有在注入成功后才删除存储条目，并且最多重试 3 次。
注入一直失败时状态会留在存储里，下次该标签页加载时再试；浏览器启动时的
清理（`pruneSleepingTabs()`）是最终兜底。

## 后果

- 正面：
  - 用户访问的每个网页不再被注入任何代码；
  - **消除了 ADR-0004 记录的最后一处重复实现**——采集与恢复现在同一份心智模型；
  - 少一个消息类型（`consumeRestoreState`）与一次消息往返；状态通过 `args`
    直接交给注入函数，页面不需要知道存储结构；
  - 隐私叙事从「扩展默认存在于每个页面」变成「只有你主动唤醒时才注入」。
- 负面 / 需要接受的代价：
  - `onUpdated` 每次页面加载完成都会做一次存储查询（判断该标签页是否有状态）。
    这与原先内容脚本每次加载做一次查询等价，且省掉了注入本身，所以总体更省；
  - 恢复依赖 MV3 事件送达。`tabs.onUpdated` 是会自动唤醒 Service Worker 的注册监听器，
    但如果注入连续失败，恢复会推迟到下一次加载（不会丢失）；
  - `verify-in-browser.py` 的恢复断言从"内容脚本自己来领"改成"等 worker 注入"，
    断言内容不变，机制变了。
- 权限：**不变**。`<all_urls>` 仍然需要——休眠时要注入采集函数；`scripting` 也仍需要。
  所以安装提示没有任何变化，这项改动的收益是运行时开销与代码质量。

## 替代方案

- **保留常驻内容脚本（ADR-0004 的方案）**：不依赖时序，但代价是每个页面都被注入、
  以及一份永远删不掉的重复实现。既然注入时机的把握问题已经用实测解决，这个代价
  不再有理由继续支付。
- **在 `onActivated` 里立刻注入**：实测 4% 成功率，静默失败。否决。
- **用 `chrome.tabs.onUpdated` 的 `loading` 阶段注入**：同上，document 尚未就绪。否决。
- **不注入，改为唤醒后由页面轮询扩展**：又需要常驻脚本。否决。

## 相关

- [0004 页面上下文与 Service Worker 的代码共享边界](0004-page-context-code-sharing.md)（被本决策取代）
- [0003 运行时状态放入 `chrome.storage.session`](0003-session-storage-for-runtime-state.md)
- [ROADMAP L1：原型实测数据](../ROADMAP.md)
