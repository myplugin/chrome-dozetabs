# 架构说明 / Architecture

> 面向要修改这个扩展的人。读完本文你应该能：说清每个文件负责什么、
> 一条消息从弹窗到 Chrome API 经过哪些环节、以及哪些约束是**不能**违背的。

---

## 1. 项目定位

### 它解决什么问题

浏览器把每个标签页都跑在独立渲染进程里。开的标签页越多，后台进程越吃内存；
更糟的是**浏览器重启**——会话恢复会把上百个标签页同时加载，内存直接冲到十几 GB，
机器在接下来几分钟里基本不可用。

### 目标

| 目标                                 | 对应能力                          |
| ------------------------------------ | --------------------------------- |
| 不关闭标签页也能释放内存             | 原生 `chrome.tabs.discard()`      |
| **重启后不要让恢复的标签页一起加载** | 启动抢先休眠（本项目核心）        |
| 好页面不被误伤                       | 白名单 + 单页锁定 + 固定/发声排除 |
| 唤醒后回到原来的位置                 | 滚动位置与表单内容恢复            |
| 用户不需要盯着它                     | 自动休眠                          |

### 非目标（明确的边界）

- **不替代标签页管理器**：不做会话保存/恢复、不做分组、不做垂直标签栏。
- **不做假页面**：休眠后**不**把页面替换成自定义 DOM。一旦注入占位页，
  就再也无法保证站点的真实行为（这也是同类扩展历史上出问题的根源）。
- **不保留页面内 JS 状态**：`discard()` 会销毁渲染进程，游戏进度、复杂 SPA 状态必然丢失。
- **不跨浏览器**：只做 Chromium 内核（Chrome / Edge / Brave 等），不做 Firefox。
- **不引入构建步骤**：`src/` 即产物，原生 ES Module。

### 典型应用场景

1. **调研/开发时开几十上百个标签页**：看完一批点「休眠其他页」，内存立刻回落。
2. **每天重启浏览器且会话里有几百个标签页**：开启启动抢先休眠后，
   重启的代价约等于只加载当前一页。
3. **笔记本/老机器**：配合自动休眠，后台标签页不再持续占用内存与 CPU。

---

## 2. 运行时拓扑

一个扩展里有四种执行环境，它们**不能**共享内存，只能通过消息与存储通信：

```
┌───────────────────────┐        ┌───────────────────────┐
│  Popup (popup.js)     │        │ Options (options.js)  │
│  临时页面，关闭即销毁 │        │ 独立标签页            │
└──────────┬────────────┘        └──────────┬────────────┘
           │  chrome.runtime.sendMessage      │
           └───────────────┬──────────────────┘
                           ▼
        ┌──────────────────────────────────────────┐
        │  Service Worker (background/)            │
        │  MV3 事件驱动，空闲约 30s 被回收         │
        │  全部业务逻辑在这里                      │
        └───────┬─────────────────────┬────────────┘
                │ chrome.tabs.*       │ chrome.scripting.executeScript
                ▼                     ▼
        ┌───────────────┐   ┌──────────────────────────┐
        │ Chrome APIs   │   │ 页面上下文 (被注入的函数)│
        └───────────────┘   └──────────────────────────┘
                │
                ▼
        ┌──────────────────────────────────────────┐
        │ chrome.storage.local / .session          │
        └──────────────────────────────────────────┘
                           ▲
                           │ chrome.runtime.sendMessage
        ┌──────────────────┴───────────────────────┐
        │ Content Script (content/content-script.js)│
        │ 在每个页面运行，唤醒后恢复滚动/表单       │
        └──────────────────────────────────────────┘
```

**关键推论**：Service Worker 随时可能被回收，所以任何需要跨事件存活的运行时状态
都必须落到 `chrome.storage.session`（见 `utils/session-store.js`）。
本项目历史上最隐蔽的一个缺陷就来自这条约束——自动休眠的空闲计时器只存在内存里，
Worker 一被回收就归零，导致该功能实际上很少生效。

---

## 3. 目录与模块职责

