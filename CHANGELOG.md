# 更新日志 / Changelog

本文件记录所有值得注意的变更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
`src/manifest.json` 的 `version` 字段是版本号的唯一来源。

## [Unreleased]

### 修复

- **ADR-0004 里有一条失效链接**：它仍指向 `src/content/content-script.js`，而该文件
  已在 ADR-0008 中被删除。ADR 正文作为决策历史保留（不重写），但链接改为纯文本并
  注明「该文件已删除」，避免读者点进一个空响应。
- **`[Unreleased]` 的对比链接仍指向 `v1.0.0`**，且缺少 `[1.1.0]` 链接定义。
  发布 1.1.0 时漏改，现已补齐。（只影响仓库文档，不进打包产物。）
- **文档把 GitHub 镜像描述成「公开镜像」，但它实际上是私有的**：未认证访问
  `github.com/myplugin/chrome-tab-sleep` 与对应的 REST API 都返回 404，而仓库确实
  存在于该路径下（能推送、`git ls-remote` 有响应）——是可见性设置，不是路径写错。
  已改为如实描述，并写清后果：`.github/` 下的 issue 模板与其中的链接，外部贡献者
  **看不到也点不开**，面向外部的交流事实上全部发生在 Gitee。**该问题随后已由所有者
  在仓库设置中改为 public 彻底解决**，见下方「仓库公开与改名」。
- **`docs/RELEASING.md` 写死了维护者的本机环境信息**：原文把 SSH key 文件名
  （含机器名）与主机别名当作通用指引写给所有读者——这些路径对别人毫无意义，
  且会随仓库公开而暴露维护者的环境细节。现改为通用示例（`github-myaccount`），
  保留「别名必须覆盖主机名，否则裸 `git@github.com:...` 不会用到那把 key」这个
  真正的知识点，把每台机器各自的配置交回 `~/.ssh/config`。
  （公开前的整仓库扫描确认：历史 56 个提交中无密钥/令牌，两个作者邮箱均为
  noreply 地址，无本机绝对路径。）
- **`branch` 校验段会误杀所有 PR（自行引入的回归）**：该段把文档里出现的分支名与仓库
  真实存在的分支比对，却拿 `refs/heads` + `refs/remotes` 的全量当依据——而
  `actions/checkout` 在 `pull_request` 事件下**只取 PR 的 merge ref**，`master` 根本
  不在其中，于是每一条本来正确的分支引用都被判成「不存在」。已实测复现：在只含
  `refs/remotes/pull/4/merge` 的检出里直接
  `FAIL .github/ISSUE_TEMPLATE/config.yml names the branch "master"`——也就是说，
  它会拦住**每一个**贡献者的 PR，而本地完整克隆里一切正常，所以极易漏检。
  现改为只以「**已配置 remote 的远端跟踪分支**」为证据：正常克隆有、PR 检出没有，
  于是后者**跳过并说明原因**，而不是拿不完整的信息去猜。检测能力未被削弱——
  在完整克隆里注入 `main` 仍然失败。

### 变更

- **GitHub 仓库已由所有者改为 public，并改名为 `chrome-dozetabs`**（原名
  `chrome-tab-sleep`）。后果：
  - `.github/` 下的 issue 模板、PR 模板、CODEOWNERS、Dependabot 与 Actions
    对所有人可见并开始生效；三个对外联系链接已实测匿名返回 200；
  - 仓库一旦公开即应视为**准单向操作**——技术上可改回 private，但代码可能已被
    fork、被搜索引擎与第三方镜像缓存，改回去也收不回来；
  - **Gitee 侧没有改名**，仍是 `xplugins/chrome-tab-sleep`。两个平台因此有了不同的
    仓库名，`docs/RELEASING.md` 的 remote 表已按实际情况分别记录；
  - 公开仓库的 Actions 标准运行器不再消耗私有仓库的计费额度。
- `v1.1.0` 的 Release 已由 `release.yml` 自动创建，并附带
  `dozetabs-v1.1.0.zip`（51.26 KB）——这也顺带确认了此前无法核实的那次发布工作流
  确实跑成功了。

### 工程化

- `tool/validate.js` 新增第 6 个校验段 `links`：解析全部 Markdown 的相对链接
  （26 个文件、133 条）并检查目标文件是否存在。外部 URL **刻意不抓取**——
  会联网的校验器在网络不通时会失败，而 `npm run validate` 必须能离线运行。

## [1.1.0] - 2026-10-13

一次面向开源协作的整体工程化整改：修复阻断级缺陷、拆分核心模块、重建测试与
工具链，并补齐治理与架构文档。对外行为**基本保持不变**，例外见下方「变更」。

