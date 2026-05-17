# pi-mono 零基础学习指南

这份文档写给“刚接触 Agent、AI、Transformer，也刚开始看开源项目”的你。目标不是让你一次看懂所有源码，而是先建立一个能跑、能讲、能继续学下去的理解框架。

## 先回答你的 3 个问题

### 1. 这个项目是什么

`pi-mono` 是一个 **TypeScript + Node.js 的 monorepo**。它不是单独一个聊天机器人，也不是单独一个 CLI，而是一整套和 AI Agent 相关的基础设施：

- `packages/ai`: 统一对接很多大模型提供商
- `packages/agent`: Agent 运行时，负责“对话 -> 调工具 -> 再对话”
- `packages/tui`: 终端 UI 库
- `packages/coding-agent`: 真正的终端 Coding Agent 产品
- `packages/web-ui`: 网页聊天界面组件
- `packages/mom`: Slack 机器人
- `packages/pods`: 远程 GPU / vLLM 管理工具

一句话理解：

`pi-mono = 大模型接入层 + Agent 引擎 + 终端界面 + Web 界面 + 一些集成工具`

### 2. 这个项目能不能跑起来

可以，但有一个前提：

- 依赖需要先安装
- 想真正和模型对话，需要 API Key 或者登录支持的 provider

我已经在本地做过这些验证：

- `npm install` 可以成功
- `npx tsx packages\coding-agent\src\cli.ts --help` 可以成功
- `pi-test.sh --help` 也能成功，但你的 Windows 默认命中的是 WSL 的 `bash.exe`，所以直接跑 `bash ./pi-test.sh` 会失败
- 现在仓库里我补了一个 `pi-test.ps1`，你在 PowerShell 里可以直接启动源码版 CLI

### 3. 这个项目目前有终端界面和操作吗

有，而且已经比较完整。

不是“只有终端输出”，而是有真正的 **交互式终端界面（TUI）**：

- 多行输入框
- Slash 命令
- 模型切换
- Session 恢复与分叉
- Tool 调用展示
- Bash 命令模式
- 设置面板

关键位置：

- 终端 UI 基础库在 `packages/tui`
- 真正的交互式界面在 `packages/coding-agent/src/modes/interactive/interactive-mode.ts`

所以你的第三问结论是：

**有终端界面，不是没有。**

我这次没有重做一套新的终端 UI，而是补了一个更适合 Windows 的启动脚本，让你更容易把现有界面跑起来。

---

## 你完全不懂 AI 时，先建立这几个最小概念

### 1. Transformer 是什么

你可以先把 Transformer 理解成：

> 一种“特别擅长处理文本序列关系”的神经网络结构。

它让模型更容易理解一句话里前后词语之间的关系，比如：

- “苹果很好吃”里的“苹果”是水果
- “苹果发布了新手机”里的“苹果”是公司

Transformer 的核心直觉不是“背答案”，而是“看上下文，判断下一个最合理的内容是什么”。

你现在不需要先学矩阵推导。对看这个项目来说，只要先知道：

- 大模型底层很多是 Transformer
- 它擅长根据上下文生成文本
- Agent 项目通常是“让大模型不仅说话，还能调工具做事”

### 2. LLM 是什么

LLM 就是 Large Language Model，大语言模型。

你可以把它理解成：

> 一个特别强的“文本预测器”，但因为训练规模很大，所以它看起来像会对话、会总结、会写代码。

### 3. Token 是什么

Token 可以简单理解成模型处理文本时用的“最小计费和计算单位”。

不是严格等于一个字，也不是严格等于一个单词。

你现在只要知道：

- 你输入的内容会消耗 token
- 模型输出的内容也会消耗 token
- 上下文越长，花费越高，速度可能越慢

### 4. Tool Calling 是什么

Tool Calling 就是：

> 模型不直接自己做所有事，而是先说“我要调用某个工具”，程序再帮它执行。

例如：

- 读取文件
- 搜索代码
- 执行 bash 命令
- 写文件

在 `pi-mono` 里，coding agent 的核心能力就在这里。

### 5. Agent 是什么

你可以先用一个最简单的定义：

> Agent = LLM + 工具 + 循环控制

普通聊天模型：

- 你问一次
- 它答一次

Agent：

- 你提需求
- 它判断是否需要读文件、查目录、执行命令
- 调工具
- 拿到结果后继续思考
- 最后再回答你

### 6. Monorepo 是什么

Monorepo 就是“一个仓库里放多个相关子项目”。

`pi-mono` 就是典型 monorepo：

- 一个仓库
- 多个 package
- 每个 package 负责不同层次的能力

---

