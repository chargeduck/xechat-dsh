<#
.SYNOPSIS
    xechat-dsh 一键安装脚本（Windows PowerShell 5.1+ / PowerShell 7+）

.DESCRIPTION
    把 xechat-dsh 安装到指定的 DSH profile，并在安装后立即验证。

    设计原则：
      1. 先检查、后动手；失败时给出可执行的下一步，而不是堆栈。
      2. 不改动全局 npm / pnpm 配置。
      3. 装完用 dsh 自己的解析器验证，避免「pnpm 说成功但插件加载不了」。

.PARAMETER Profile
    目标 profile，默认 web。桌面端用 desktop。

.PARAMETER Tgz
    从本地 tarball 安装。

.PARAMETER Repo
    从 GitHub 安装，形如 owner/repo 或完整 URL。

.PARAMETER Npm
    从 npm 安装（包名 xechat-dsh）。

.PARAMETER DryRun
    只检查环境并打印将要执行的命令，不改动任何文件。

.PARAMETER Uninstall
    卸载。

.PARAMETER Yes
    跳过交互确认。

.EXAMPLE
    .\install.ps1

.EXAMPLE
    .\install.ps1 -Profile desktop

.EXAMPLE
    .\install.ps1 -Tgz .\xechat-dsh-0.1.0.tgz
#>
[CmdletBinding()]
param(
    [string]$Profile = 'web',
    [string]$Tgz,
    [string]$Repo,
    [switch]$Npm,
    [switch]$DryRun,
    [switch]$Uninstall,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'

# ---------- 输出 ----------
#
# 注意：不要用 Write-Host '' 输出空行。
# 在 PowerShell 5.1 的可执行环境（powershell.exe 承载脚本文件）里，
# 空字符串的 Write-Host 与前面的 -ForegroundColor 调用连用时不会产生换行，
# 结果是多行文字黏成一行（实测复现）。这里统一用 Write-Line 输出空行。

function Write-Line { Write-Host ' ' }

function Write-Info  ($m) { Write-Host "-> $m" -ForegroundColor Cyan }
function Write-Ok    ($m) { Write-Host "[OK] $m" -ForegroundColor Green }
function Write-Warn2 ($m) { Write-Host "[!] $m" -ForegroundColor Yellow }
function Write-Fail  ($m) { Write-Host "[X] $m" -ForegroundColor Red }
function Write-Dim   ($m) { Write-Host "    $m" -ForegroundColor DarkGray }

function Stop-WithError {
    param([string]$Message, [string[]]$Hints = @())
    Write-Fail $Message
    foreach ($h in $Hints) { Write-Host "  $h" }
    exit 1
}

# ---------- 环境探测 ----------

Write-Info '检测环境'

$isWindowsHost = $true
if ($PSVersionTable.PSEdition -eq 'Core') {
    $isWindowsHost = $IsWindows
}
$platform = if ($isWindowsHost) { 'windows' } elseif ($IsMacOS) { 'macos' } else { 'linux' }
Write-Ok "平台: $platform"

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }

# DSH_HOME：官方约定 $env:DSH_HOME，缺省 ~/.dsh
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$ProfileDir = Join-Path $DshHome "profiles/$Profile"

# 找 dsh CLI
$DshBin = $null
$cmd = Get-Command dsh -ErrorAction SilentlyContinue
if ($cmd) {
    $DshBin = $cmd.Source
} else {
    $candidates = @(
        'D:\Program Files\deepSeekHarness\resources\runtime\cli\bin\dsh.cmd',
        'C:\Program Files\deepSeekHarness\resources\runtime\cli\bin\dsh.cmd',
        (Join-Path $env:LOCALAPPDATA 'Programs\deepSeekHarness\resources\runtime\cli\bin\dsh.cmd'),
        (Join-Path $HOME '.dsh\bin\dsh.cmd'),
        '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh',
        '/opt/deepseek-harness/resources/runtime/cli/bin/dsh',
        '/usr/local/bin/dsh',
        (Join-Path $HOME '.local/bin/dsh')
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) { $DshBin = $c; break }
    }
}

if (-not $DshBin) {
    Stop-WithError '未找到 dsh 命令' @(
        '请先安装 DeepSeek Harness，或把它加入 PATH：',
        '  Windows 默认: D:\Program Files\deepSeekHarness\resources\runtime\cli\bin',
        '  macOS 默认:   /Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin'
    )
}
Write-Ok "dsh: $DshBin"