### 重命名

- 项目原名 **Tab Sleep**，现更名为 **Dozetabs**（月亮图标 + doze「打盹」，
  与它的实际行为一致）。更名原因：应用商店里已有多个同名的标签页休眠扩展，
  搜索时容易被淹没；现在尚未发布、没有用户，是改名成本最低的时刻。
- 同步更新：扩展显示名（英文 `Dozetabs`、中文 `Dozetabs 标签页休眠`）、
  `package.json`、打包产物名（`dozetabs-v<version>.zip`）、本地日志前缀
  （`[Dozetabs]`）以及全部文档。
- **未改**：Gitee / GitHub 上的仓库名仍为 `chrome-tab-sleep`，
  因此 remote 地址与 CI 配置不受影响；如需一并改名，仓库设置里操作后
  同步 `git remote set-url` 即可。

### 修复

- **真机测试钩子回归**：给 `sweepStartupTabs()` 加上「必须窗口打开」的授权检查后，
  `scripts/smoke-test.py` 依赖的「写 `chrome.storage.session` + 手动触发清扫」路径
  失效——新代码只在 Service Worker 启动时读取窗口边界一次。生产路径（`onStartup`）
  不受影响；现已通过 `adoptStartupWindowFromSession()` 修复，并保留
  「只有打开的窗口才允许丢弃标签页」这一不变量。
- **弹窗「唤醒」按钮从未触发状态恢复**：弹窗直接调用 `chrome.tabs.reload()`，
  绕过了 Service Worker 的唤醒处理，导致滚动位置/表单内容恢复与唤醒计数
  在这条路径上完全失效。现在统一经由 `WAKE_TAB` 消息处理。
- **批量休眠时统计与状态丢失**：`incrementSleepCount()`、`saveSleepingTab()` 等
  读-改-写操作在不同时并发保护下会互相覆盖。现在按存储键串行化
  （`utils/storage.js:withStorageLock()`）。
- **自动休眠实际上很少生效**：空闲时间记录只存在于 Service Worker 内存中，
  而 MV3 的 Worker 约 30 秒空闲即被回收，导致每个标签页的计时器被反复重置。
  现在记录持久化到 `chrome.storage.session`，并改为跨所有窗口判断。
- **休眠当前标签页会不断产生空白标签页**：原先总是新建 `about:blank`。
  现在优先切到相邻标签页，仅在窗口无其他可用标签页时才新建。
- **`node tool/build.js` 无法运行**：`package.json` 为 `"type": "module"`，
  而脚本使用 `require()`，直接抛出 `ReferenceError`。
- **`tool/build.sh` 产出的 zip 结构错误**：把整个目录作为顶层项打包
  （`dozetabs-v1.0.0/manifest.json`），会被 Chrome 应用商店拒绝。
- **`confirmSleepAll` 是「幽灵设置」**：README 与单元测试都声称存在
  「休眠其他标签页前先确认」，但代码从未实现、选项页也没有开关。现已完整实现
  （选项页开关 + 弹窗确认框）。
- 选项页页脚硬编码版本号 `v1.0.0`，现在从 `chrome.runtime.getManifest()` 读取。
- 扩展安装/更新触发的 Worker 重载不再可能误开启动休眠窗口，
  并为该不变量补上独立测试。
- `handleMessage()` 现在拒绝来自其他扩展的消息（`sender.id` 校验），
  并通过 `sanitizeSettings()` 丢弃设置中的未知键。
- **残留的休眠状态可能被错误复用**：`sleepingTabs` 此前只在「唤醒时领取」与
  「标签页关闭」时清理，浏览器被强杀（或休眠后再未被唤醒）留下的条目会持续堆积；
  而标签页 ID 只在单次浏览器运行内唯一，残留条目可能与新分配的 ID 撞车，把滚动位置
  与表单内容恢复到无关的页面上。现在会在浏览器启动与扩展安装/更新时清理所有对应
  标签页已不存在的条目（`pruneSleepingTabs()`）。
- **文档与 CI 配置把默认分支名写成了 `main`**：仓库的默认分支实际是 `master`，
  而 `.github/ISSUE_TEMPLATE/config.yml` 的三个链接、`CONTRIBUTING.md` 的分支说明、
  `docs/RELEASING.md` 的发布命令一共 7 处都写成了 `main`。后果不止「文档不准」：
  issue 选择页的三个链接全部 404，贡献者照做 `git checkout main` 直接失败，
  而**照着发布流程推送分支与 tag 时会报 `src refspec main does not match any`
  ——文档里那条发版路径从未真正可用过**。
  现已全部改为 `master`，并新增 `branch` 校验段（见下）防止再次漂移。