```
src/
├── manifest.json              清单：权限、入口、快捷键（无业务逻辑）
├── background/                Service Worker
│   ├── service-worker.js      入口：只做事件接线（~150 行）
│   ├── router.js              chrome.runtime.onMessage 的唯一入口 + 分发表
│   ├── sleep.js               单个标签页的休眠 / 唤醒 / 状态领取
│   ├── batch.js               「休眠其他标签页」批处理状态机
│   ├── auto-sleep.js          按空闲时长自动休眠
│   ├── startup-suspend.js     启动抢先休眠（核心）
│   ├── badge.js               图标角标（含防抖）
│   ├── favicon.js             图标代理 + 内存缓存
│   ├── menus.js               右键菜单
│   └── tab-state.js           注入到页面的采集函数（必须自包含）
├── utils/                     SW 与 UI 共享的逻辑
│   ├── constants.js           ← 存储键 / 默认值 / MESSAGE_TYPES 的唯一来源
│   ├── storage.js             chrome.storage.local + 按键串行化
│   ├── session-store.js       chrome.storage.session（带内存降级）
│   ├── tab-manager.js         chrome.tabs 包装 + canSleepTab 判定
│   ├── whitelist.js           域名匹配 / 内部页 / 空标签页（唯一实现）
│   ├── settings.js            sanitizeSettings：不可信设置的清洗
│   ├── i18n.js                t() 与 applyTranslations()
│   ├── dom.js                 escapeHtml / showToast
│   └── timers.js              setUnrefTimeout
├── popup/                     弹窗：标签页列表 + 两个批量按钮
├── options/                   选项页：设置 / 白名单 / 统计
├── content/                   内容脚本：唤醒后恢复状态
├── _locales/{en,zh_CN}/       文案
└── assets/icons/              图标
```

### 依赖方向

```
popup / options ──▶ utils/*        （只读状态，不做判定）
background/*   ──▶ utils/*        （全部业务规则）
utils/*        ──▶ 无内部依赖（whitelist 依赖 storage，storage 依赖 constants）
content/*      ──▶ 无 import（classic script，只能发消息）
```

**没有环**。`background/service-worker.js` 是唯一注册 `chrome.*` 监听器的地方，
其他模块导出纯函数/状态，由入口接线。

---

## 4. 数据模型

### `chrome.storage.local`（跨浏览器重启保留）

| 键             | 类型                                | 说明                                         |
| -------------- | ----------------------------------- | -------------------------------------------- |
| `settings`     | `Object`                            | 见 `DEFAULT_SETTINGS`，扁平结构              |
| `whitelist`    | `string[]`                          | 域名模式，支持 `*.example.com`               |
| `lockedTabs`   | `number[]`                          | 被用户锁定的标签页 ID（批量休眠会跳过）      |
| `statistics`   | `{totalSlept,totalWoken,lastReset}` | 计数器（纯展示）                             |
| `sleepingTabs` | `Object<tabId, TabState>`           | 休眠标签页的 URL/标题/图标/滚动位置/表单内容 |

`TabState` 即唤醒后要还给页面的东西：

```js
{
  tabId, originalUrl, title, favIconUrl, sleptAt,
  scrollPosition?: { x, y },
  formData?: { [字段标识]: string | boolean }   // 密码字段被排除
}
```

**生命周期**：休眠时写入 → 页面唤醒时被 `consumeRestoreState` **一次性领取并删除**
→ 或标签页关闭时删除。不存在需要定时器清理的中间态（这正是重构前的一个缺陷来源）。

### `chrome.storage.session`（浏览器退出即清空）

| 键                    | 说明                                                |
| --------------------- | --------------------------------------------------- |
| `startupWindowEnd`    | 启动休眠窗口的截止时间戳；Worker 中途重启后据此恢复 |
| `autoSleepLastActive` | `tabId → 最后活跃时间`，自动休眠的空闲判据          |

---

## 5. 消息协议

所有消息类型定义在 `utils/constants.js:MESSAGE_TYPES`，**唯一**的分发点是
`background/router.js`。`npm run validate` 会强制「声明即处理」。

| 方向         | 类型                                                      | 响应                                     |
| ------------ | --------------------------------------------------------- | ---------------------------------------- |
| UI → SW      | `sleepTab`                                                | `{success}` 或 `{success:false, reason}` |
| UI → SW      | `sleepAllOther`                                           | `{slept, skipped, reasons[], aborted?}`  |
| UI → SW      | `wakeTab`                                                 | `{success}`                              |
| UI → SW      | `getSettings` / `updateSettings`                          | `{settings}` / `{success}`               |
| UI → SW      | `getWhitelist` / `addToWhitelist` / `removeFromWhitelist` | `{whitelist}` / `{success, domain}`      |
| UI → SW      | `lockTab` / `unlockTab` / `getLockedTabs`                 | `{success}` / `{lockedTabs:number[]}`    |
| UI → SW      | `getBatchStatus` / `abortBatch`                           | 批处理进度 / `{success}`                 |
| UI → SW      | `getStatistics` / `resetStatistics`                       | `{statistics}` / `{success, statistics}` |
| UI → SW      | `fetchFavicon`                                            | `{success, dataUrl}`                     |
| Content → SW | `consumeRestoreState`                                     | `{state: TabState \| null}`              |
| 测试钩子     | `triggerStartupSweep`                                     | `{discarded: number}`                    |

