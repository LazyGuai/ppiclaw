# Agent 配置初始化说明

这个文档用于新手快速初始化本地 `pi` 配置目录：`~/.pi/agent`。

## 这个 README 是干什么的

- 解释为什么 clone 仓库后还要再配一次本地配置。
- 提供一条命令生成 `auth.json / channels.json / settings.json / models.json`。
- 给出可直接复制的 `auth.json` 和 `channels.json` 示例。

## 一键初始化（Windows）

在仓库根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\init-agent-config.ps1
```

会在 `~/.pi/agent` 创建缺失文件（也支持环境变量 `PI_CODING_AGENT_DIR` 或 `PI_AGENT_DIR` 指定目录）：

- `auth.json`
- `channels.json`
- `settings.json`
- `models.json`

模板来源：

- `config-templates/auth.json.example`
- `config-templates/channels.json.example`
- `config-templates/settings.json.example`
- `config-templates/models.json.example`

如需覆盖已有文件：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\init-agent-config.ps1 -Force
```

## 示例 1：auth.json（API Key）

`auth.json` 示例（按需保留你使用的 provider）：

```json
{
  "openai": { "type": "api_key", "key": "sk-xxx" },
  "anthropic": { "type": "api_key", "key": "sk-ant-xxx" },
  "google": { "type": "api_key", "key": "your-gemini-api-key" }
}
```

## 示例 2：channels.json（飞书）

### 长连接模式（推荐先用这个）

```json
{
  "feishu": {
    "agentCwd": "C:\\path\\to\\your\\pi-mono",
    "workingDir": "C:\\path\\to\\your\\pi-mono\\packages\\feishu\\data-feishu",
    "apiBaseUrl": "https://open.feishu.cn",
    "transport": "long-connection",
    "appId": "cli_xxx",
    "appSecret": "your-feishu-app-secret",
    "botOpenId": "ou_xxx",
    "requireMention": true
  }
}
```

### 回调模式（需要公网回调时再用）

```json
{
  "feishu": {
    "transport": "callback",
    "appId": "cli_xxx",
    "appSecret": "your-feishu-app-secret",
    "botOpenId": "ou_xxx",
    "verifyToken": "your-feishu-verify-token",
    "encryptKey": "",
    "webhookHost": "127.0.0.1",
    "webhookPath": "/feishu/events",
    "webhookPort": 3000
  }
}
```

结论：现在模板字段已按当前飞书代码对齐，用户把值填上可以使用。
说明：

- `appId / appSecret / botOpenId / transport` 是核心字段。
- `verifyToken / encryptKey / webhook*` 主要给 `callback` 模式使用。
- `requireMention` 为可选，默认是 `true`。

## 初始化完成后

1. 填 `auth.json`（或在 pi 里 `/login`）。
2. 启动 pi 后执行 `/model` 选择模型。
3. 填 `channels.json`（只在接飞书时需要，可以利用ai帮忙填写）。

## 安全提醒

不要把 `~/.pi/agent/*.json` 里的密钥提交到 GitHub。