### 变更

- **弹窗图标不再抓取网络**：原先打开弹窗时，Service Worker 会 `fetch()` 每个标签页
  声明的 `favIconUrl`——那是本扩展唯一的对外网络访问。现改用 Chrome 内置的
  `_favicon/` 端点（`chrome-extension://<id>/_favicon/?pageUrl=…`），图标由浏览器从
  自身缓存提供，**对外请求数归零**。`manifest.json` 增加 `favicon` 权限；因已申请
  `tabs` 与主机权限，按官方说明不产生新的安装警告。附带修复：休眠中的标签页原先
  没有 `favIconUrl`、只能显示占位图，改为按页面 URL 查询后能显示真实图标。
  同时删除了 `background/favicon.js`、`fetchFavicon` 消息类型与弹窗里的并发抓取逻辑。
- **新增 privacy 校验**：`npm run validate` 会扫描 `src/`，出现 `fetch()` /
  `XMLHttpRequest` / `WebSocket` 即判定失败——把「零对外请求」从文档承诺变成 CI 规则。
- **「休眠其他标签页」默认会先弹出确认框**（与 README 早已声明的行为一致，
  可在选项页关闭）。
- 休眠失败的原因由英文句子改为稳定的原因码，由界面按当前语言渲染
  （新增 8 条中英文案）。
- **弹窗不再依赖固定延时刷新**：休眠/唤醒/批量休眠后原先统一 `setTimeout(150ms)`
  再重渲染，本质是赌浏览器已处理完——快机器上白等，慢机器上仍可能显示旧状态。
  现改为对目标标签页做有界轮询（`src/utils/tab-wait.js`，上限 1200ms，
  超时或标签页消失即放弃），批量休眠则等到 slept 数达到预期值。
  轮询逻辑抽到 `utils/` 以便单测，新增 9 项断言。

### 重构

- **移除常驻内容脚本**：原先 `content/content-script.js` 通过 `content_scripts`
  注入到用户访问的**每一个网页**，每次加载都跑一次，只为问一句「有状态要恢复吗」。
  现已从 manifest 移除、文件删除，恢复改为在标签页**加载完成时按需注入**。
  注入时机是这件事的关键：实测在标签页刚开始重载时注入只有 **1/25** 成功率
  （`Frame with ID 0 was removed.`），等 `status === 'complete'` 则是 **25/25**；
  而且失败是静默的——页面照常打开，只是滚动位置和表单内容悄悄没了。
  因此实现为事件驱动，并且**只在注入成功后才删除存储条目**（失败重试 3 次，不丢数据）。
  连带收获：`captureTabState` 与 `restoreTabState` 终于住进同一个文件，
  **ADR-0004 记录的那处无法消除的重复消失了**，该 ADR 标记废弃。
  权限不变，安装提示无变化。
- `src/background/service-worker.js` 由 **1025 行**拆分为 10 个职责单一的模块，
  入口文件只保留事件接线（约 150 行），不再包含业务规则。
- 消除三处重复实现：白名单/域名匹配、浏览器内部页面判定、标签页休眠状态判定；
  表单采集因内容脚本无法 `import` 而保留一份精简实现，并在架构文档中说明原因。
- 删除全部死代码：未被处理的消息类型（`getTabState`/`saveTabState`/
  `restoreTabState`/`updateBadge`/`isTabLocked`/`getStartupStatus`/`autoSleepStatus`）、
  未使用的 `ICONS` 与 `CHROME_INTERNAL_SCHEMES` 副本、内容脚本中无人发送的
  `captureState`/`restoreState` 协议、打包脚本中的无用引用。
- 休眠状态恢复不再依赖 `setTimeout(5000)` 清理：状态在休眠时即已落盘，
  页面唤醒时通过 `consumeRestoreState` **一次性**领取并立即删除，消除了时序竞态。
- 批量休眠与自动休眠改为一次性加载设置/白名单/锁（原先每个标签页重复读取 3 次）。

### 工程化

- 新增 **ESLint 10**（flat config）与 **Prettier**，`.editorconfig`、`.gitattributes`、
  `.nvmrc`；`npm run check` 一条命令跑完格式、静态检查、一致性校验与测试。
- 测试栈从 vitest 迁移到 **Node 内置 `node:test`**，实现零运行时依赖的测试：
  断言数由 37 增至 **137**，覆盖存储层并发、设置清洗、休眠判定矩阵、
  消息路由与启动休眠不变量；`tests/helpers/chrome-mock.js` 提供可复用的 chrome API 模拟。
