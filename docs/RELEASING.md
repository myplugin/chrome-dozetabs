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
# → dist/dozetabs-v<version>.zip
```

打包器（`tool/build.js`）的行为：

- 只打包 `src/`，条目的**路径相对于 `src/`**，因此 zip 内是
  `manifest.json` 而不是 `dozetabs-v1.0.0/manifest.json`
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
# 1) 合并到 master 且 CI 全绿
# 2) 打标签并推送
git tag -a v1.1.0 -m "v1.1.0"
git push origin master --tags
```

工作流会：安装依赖 → 跑完整的 `npm run check` → 打包 → 校验 tag 与 manifest 版本一致
→ 从 `CHANGELOG.md` 抽取该版本小节作为 Release Notes → 创建 Release 并附上 zip。

若 tag 与 manifest 版本不一致，工作流会**失败并拒绝发布**。

## 5. 发布到 Chrome 应用商店 / Edge 加载项

两个商店都接受 `npm run build` 产出的 zip。提交流程：

1. 开发者后台 → 新建/更新版本 → 上传 `dist/dozetabs-v<version>.zip`
2. 填写「此版本的新增内容」（直接复制 CHANGELOG 对应小节）
3. 隐私：确认「数据用途」声明与 [PRIVACY.md](../PRIVACY.md) 一致
   （本扩展不收集任何数据；唯一对外请求是页面自身的 favicon，仅为展示）
4. 提交审核。审核期间不要再向 `master` 推送会改变 manifest 的提交