**失败原因使用稳定代码而非句子**（`alreadySleeping` / `locked` / `emptyTab` /
`internalPage` / `pinnedTab` / `audibleTab` / `whitelisted` / `unknownError` /
`batchAlreadyRunning`），由界面按当前语言渲染。Service Worker 里没有面向用户的英文串。

### 安全边界

`router.js` 通过 `sender.id === chrome.runtime.id` 拒绝其他扩展伪造的控制消息；
`updateSettings` 的载荷一律经 `sanitizeSettings()` 清洗（丢弃未知键、按默认值类型强转）。

---

## 6. 关键流程

### 6.1 休眠一个标签页

```
popup / 右键菜单 / 快捷键 / 自动休眠
        │
        ▼
sleep.js: sleepTab(tabId, {context})
        │
        ├─ canSleepTab(tab, context) ── 不通过 → {success:false, reason}
        │
        ├─ 若是当前活动标签页 → switchAwayFromTab()
        │     （Chrome 拒绝 discard 活动标签页；优先切到相邻标签页，避免制造空白页）
        │
        ├─ 采集滚动位置 / 表单内容（chrome.scripting.executeScript，注入 tab-state.js）
        │
        ├─ 先落盘 sleepingTabs[tabId]，再 discard  ← 顺序很重要，见 6.3
        ├─ chrome.tabs.discard(tabId)
        └─ statistics.totalSlept += 1；刷新角标
```

### 6.2 批量休眠（休眠其他页）

`batch.js` 以 **10 路并发**分块处理当前窗口的其余标签页：

```
加载一次 context = {settings, whitelist, lockedTabs}
for 每 10 个标签页:
    若用户点了「中止」→ 立即返回 {aborted:true}
    Promise.allSettled(逐页 canSleepTab + sleepTab({skipStateCapture:true}))
最后统一刷新一次角标
```

两个设计点：

- **context 只加载一次**。原先每个标签页都要重新读一遍设置/白名单/锁（200 个标签页
  就是 ~600 次存储往返）。
- **批量路径跳过状态采集**。为 200 个标签页采集表单内容既慢又占用大量存储，
  且大多数页面并不需要。这是有意的取舍，已在设置项中体现为单页采集。

### 6.3 唤醒与状态恢复

```
用户点击休眠的标签页
        │
        ▼
Chrome 自行重新加载该标签页 ──▶ chrome.tabs.onActivated 触发
        │                                  │
        │                                  ▼
        │                        要唤醒的是被 discard 的标签页
        │                                  │
        │                          sleep.js: wakeTab(tabId)
        │                          ├─ 活动标签页：Chrome 已在加载，不再重复 reload
        │                          ├─ 后台标签页（弹窗里点唤醒）：显式 reload
        │                          ├─ statistics.totalWoken += 1
        │                          └─ 不删除 sleepingTabs：页面还没来领
        ▼
页面加载 → 内容脚本运行 (document_idle)
        │
        └─ sendMessage({type:'consumeRestoreState'})
                 │
                 ▼
           SW 从 sleepingTabs 取出状态 → 立即删除 → 返回给页面
                 │
                 ▼
           页面应用滚动位置与表单值，并派发 input/change 事件
```

**为什么状态在休眠时就落盘，而不是唤醒时才写**：唤醒那一刻页面正在加载，
内容脚本随时可能已经开始执行。如果迁移状态需要一个中间键 + 定时器清理
（重构前的做法：写入 `restore_<tabId>`，5 秒后删除），就会出现
「页面还没读完、状态已被清掉」或「状态残留被下次加载重放」两类竞态。
把状态放在休眠时就写好的位置、由页面**一次性领取**，这两类问题都不存在。

### 6.4 启动抢先休眠（核心能力）

目标：浏览器重启恢复 200 个标签页时，它们必须**保持未加载**，而不是一起加载把内存打满。

三层机制，逐层兜底：

| 层          | 位置                                             | 作用                                                                                              |
| ----------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 1. 抢先拦截 | `chrome.tabs.onCreated`                          | 会话恢复的标签页先以 `status === 'unloaded'` 创建、随后才被导航。在这个瞬间 discard，即可拦下加载 |
| 2. 事件兜底 | `chrome.tabs.onUpdated` (`status === 'loading'`) | Worker 还在启动、或恢复标签页越过了 onCreated 的情况                                              |
| 3. 周期清扫 | 每 750ms 全窗口扫描                              | 连「已经加载完」的恢复标签页也一并丢弃（快速恢复场景）                                            |

**窗口判定**是整套机制的安全阀：

- 窗口**只由 `chrome.runtime.onStartup` 打开**（浏览器真正启动的规范信号）。
- 窗口截止时间写入 `chrome.storage.session`：Worker 在窗口内被回收后重启，
  会读回截止时间继续清扫，而不是重新计时。
