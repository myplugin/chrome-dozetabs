# 路线图 / Roadmap

> 这里记录**已确认要做**的事、**明确不做**的事，以及待讨论的想法。
> 想推动某一项，请开 issue 引用对应编号。

图例：🟢 已完成　🟡 已排期　🔵 待认领　⚪ 需要先设计　⛔ 明确不做

---

## 下一步（Next）

### 🔵 N1. 把 favicon 抓取换成 Chrome 内置的 `favicon` 权限

**问题**：弹窗展示标签页图标时，Service Worker 会用 `fetch()` 去抓页面声明的
`favIconUrl`。这是本扩展**唯一**的对外网络请求。

**方案**：Chrome 102+ 提供 `favicon` 权限与
`chrome-extension://<id>/_favicon/?pageUrl=...&size=32` 端点，可直接在弹窗的 `<img src>`
里使用。

**收益**：对外请求降为 0，`PRIVACY.md` 与商店隐私声明可以从
「唯一的对外请求是页面自己的图标」升级为「零对外请求」。

**注意**：`favicon` 权限不产生用户可见的安装警告，因此这是纯粹的改进；
但必须真机验证图标在 Chrome 与 Edge 上都正常显示，且 `_favicon/` 需要
`web_accessible_resources` 之类的配套声明。改动会影响 `manifest.json`，
按破坏性变更处理。

**验收**：弹窗列表图标全部正常；抓包确认无对外请求。

---

### 🟢 N2. 整理 `scripts/` 下的真机脚本 —— 已完成（2026-10）

已按原计划处理：

- 抽出 `scripts/_browser.py`（启动 / 按 profile 杀进程 / 找 Service Worker /
  本地 HTTP 服务 / 退出码汇总），`smoke-test.py` 与新脚本共用；
- **删除** `popup-e2e-probe.py`（`active_before` 未定义导致每次必崩，从未完整跑通过）
  与 `sw-log-probe.py`（检查失败仍以 0 退出，假绿；且它宣传的"dump SW 日志"能力
  在 Playwright 下根本不可用）；
- **新增** `scripts/verify-in-browser.py`：38 项断言、退出码可信，覆盖扩展加载、
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

### 🔵 N3. 弹窗标签页列表的等待策略

**问题**：休眠/唤醒后弹窗用固定 `setTimeout(150ms)` 等界面刷新，属于"赌它已经生效"。

**方案**：改为对目标标签页做有界轮询（`chrome.tabs.get` 直到 `discarded` 状态符合预期，
上限 ~1s）。最快路径更快，慢机器上更稳。

---

## 之后（Later）

### ⚪ L1. 移除常驻内容脚本

**现状**：`content/content-script.js` 在 `<all_urls>` 上以 `document_idle` 常驻运行，
只为在唤醒时恢复滚动位置与表单内容。

**想法**：改为唤醒时按需 `chrome.scripting.executeScript({ files: [...] })` 注入，
并从 `manifest.json` 移除 `content_scripts`。收益：

- 每个页面少一个常驻脚本与一次 `storage` 查询；
- 可以彻底消除 `content-script.js` 与 `tab-state.js` 之间的表单逻辑重复
  （见 [ADR-0004](adr/0004-page-context-code-sharing.md)）；
- 商店审核时的权限叙事更简单。

**风险**：注入时机与页面加载存在竞态。当前「休眠时落盘、页面一次性领取」的设计
是刻意规避竞态的，改成注入必须保证注入发生在正确的 document 上。需要先做原型验证。

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

### ⚪ L3. 统计维度

目前只有 `totalSlept` / `totalWoken` 两个全量计数。可以考虑记录「本次会话节省的标签页数」
「自动休眠占比」等，帮助用户理解设置的实际效果。需要先确认这不是为了堆功能。

---

### 🔵 L4. Gitee 镜像的 CI

当前 CI 只跑在 GitHub Actions。若 Gitee 侧需要门禁，需要新增一份 Gitee Go 配置
（语法与 Actions 不同）。**在有实际使用者之前不引入无法验证的配置**
（见 [RELEASING.md 第 6 节](RELEASING.md#6-gitee-镜像)）。

---

### ⚪ L5. 名称与品牌

`Tab Sleep` / `Tab Sleep Tool` 与应用商店中已有的同名扩展高度重合，存在检索与商标风险。
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
`scripts/verify-in-browser.py`（38 项断言），并借它完成了对本轮重构的真机验证：
弹窗与选项页渲染、状态采集（含密码排除）、唤醒恢复握手。
过程中还抓出并修复了一个只有端到端运行才会暴露的启动清扫回归。
详见 [N2](#-n2-整理-scripts-下的真机脚本--已完成2026-10)。

### 🟢 D1. 工程化与缺陷整改（2026-10）

一次完整的系统审计与整改：拆分 1025 行的 Service Worker、修复 5 个阻断级缺陷、
把测试从 37 项提升到 120 项并迁移到零依赖的 Node 测试运行器、重建打包与校验工具、
补齐治理与架构文档。详见 [AUDIT.md](AUDIT.md) 与 [CHANGELOG](../CHANGELOG.md)。
