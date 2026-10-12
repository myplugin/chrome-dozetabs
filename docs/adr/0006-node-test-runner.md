# 0006. 测试使用 Node 内置运行器

- **状态**：已采纳
- **日期**：2026-10-11
- **影响**：`tests/`、`package.json` 的依赖与脚本、CI

## 背景

整改前项目有两套测试：

1. **vitest**（24 项）覆盖 `whitelist` 与 `constants`；
2. **手写断言脚手架**（13 项）自己打印 PASS/FAIL 并用 `process.exit()` 结束，
   用来驱动 Service Worker 的启动休眠逻辑。

问题不只是"两套"。vitest 引入了约 70 个传递依赖（vite、esbuild、rollup…），
意味着**贡献者在写第一行测试之前必须先 `npm install`**，而运行时代码是零依赖的。
同时手写脚手架有一套自己的 mock 与断言方式，新增测试需要理解两套约定。

而项目本身的约束是"无构建步骤、零运行时依赖"（[ADR-0002](0002-no-build-step.md)）。
测试链路是唯一违背这一精神的地方。

## 决策

**统一使用 Node 内置的 `node:test` + `node:assert/strict`。**

- `npm test` = `node --test`（自动发现 `tests/**/*.test.*`），**不需要任何 npm 包**；
- 开发期依赖只剩 ESLint / Prettier（用于代码检查，与测试无关）；
- 手写脚手架的 13 项断言全部迁移，并抽取出可复用的
  [`tests/helpers/chrome-mock.js`](../../tests/helpers/chrome-mock.js)；
- 断言数由 37 提升到 129，新增并发存储、设置清洗、休眠判定矩阵、
  消息路由与鉴权、扩展更新不触发启动休眠等覆盖。

## 后果

- 正面：
  - 测试可在**任何** Node ≥ 20 环境直接运行，包括没有网络的环境；
  - `npm ci` 只装 4 个直接依赖，安装时间从数十秒降到约 2 秒；
  - 只有一套测试 API（`describe` / `it` / `assert`），新贡献者无需学两套；
  - 覆盖率可用 `node --test --experimental-test-coverage` 获取。
- 负面 / 需要接受的代价：
  - **每个测试文件默认派生一个子进程**。在限制子进程的沙箱环境中
    `node --test`（默认隔离）会以 `spawn EPERM` 失败，需要改为逐文件运行
    （`--experimental-test-isolation=none`）。已记录在
    [TESTING.md](../TESTING.md#受限环境提示)。
  - 覆盖率工具比 vitest 简陋（无阈值门禁、无 HTML 报告）。
    目前不需要——测试存在的目的是防止回归，不是为了一个数字。
  - 没有内置的 mock/spy 工具，chrome API 模拟需要自己维护一份
    （已抽取为共享 helper，因此只需维护一次）。

## 替代方案

- **统一到 vitest**：功能更强，但把"写测试"重新变成"先装 70 个包"，
  与项目零依赖的定位冲突。否决。
- **统一到手写脚手架**：零依赖但每增加一个测试文件都要复制报告逻辑，
  且没有标准化的失败输出。否决。
- **保留两套**：正是整改前的状态，贡献者需要理解两种约定。否决。

## 相关

- [0002 不引入构建步骤](0002-no-build-step.md)
- [TESTING.md](../TESTING.md)
