#!/usr/bin/env bash
#
# xechat-dsh 一键安装脚本（macOS / Linux）
#
# 用法：
#   ./install.sh                    安装到 web profile（默认）
#   ./install.sh --profile desktop  安装到桌面端 profile
#   ./install.sh --tgz /path/a.tgz  从本地 tarball 安装
#   ./install.sh --repo owner/repo  从 GitHub 安装
#   ./install.sh --dry-run          只检查环境，不改动任何文件
#   ./install.sh --uninstall        卸载
#
# 设计原则：
#   1. 先检查、后动手；每一步失败都给出可执行的下一步，而不是堆栈。
#   2. 不修改你的全局 npm / pnpm 配置。
#   3. 装完立刻用 dsh 自己的解析器验证，避免「pnpm 说成功但插件加载不了」。

set -uo pipefail

# ---------- 输出 ----------

if [ -t 1 ]; then
  C_RESET='\033[0m'; C_DIM='\033[2m'; C_RED='\033[31m'
  C_GREEN='\033[32m'; C_YELLOW='\033[33m'; C_BLUE='\033[34m'
else
  C_RESET=''; C_DIM=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''
fi

info()  { printf "${C_BLUE}→${C_RESET} %s\n" "$*"; }
ok()    { printf "${C_GREEN}✓${C_RESET} %s\n" "$*"; }
warn()  { printf "${C_YELLOW}!${C_RESET} %s\n" "$*"; }
fail()  { printf "${C_RED}✗${C_RESET} %s\n" "$*" >&2; }
dim()   { printf "${C_DIM}%s${C_RESET}\n" "$*"; }

die() {
  fail "$1"
  shift || true
  for line in "$@"; do printf "  %s\n" "$line"; done
  exit 1
}

# ---------- 参数 ----------

PROFILE="web"
SOURCE=""
SOURCE_KIND="auto"   # auto | local | repo | npm
DRY_RUN=0
UNINSTALL=0
ASSUME_YES=0

while [ $# -gt 0 ]; do
  case "$1" in
    --profile)    PROFILE="${2:-}"; shift 2 ;;
    --tgz|--local) SOURCE="${2:-}"; SOURCE_KIND="local"; shift 2 ;;
    --repo)       SOURCE="${2:-}"; SOURCE_KIND="repo"; shift 2 ;;
    --npm)        SOURCE="xechat-dsh"; SOURCE_KIND="npm"; shift ;;
    --dry-run)    DRY_RUN=1; shift ;;
    --uninstall)  UNINSTALL=1; shift ;;
    -y|--yes)     ASSUME_YES=1; shift ;;
    -h|--help)    sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)            die "未知参数: $1" "运行 ./install.sh --help 查看用法" ;;
  esac
done

[ -n "$PROFILE" ] || die "缺少 --profile 的值"

# 脚本所在目录（解析软链接，保证从任意位置调用都正确）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# ---------- 环境探测 ----------

info "检测环境"

OS_NAME="$(uname -s 2>/dev/null || echo unknown)"
case "$OS_NAME" in
  Darwin) PLATFORM="macos" ;;
  Linux)  PLATFORM="linux" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
  *)      PLATFORM="unknown" ;;
esac
ok "平台: $PLATFORM ($OS_NAME)"

# DSH_HOME：官方约定 $DSH_HOME，缺省 ~/.dsh
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"

# 找 dsh CLI：优先 PATH，其次已知安装位置
#
# 注意 Windows 上可执行文件名是 `dsh.cmd` 而不是 `dsh`，
# 所以候选路径要同时尝试带与不带 .cmd 后缀的两种。
DSH_BIN=""
if command -v dsh >/dev/null 2>&1; then
  DSH_BIN="$(command -v dsh)"
