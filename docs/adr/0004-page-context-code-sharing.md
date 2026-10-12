# 0004. 页面上下文与 Service Worker 的代码共享边界

- **状态**：**已废弃（被 [0008](0008-inject-on-demand-instead-of-content-script.md) 取代）**
- **取代原因**：本 ADR 的前提是"必须常驻一个内容脚本"，因此只能接受一份无法消除的
  重复实现。[0008](0008-inject-on-demand-instead-of-content-script.md) 通过实测解决了
  注入时机问题，改用按需注入，那处重复也随之消失。本文保留作为决策历史。
- **日期**：2026-10-11
- **影响**：`src/content/content-script.js`、`src/background/tab-state.js`、`manifest.json`

## 背景

扩展里有两处代码需要**在页面里**读写表单字段与滚动位置：

1. **采集**（休眠前）：由 Service Worker 通过
   `chrome.scripting.executeScript({ func: captureTabState })` 注入。
2. **恢复**（唤醒后）：由内容脚本在页面加载完成后执行。

直觉上这应该共用同一份实现。但在 MV3 下有三个硬约束：

- **内容脚本不能 `import`**。`content_scripts` 不支持 `type: module`，
  它是 classic script，只能用全局变量与消息通信。
- **注入的函数会被序列化**。传给 `executeScript({ func })` 的函数必须完全自包含，
  不能引用任何外部作用域的变量或导入。
- **本项目没有打包器**（见 [ADR-0002](0002-no-build-step.md)），
  因此也无法用一个共享模块同时喂给两个环境。

于是"共享一份实现"在本项目的约束下**不可能**，只能选择在哪一层接受重复。

## 决策

按职责切分，把重复压到最小且显式：

- **采集**收敛到一个自包含函数：
  [`src/background/tab-state.js`](../../src/background/tab-state.js) 的
  `captureTabState(saveScroll, saveForm)`。文件头明确写出"必须自包含"的约束。
- **恢复**只保留在 `src/content/content-script.js` 中（该文件已在
  [0008](0008-inject-on-demand-instead-of-content-script.md) 中删除，此处仅作历史引用，
  故不再做成链接），并压缩到最小实现（约 60 行，含注释）。
- **两边都不复制的部分**：状态的具体内容、存储位置、以及"谁来领取"，
  统一由消息 `consumeRestoreState` 与
  [`src/background/sleep.js`](../../src/background/sleep.js) 决定。
  内容脚本不知道存储键名，也不知道状态结构，它只是把拿到的对象应用上去。
- **不引入共享常量到内容脚本**：内容脚本里唯一的消息类型字面量，
  由 `tool/validate.js` 校验其与 `constants.js` 一致，防止静默漂移。

## 后果

- 正面：
  - 重复被限制在"字段遍历 + 写值"这一小段，两边合起来约 40 行；
  - 密码排除规则只在一个地方出现（两处都必须是同一条件，
    由代码审查与 ADR 记录共同约束——这是本决策的已知薄弱点）；
  - 内容脚本足够小，可以整体审查，符合 [PRIVACY.md](../../PRIVACY.md) 的承诺。
- 负面 / 需要接受的代价：
  - 表单字段的选取规则（`input:not([type=password]), textarea, select`）
    在两边各出现一次，是真实存在的漂移风险；
  - 无法通过单元测试保证两者一致——测试能覆盖 SW 侧的采集函数，
    但页面上下文的恢复只能靠真机冒烟。

## 消除重复的路径

如果[移除常驻内容脚本](../ROADMAP.md)（ROADMAP L1）落地——唤醒时改为按需注入
同一个 `tab-state.js`——那么采集与恢复都会收敛到同一个文件，
本 ADR 记录的重复将彻底消失。这是该路线图项的主要动机之一。

## 替代方案

- **把恢复逻辑也塞进内容脚本，并让 SW 只发消息**：这正是重构前的形态，
  结果是内容脚本里存在一套无人调用的 `captureState`/`restoreState` 死协议，
  与 SW 的实际实现并存且不一致。否决。
- **让内容脚本用 `import()` 动态加载**：`import()` 在 classic content script 中
  不可用（需要 web_accessible_resources 与动态 URL 拼接，且仍受 CSP 影响）。
  收益不足以抵消复杂度。否决。
- **引入打包器以共享模块**：与 ADR-0002 的决策冲突，代价远大于收益。否决。

## 相关

- [0001 用原生 discard，不做占位页](0001-native-discard-over-placeholder.md)
- [0002 不引入构建步骤](0002-no-build-step.md)
- [ARCHITECTURE.md 第 7 节 不能违背的约束](../ARCHITECTURE.md#7-不能违背的约束)
