# dsh-model-tester

English | [简体中文](#中文)

A DeepSeek Harness plugin that adds a **one-click model availability tester** panel at the bottom of the Models settings page. It sends one real streaming request to every added model and reports availability, output speed (TPS), first-token latency, and total elapsed time.

## Features

- **Test all at once**: real streaming calls (`llm.stream`) with 3-way concurrency and a 30-second per-model timeout
- **Test one channel**: per-provider「测试本渠道」button runs only that provider's models
- **Three metrics on one line**: available / `TPS (tok/s)` / `first token (s)` / `elapsed (s)`
- **Actionable failures**: failed rows show the reason, error code, and HTTP status
- **Per-model retest**: each model row carries its own prominent Test / Retest button
- **Smart filtering**:
  - Inactive / unconfigured providers are hidden
  - Auto-registered entries whose model id or name contains `vision` (e.g. `modlens vision`) are hidden
- **Model list source**: models you explicitly configured in settings win; otherwise the adapter catalog (`llm.listModels`) is used

## Install

```sh
dsh plugin --profile web add github:masknull/dsh-model-tester
```

Restart the web profile (restart the `dsh web` process) after installing, then open **Settings → Models** — the tester panel sits at the bottom of the page.

## Uninstall

```sh
dsh plugin --profile web remove dsh-model-tester
```

## Metric definitions

| Metric | Meaning |
| --- | --- |
| Available | The streaming call finished with `stop` / `max-tokens` / `tool-calls` |
| TPS | `usage.outputTokens ÷ (stream finish time − first token time)`, tok/s, 1 decimal; shows `—` when the decode window is shorter than 50 ms (response arrives in a single chunk — no meaningful rate can be measured) |
| First token | Time from request start to the first output chunk (text / reasoning delta), seconds, 2 decimals |
| Elapsed | Total time from request start to stream finish, seconds, 2 decimals |

The test request is fixed at `maxTokens: 16` with the prompt "连通性测试：请只回复 ok" ("connectivity test: reply ok only"). TPS relies on provider usage reporting; it shows `—` when the provider does not report usage.

## Architecture

- **Host half** (`index.js`): injects `llm` / `settings` / `timer` / `webServer` / `connection` and registers two authenticated HTTP routes (auth via the client-connection service's `requestRejection` — the same trust boundary open-in-app uses):
  - `GET /model-tester/list` — configurable-provider directory × settings profiles × live-state join
  - `POST /model-tester/test` — one real streaming test against `{provider, model}`
- **Browser half** (`client.js`): a hand-written closure-factory bundle following the `window.__ModuleLoader__` client-bundle contract (`react` resolved through the platform module table), registered into the `settings.models.footer` slot, talking to the host routes over `fetch`

## Local development

```sh
# Install from a local checkout (link mode; changes apply after a profile restart)
dsh plugin --profile web add <path to this repository>
```

No build step is required: `index.js` and `client.js` are plain, directly loadable JavaScript.

## License

[MIT](./LICENSE)

---

## 中文

DeepSeek Harness 插件：在「设置 → 模型」页底部提供**模型可用性一键测试**面板。对每个已添加的模型发起一条真实的流式小请求，给出可用性标记、输出速度（TPS）、首 token 延迟与总耗时。

### 功能

- **一键测试全部**：3 路并发逐个真实调用（`llm.stream`），单模型 30 秒超时
- **按渠道测试**：每个渠道标题行带「测试本渠道」按钮，只测该渠道下的全部模型
- **单行三指标**：可用 / `TPS（tok/s）` / `首 token（s）` / `耗时（s）`
- **失败可诊断**：失败行显示原因、错误码与 HTTP 状态
- **单模型重测**：每个模型行带独立的显眼「测试 / 重测」按钮
- **智能过滤**：
  - 未激活 / 未配置的提供方不显示
  - 模型 id 或名称含 `vision` 的自动注册条目（如 `modlens vision`）不显示
- **模型清单来源**：优先读取你在设置中配置的模型，未显式配置时回退到适配器目录（`llm.listModels`）

### 安装

```sh
dsh plugin --profile web add github:masknull/dsh-model-tester
```

安装后重启 web profile（重启 `dsh web` 进程），打开 **设置 → 模型**，页面底部即为测试面板。

### 卸载

```sh
dsh plugin --profile web remove dsh-model-tester
```

### 指标口径

| 指标 | 含义 |
| --- | --- |
| 可用 | 流式调用以 `stop` / `max-tokens` / `tool-calls` 正常终结 |
| TPS | `usage.outputTokens ÷（流结束时刻 − 首 token 时刻）`，tok/s，保留 1 位小数；decode 窗口不足 50 毫秒（响应一次性到达）时无法测得有效速率，显示 `—` |
| 首 token | 从发起请求到收到第一个输出分片（text / reasoning delta）的耗时，秒，2 位小数 |
| 耗时 | 从发起请求到流结束的总量耗时，秒，2 位小数 |

测试请求固定为 `maxTokens: 16`、提示词「连通性测试：请只回复 ok」。TPS 依赖提供方返回 usage；未返回时显示 `—`。

### 架构

- **宿主半**（`index.js`）：注入 `llm` / `settings` / `timer` / `webServer` / `connection`，注册两个鉴权 HTTP 路由（鉴权走 client-connection 的 `requestRejection`，与 open-in-app 同一信任边界）：
  - `GET /model-tester/list` — 可配置提供方目录 × settings 剖面 × 激活状态联接
  - `POST /model-tester/test` — 单模型真实流式测试
- **浏览器半**（`client.js`）：按 `window.__ModuleLoader__` 工厂契约手写的客户端 bundle（`react` 走平台模块表），注册进 `settings.models.footer` 槽位，通过 `fetch` 调用宿主路由

### 本地开发

```sh
# 从本地 checkout 安装（link 方式，改动即时生效，重启 profile 后可见）
dsh plugin --profile web add <本仓库本地路径>
```

无需构建步骤：`index.js` 与 `client.js` 均为可直接加载的纯 JS。

### License

[MIT](./LICENSE)