else
  for base in \
    "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
    "$HOME/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
    "/opt/deepseek-harness/resources/runtime/cli/bin/dsh" \
    "/usr/local/bin/dsh" \
    "$HOME/.local/bin/dsh" \
    "$HOME/.dsh/bin/dsh" \
    "/d/Program Files/deepSeekHarness/resources/runtime/cli/bin/dsh" \
    "/c/Program Files/deepSeekHarness/resources/runtime/cli/bin/dsh" \
    "/mnt/d/Program Files/deepSeekHarness/resources/runtime/cli/bin/dsh" \
    "/mnt/c/Program Files/deepSeekHarness/resources/runtime/cli/bin/dsh"
  do
    if [ -x "$base" ]; then DSH_BIN="$base"; break; fi
    if [ -f "$base.cmd" ]; then DSH_BIN="$base.cmd"; break; fi
  done
fi

if [ -z "$DSH_BIN" ]; then
  die "未找到 dsh 命令" \
    "请先安装 DeepSeek Harness，或把它加入 PATH：" \
    "  export PATH=\"\$PATH:/path/to/deepseek-harness/resources/runtime/cli/bin\"" \
    "macOS 桌面版默认在 /Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
fi
ok "dsh: $DSH_BIN"

DSH_VERSION="$("$DSH_BIN" --version 2>/dev/null | head -1 | tr -d '\r')"
if [ -z "$DSH_VERSION" ]; then
  die "dsh 无法执行" "直接运行失败：$DSH_BIN --version"
fi
ok "版本: $DSH_VERSION"

# 版本门槛：engines.dsh = >=0.2.0-rc.1
case "$DSH_VERSION" in
  0.[01].*)
    warn "当前版本 $DSH_VERSION 低于插件要求（>=0.2.0-rc.1），可能无法加载"
    ;;
esac

# profile 是否存在（web 通常已存在，desktop 由应用创建）
if [ -d "$PROFILE_DIR" ]; then
  ok "profile: $PROFILE ($PROFILE_DIR)"
else
  warn "profile 目录不存在，将在安装时创建: $PROFILE_DIR"
fi

# pnpm 由 dsh 自带，但先确认一次，避免装到一半才发现
if [ "$PLATFORM" = "macos" ] || [ "$PLATFORM" = "linux" ]; then
  if ! command -v pnpm >/dev/null 2>&1; then
    RUNTIME_PNPM="$(dirname "$DSH_BIN")/../../dependencies/pnpm/bin/pnpm.cjs"
    if [ -f "$RUNTIME_PNPM" ]; then
      ok "pnpm: dsh 自带"
    else
      warn "未在 PATH 找到 pnpm；dsh 通常会自带，若安装失败请装 pnpm 后重试"
    fi
  else
    ok "pnpm: $(pnpm --version 2>/dev/null | head -1)"
  fi
fi

# ---------- 卸载 ----------

if [ "$UNINSTALL" -eq 1 ]; then
  info "卸载 xechat-dsh（profile: $PROFILE）"
  if [ "$DRY_RUN" -eq 1 ]; then
    dim "dry-run：将执行 $DSH_BIN plugin --profile $PROFILE remove xechat-dsh"
    exit 0
  fi
  "$DSH_BIN" plugin --profile "$PROFILE" remove xechat-dsh 2>&1 | sed 's/^/  /'
  if [ -d "$PROFILE_DIR/node_modules/xechat-dsh" ] || [ -L "$PROFILE_DIR/node_modules/xechat-dsh" ]; then
    warn "包目录仍在，手动清理："
    dim "  rm -rf \"$PROFILE_DIR/node_modules/xechat-dsh\""
  fi
  # bundle 列表里可能残留
  if [ -f "$PROFILE_DIR/package.json" ] && grep -q '"xechat-dsh"' "$PROFILE_DIR/package.json"; then
    warn "profile 的 package.json 仍提到 xechat-dsh，若启动报错请手动从 dsh.profile.bundles 移除"
  fi
  ok "卸载完成，重启 dsh 生效"
  exit 0
fi

# ---------- 决定安装源 ----------

info "确定安装源"

