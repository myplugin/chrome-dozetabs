<#
.SYNOPSIS
    Dozetabs - 启动抢先休眠 验收测量脚本

.DESCRIPTION
    浏览器重启后测量内存占用，用于 docs/STARTUP-SUSPEND-TEST.md 的手工验收：
    开 200 个标签 -> 强杀浏览器 -> 重启 -> 等 30 秒 -> 测量总内存。

.PARAMETER Browser
    msedge (默认) 或 chrome

.PARAMETER WaitSeconds
    测量前等待的秒数（验收要求 30 秒）

.PARAMETER Profile
    可选。只统计命令行中包含该字符串的进程（例如你的 user-data-dir）。
    不指定时会统计机器上**所有**同族浏览器进程 —— 如果你同时开着多个
    浏览器实例，数字会偏高。

.PARAMETER MaxWorkingSetGb
    可选。给出目标上限；超限时脚本以退出码 1 结束，便于放进自动化。

.EXAMPLE
    .\scripts\measure-memory.ps1 -Browser msedge -WaitSeconds 30

.EXAMPLE
    # 只统计指定 profile，并以 5 GB 为上限做判定
    .\scripts\measure-memory.ps1 -Profile 'C:\tmp\dozetabs-smoke-b' -MaxWorkingSetGb 5
#>
param(
    [ValidateSet('msedge', 'chrome')]
    [string]$Browser = 'msedge',
    [int]$WaitSeconds = 0,
    [string]$Profile = '',
    [double]$MaxWorkingSetGb = 0
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if ($WaitSeconds -gt 0) {
    Write-Host "等待 $WaitSeconds 秒后再测量..." -ForegroundColor Yellow
    Start-Sleep -Seconds $WaitSeconds
}

# ---- 1. 目标进程 ----
$all = @(Get-Process -Name $Browser -ErrorAction SilentlyContinue)
if ($all.Count -eq 0) {
    Write-Error "未找到 $Browser 进程。请先启动浏览器。"
    exit 1
}

$procs = $all
if ($Profile) {
    $matched = @()
    foreach ($p in $all) {
        try {
            $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)").CommandLine
        } catch {
            $cmd = $null
        }
        if ($cmd -and $cmd -like "*$Profile*") { $matched += $p }
    }
    if ($matched.Count -eq 0) {
        Write-Error "没有进程的命令行包含 '$Profile'（共 $($all.Count) 个 $Browser 进程）。"
        exit 1
    }
    $procs = $matched
}

# ---- 2. 内存 ----
$totalWS = ($procs | Measure-Object WorkingSet64 -Sum).Sum / 1GB
$totalPM = ($procs | Measure-Object PrivateMemorySize64 -Sum).Sum / 1GB

Write-Host ""
Write-Host "===== Dozetabs 启动休眠 验收测量 ($Browser) =====" -ForegroundColor Cyan
Write-Host ("测量时间        : {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
if ($Profile) {
    Write-Host ("进程过滤        : 命令行包含 '{0}'" -f $Profile)
    Write-Host ("匹配 / 全部进程 : {0} / {1}" -f $procs.Count, $all.Count)
} else {
    Write-Host ("进程数          : {0}（未按 profile 过滤）" -f $procs.Count)
}
Write-Host ("总内存 (工作集) : {0:N2} GB" -f $totalWS)
Write-Host ("总内存 (私有)   : {0:N2} GB" -f $totalPM)

# ---- 3. 人工核对提示 ----
# 进程内存是核心指标；标签页状态请在扩展弹窗里核对（或跑 scripts/smoke-test.py）。
Write-Host ""
Write-Host "人工核对提示：" -ForegroundColor Yellow
Write-Host "  - 点扩展图标：'休眠中' 计数应接近 (标签总数 - 1)，'活跃' 应为 1"
Write-Host "  - 点击任何'休眠中'标签，应正常加载"
Write-Host "  - 任务管理器 (Shift+Esc) 里几乎不应有网页渲染进程"

# ---- 4. 记录行 ----
Write-Host ""
Write-Host "----- 数据记录行（复制用）-----" -ForegroundColor Green
Write-Host ("{0}`t{1:yyyy-MM-dd HH:mm}`t{2:N2} GB`t{3:N2} GB`t{4}" -f `
        $Browser, (Get-Date), $totalWS, $totalPM, $procs.Count)

# ---- 5. 退出码 ----
if ($MaxWorkingSetGb -gt 0) {
    if ($totalWS -gt $MaxWorkingSetGb) {
        Write-Host ""
        Write-Host ("超出上限：{0:N2} GB > {1:N2} GB" -f $totalWS, $MaxWorkingSetGb) -ForegroundColor Red
        exit 1
    }
    Write-Host ""
    Write-Host ("在上限内：{0:N2} GB <= {1:N2} GB" -f $totalWS, $MaxWorkingSetGb) -ForegroundColor Green
}

exit 0