- 新增 `tool/validate.js`：校验 manifest 引用、多语言 key 对齐、
  消息类型「声明即处理」，并修正了原 i18n 检查脚本的误报
  （把 `Event('input'` 误判为 `t('input'`，以及漏掉 `data-i18n-placeholder`）。
- `tool/validate.js` 新增第 5 个校验段 `branch`：扫描 `.md` / `.yml` 中
  `…/blob/<branch>/`、`git push <remote> <branch>`、`refs/heads/<branch>`
  这三类位置上出现的分支名，与本仓库真实存在的分支比对，不一致即失败。
  规则刻意写得窄——只在分支名义无歧义的位置取值，所以文档里「切一个 `feat/xxx`
  分支」这类示例不会被误判；不在 git 仓库中运行时自动跳过而非报错。
- 打包工具重写为单一实现 `tool/build.js` + 自研零依赖 `tool/zip.js`：
  不再依赖 `zip`/PowerShell，跨平台产出一致，条目位于压缩包根目录。
- 新增 GitHub Actions CI（Node 20/22/24 矩阵 + 打包校验）与 Release 工作流。
- 新增 `.github/workflows/mirror-gitee.yml`：Gitee（主平台）→ GitHub（镜像）
  每 6 小时自动同步分支与 tag，并在同一次运行里完成校验与打包。
- 重构真机脚本：抽出 `scripts/_browser.py`；删除 `popup-e2e-probe.py`（未定义变量
  导致每次必崩、从未完整跑通）与 `sw-log-probe.py`（检查失败仍返回 0，假绿）；
  新增 `scripts/verify-in-browser.py`——42 项断言、退出码可信，覆盖扩展加载、
  设置默认值、弹窗与选项页渲染、状态采集（含密码排除）与唤醒恢复握手。
- `scripts/measure-memory.ps1` 支持 `-Profile` 过滤与 `-MaxWorkingSetGb` 阈值退出码，
  并补 UTF-8 BOM 以修正 Windows PowerShell 5.1 下的中文乱码。
- 新增 Python 静态检查（`pyflakes`，`npm run lint:py`）并接入 CI：这类检查能在不启动
  浏览器的情况下抓出 `active_before` 那种未定义变量错误。
- 补齐开源治理文件：CONTRIBUTING、CODE_OF_CONDUCT、SECURITY、PRIVACY、
  CHANGELOG、Issue/PR 模板、CODEOWNERS、Dependabot。

### 移除

- `tool/build.sh`、`tool/build.bat`（与 `build.js` 三份实现互相漂移）、
  `vitest.config.js`、`tests/i18n-check.mjs`（由 `tool/validate.js` 取代）、
  `scripts/popup-e2e-probe.py`、`scripts/sw-log-probe.py`（由
  `scripts/verify-in-browser.py` 取代）。

### 为什么是 MINOR 而不是 MAJOR

[RELEASING.md](docs/RELEASING.md) 把「权限调整」列为破坏性变更，理由是新增权限会改变
**所有已安装用户**的更新提示。本次确实给 `manifest.json` 增加了 `favicon` 权限，
但这不构成破坏性变更：扩展早已申请 `tabs` 与 `<all_urls>` 主机权限，按 Chrome 官方
说明，`favicon` 不会再产生新的安装提示，用户侧的授权范围与更新体验都没有变化。
除此之外，本次没有删改任何设置项的语义，存储结构向后兼容。因此定为 **1.1.0**。

## [1.0.0] - 2026-03-17

首个公开版本。

### 新增

- 基于 Chrome 原生 `chrome.tabs.discard()` 的标签页休眠：休眠当前页 / 休眠其他页
- **启动抢先休眠**：浏览器重启后恢复的标签页保持未加载，点击才加载
- 自动休眠（按空闲时长）
- 唤醒时恢复滚动位置与表单内容（不含密码）
- 域名白名单（支持 `*.example.com` 通配）与单个标签页锁定
- 智能排除：固定标签页、正在播放声音的标签页、浏览器内部页面
- 中英文国际化、右键菜单、`Alt+S` / `Alt+Shift+S` 快捷键、图标角标计数
- 打包脚本与三层测试（单元 / 逻辑 / 真机冒烟）

[Unreleased]: https://github.com/myplugin/chrome-dozetabs/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/myplugin/chrome-dozetabs/releases/tag/v1.1.0
[1.0.0]: https://github.com/myplugin/chrome-dozetabs/releases/tag/v1.0.0
