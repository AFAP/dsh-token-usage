# dsh-token-usage

<div align="center">
  <b>中文</b> · <a href="README.en.md">English</a>
</div>

Token 用量展示插件 for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI。

在 `dsh web` 中展示 Token 消耗，包含两个面：

1. **单会话胶囊**：会话头部右侧显示当前会话的输入/输出/上下文占用，点击弹出明细
   （提供方用量、上下文构成、上下文压力、会话统计）。
2. **全局消耗面板**：侧边栏底部"Token 统计"按钮打开全局面板 —— 每日消耗柱状图
   （近 30 天）、**按模型分解**（输入/输出/缓存/合计/占比）、按日明细。数据来自
   会话日志，实时扫描聚合，面板打开时每 60 秒自动刷新。

无需任何配置。

本插件**不修改任何文件**：单会话胶囊只读取 Harness 实时推送的会话投影数据；全局面板
只**只读扫描** `$DSH_HOME\sessions` 下的会话日志（不写入、不删除、不改动任何日志）。

## 效果预览

| 全局消耗面板（每日消耗 · 按模型 · 按日明细） | 会话头部 Token 胶囊 |
|:---:|:---:|
| ![全局消耗面板](screenshot/panel.jpg) | ![会话 Token 胶囊](screenshot/pill.jpg) |

## 一键安装（GitHub）

```powershell
dsh plugin --profile web add github:AFAP/dsh-token-usage
```

然后**重启 `dsh web`** 生效。

> 安装后插件位于 `$DSH_HOME\profiles\web\node_modules\dsh-token-usage`（pnpm 从
> GitHub 克隆），与源码仓库位置无关。
>
> 升级：`dsh plugin --profile web update dsh-token-usage`
>
> 卸载：`dsh plugin --profile web remove dsh-token-usage`

### 从源码目录手动安装（等价验证用）

```powershell
dsh plugin --profile web add "D:\path\to\dsh-token-usage"
```

### 验证是否加载成功

打开任意会话 → 头部右侧出现 token 胶囊；侧边栏底部出现"Token 统计"按钮。

## 架构与数据流

### 单会话胶囊（纯客户端）

数据链路全部由 DeepSeek Harness 内置组件提供：

1. `@deepseek-ai/dsh-token-meter`（base 层已内置）把每次请求的 token 用量折叠成
   会话投影：`tokenUsage`、`contextPressure`、`contextBreakdown`；
   `@deepseek-ai/dsh-session-stats`（web 层已内置）提供 `sessionStats`。
2. `dsh-host-apiproxy` 把**每个投影变更**广播为 `session/projection` 帧；
   打开旧会话时历史尾部也携带投影基线。
3. 浏览器端 `dsh-client-runtime` 写入 `ProjectionValueStore`，slot 标准套件的
   `useProjection(key)` 钩子暴露给组件。
4. 插件把 `TokenUsageBadge` 注册进 `conversation.session.header.utilities`。

### 全局面板（宿主半部扫描日志 + 客户端渲染）

```
dsh-token-usage (node half, lib/index.js — 零外部依赖，仅 node 内置 + ./stats.js)
  GET /api/token-stats ──▶ 扫描 $DSH_HOME/sessions/**/session.jsonl.zstd
                            （串联 zstd 帧，逐帧解压，解析 JSONL 事件）
                            ├─ assistant/message 事件 → data.usage（提供方上报的 token）
                            ├─ request/header / request/context → 当前 model
                            └─ 按「本地日期 × 模型」聚合 → JSON
                                  │
                                  ▼  (浏览器 fetch，同源)
  GlobalStatsPanel (client half) ── 汇总卡片 + 30 天柱状图 + 按模型表 + 按日明细
```

- 日志格式：`dsh-session-persistence-jsonl` 的**多帧 zstd 容器**（每追加一批事件
  写一个独立帧）；本插件移植了官方的帧边界扫描（magic/descriptor/block/checksum），
  逐帧 `zstdDecompressSync`（Node 22.22+ 内置），跳过崩溃残留的不完整尾帧。
- 每次请求按文件 mtime/size 记忆化：只有变化的会话日志会被重新读取，刷新接近瞬时。
- `/api/token-stats` 以 **exact 路由**注册在 webserver 上（优先于连接插件 `/api`
  前缀），并自带浏览器信任围栏（loopback / trustedHosts + same-origin 检查，
  与 `dsh-client-connection` 的 `/api` 围栏一致），拒绝 DNS 重绑定与跨站请求。
- 宿主半部刻意**零外部依赖**：DSH_HOME 从环境变量解析（`$DSH_HOME` → `~/.dsh`），
  不引入任何 `@deepseek-ai/*` 包，因此无论以 git / registry / file: / link: 哪种
  方式安装都不会出现模块解析失败。

## 目录结构

```
dsh-token-usage/               # 仓库根 = npm 包根
├── package.json               # dsh.bundle.patch（配置补丁层）+ dsh.client（浏览器端声明）
├── cordis.patch.yml           # 组合行：inject webRuntime + trustedHosts 配置
├── LICENSE                    # MIT
├── screenshot/                # 效果截图（panel.jpg 全局面板 / pill.jpg 会话胶囊）
└── lib/
    ├── index.js               # 宿主半部：/api/token-stats 路由 + zstd 帧扫描 + 聚合缓存
    ├── stats.js               # 纯聚合逻辑（无依赖，可独立测试）
    └── client.js              # 浏览器 bundle：单会话胶囊 + 全局面板
```

## 使用

- **单会话胶囊**：`入 {输入} · 出 {输出} · 上下 {占用%}`（紧凑格式 1.2k / 3.4M），
  点击弹出四组明细（提供方用量 / 上下文构成 / 上下文压力 / 会话统计）。
- **全局面板**（侧边栏底部 → Token 统计）：
  - 汇总卡片：累计消耗 / 今日 / 近 7 天 / 请求数 / 会话数；
  - 近 30 天每日消耗柱状图（今日高亮，悬停显示数值）；**点击某天柱子 → 下方展开该日 24 小时用量分布**；
  - 按模型汇总（默认收起，点击展开）：模型 | 输入 | 输出 | 缓存 | 合计 | 占比 —— 收起时显示全部模型汇总；
  - 按日明细：日期 | 合计 | 输入 | 输出 | 请求 | 模型明细，点日期行展开该日各模型；
  - 打开时每 60 秒自动刷新，也可手动刷新；Esc / 点击遮罩关闭。
- **秒开**：已聚合数据带本地缓存，反复打开、重启 dsh 后都无需重新统计。
- 语言跟随界面：简体中文 / English 词典均已内置。

## License

MIT