## 用搭积木的方式理解 pi-mono

你可以把它想成 3 层。

### 第 1 层：基础能力层

- `packages/ai`
- `packages/agent`
- `packages/tui`

这层负责：

- 连模型
- 跑 Agent 循环
- 画终端界面

### 第 2 层：产品层

- `packages/coding-agent`
- `packages/web-ui`

这层负责把前面的基础能力拼成真正能用的产品。

### 第 3 层：集成 / 场景层

- `packages/mom`
- `packages/pods`

这层负责把能力接到 Slack、GPU Pod 等场景里。

---

## 从用户输入到 Agent 输出，内部发生了什么

假设你在终端里输入一句：

```text
请帮我分析当前目录的 package.json
```

大致流程是：

1. `packages/coding-agent/src/main.ts`
   读取命令行参数，决定是 interactive、print 还是 rpc 模式。

2. `packages/coding-agent`
   创建 `AgentSession`、`SettingsManager`、`ModelRegistry`、`SessionManager`。

3. `packages/agent`
   进入 Agent loop。

4. `packages/ai`
   把消息发给具体的大模型提供商，比如 OpenAI、Anthropic、Google。

5. 如果模型决定要调工具
   例如 `read`、`grep`、`bash`

6. `packages/coding-agent/src/core/tools`
   执行具体工具。

7. 工具结果返回后
   Agent 再继续一轮推理。

8. `packages/tui` + `interactive-mode.ts`
   把过程渲染到终端界面中。

所以这个仓库真正厉害的点，不是某个单独算法，而是把“模型、工具、会话、UI、扩展机制”拼装得很完整。

---

## 每个核心包，初学者应该怎么理解

### `packages/ai`

这是“大模型接线板”。

它解决的问题是：

- OpenAI 怎么调
- Anthropic 怎么调
- Google 怎么调
- 它们的返回格式不一样怎么办

它把这些差异统一起来。

你可以把它理解为：

> “多模型统一 API 层”

### `packages/agent`

这是“Agent 大脑循环”。

它决定：

- 什么时候向模型提问
- 模型说要调用工具时怎么办
- 工具结果回来后是否继续下一轮

你可以把它理解为：

> “Agent 的执行引擎”

### `packages/tui`

这是“终端界面引擎”。

它不是简单 `console.log`，而是真正做了：

- 输入框
- 列表选择
- Markdown 渲染
- 差分刷新
- 键盘事件处理

你可以把它理解为：

> “终端里的前端框架”

### `packages/coding-agent`

这是这个仓库最值得重点学习的部分。

它把：

- AI
- Agent
- TUI
- Session
- Tool
- 扩展系统

全部装配成一个真正能用的终端 Coding Agent。

如果你现在时间有限，就优先看这个包。

---

## 推荐阅读顺序

按你现在的基础，我建议按下面顺序读，不要一上来就怼最大的文件。

### 第一步：先看项目入口和大图

先读：

- 根目录 `README.md`
- 根目录 `package.json`
- 本文档

目标：

- 知道仓库里有几个 package
- 知道谁是核心
- 知道怎么跑

### 第二步：看最核心的产品入口

再读：

- `packages/coding-agent/README.md`
- `packages/coding-agent/src/main.ts`

目标：

- 知道 CLI 是怎么启动的
- 知道有几种运行模式

### 第三步：看 Agent 的真正循环

再读：

- `packages/agent/README.md`
- `packages/agent/src/agent.ts`
- `packages/agent/src/agent-loop.ts`

目标：

- 明白 Agent 不只是“发一次请求”
- 明白它是一个“多轮循环”

### 第四步：看终端界面

再读：