try {
    $DshVersion = (& $DshBin --version 2>&1 | Select-Object -First 1).ToString().Trim()
} catch {
    Stop-WithError "dsh 无法执行: $DshBin" @($_.Exception.Message)
}
if (-not $DshVersion) {
    Stop-WithError "dsh 没有返回版本号: $DshBin"
}
Write-Ok "版本: $DshVersion"

if ($DshVersion -match '^0\.[01]\.') {
    Write-Warn2 "当前版本 $DshVersion 低于插件要求（>=0.2.0-rc.1），可能无法加载"
}

if (Test-Path $ProfileDir) {
    Write-Ok "profile: $Profile ($ProfileDir)"
} else {
    Write-Warn2 "profile 目录不存在，将在安装时创建: $ProfileDir"
}

# ---------- 卸载 ----------

if ($Uninstall) {
    Write-Info "卸载 xechat-dsh（profile: $Profile）"
    if ($DryRun) {
        Write-Dim "dry-run：将执行 & '$DshBin' plugin --profile $Profile remove xechat-dsh"
        exit 0
    }
    & $DshBin plugin --profile $Profile remove xechat-dsh 2>&1 | ForEach-Object { "  $_" }

    $pkgPath = Join-Path $ProfileDir 'node_modules/xechat-dsh'
    if (Test-Path $pkgPath) {
        Write-Warn2 '包目录仍在，手动清理：'
        Write-Dim "  Remove-Item -Recurse -Force '$pkgPath'"
    }
    $pkgJson = Join-Path $ProfileDir 'package.json'
    if ((Test-Path $pkgJson) -and (Select-String -Path $pkgJson -Pattern 'xechat-dsh' -Quiet)) {
        Write-Warn2 'profile 的 package.json 仍提到 xechat-dsh，若启动报错请从 dsh.profile.bundles 移除'
    }
    Write-Ok '卸载完成，重启 dsh 生效'
    exit 0
}

# ---------- 决定安装源 ----------

Write-Info '确定安装源'

$spec = $null
$kind = $null

if ($Tgz) {
    $kind = 'local'; $spec = $Tgz
} elseif ($Repo) {
    $kind = 'repo'; $spec = $Repo
} elseif ($Npm) {
    $kind = 'npm'; $spec = 'xechat-dsh'
} else {
    # 默认：脚本同目录有 tarball 就用它（离线/免构建），否则用仓库
    $localTgz = Get-ChildItem -Path $ScriptDir -Filter 'xechat-dsh*.tgz' -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($localTgz) {
        $kind = 'local'; $spec = $localTgz.FullName
        Write-Ok "发现本地 tarball: $($localTgz.Name)"
    } else {
        $pkgJsonPath = Join-Path $ScriptDir 'package.json'
        if (Test-Path $pkgJsonPath) {
            $repoUrl = (Get-Content $pkgJsonPath -Raw | ConvertFrom-Json).repository.url
            if ($repoUrl) {
                $kind = 'repo'; $spec = ($repoUrl -replace '^git\+', '' -replace '\.git$', '')
                Write-Ok "使用仓库地址: $spec"
            }
        }
        if (-not $spec) {
            Stop-WithError '无法确定安装源' @(
                '脚本同目录没有 tarball，package.json 里也没有 repository 字段。',
                '请显式指定：.\install.ps1 -Tgz C:\path\to\xechat-dsh.tgz',
                '或：        .\install.ps1 -Repo owner/repo'
            )
        }
    }
}

switch ($kind) {
    'local' {
        if (-not (Test-Path $spec)) {
            Stop-WithError "tarball 不存在: $spec" @('请确认路径，或先用 npm pack 生成')
        }
        $abs = (Resolve-Path $spec).Path
        $spec = "file:$abs"
        Write-Ok "本地包: $abs"
    }
    'repo' {
        if ($spec -notmatch '^(https?|git\+)') {
            $spec = "https://github.com/$spec"
        }
        Write-Ok "仓库: $spec"
        Write-Warn2 '源码安装会触发 pnpm 构建脚本审批，可能需要逐包确认'
    }
    'npm' {
        Write-Ok "npm: $spec"
    }
}

if ($DryRun) {
    Write-Line
    Write-Info 'dry-run 结束，未改动任何文件'
    Write-Dim "将执行：& '$DshBin' plugin --profile $Profile add `"$spec`""
    exit 0
}

# ---------- 确认 ----------

if (-not $Yes) {
    Write-Line
    Write-Host "即将安装到 profile `"$Profile`"，源：$spec"
    $reply = Read-Host '继续？[Y/n]'
    if ($reply -and $reply -notmatch '^(y|yes)$') {
        Write-Info '已取消'
        exit 0
    }
}

