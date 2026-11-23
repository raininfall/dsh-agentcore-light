# dsh-agentcore-light

[English](./README.md) | 中文

把 DeepSeek Harness（DSH）的回合状态映射到 [AgentCore-Light](https://light.buildfpga.com/) 桌面状态灯：agent 工作时黄色，等待你授权时黄色常亮，回合成功绿色，回合失败红色。

这是一个 DSH 组合包（profile bundle）。纯 ESM JavaScript，无构建步骤，无运行时依赖。灯由同一台机器上的 AgentCore-Light 桌面应用驱动（`127.0.0.1:18792`）。

## 灯显示什么

| DSH 报告 | 灯 |
| --- | --- |
| 根会话开始一个回合 | `BUSY` —— 工作中 |
| 弹出工具授权请求 | `WAIT_CONFIRM` —— 等你确认 |
| 弹出 `ask_user_question` 提问 | `WAIT_CONFIRM` —— 等你确认 |
| 授权或提问被应答 | `BUSY` |
| kanban 收件箱里有待你回答的问题或待你决定的评审 | `WAIT_CONFIRM` —— 看板在等你 |
| 收件箱清空 | 回到 `BUSY` 或上一个已结束状态 |
| 回合正常完成 | `SUCCESS` —— 应用在 5 秒后回到 `IDLE` |
| 回合报错或触到输出 token 上限 | `ERROR` |
| 回合在开始任何步骤前被停止或阻塞 | `IDLE` |

子 agent 会话不会驱动灯——它们的工作已经表现为父会话的 `BUSY`。子 agent 的授权或提问请求仍然显示 `WAIT_CONFIRM`，因为要回答的人是你。

同时有多个根会话时，「等你处理」优先于运行，运行优先于已结束。插件激活时会把灯重置为 `IDLE`，避免上一次运行遗留的状态一直亮着；若灯上还留着「等待确认」，则用 `SUCCESS` 释放（灯显示确认中时 app 会忽略 `IDLE`）。

## 安装

前提：

- 已安装 DeepSeek Harness 并有可用的 profile（在 `0.2.2-rc.4` 上验证）。
- AgentCore-Light 桌面应用正在运行，且灯已连接。

```sh
dsh plugin --profile web add github:raininfall/dsh-agentcore-light
```

命令会添加依赖，并把组合包追加到 profile 的 `dsh.profile.bundles`（因为包内声明了 `dsh.bundle`）。重启 DSH 后生效，组合包会插入 `agentcore-light-status` 行。

需要可复现安装时可固定到某个提交：

```sh
dsh plugin --profile web add github:raininfall/dsh-agentcore-light#<commit-sha>
```

也可以在 Web UI 的 **设置 → 插件 → 添加插件** 中安装（任何带插件管理器的 DSH 界面都可以），这种方式会顺带启用组合包。

本地开发时直接安装检出目录：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-agentcore-light
```

不启动也能检查合成后的配置：

```sh
dsh --profile web --dump-config | grep agentcore-light-status
```

## 配置

可选的行配置，写在 profile 的 `cordis.patch.yml` 中：

```yaml
- id: agentcore-light-status
  name: dsh-agentcore-light
  config:
    port: 18792    # AgentCore-Light 控制端口
    timeoutMs: 800 # 单次请求超时
    kanbanInboxUrl: http://127.0.0.1:8787/api/inbox # 可选的看板收件箱
    kanbanPollMs: 5000 # 收件箱轮询间隔
```

保持默认端口即可。端口 `18793` 会把上报的来源改写为 `control_panel`，这些事件就不会出现在应用的 AI 活动日志里。本插件使用的来源标记是 `deepseek_harness`。

配置非法时激活会直接报错并给出诊断，而不是留下一盏悄无声息死掉的灯。

## 工作原理

- 订阅 `agent/created`、`agent/disposed` 和 `session/event`（`turn/start`、`approval/asked`、`approval/decided`、`tool/call`、`tool/result`、`user/message`、`turn/end`）。
- 可选地轮询 kanban 看板收件箱（`kanbanInboxUrl`），让看板里待你回答的问题和待评审的提交进入同一个状态机，而不是让第二个写入者去抢同一盏灯。
- 把这些事件折叠成一个设备状态：`IDLE`、`BUSY`、`WAIT_CONFIRM`、`SUCCESS` 或 `ERROR`。
- 向 `POST http://127.0.0.1:18792/status` 发送 `{"state": ..., "source": "deepseek_harness"}`。
- 投递是尽力而为的：同一时刻只有一个请求在途，最新状态在它后面排队，重复状态丢弃，超时 800 毫秒。应用没开、端口关闭或请求变慢都不会拖慢或弄失败一个回合。

## 验证

1. 启动 AgentCore-Light，确认应用里显示灯已连接。
2. 跑一个 DSH 回合：agent 工作时灯变黄，回合结束时变绿。
3. 打开一个工具授权提示，或让 agent 向你提问：灯保持黄色常亮，直到你应答。
4. 设置 `kanbanInboxUrl` 后，在看板上提出问题或提交评审：灯变黄；收件箱清空后报 `SUCCESS`（灯显示确认中时 app 会忽略 `IDLE`，`SUCCESS` 由 app 在 5 秒后转回 `IDLE`）。
4. 停止一个回合：灯回到空闲。

## 前提与限制

- 灯没有单独的「思考」状态。模型生成和工具执行都显示为 `BUSY`。
- 没有 token 百分比、亮度、蜂鸣或声音控制；这些需要 v2 应用尚未开放的协议支持。
- 不要同时安装 AgentCore-Light 控制面板自带的 DeepSeek Harness 钩子。两者会写同一盏灯，只保留其中一个。

## 卸载

```sh
dsh plugin --profile web remove dsh-agentcore-light
```

或在 **设置 → 插件** 中移除该组合包。磁盘上没有其他改动。

## 目录结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | 插件入口；订阅 Cordis 事件，激活时重置灯 |
| `bridge.js` | 纯状态机，把 agent/会话事件折叠成一个设备状态 |
| `inbox.js` | 可选的 kanban 收件箱轮询，作为状态机的输入 |
| `transport.js` | 去重、单请求在途的 HTTP 投递 |
| `cordis.patch.yml` | 插入 `agentcore-light-status` 行 |
| `locale/` | 插件卡片的标题与描述（英文、中文） |
| `docs/DETAIL.md` | 完整行为规格 |
| `test/` | 覆盖 bridge、transport 和入口的 `node --test` 测试 |

运行测试：`node --test`。