> Edge 加载项（Edge Add-ons）可复用同一个 zip；Firefox 不在支持范围内（见
> [ARCHITECTURE.md 的非目标](ARCHITECTURE.md#非目标明确的边界)）。

## 6. 仓库拓扑与同步

**Gitee 是主开发平台，GitHub 是私有镜像。两个平台的默认分支都是 `master`。**

> **GitHub 仓库当前是私有的。** 未认证访问 `github.com/myplugin/chrome-tab-sleep` 与
> 对应的 REST API 都返回 404，而仓库确实存在于该路径下（能推送、`git ls-remote` 有
> 响应），所以这是可见性设置，不是路径写错。**因此对外可见的仓库只有 Gitee**；
> GitHub 那一侧目前只承担三件事：跑 CI、定时同步备份、存放 Release 产物。
>
> 这个事实有一个必须说清楚的后果：`.github/` 下的 issue 模板、以及它们里面的链接，
> **外部贡献者看不到、也点不开**——面向外部的交流事实上全部发生在 Gitee。
> 若要让 GitHub 真正成为公开镜像，需要在仓库设置里改为 public，这是一次所有者操作
> （见 [ROADMAP.md L5](ROADMAP.md)）。

本文档、`.github/` 配置与各处链接均按 `master` 书写，`npm run validate` 的 `branch`
段会核对它们指向的分支是否真实存在——写成 `main` 这类不存在的分支名会直接让校验失败，
而不是等到有人点开一个 404 链接、或照抄的命令报
`src refspec main does not match any` 时才发现。

**默认分支名已决定保持 `master`，不改名为 `main`（2026-10-13）**：Gitee 是主开发平台，
它的默认分支就是 `master`，而 GitHub 只是镜像；为迁就镜像平台的命名习惯去改动主平台的
默认分支，收益不抵一次「两个远端默认分支短暂不一致」的窗口。若将来仍要改，注意
**「默认分支」是仓库属性，`git` 做不到**，只能在两个平台的仓库设置里各自操作；
并须同步本文档、`.github/ISSUE_TEMPLATE/config.yml` 与 `CONTRIBUTING.md` 的分支引用。

| remote   | 地址                                           | 角色                                |
| -------- | ---------------------------------------------- | ----------------------------------- |
| `origin` | `git@gitee.com:xplugins/chrome-tab-sleep.git`  | 主开发仓库（对外可见，日常推送/PR） |
| `github` | `git@github.com:myplugin/chrome-tab-sleep.git` | 私有镜像（CI + 备份，外部不可见）   |

> **维护者本机的 remote 地址可能与上表不同**：`github.com:22` 在部分网络下会被
> 概率性阻断，官方解法是改走 `ssh.github.com:443`。维护者用 `~/.ssh/config` 里的
> **主机别名**来为不同账号分配不同的 key——例如
>
> ```sshconfig
> Host github-myaccount
>   HostName ssh.github.com   # 22 端口被网络阻断时的官方替代
>   Port 443
>   User git
>   IdentityFile ~/.ssh/id_ed25519_github_myaccount
> ```
>
> 之后 remote 写成 `git@github-myaccount:owner/repo.git` 即可。
> **关键在于别名必须覆盖主机名**：如果只配了 `Host github-myaccount` 而没有对应的
> `Host github.com` 段，那么裸 `git@github.com:...` **不会**使用这把 key，会得到
> `Permission denied (publickey)`。
>
> 具体的 key 路径与别名属于**每台机器各自的配置**，因此本文不写死任何一个——
> 它们对别人毫无意义，写进公开仓库也平白暴露维护者的环境信息。
> 以自己的 `~/.ssh/config` 为准；推送前自检 `ssh -T git@<你的别名>`，
> 看到 `Hi <你的用户名>!` 即通了。

表中 `github-pycv` 是**维护者本机** `~/.ssh/config` 里的别名。没有这份配置的机器，
直接用官方地址即可：`git@github.com:myplugin/chrome-tab-sleep.git`。

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

### 推送 GitHub 失败时（网络受限环境）

国内网络对 `github.com:22` 和 `ssh.github.com:443` 都存在**概率性阻断**，表现为：

```
ssh_dispatch_run_fatal: Connection to <ip> port 22: Connection timed out
Connection reset by <ip> port 22
fatal: Could not read from remote repository.
```

**这不代表配置写错了。** 按顺序处理：

1. **先确认别名解析正确**：`ssh -G <你的别名> | grep -E '^(hostname|port|identityfile)'`
   应输出 `ssh.github.com` / `443` / 你为这个账号配的那把 key（见上文示例）。
   如果 `port 22` 且 `hostname github.com`，说明配置被改回去了——把 `HostName` 设为
   `ssh.github.com` 并加 `Port 443`（GitHub 官方针对端口 22 被封的解法）。
2. **直接重试**。实测大约每 3~4 次成功一次，重试即可，不要改配置：
   ```bash
   for i in 1 2 3 4 5 6 7 8; do git push github master && break; sleep 8; done
   ```
3. **完全推不动时的兜底**：在 GitHub 网页上手动触发同步工作流
   （**Actions → Mirror from Gitee → Run workflow**）。它跑在 GitHub 自己的机器上，
   不经过你的本地网络，会把 Gitee 的最新提交同步上来。

两个必须知道的限制：

1. **用工作流自带的 `GITHUB_TOKEN` 推送，不会触发其他工作流**（GitHub 用来防止递归）。
   所以同步工作流**自己在同一个 job 里跑 `npm run check` 与打包校验**，
   而不是指望 `ci.yml` 随后被触发。
2. **因此 `ci.yml` 只在直接向 GitHub 推送或提 PR 时运行。** 由于日常工作发生在
   Gitee，日常的自动化结论实际来自同步工作流那一次运行。

若 Gitee 仓库是私有的，在 GitHub 仓库里加一个 `GITEE_TOKEN` secret（具有读取权限即可），
同步工作流会自动使用它。

### Gitee 侧的 CI

**已决定不做（2026-10-13）。** CI 只跑在 GitHub Actions，Gitee 侧不设门禁。

Gitee Go 的配置语法与 Actions 完全不同，等于要额外维护第二套**无法在本地验证**的
流水线；在仓库还没有外部贡献者的时候，这份维护成本换不到任何东西。

**触发重新考虑的条件**：Gitee 上出现真实的外部 PR、需要提交门禁时再做。
届时是**重写**配置而不是复用。详见 [ROADMAP.md L4](ROADMAP.md)。

### 发布

GitHub Release 由 `.github/workflows/release.yml` 生成。注意它的触发方式是
打 tag 推送或手动 `workflow_dispatch`：**同步工作流推送的 tag 不会自动触发它**
（原因见上面的第 1 条限制）。发版时在 GitHub 的 Actions 页面手动触发一次即可。

> **注意 GitHub 仓库是私有的**：Release 产物只有仓库成员能看到。对外分发应走 Gitee
> 的发行版页面，或直接提供 `dist/dozetabs-v<version>.zip`。