if [ "$SOURCE_KIND" = "auto" ]; then
  # 默认：脚本同目录有 tarball 就用它（离线/免构建），否则用仓库
  TARBALL=""
  ls "$SCRIPT_DIR"/xechat-dsh*.tgz >/dev/null 2>&1 && TARBALL="$(ls -1 "$SCRIPT_DIR"/xechat-dsh*.tgz | head -1)"
  if [ -n "$TARBALL" ]; then
    SOURCE="$TARBALL"; SOURCE_KIND="local"
    ok "发现本地 tarball: $(basename "$TARBALL")"
  else
    # package.json 的 repository 字段是权威来源
    REPO_URL="$(sed -n 's/.*"url"[[:space:]]*:[[:space:]]*"git+\(https[^"]*\)".*/\1/p' "$SCRIPT_DIR/package.json" 2>/dev/null | head -1)"
    if [ -n "$REPO_URL" ]; then
      SOURCE="$REPO_URL"; SOURCE_KIND="repo"
      ok "使用仓库地址: $SOURCE"
    else
      die "无法确定安装源" \
        "脚本同目录没有 tarball，package.json 里也没有 repository 字段。" \
        "请显式指定：./install.sh --tgz /path/to/xechat-dsh.tgz" \
        "或：        ./install.sh --repo owner/repo"
    fi
  fi
fi

case "$SOURCE_KIND" in
  local)
    [ -f "$SOURCE" ] || die "tarball 不存在: $SOURCE" "请确认路径，或先用 npm pack 生成"
    # dsh 转给 pnpm，file: 需要绝对路径。
    # Windows 上必须转成原生路径：Git Bash 的 /e/foo 交给 pnpm 会变成 C:\e\foo
    ABS_SOURCE="$(cd "$(dirname "$SOURCE")" && pwd -P)/$(basename "$SOURCE")"
    if [ "$PLATFORM" = "windows" ]; then
      # cygpath 能把 /e/foo 转成 E:\foo；没有它就用 sed 兜底
      if command -v cygpath >/dev/null 2>&1; then
        ABS_SOURCE="$(cygpath -w "$ABS_SOURCE")"
      else
        ABS_SOURCE="$(printf '%s' "$ABS_SOURCE" | sed -E 's|^/([a-zA-Z])/|\1:/|; s|/|\\|g')"
      fi
    fi
    SPEC="file:$ABS_SOURCE"
    ok "本地包: $ABS_SOURCE"
    ;;
  repo)
    case "$SOURCE" in
      http*|git+*) SPEC="$SOURCE" ;;
      *) SPEC="https://github.com/$SOURCE" ;;
    esac
    ok "仓库: $SPEC"
    warn "源码安装会触发 pnpm 构建脚本审批，可能需要逐包确认"
    ;;
  npm)
    SPEC="xechat-dsh"
    ok "npm: $SPEC"
    ;;
esac

if [ "$DRY_RUN" -eq 1 ]; then
  echo
  info "dry-run 结束，未改动任何文件"
  dim "将执行：$DSH_BIN plugin --profile $PROFILE add \"$SPEC\""
  exit 0
fi

# ---------- 确认 ----------

if [ "$ASSUME_YES" -ne 1 ]; then
  printf "\n即将安装到 profile \"%s\"，源：%s\n" "$PROFILE" "$SPEC"
  printf "继续？[Y/n] "
  read -r reply </dev/tty || reply="y"
  case "$reply" in
    ""|y|Y|yes|YES) ;;
    *) info "已取消"; exit 0 ;;
  esac
fi

# ---------- 安装 ----------

info "安装中（可能需要几十秒）"
ADD_OUT="$("$DSH_BIN" plugin --profile "$PROFILE" add "$SPEC" 2>&1)"
ADD_STATUS=$?
printf "%s\n" "$ADD_OUT" | sed 's/^/  /'

if [ $ADD_STATUS -ne 0 ]; then
  fail "安装命令返回非零（$ADD_STATUS）"
  # 已知误报：pnpm 装完了，但 dsh 的 reconcile 早于 pnpm 完成
  if printf "%s" "$ADD_OUT" | grep -qi "cannot resolve profile bundle\|failed to resolve"; then
    warn "这是已知的时序误报：dsh 的 reconcile 早于 pnpm 写入完成"
    warn "下面会用实际文件校验真实状态"
  else
    die "安装失败" "常见原因：" \
      "  · 网络无法访问 GitHub / npm" \
      "  · 仓库不是合法 DSH 插件（缺少 dsh.bundle）" \
      "  · pnpm 需要构建授权（加 --yes 跳过交互后重试）"
  fi
