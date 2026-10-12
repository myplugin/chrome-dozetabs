# 路线图 / Roadmap

> 这里记录**已确认要做**的事、**明确不做**的事，以及待讨论的想法。
> 想推动某一项，请开 issue 引用对应编号。

图例：🟢 已完成　🟡 已排期　🔵 待认领　⚪ 需要先设计　⛔ 明确不做

---

## 下一步（Next）

### 🟢 N1. 把 favicon 抓取换成 Chrome 内置的 `favicon` 权限 —— 已完成（2026-10）

原先弹窗展示标签页图标时，Service Worker 会用 `fetch()` 去抓页面声明的 `favIconUrl`
——那是本扩展**唯一**的对外网络请求。

现已改用 Chrome 102+ 内置的 `_favicon/` 端点：弹窗直接引用
`chrome-extension://<id>/_favicon/?pageUrl=…&size=32`，图标由浏览器从自己的缓存提供。

**收益**：对外请求降为 **0**。`PRIVACY.md` 与商店隐私声明从「唯一的对外请求是页面
自己的图标」升级为「零对外请求」；同时删掉了 `background/favicon.js`（45 行）、
`fetchFavicon` 消息类型，以及弹窗里的并发抓取与 SW 内存缓存。

**意外的额外收益**：原先用的是 `tab.favIconUrl`，而**被休眠的标签页没有这个字段**，
所以休眠中的标签页一直显示占位图。新的查询按**页面 URL** 取图标，休眠标签页也能显示
真实图标。

**关于权限**：加了 `favicon`。按官方文档，它**只在尚未申请 `tabs` 或主机权限时才
触发安装警告**；本项目两者都有，所以安装提示一字未变。另外 `web_accessible_resources`
**只在内容脚本里用图标时才需要**——我们在弹窗（扩展自己的页面）里用，不需要声明，
也就不会把资源暴露给网页。

**验收（已完成）**：

- `npm run validate` 新增 **privacy** 段：扫描 `src/` 中任何 `fetch()` /
  `XMLHttpRequest` / `WebSocket` 即判定失败——把这条承诺变成 CI 强制的规则，
  而不是文档里的一句口号；
- `verify-in-browser.py` 新增 3 项断言（真机 Edge 通过）：弹窗图标不来自网络、
  manifest 已声明权限、`_favicon/` 端点确实返回了图片。

---

### 🟢 N2. 整理 `scripts/` 下的真机脚本 —— 已完成（2026-10）

已按原计划处理：

- 抽出 `scripts/_browser.py`（启动 / 按 profile 杀进程 / 找 Service Worker /
  本地 HTTP 服务 / 退出码汇总），`smoke-test.py` 与新脚本共用；
- **删除** `popup-e2e-probe.py`（`active_before` 未定义导致每次必崩，从未完整跑通过）
  与 `sw-log-probe.py`（检查失败仍以 0 退出，假绿；且它宣传的"dump SW 日志"能力
  在 Playwright 下根本不可用）；
- **新增** `scripts/verify-in-browser.py`：42 项断言、退出码可信，覆盖扩展加载、
  设置默认值、弹窗/选项页渲染、状态采集（含密码排除）与唤醒恢复握手。
  已在本机真实 Edge 上跑通；
- 修掉 `get_sw()` 死代码、`relaunched_at` 未使用、无效的 `--enable-extensions` 开关；
- `measure-memory.ps1` 改为可按 `-Profile` 过滤进程，并支持 `-MaxWorkingSetGb`
  阈值决定退出码；同时补 UTF-8 BOM，修正 Windows PowerShell 5.1 下的中文乱码；
- 新增 `scripts/requirements-dev.txt` + `npm run lint:py`（pyflakes），并接入 CI——
  正是这类检查能在不启动浏览器的情况下抓出 `active_before` 那种错误。

**过程中发现并修复了一个产品缺陷**：为 `sweepStartupTabs()` 增加"必须窗口打开"的
授权检查后，真机脚本"写 `storage.session` + 手动触发清扫"的测试钩子失效了
（新代码只在 Worker 启动时读一次窗口边界）。现已通过
`adoptStartupWindowFromSession()` 修复，且保持"只有打开的窗口才允许丢弃"这一不变量。
这是本轮唯一一个**只有真机端到端运行才能暴露**的问题。

**残留**：`scripts/smoke-test.py` 在 Playwright 下无法完成 discard 之后的步骤
（浏览器会退出），已按环境限制处理：退出码 2 + 明确提示，不再抛堆栈。
内存 A/B 仍需按 [STARTUP-SUSPEND-TEST.md](STARTUP-SUSPEND-TEST.md) 人工执行。

---

### 🟢 N3. 弹窗标签页列表的等待策略 —— 已完成（2026-10）

