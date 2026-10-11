# 0007. 打包器自带 ZIP 实现

- **状态**：已采纳
- **日期**：2026-10-11
- **影响**：`tool/build.js`、`tool/zip.js`、发布流程、CI

## 背景

整改前仓库里有**三份**打包脚本，各自实现同一件事，且已经互相漂移：

| 文件             | 状态                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `tool/build.js`  | **完全无法运行**：`package.json` 是 `"type": "module"`，脚本却用 `require()`                      |
| `tool/build.sh`  | 产物结构错误：`zip -r "$ZIP" "$PACKAGE_NAME"` 会在压缩包内多套一层目录，**Chrome 应用商店会拒绝** |
| `tool/build.bat` | 结构正确，但只在 Windows 可用                                                                     |

共性问题：

- 依赖外部命令（`zip` / PowerShell），在不同平台上产出不一致；
- 三份实现意味着任何改动都要改三遍，而实际上只会改一遍。

Chrome 应用商店对包结构有硬要求：`manifest.json` 必须位于压缩包**根目录**。

## 决策

**合并为一份纯 Node 实现，并在 `tool/zip.js` 中自带最小 ZIP 写入器。**

- 只实现用得到的子集：每个条目 deflate（或 store，取更小者）、
  UTF-8 文件名标志、无 ZIP64、无加密；
- 条目名相对于 `src/`，因此压缩包根目录就是 `manifest.json`；
- 不再调用任何外部二进制，三个平台产出逐字节一致；
- CI 中增加一条断言：解压后必须能在根目录读到 `manifest.json`。

删除 `tool/build.sh` 与 `tool/build.bat`。

## 后果

- 正面：
  - 只有一份实现，不存在漂移；
  - 不再需要系统里有 `zip` 或 `pwsh`；
  - 产物结构由 CI 断言守护，不可能再出现嵌套目录；
  - 版本号只从 `src/manifest.json` 读取，与 `package.json` 的一致性由
    `npm run validate` 保证。
- 负面 / 需要接受的代价：
  - 仓库里多了一份需要自己维护的二进制格式实现（约 140 行）。
    这是本 ADR 唯一的实质成本，因此它必须有测试与真机验证：
    已在 Windows 上用 `Expand-Archive` 解压并逐文件比对过 `src/` 内容。
  - 不支持 ZIP64，即 4 GB 以上的包——扩展包约 50 KB，不构成限制。

## 替代方案

- **引入 `archiver` / `jszip` 依赖**：把"零依赖"破在发布工具上，
  而发布工具恰恰是最需要长期可复现的部分。否决。
- **统一到 PowerShell 的 `Compress-Archive`**：只在 Windows 可用，
  与 CI（Linux）冲突。否决。
- **统一到 `zip` 命令**：Linux/macOS 自带，Windows 通常没有。否决。
- **保留三份但修正结构**：治标不治本，漂移会再次发生。否决。

## 相关

- [0002 不引入构建步骤](0002-no-build-step.md)
- [RELEASING.md](../RELEASING.md)