# ---------- 安装 ----------

Write-Info '安装中（可能需要几十秒）'
$addOutput = & $DshBin plugin --profile $Profile add $spec 2>&1 | ForEach-Object { $_.ToString() }
$addExit = $LASTEXITCODE
$addText = ($addOutput -join "`n")
$addOutput | ForEach-Object { "  $_" }

if ($addExit -ne 0) {
    Write-Fail "安装命令返回非零（$addExit）"
    if ($addText -match 'cannot resolve profile bundle|failed to resolve') {
        Write-Warn2 '这是已知的时序误报：dsh 的 reconcile 早于 pnpm 写入完成'
        Write-Warn2 '下面会用实际文件校验真实状态'
    } else {
        Stop-WithError '安装失败' @(
            '常见原因：',
            '  · 网络无法访问 GitHub / npm',
            '  · 仓库不是合法 DSH 插件（缺少 dsh.bundle）',
            '  · pnpm 需要构建授权'
        )
    }
}

# ---------- 验证 ----------

Write-Info '验证安装结果'
$pkgDir = Join-Path $ProfileDir 'node_modules/xechat-dsh'
$fails = 0

if (Test-Path $pkgDir) {
    Write-Ok '包目录存在'
    foreach ($f in @('package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js')) {
        $full = Join-Path $pkgDir $f
        if (Test-Path $full) {
            $size = (Get-Item $full).Length
            Write-Ok "$f ($size bytes)"
        } else {
            Write-Fail "缺少 $f"
            $fails++
        }
    }
} else {
    Write-Fail "包目录不存在: $pkgDir"
    $fails++
}

$profilePkg = Join-Path $ProfileDir 'package.json'
if (Test-Path $profilePkg) {
    if (Select-String -Path $profilePkg -Pattern '"xechat-dsh"' -Quiet) {
        Write-Ok 'dsh.profile.bundles 已注册'
    } else {
        Write-Fail 'profile 的 package.json 里没有 xechat-dsh'
        Write-Dim '  手动把 "xechat-dsh" 加进 dsh.profile.bundles 数组'
        $fails++
    }
}

# 用 dsh 自己的解析器做终审——唯一可靠的判据
Write-Info '用 dsh 解析配置（终审）'
$dumpText = (& $DshBin --profile $Profile --dump-config 2>&1 | ForEach-Object { $_.ToString() }) -join "`n"

if ($dumpText -match 'failed to parse|YAMLException') {
    Write-Fail 'profile 配置解析失败——注意：这通常不是本插件的问题'
    ($dumpText -split "`n" | Where-Object { $_ -match 'failed to parse|YAMLException' } |
        Select-Object -First 3) | ForEach-Object { "  $_" }
    Write-Dim '  常见原因：profile 的 cordis.patch.yml 里有多个 YAML 根节点'
    Write-Dim '  （例如先写了 [] 又在后面追加 - insert: 块）'
    Write-Dim "  文件位置：$(Join-Path $ProfileDir 'cordis.patch.yml')"
    $fails++
} elseif ($dumpText -match 'managed exclusively by the Electron') {
    Write-Warn2 '该 profile 由 Electron 独占管理，CLI 无法验证，请直接用应用启动确认'
} elseif ($dumpText -match 'xechat-dsh') {
    Write-Ok 'dsh 已能解析到 xechat-dsh'
} else {
    Write-Warn2 '解析成功但输出里没看到 xechat-dsh，请启动后确认侧边栏是否出现'
}

# ---------- 收尾 ----------

Write-Line
if ($fails -eq 0) {
    Write-Ok '安装完成'
    Write-Line
    Write-Info '下一步：'
    if ($Profile -eq 'web') {
        Write-Dim '  1. 重启 dsh web 服务'
        Write-Dim '  2. 刷新浏览器页面'
    } else {
        Write-Dim '  完全退出并重新打开 DeepSeek Harness'
    }
    Write-Dim '  3. 视口右侧会出现 44px 图标条，点击可展开'
    Write-Dim '  4. 在聊天输入框输入 #showServer 拉取服务器列表'
} else {
    Write-Fail "安装未完全成功（$fails 项待处理）"
    Write-Line
    Write-Info '排查建议：'
    Write-Dim '  · 先看上面的 [X] 行，按提示处理'
    Write-Dim "  · 卸载重试：.\install.ps1 -Profile $Profile -Uninstall"
    Write-Dim "  · 报告问题时附上：dsh 版本 ($DshVersion)、平台 ($platform)、上面的完整输出"
    exit 1
}