- **扩展安装/更新触发的 Worker 重载不会触发 `onStartup`**，因此绝不会误开窗口。
  这是本功能最危险的一类回归——「更新扩展 = 把所有后台标签页休眠掉」——
  已由 `tests/startup-suspend-reload.test.mjs` 单独守护。
- `sweepStartupTabs()` 本身也要求窗口处于打开状态：总开关不是授权，
  窗口才是授权。

不会被误伤的标签页：当前每个窗口正在查看的标签页、用户本次会话点击过的标签页、
白名单域名、被锁定的标签页、固定标签页（默认，可配置）。

### 6.5 自动休眠

```
chrome.alarms（每 1 分钟）→ runAutoSleepCheck()
    ├─ 读回 chrome.storage.session 中的空闲时间表（跨 Worker 回收存活）
    ├─ 遍历所有窗口；跳过每个窗口的活动标签页与已休眠标签页
    ├─ 空闲 >= 阈值 → canSleepTab → sleepTab
    └─ 回写时间表；有实际休眠才刷新角标
```

**开启该功能时会给当前所有标签页重置为「此刻」**，让每个标签页都获得一个完整的
超时窗口。否则开关一打开，所有已经空闲很久的标签页会被瞬间集体休眠。

---

## 7. 不能违背的约束

| 约束                                                 | 原因                           | 违反后果                           |
| ---------------------------------------------------- | ------------------------------ | ---------------------------------- |
| 业务判定只实现一次（`whitelist.js` / `canSleepTab`） | 重构前有三份实现，已经互相漂移 | UI 显示与实际行为不一致            |
| 模块导入时无副作用                                   | 否则测试无法驱动，只能靠真机   | 无法为逻辑写回归测试               |
| 跨事件状态必须落 `storage.session`                   | MV3 Worker 约 30s 被回收       | 功能静默失效（自动休眠的历史缺陷） |
| 跨进程 read-modify-write 必须串行化                  | 批量休眠 10 路并发             | 统计与状态丢更新                   |
| 内容脚本与 SW 共享逻辑只能通过消息                   | 内容脚本不能 `import`          | 见下                               |

### 关于内容脚本的重复实现

`content/content-script.js` 与 `background/tab-state.js` 都涉及「表单字段的读写」。
内容脚本是 classic script，**不能 `import`**，而注入到页面的函数必须是自包含的
（序列化后执行）。因此这份逻辑无法完全去重。

处理方式：把页面上下文里的**采集**收敛到 `tab-state.js` 一个函数；
内容脚本只保留**恢复**所需的最小实现；两者的行为差异写在 ADR-0004 里。
如果未来不再需要常驻内容脚本（改为唤醒时按需注入），这部分重复可以彻底消除——
已列入 [ROADMAP](ROADMAP.md)。

---

## 8. 已知限制

| 限制                             | 说明                                                                              | 状态                                  |
| -------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------- |
| 窗口内新开的后台标签页也会被休眠 | 启动后 45 秒窗口内，新开/后台打开的标签页同样会被抢先休眠（点击即加载，体验一致） | 有意为之                              |
| 页面内 JS 状态丢失               | `discard()` 的固有语义                                                            | 无法解决                              |
| 复杂富文本编辑器内容可能恢复不全 | 基于 `value` 回填 + `input`/`change` 事件                                         | 尽力而为                              |
| Worker 被回收会打断清扫定时器    | 窗口内 Worker 重启会自动恢复清扫，但存在最长约 750ms 的空档                       | 可接受                                |
| `<all_urls>` 主机权限            | 状态采集需要；也是安装提示的来源                                                  | 见 ROADMAP 的最小化计划               |
| favicon 需一次对外请求           | 弹窗展示图标时抓取页面自己的图标                                                  | 计划改用 `favicon` 权限 + `_favicon/` |

---

## 9. 扩展点

- **新增设置项** → [CONTRIBUTING.md 第 4 节](../CONTRIBUTING.md#4-常见改动的标准步骤)
- **新增消息类型** → 同上；`npm run validate` 会检查是否闭环
- **新增文案** → 两个 locale 同步，validate 会检查 key 对齐
- **改变设计** → 在 `docs/adr/` 新增一条 ADR，并更新本文档对应章节

---

## 10. 相关文档

- [ADR 索引](adr/README.md) — 关键决策及其取舍
- [TESTING.md](TESTING.md) — 测试分层与真机验收
- [STARTUP-SUSPEND-TEST.md](STARTUP-SUSPEND-TEST.md) — 启动抢先休眠的验收步骤
- [RELEASING.md](RELEASING.md) — 发版流程
- [ROADMAP.md](ROADMAP.md) — 待办与已知改进方向
- [AUDIT.md](AUDIT.md) — 本次工程化整改前的系统审计报告