fi

# ---------- 验证 ----------

info "验证安装结果"
PKG_DIR="$PROFILE_DIR/node_modules/xechat-dsh"
FAILS=0

check_file() {
  if [ -f "$PKG_DIR/$1" ]; then
    ok "$1 ($(wc -c < "$PKG_DIR/$1" | tr -d ' ') bytes)"
  else
    fail "缺少 $1"; FAILS=$((FAILS + 1))
  fi
}

if [ -e "$PKG_DIR" ]; then
  ok "包目录存在"
  check_file package.json
  check_file cordis.patch.yml
  check_file lib/index.js
  check_file lib/client.js
else
  fail "包目录不存在: $PKG_DIR"
  FAILS=$((FAILS + 1))
fi

# bundle 是否注册（决定插件会不会被加载）
if [ -f "$PROFILE_DIR/package.json" ]; then
  if grep -q '"xechat-dsh"' "$PROFILE_DIR/package.json"; then
    ok "dsh.profile.bundles 已注册"
  else
    fail "profile 的 package.json 里没有 xechat-dsh"
    dim "  手动把 \"xechat-dsh\" 加进 dsh.profile.bundles 数组"
    FAILS=$((FAILS + 1))
  fi
fi

# 用 dsh 自己的解析器做终审——这是唯一可靠的判据
info "用 dsh 解析配置（终审）"
DUMP_OUT="$("$DSH_BIN" --profile "$PROFILE" --dump-config 2>&1)"
if printf "%s" "$DUMP_OUT" | grep -qi "failed to parse\|YAMLException"; then
  fail "profile 配置解析失败——注意：这通常不是本插件的问题"
  # 只抽真正有信息的那一行，别把 JS 堆栈糊到用户脸上
  printf "%s\n" "$DUMP_OUT" \
    | grep -i "failed to parse\|YAMLException" \
    | head -1 \
    | sed 's/.*\(failed to parse.*\)/\1/' \
    | sed 's/^/  /'
  dim "  常见原因：profile 的 cordis.patch.yml 里有多个 YAML 根节点"
  dim "  （例如先写了 [] 又在后面追加 - insert: 块）"
  dim "  文件位置：$PROFILE_DIR/cordis.patch.yml"
  FAILS=$((FAILS + 1))
elif printf "%s" "$DUMP_OUT" | grep -qi "managed exclusively by the Electron"; then
  warn "该 profile 由 Electron 独占管理，CLI 无法验证，请直接用应用启动确认"
elif printf "%s" "$DUMP_OUT" | grep -q "xechat-dsh"; then
  ok "dsh 已能解析到 xechat-dsh"
else
  warn "解析成功但输出里没看到 xechat-dsh，请启动后确认侧边栏是否出现"
fi

# ---------- 收尾 ----------

echo
if [ "$FAILS" -eq 0 ]; then
  ok "安装完成"
  echo
  info "下一步："
  if [ "$PROFILE" = "web" ]; then
    dim "  1. 重启 dsh web 服务"
    dim "  2. 刷新浏览器页面"
  else
    dim "  完全退出并重新打开 DeepSeek Harness"
  fi
  dim "  3. 视口右侧会出现 44px 图标条，点击可展开"
  dim "  4. 在聊天输入框输入 #showServer 拉取服务器列表"
else
  fail "安装未完全成功（$FAILS 项待处理）"
  echo
  info "排查建议："
  dim "  · 先看上面的 ✗ 行，按提示处理"
  dim "  · 卸载重试：./install.sh --profile $PROFILE --uninstall"
  dim "  · 报告问题时附上：dsh 版本 ($DSH_VERSION)、平台 ($PLATFORM)、上面的完整输出"
  exit 1
fi
