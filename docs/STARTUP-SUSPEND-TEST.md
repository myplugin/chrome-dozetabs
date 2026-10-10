# 启动抢先休眠 — 验收测试指南

## 机制概述

| 组件 | 说明 |
|------|------|
| 抢先丢弃 | `chrome.tabs.onCreated`:会话恢复的标签先以 `status === 'unloaded'` 创建、随后才被加载。在这个瞬间 `chrome.tabs.discard()` 即可拦下;普通新开标签页不受影响(active/pinned/autoDiscardable 检查) |
| 兜底窗口 | 浏览器启动后 45 秒内(30~60s 区间),`onUpdated` 中 `status === 'loading'` 的非活动标签 + 每 750ms 一次全窗口清扫,把漏网的恢复标签(含已加载完的)立即 discard |
| 窗口判定 | 窗口**只由 `chrome.runtime.onStartup` 打开**(浏览器启动的规范信号)。窗口截止时间存 `chrome.storage.session`:SW 在窗口内重启 → 读回截止时间继续清扫;扩展安装/更新触发的重载**不触发** `onStartup`,所以不会误开窗 |
| 设置 | 总开关 `startupSuspendEnabled`(默认开)、是否包含固定标签 `startupIncludePinned`(默认关)。白名单域名和锁定标签仍然生效 |
| 兼容性 | 只用原生 `chrome.tabs.discard()`,不关标签重开、不假页面替换 DOM;权限无新增(沿用原有 `tabs`/`storage`);Edge/Chrome 通用 |

## 自动化测试

### 单元测试(可靠,无需浏览器)

用 mock 的 chrome API 直接驱动 service worker 的事件监听器和消息处理器:

```
node tests\startup-suspend.test.mjs
```

**13/13 通过。** 覆盖：
- `onCreated` 抢先丢弃 unloaded 标签(竞态核心)
- active / pinned / 白名单 / `autoDiscardable=false` / 用户激活过 的过滤
- `onUpdated` 对 loading 非活动标签的兜底丢弃
- 清扫(sweep)丢弃已加载完的恢复标签 + 保护活动标签
- `RESET_STATISTICS` 只重置统计**不覆盖用户设置**(修复了原 optons 页用 UPDATE_SETTINGS 误清全部设置的 bug)
- `UPDATE_SETTINGS` 正常持久化新设置项

### 真实浏览器探针

```
# 扩展是否干净加载、设置默认值是否正确(SW 无报错)
python scripts\sw-log-probe.py

# 通过真实 popup UI 走 休眠/唤醒流程(在真实桌面环境运行)
python scripts\popup-e2e-probe.py

# 12 标签 A/B 对照(基线 vs 开启启动休眠)
python scripts\smoke-test.py --tabs 12
```

**已验证的证据(本次改造)**：

| 验证项 | 方法 | 结果 |
|--------|------|------|
| 扩展在真实 Edge 干净加载 | `sw-log-probe.py`(多次) | SW 无报错;`startupSuspendEnabled=true`、`startupIncludePinned=false` 默认值正确;`chrome.storage.session` 正常;徽标更新无错 |
| `chrome.tabs.discard` 原语安全(扩展核心操作) | **最小扩展对照实验**：一个不含任何产品代码的 MV3 扩展从 SW 调 discard | 成功且浏览器存活 —— 证明产品的基础操作不会导致浏览器崩溃 |
| 会话恢复后浏览器 + 扩展页稳定 | kill → 重启 → 驱动页轮询 60s | 16 个标签持续稳定,无 target 丢失 |
| popup UI 渲染 | `popup-e2e-probe.py` | 8 个标签全部渲染出休眠/唤醒按钮 |

> **受限环境说明(非产品缺陷)**：在沙箱化/CI 这类受限的自动化环境中，Playwright 驱动的 Edge 可能在 CDP 流量暂停约 1 秒后自行退出，且 `executeScript`(内容脚本注入)会干扰渲染器。因此完整 UI 级 E2E 需在真实桌面环境按下面的正式验收步骤执行；逻辑正确性由单元测试保证。

## 正式验收(200 标签真实数据)

### 步骤

1. 在 `chrome://extensions` 重新加载扩展(改代码后必须)。
2. 打开约 200 个真实网页标签(模拟日常工作负载)。
3. **改造前基线**:设置里关闭"启动时抢先休眠恢复的标签页",然后:
   - 强杀浏览器(任务管理器结束进程,或直接关机重启);
   - 重启浏览器等待自动恢复;
   - 重启后 **30 秒**,运行测量脚本(见下),记录基线数据。
4. **改造后**:设置里重新打开"启动时抢先休眠恢复的标签页",重复强杀 → 重启。
5. 重启后 30 秒测量,并人工核对:
   - 点扩展图标:"休眠中"计数 ≈ 199,"活跃" = 1;
   - 点击任意"休眠中"标签,应正常加载;
   - `Shift+Esc` 任务管理器里几乎没有网页渲染进程。

### 测量脚本

重启浏览器后,另开一个 PowerShell 窗口:

```powershell
.\scripts\measure-memory.ps1 -Browser msedge -WaitSeconds 30
# 或 Chrome:
.\scripts\measure-memory.ps1 -Browser chrome -WaitSeconds 30
```

输出浏览器全部进程总内存(工作集/私有)与进程数,并打印可直接粘贴进对比表的记录行。

### 对比表模板(填入实测数据)

| 指标 | 改造前(关闭启动休眠) | 改造后(开启启动休眠) | 目标 |
|------|----------------------|----------------------|------|
| 30 秒后总内存(工作集) | ~22 GB | ___ GB | < 5 GB |
| 加载中的标签数 | ~200 | 1(仅当前标签) | 1 |
| 点击其他标签能否加载 | — | 能/否 | 能 |
| 内存峰值(重启过程中,任务管理器观察) | ~22 GB | ___ GB | < 5 GB |

> 注:如果浏览器自身开启了 Edge"休眠标签页/效率模式"或 Chrome"内存节省程序",它们会在后台慢慢丢弃标签,导致改造前基线偏低;做对比时建议两组使用相同浏览器设置,以扩展的"启动抢先休眠"为准。

## 已知边界

- 兜底窗口内(启动后 ~45 秒)新开/后台打开的标签也会被抢先休眠(点击即加载,行为一致);窗口过后恢复常态。**用户实际点击过的标签、各窗口当前正在查看的标签不会被误伤**。
- 白名单域名、锁定的标签不会被启动休眠;固定标签默认不休眠,可在设置中改为包含。
- 扩展安装/更新触发的 SW 重载**不会**误开窗 —— 开窗只认 `chrome.runtime.onStartup`(真正浏览器启动才触发),彻底避免"更新扩展 = 休眠所有后台标签"。
- `chrome.storage.session` 需要 Chromium 102+(Edge/Chrome 现代版本均满足,manifest 已声明 `minimum_chrome_version: 102`);更低版本自动退化为纯内存存储(功能仍可用,但 SW 重启即丢失窗口状态)。