- `packages/tui/README.md`
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`

目标：

- 明白终端 UI 是怎么做出来的
- 知道为什么它看起来像一个真正的应用

### 第五步：看模型接入层

再读：

- `packages/ai/README.md`

目标：

- 知道为什么这个项目可以切换不同 provider

---

## Windows 上如何把它跑起来

## 1. 安装依赖

在 PowerShell 中进入项目根目录：

```powershell
cd C:\aPJQ\agent\pi-mono
npm install
```

## 2. 验证 CLI 是否正常

我这次补了一个 PowerShell 启动脚本：

```powershell
.\pi-test.ps1 --help
```

如果能看到 `pi` 的帮助信息，说明源码启动链路已经通了。

## 3. 没有 API Key 时能做什么

你可以先看帮助：

```powershell
.\pi-test.ps1 --help
.\pi-test.ps1 --offline --list-models
```

注意：

- `--offline --list-models` 在没登录、没配置 key 时会提示没有可用模型
- 这是正常现象，不是项目坏了

## 4. 真正开始对话

如果你有 OpenAI Key，可以先这样试：

```powershell
$env:OPENAI_API_KEY="你的key"
.\pi-test.ps1 --provider openai --model gpt-4o-mini
```

如果你想测试一次性输出模式：

```powershell
$env:OPENAI_API_KEY="你的key"
.\pi-test.ps1 --provider openai --model gpt-4o-mini -p "What files are in the current directory?"
```

## 5. 如果你想继续用原始 Bash 脚本

仓库自带的是：

```powershell
& 'C:\Program Files\Git\bin\bash.exe' ./pi-test.sh --help
```

你这里不要直接用系统默认的 `bash.exe`，因为当前环境默认命中了 WSL 的 bash，而那个入口现在是坏的。

---

## 这个项目当前已经有哪些终端操作

从 `packages/coding-agent/README.md` 可以确认，当前终端模式已经支持：

- `/login`
- `/logout`
- `/model`
- `/settings`
- `/resume`
- `/new`
- `/session`
- `/tree`
- `/fork`
- `/compact`
- `/copy`
- `/export`
- `/share`
- `/reload`
- `/hotkeys`
- `/changelog`
- `/quit`

编辑区也支持：

- `@` 引用文件
- `Tab` 路径补全
- `!command` 执行 bash 并把结果发给模型
- `!!command` 执行 bash 但不发给模型
- 多行输入
- 图像粘贴

所以从“终端产品成熟度”来看，它不是一个半成品。

---

## 你现在最应该重点看的源码文件

如果你只挑 7 个文件，我建议是：

1. `package.json`
2. `packages/coding-agent/src/main.ts`
3. `packages/coding-agent/src/core/agent-session.ts`
4. `packages/coding-agent/src/core/session-manager.ts`
5. `packages/agent/src/agent.ts`
6. `packages/agent/src/agent-loop.ts`
7. `packages/coding-agent/src/modes/interactive/interactive-mode.ts`

这 7 个文件可以帮助你回答下面 3 个面试级问题：

- 这个 Agent 是怎么跑起来的？
- 它怎么调工具？
- 它为什么能做成真正的终端产品？

---

## 作为小白，你容易卡住的点

### 1. 一上来就想看懂全部源码

不要这么做。

这个仓库是成熟 monorepo，直接硬读会很容易被文件量劝退。

### 2. 先去死磕 Transformer 数学

不建议。

你现在更应该先建立“系统视角”：

- 模型是什么
- Agent 是什么
- Tool Calling 是什么
- Session 是什么
- UI 怎么挂到 Agent 上

数学以后再补。

### 3. 把 Agent 理解成“换皮聊天机器人”

这会让你误判项目价值。

真正的 Agent 项目重点在：

- 能否调用工具
- 能否长期保持上下文
- 能否管理会话和分支
- 能否扩展
- 能否在真实开发流程里工作

`pi-mono` 正是在这些点上做得比较完整。

---

## 给你的 7 天学习路线

### 第 1 天

- 看本文档
- 看根目录 `README.md`
- 看根目录 `package.json`
- 成功运行 `.\pi-test.ps1 --help`

### 第 2 天

- 看 `packages/coding-agent/README.md`
- 看 `packages/coding-agent/src/main.ts`

### 第 3 天

- 看 `packages/agent/README.md`
- 看 `packages/agent/src/agent.ts`

### 第 4 天

- 看 `packages/agent/src/agent-loop.ts`
- 画出“用户消息 -> 模型 -> 工具 -> 模型”的流程图

### 第 5 天

- 看 `packages/tui/README.md`
- 看 `packages/coding-agent/src/modes/interactive/interactive-mode.ts`

### 第 6 天

- 看 `packages/ai/README.md`
- 了解 provider 抽象为什么重要

### 第 7 天

- 自己回答下面问题并写成 1 页笔记：
  - 什么是 Agent？
  - `pi-mono` 的核心包是哪几个？
  - `coding-agent` 为什么不是单纯调用一下 OpenAI API？

---

## 最后给你的一个学习心态建议

你现在不用追求“我已经懂 Transformer 的数学细节”。

对你当前阶段更重要的是先做到这 4 件事：

- 能把项目跑起来
- 能说清楚项目分层
- 能说清楚 Agent loop 是什么
- 能指出自己下一步该读哪些文件

做到这一步，你就已经不是“完全小白”了。

后面如果你愿意，我下一轮可以继续帮你做两件事里的任意一个：

- 给你画一版 `pi-mono` 的通俗架构图
- 带你按文件顺序精读 `packages/coding-agent/src/main.ts`
