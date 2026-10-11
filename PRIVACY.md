# 隐私政策 / Privacy Policy

**一句话：本扩展不收集、不上传、不共享任何用户数据。所有数据只存在于你的浏览器本地。**

最后更新：2026-10-11 · 适用于 Tab Sleep 全部版本

---

## 我们处理哪些数据，以及为什么

| 数据                                   | 是否离开本机 | 用途                                                                            |
| -------------------------------------- | ------------ | ------------------------------------------------------------------------------- |
| 白名单域名、扩展设置、休眠/唤醒计数    | 否           | 实现你配置的行为；存放在 `chrome.storage.local`                                 |
| 休眠标签页的 URL、标题、图标地址       | 否           | 唤醒后核对是哪个标签页；标签页关闭时删除                                        |
| 滚动位置、表单内容（**不含密码字段**） | 否           | 唤醒后把页面恢复到休眠前的样子；被读取一次后立即删除                            |
| 标签页最后一次活跃时间                 | 否           | 判断是否达到自动休眠的空闲阈值；存于 `chrome.storage.session`，浏览器退出即清空 |

**我们不处理**：账号信息、Cookie、浏览历史、页面正文、网络请求内容、位置、设备标识符。

## 对外网络请求

扩展代码**不向任何服务器发送数据**。

唯一可能产生的对外请求是：当你打开弹窗查看标签页列表时，Service Worker 会读取
页面自己声明的图标地址（`favIconUrl`）并抓取该图标用于展示。这与浏览器自身加载
网站图标的行为一致，请求目标是网站自己，不携带任何用户数据，且只在你打开弹窗时发生。

> 我们计划改用 Chrome 内置的 `favicon` 权限与 `_favicon/` 端点，把这项请求也彻底去掉。
> 进度见 [docs/ROADMAP.md](docs/ROADMAP.md)。

扩展**不含**任何分析、埋点、崩溃上报或远程配置。

## 为什么需要这些权限

| 权限                                | 为什么需要                                                       |
| ----------------------------------- | ---------------------------------------------------------------- |
| `tabs`                              | 枚举标签页、调用 `chrome.tabs.discard()` 休眠、读取标题与图标    |
| `storage`                           | 保存设置、白名单、滚动位置与表单内容（全部在本机）               |
| `scripting` + `<all_urls>` 主机权限 | 休眠前在页面内读取滚动位置与表单内容（密码除外）。数据不离开本机 |
| `contextMenus`                      | 右键菜单中的休眠/白名单操作                                      |
| `alarms`                            | 自动休眠的定时检查                                               |
| `content_scripts`（`<all_urls>`）   | 唤醒后把滚动位置与表单内容写回页面                               |

`<all_urls>` 是本扩展权限提示的来源。它的唯一用途是**在本地**读写即将休眠的页面状态；
你可以通过关闭「恢复滚动位置」「恢复表单内容」来减少被采集的数据量。

## 数据删除

- 打开选项页 → 统计区域 → **重置统计**，可清空计数。
- 在浏览器中移除扩展，`chrome.storage.local` 中该扩展的全部数据会被浏览器删除。
- 我们不留存任何副本，因为我们从未收到过任何数据。

## 儿童隐私

本扩展不面向儿童，也不收集任何年龄相关信息。

## 政策变更

本政策的任何变更都会体现在仓库的 `CHANGELOG.md` 与提交历史中；涉及数据处理范围的
实质变更会同时更新 Chrome 应用商店的隐私声明。

## 联系方式

问题或疑虑请通过仓库 issue 提出；安全相关问题请见 [SECURITY.md](SECURITY.md)。

---

## English summary

Tab Sleep collects **nothing**. Settings, whitelists, statistics, and the captured
scroll position / form contents (passwords excluded) live only in your browser's
local extension storage, and captured page state is deleted as soon as it is
restored. The extension contains no analytics, telemetry, or remote configuration,
and sends no data to any server. The single outbound request is the page's own
favicon, fetched only while the popup is open, and slated for removal. Removing the
extension removes all of its data. Full policy above (Chinese).
