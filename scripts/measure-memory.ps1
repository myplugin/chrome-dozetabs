<#
.SYNOPSIS
    Tab Sleep Tool - 启动抢先休眠 验收测量脚本

.DESCRIPTION
    在浏览器重启后测量：
      1. 浏览器(Edge/Chrome)所有相关进程的总内存 (WorkingSet)
      2. 已加载 / 已丢弃(挂起)标签页数量

    用于验收：开 200 个标签 -> 强杀浏览器 -> 重启 -> 30 秒后总内存
    从 ~22GB 降到 <5GB，只有当前标签在加载。

.PARAMETER Browser
    msedge (默认) 或 chrome

.PARAMETER WaitSeconds
    重启后等待的秒数（验收要求 30 秒）

.EXAMPLE
    # 重启浏览器后，另开一个 PowerShell 窗口执行：
    .\scripts\measure-memory.ps1 -Browser msedge -WaitSeconds 30
#>
param(
    [ValidateSet('msedge', 'chrome')]
    [string]$Browser = 'msedge',
    [int]$WaitSeconds = 0
)

if ($WaitSeconds -gt 0) {
    Write-Host "等待 $WaitSeconds 秒后再测量..." -ForegroundColor Yellow
    Start-Sleep -Seconds $WaitSeconds
}

# ---- 1. 浏览器进程总内存（排除被丢弃标签不占渲染进程） ----
$procs = Get-Process -Name $Browser -ErrorAction SilentlyContinue
if (-not $procs) {
    Write-Error "未找到 $Browser 进程。请先启动浏览器。"
    exit 1
}
$totalWS  = ($procs | Measure-Object WorkingSet64    -Sum).Sum / 1GB
$totalPM  = ($procs | Measure-Object PrivateMemorySize64 -Sum).Sum / 1GB
$renderer = ($procs | Where-Object { $_.MainWindowTitle -eq '' }).Count

Write-Host ""
Write-Host "===== Tab Sleep Tool 启动休眠 验收测量 ($Browser) =====" -ForegroundColor Cyan
Write-Host ("测量时间        : {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Write-Host ("进程数          : {0}" -f $procs.Count)
Write-Host ("总内存 (工作集) : {0:N2} GB" -f $totalWS)
Write-Host ("总内存 (私有)   : {0:N2} GB" -f $totalPM)

# ---- 2. 通过扩展的 Service Worker 统计标签状态 ----
# 说明：进程内存是核心指标；标签状态也可以在浏览器地址栏打开
#       扩展的 popup（"休眠中"计数）人工核对，或用 scripts/smoke-test.py 自动化核对。
Write-Host ""
Write-Host "人工核对提示：" -ForegroundColor Yellow
Write-Host "  - 点扩展图标：'休眠中' 计数应接近 (标签总数 - 1)，'活跃' 应为 1"
Write-Host "  - 点击任何'休眠中'标签，应正常加载"
Write-Host "  - 任务管理器 (Shift+Esc) 里几乎不应有网页渲染进程"

# ---- 3. 输出记录行（方便复制进对比表） ----
Write-Host ""
Write-Host "----- 数据记录行（复制用）-----" -ForegroundColor Green
Write-Host ("{0}`t{1:yyyy-MM-dd HH:mm}`t{2:N2} GB`t{3:N2} GB`t{4}" -f `
    $Browser, (Get-Date), $totalWS, $totalPM, $procs.Count)