原先休眠/唤醒后弹窗用固定 `setTimeout(150ms)` 等界面刷新——本质是在赌浏览器已经
处理完：快机器上白等，慢机器上仍可能渲染出旧状态。

已新增 `src/utils/tab-wait.js`，改为**对真实状态做有界轮询**：

- 单页休眠：轮询到该标签页确实进入 slept 状态；
- 单页唤醒：轮询到该标签页不再是 slept；
- 批量休眠：轮询到窗口内 slept 数达到「原先数 + 本次 slept 数」；
- 上限 1200ms，标签页消失或超时即放弃并照常渲染，不会卡住界面。

`loadTabs(delay, preserveScroll)` 中的 `delay` 参数随之删除，改为
`loadTabs({ preserveScroll })`。

轮询逻辑刻意抽到 `utils/` 而不是留在 popup 里——这样它可以用 chrome mock 单测
（9 项断言覆盖：立即满足、轮询到状态变化、超时放弃、标签页消失、批量计数）。
popup 自身的时序行为仍只能靠真机验证，`scripts/verify-in-browser.py`
覆盖了「模块可加载 + 界面无未捕获错误」。

---

## 之后（Later）

### 🟢 L1. 移除常驻内容脚本 —— 已完成（2026-10）

**现状**：`content/content-script.js` 通过 manifest 的 `content_scripts` 声明，
在 `<all_urls>` 上以 `document_idle` **注入到你访问的每一个网页**。它每次页面加载
都跑一次，只做一件事：问 Service Worker「这个标签页有保存的状态要恢复吗？」
——绝大多数时候答案是「没有」。

**想法**：从 manifest 移除 `content_scripts`，改为**只在唤醒休眠标签页时按需注入**。
收益：

- 每个页面少一个常驻脚本、少一次 `storage` 查询；
- 可以彻底消除 `content-script.js` 与 `tab-state.js` 之间最后那处表单逻辑重复
  （[ADR-0004](adr/0004-page-context-code-sharing.md) 可随之废弃）；
- 隐私叙事更干净：扩展默认不出现在页面里，只有你主动唤醒时才注入。

注意 `<all_urls>` 主机权限**不会因此减少**（休眠时仍需要注入采集脚本），
所以安装警告不变——这项的收益是运行时开销与代码简化，不是权限。

**原型结论（2026-10，真机 Edge 实测）**：

关键问题是**注入时机**。两种做法的成功率：

| 做法                                                          | 成功落地率          | 失败原因                                                                   |
| ------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------- |
| A. 察觉唤醒后立刻注入（`onActivated` 里直接 `executeScript`） | **1 / 25（4%）**    | `Frame with ID 0 was removed.`——旧 document 已被销毁，新 document 尚未就绪 |
| B. 等 `onUpdated` 报 `status === 'complete'` 再注入           | **25 / 25（100%）** | 无                                                                         |

结论：**那种"直觉上最自然"的写法基本必然失败**，而这个失败是静默的——
`executeScript` 抛错、页面照常加载、只是滚动位置和表单内容没了。所以必须走事件驱动：

1. `onActivated` 发现被 discard 的标签页 → 记入待恢复集合（状态早已在存储里）；
2. `onUpdated` 收到该标签页 `status === 'complete'` → 读取状态、
   `executeScript({ func: restoreState, args: [state] })` → 清除存储条目。

顺带一个简化：既然由扩展主动注入，状态可以直接通过 `args` 传给注入函数，
**不再需要 `consumeRestoreState` 消息往返**，页面也不必知道存储结构。

