# 发布流程 / Releasing

## 1. 版本策略

遵循[语义化版本](https://semver.org/lang/zh-CN/)：

| 变更类型                                               | 版本位                    | 例子              |
| ------------------------------------------------------ | ------------------------- | ----------------- |
| 破坏性变更（权限调整、设置项语义变化、存储结构不兼容） | MINOR（0.x 阶段）或 MAJOR | `1.2.0` → `2.0.0` |
| 新功能、新设置项                                       | MINOR                     | `1.2.0` → `1.3.0` |
| 缺陷修复、文案、性能                                   | PATCH                     | `1.3.0` → `1.3.1` |

**版本号唯一来源是 `src/manifest.json` 的 `version` 字段**，`package.json` 必须与之一致；
`npm run validate` 会在 CI 中强制这一点，因此不可能出现两者漂移。

> 关于权限：新增权限会改变所有已安装用户的更新提示，按破坏性变更处理。

## 2. 发布前检查清单

- [ ] 所有测试与校验在本地通过：`npm run check`
- [ ] `CHANGELOG.md`：把 `[Unreleased]` 的内容整理到新的版本小节，
      并补上版本号与日期链接
- [ ] 版本号已在 `src/manifest.json` 与 `package.json` 同步提升
- [ ] 真机验收已完成（至少：加载无报错、休眠/唤醒走通、启动休眠按
      [STARTUP-SUSPEND-TEST.md](STARTUP-SUSPEND-TEST.md) 验收）
- [ ] 若涉及权限或数据处理，`PRIVACY.md` / `SECURITY.md` 已同步
- [ ] 若涉及设计变化，`docs/adr/` 已新增记录

## 3. 打包

```bash
npm run build
# → dist/tab-sleep-v<version>.zip
```

打包器（`tool/build.js`）的行为：

- 只打包 `src/`，条目的**路径相对于 `src/`**，因此 zip 内是
  `manifest.json` 而不是 `tab-sleep-v1.0.0/manifest.json`
  —— Chrome 应用商店会拒绝带嵌套顶层目录的包；
- 剔除 `*.map`、`*.md`、`.gitkeep`、`Thumbs.db` 等；
- 使用自研的纯 Node ZIP 实现（`tool/zip.js`），**不依赖 `zip` 命令或 PowerShell**，
  三个平台产出一致；
- 不校验代码内容——请在打包前先跑 `npm run check`。

**密钥材料**：`*.pem` / `*.p12` / `*.crx` 已在 `.gitignore` 中排除。
私有签名密钥绝不要提交到仓库，也不要放进 CI 变量之外的任何位置。

## 4. 发布到 GitHub

打 tag 即触发 `.github/workflows/release.yml`：

```bash
# 1) 合并到 main 且 CI 全绿
# 2) 打标签并推送
git tag -a v1.1.0 -m "v1.1.0"
git push origin main --tags
```

工作流会：安装依赖 → 跑完整的 `npm run check` → 打包 → 校验 tag 与 manifest 版本一致
→ 从 `CHANGELOG.md` 抽取该版本小节作为 Release Notes → 创建 Release 并附上 zip。

若 tag 与 manifest 版本不一致，工作流会**失败并拒绝发布**。

## 5. 发布到 Chrome 应用商店 / Edge 加载项

两个商店都接受 `npm run build` 产出的 zip。提交流程：

1. 开发者后台 → 新建/更新版本 → 上传 `dist/tab-sleep-v<version>.zip`
2. 填写「此版本的新增内容」（直接复制 CHANGELOG 对应小节）
3. 隐私：确认「数据用途」声明与 [PRIVACY.md](../PRIVACY.md) 一致
   （本扩展不收集任何数据；唯一对外请求是页面自身的 favicon，仅为展示）
4. 提交审核。审核期间不要再向 `main` 推送会改变 manifest 的提交

> Edge 加载项（Edge Add-ons）可复用同一个 zip；Firefox 不在支持范围内（见
> [ARCHITECTURE.md 的非目标](ARCHITECTURE.md#非目标明确的边界)）。

## 6. 仓库拓扑与同步

**Gitee 是主开发平台，GitHub 是公开镜像。**

| remote   | 地址                                            | 角色                              |
| -------- | ----------------------------------------------- | --------------------------------- |
| `origin` | `git@gitee.com:xplugins/chrome-tab-sleep.git`   | 主开发仓库（日常推送、issue、PR） |
| `github` | `git@github-pycv:myplugin/chrome-tab-sleep.git` | 公开镜像（定时同步 + CI 结果）    |

> **为什么用 `github-pycv` 而不是 `github.com`**：`~/.ssh/config` 里为 pycv 账户配了
> 专用别名（`Host github-pycv` + `IdentityFile ~/.ssh/id_ed25519_github_asuspc_pycv`），
> 但**没有 `Host github.com` 段**。所以裸 `git@github.com:...` 不会使用这把 key——
> 实测得到 `Permission denied (publickey)`。换机器或换账户前，先跑
> `ssh -T git@github-pycv`，确认返回 `Hi pycv!` 再推送。

### 日常推送

```bash
git push origin master --tags     # 主平台
git push github master --tags     # 双推：让镜像立刻跟上（可选）
```

### 定时同步（Gitee → GitHub）

即使忘了双推也不会漂移：`.github/workflows/mirror-gitee.yml` 每 6 小时把 Gitee 的
分支与 tag 同步到 GitHub，也可以手动触发。

**同步是「快进（fast-forward）优先」的，绝不倒退 GitHub。** 它刻意**不用**
`git push --mirror`——那会强制更新每一个 ref，于是当 Gitee 落后时（例如你刚把改动
直接推到了 GitHub），同步会**把 GitHub 静默倒退**，丢掉更新的提交。现在的做法是
不带 force 推送：落后的分支会被拒绝，任务红掉并给出警告，而不是默默毁掉数据。

因此：**日常请推 Gitee（`origin`）**；只推 GitHub 时同步任务会报警并在 6 小时窗口内
持续失败，直到你把 Gitee 补上。

两个必须知道的限制：

1. **用工作流自带的 `GITHUB_TOKEN` 推送，不会触发其他工作流**（GitHub 用来防止递归）。
   所以同步工作流**自己在同一个 job 里跑 `npm run check` 与打包校验**，
   而不是指望 `ci.yml` 随后被触发。
2. **因此 `ci.yml` 只在直接向 GitHub 推送或提 PR 时运行。** 由于日常工作发生在
   Gitee，日常的自动化结论实际来自同步工作流那一次运行。

若 Gitee 仓库是私有的，在 GitHub 仓库里加一个 `GITEE_TOKEN` secret（具有读取权限即可），
同步工作流会自动使用它。

### Gitee 侧的 CI

未配置。你选择用 GitHub Actions 作为免费校验，Gitee 侧不做门禁。
若以后需要 Gitee 提交/PR 的实时门禁，需要新增 Gitee Go 的 `.workflow/*.yml`
（语法与 Actions 完全不同），详见 [ROADMAP.md](ROADMAP.md)。

### 发布

GitHub Release 由 `.github/workflows/release.yml` 生成。注意它的触发方式是
打 tag 推送或手动 `workflow_dispatch`：**同步工作流推送的 tag 不会自动触发它**
（原因见上面的第 1 条限制）。发版时在 GitHub 的 Actions 页面手动触发一次即可。