**测量方式的边界**：原型用 `chrome.tabs.reload` + 立即注入来模拟唤醒。
真实的 `discard → 激活 → Chrome 自动重载` 序列无法在此环境测量——一旦
`discard()` 真的丢弃了 Playwright 接管的标签页，浏览器进程会退出（见
[TESTING.md 第 2.3 节 C](TESTING.md#23-真机验证-scripts)）。但失败原因是
"document 被替换"，与导航由谁发起无关；而做法 B 是事件驱动的，不依赖导航的发起方。

**实施结果（已完成）**：

- `manifest.json` 移除 `content_scripts`，删除 `src/content/`；
- `captureTabState` 与 `restoreTabState` 现在同住 `src/background/tab-state.js`
  ——**ADR-0004 记录的那处重复彻底消失**，该 ADR 已标记废弃；
- 恢复改由 `onUpdated (status === 'complete')` → `restoreIntoTab()` 注入，
  **注入成功后才删除存储条目**，失败重试 3 次，不丢数据；
- 少一个消息类型（`consumeRestoreState`）与一次消息往返——状态通过 `args`
  直接交给注入函数；
- `verify-in-browser.py` 的原有恢复断言（滚动位置、input/textarea/select、
  一次性消费、不重放）**未改一行**就通过了，因为它们现在测的正是新机制；
  另加一条断言锁死"manifest 中不得再有 content_scripts"。
- 权限不变（`<all_urls>` 仍需用于休眠时的采集），安装提示无变化。

---

### 🟢 L2. 存储占用与清理策略 —— 已完成（2026-10）

`sleepingTabs` 此前只靠「唤醒即领取删除」+「标签页关闭即删除」维持，浏览器被强杀
（或休眠后再也没被唤醒）留下的条目会一直堆积。

已实现 `pruneSleepingTabs()`，在**浏览器启动**（`onStartup`）与扩展安装/更新
（`onInstalled`）时执行一次：删除所有对应标签页已不存在的条目。

这不只是省空间——**标签页 ID 只在一次浏览器运行内唯一**，残留条目可能与新分配的
ID 撞车，把滚动位置/表单内容恢复到无关的页面上。在 `onStartup` 阶段清理，
正好赶在会话恢复分配新 ID 之前。

**验收**：单元测试覆盖批量删除与「无匹配则不写入」；集成测试构造
`{1:…, 999:…}`（只有 1 存在）触发 `onStartup`，断言只剩 `['1']`。

**残留**：若 `onStartup` 在部分标签页已恢复之后才触发，这些标签页的**上一轮**
条目会被保留（它们同样是无效的，因为 ID 跨运行不通用）。要彻底解决需要给条目
打上"浏览器运行 ID"标记，属于额外复杂度，暂不做。

---

### ⛔ L3. 统计维度 —— 已决定不做（2026-10）

曾考虑记录「本次会话节省的标签页数」「自动休眠占比」「大约省了多少 MB」等。

**决定不做**，理由：

- 估算内存是伪科学——同一个标签页从几 MB 到几百 MB 都有，任何"省了 X MB"的数字
  都无法验证，很容易变成**看起来精确但实际误导**的界面文案；
- 现有两个全量计数（累计休眠 / 唤醒次数）已经能说明功能在工作，再加维度只是让
  选项页变长；
- 属于典型的"没人要的功能"。等有用户提出具体想看什么再做。

如果将来要做，底线是：只加可如实统计的维度（次数、时长），**绝不显示估算的内存数字**。

---

### 🔵 L4. Gitee 镜像的 CI

当前 CI 只跑在 GitHub Actions。若 Gitee 侧需要门禁，需要新增一份 Gitee Go 配置
（语法与 Actions 不同）。**在有实际使用者之前不引入无法验证的配置**
（见 [RELEASING.md 第 6 节](RELEASING.md#6-gitee-镜像)）。

---

### ⚪ L5. 名称与品牌

`Dozetabs` / `Dozetabs` 与应用商店中已有的同名扩展高度重合，存在检索与商标风险。
若要长期运营，建议确定一个更具辨识度的名字，并同步 README、`manifest.json`
的 `__MSG_extName__`、GitHub 仓库名与应用商店条目。

**这是一个需要项目所有者决策的事项，不由贡献者自行更改。**

---

## 明确不做（Non-goals）

| 事项                                  | 原因                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 会话保存/恢复、标签页分组、垂直标签栏 | 已有成熟扩展，不是本项目的价值点                                                                          |
| 用自定义占位页替换被休眠的页面        | 会破坏站点真实行为，同类扩展的历史事故都源于此（[ADR-0001](adr/0001-native-discard-over-placeholder.md)） |
| 支持 Firefox / Safari                 | `chrome.tabs.discard` 与 MV3 模型差异过大，会显著增加分支成本                                             |
| 引入打包器 / TypeScript / 框架        | `src/` 直接可加载是本项目刻意保留的简单性（[ADR-0002](adr/0002-no-build-step.md)）                        |
| 云同步设置、账号体系、遥测            | 与 [PRIVACY.md](../PRIVACY.md) 的承诺冲突                                                                 |

---

## 已完成（Done）

### 🟢 D2. 真机脚本整理与浏览器验证（2026-10）

删除两个不可信的探针脚本，新增可在自动化环境稳定通过的
`scripts/verify-in-browser.py`（42 项断言），并借它完成了对本轮重构的真机验证：
弹窗与选项页渲染、状态采集（含密码排除）、唤醒恢复握手。
过程中还抓出并修复了一个只有端到端运行才会暴露的启动清扫回归。
详见 [N2](#-n2-整理-scripts-下的真机脚本--已完成2026-10)。

### 🟢 D1. 工程化与缺陷整改（2026-10）

一次完整的系统审计与整改：拆分 1025 行的 Service Worker、修复 5 个阻断级缺陷、
把测试从 37 项提升到 137 项并迁移到零依赖的 Node 测试运行器、重建打包与校验工具、
补齐治理与架构文档。详见 [AUDIT.md](AUDIT.md) 与 [CHANGELOG](../CHANGELOG.md)。
