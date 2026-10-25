# @magpie-community/opencode-workbuddy-auth

[English](./README.md)

登录 WorkBuddy（腾讯 CodeBuddy 出品的桌面智能体）的套餐，支持 WorkBuddy
账号或 CodeBuddy API Key。为 WorkBuddy 的两个版本各提供一个 provider：

| Provider id | 版本 | WorkBuddy API（账号登录） | CodeBuddy API（API Key） |
|---|---|---|---|
| `workbuddy` | WorkBuddy 中国版（CodeBuddy 套餐） | `https://copilot.tencent.com/v2` | `https://www.codebuddy.cn/v2` |
| `workbuddy-ai` | WorkBuddy AI 国际版 | `https://www.workbuddy.ai/v2` | `https://www.codebuddy.ai/v2` |

本包导出 `WorkBuddyAuthPlugin`（`workbuddy`）和
`WorkBuddyAIAuthPlugin`（`workbuddy-ai`）。

## 登录

- **账号（浏览器）。** 打开该版本的腾讯登录页，也就是 WorkBuddy 桌面端
  打开的同一个页面。之后插件每秒向 WorkBuddy 询问一次令牌，直到登录完成，
  最长 5 分钟。不需要粘贴任何东西。
- **桌面端登录。** 使用 WorkBuddy 桌面端已登录的账号。不会复制任何内容：
  每次请求都重新读取应用的文件，并且绝不修改它：
  - macOS：`~/Library/Application Support/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop[-ai].info`
  - Windows：`~/AppData/Local/CodeBuddyExtension/…`
  - Linux：`~/.local/share/CodeBuddyExtension/…`

  WorkBuddy 5.6 及更高版本会加密保存登录信息，只有应用自己能解密，因此
  这种方式在这些版本上会失败并说明原因：请改用浏览器登录。
- **CodeBuddy API Key。** 粘贴同一版本签发的 Key。请到该版本自己的控制台
  获取：
  - 中国版：<https://copilot.tencent.com/profile/>（`ck_…`）
  - 国际版：<https://www.codebuddy.ai/profile/keys>（`sk_…` / `ck_…`）

  Key 由 magpie（或 OpenCode）保存为 `api` 认证，
  `{"type": "api", "key": "…"}`，并在每次请求时发送；本插件绝不会把它写到
  任何地方。Key 不能续期：当版本返回 401 时，请更换 Key。一个版本的 Key
  不能被另一个版本接受（`ck_…` 会被 `www.codebuddy.ai` 拒绝）。

  API Key 账号既不读取模型列表，也不读取额度：这两项属于账号登录
  （`GET /v3/config` 和 WorkBuddy 的账单端点只接受 OAuth 令牌）。因此使用
  下面的静态模型列表，用量卡片显示为空窗口，而不是报错。

浏览器登录保存为 OpenCode 的 `oauth` 认证：访问令牌、刷新令牌、过期时间、
用户 id 和 domain；桌面端登录则保存为标记
`{"type": "oauth", "source": "desktop", "accountId", "uid"}`。OpenCode 把它
保存在 `auth.json`；magpie 保存在 `plugin-auth.json`。访问令牌会在到期前
一分钟续期，并保存新令牌。如果续期失败，旧令牌在有效期内继续使用。

在 magpie（0.1.684 或更高版本）中，插件还提供 `auth.refresh`，
`refreshLead` 为 5 分钟：magpie 会在浏览器登录（一小时有效期的令牌）到期
前 5 分钟续期，同一账号只续一次，并在它的请求、模型和额度查询之前完成，
然后保存续期结果。它与请求内的刷新共用同一套“同一时间只续一次”机制，
因此刷新令牌不会被使用两次。续期失败（包括刷新令牌已过期）不会标记账号，
内置 provider 也从不这样做；magpie 稍后会重试，期间继续使用旧令牌。
OpenCode 不会调用 `auth.refresh`；每次请求前的检查仍然保留。

企业（团队）账号会以企业身份请求。浏览器登录会保留 WorkBuddy 为该账号
指定的企业 id（来自 `/login/account`，否则来自其账号列表），桌面端登录则
从应用文件中读取。此后每个请求都会携带 `X-Enterprise-Id` 和
`X-Tenant-Id`，与 WorkBuddy 自己的客户端一致；缺少它们时，WorkBuddy 会
按个人账号处理，返回个人套餐的模型。0.1.13 之前的浏览器登录没有保存企业
id：请重新登录。

桌面端登录只在应用自己没有续期时才续期，新令牌只保存在内存中，绝不写回，
与 magpie 内置的 WorkBuddy 一致。

聊天或额度读取被 WorkBuddy 返回 401 时（自 0.1.31 起），无论令牌还剩多久，
都会续期一次并重发一次。如果期间另一个进程保存了新令牌，会先使用它，而
不是再次消耗刷新令牌。桌面端登录不会因此续期：会重新读取应用文件，如果
应用已重新登录，就使用它的令牌。再次 401，或拿不到新令牌，最终返回 401
并提示重新登录（magpie 中：Providers → WorkBuddy → 该账号的
Sign in again；桌面端登录则重新登录 WorkBuddy 桌面端）。只有 WorkBuddy
明确表示登录已失效时，插件才会在 magpie 中把账号标记为过期
（`X-Magpie-Sign-In: expired`，usage 的 `signIn`）：刷新令牌被拒（401，
`invalid_grant`），或访问令牌被拒（`WWW-Authenticate: … error="invalid_token"`）
且没有刷新令牌可续期，或刚续期后仍被拒。因其他原因续期失败，或没有
`invalid_token` 的裸 401，账号保持原样；桌面端登录从不标记。续期之后仍
401 会清除标记（`renewed`）。

## 在 magpie 中使用

先添加文件夹（或包），然后在你要用的 provider 上登录：

```bash
magpie plugin add ./packages/workbuddy      # 或者发布后用包名
magpie plugin login workbuddy               # 选择 "CodeBuddy API key"，粘贴 ck_…
magpie plugin                               # workbuddy (WorkBuddy, N models)  signed in
magpie provider test workbuddy              # 每种 API 各发一个小请求
magpie quota                                # API Key 没有窗口：卡片为空
```

然后让 Agent 使用 `workbuddy/<model>` 或 `workbuddy-ai/<model>`。在 magpie
窗口中：插件 → 添加插件 → 选择该文件夹，然后在该 provider 那一行用
**CodeBuddy API key** 登录。

终端命令每次都会按文件夹当前内容加载插件；在窗口里修改源码后，需要把
插件关闭再打开。

## 请求

聊天使用 chat completions（`@ai-sdk/openai-compatible`），发往
`<API>/chat/completions`。只支持流式；非流式请求会被 WorkBuddy 拒绝。

使用 CodeBuddy API Key 时，聊天发往该版本的 CodeBuddy 网关，而不是
WorkBuddy 的网关：中国版为 `https://www.codebuddy.cn/v2`，国际版为
`https://www.codebuddy.ai/v2`。Key 会以 `X-Api-Key`（官方请求头）和
`Authorization: Bearer` 发送；请求携带 `X-Domain`、`X-Product: SaaS`、
`X-IDE-Type: CodeBuddy`、`CodeBuddy/<version>` User-Agent 和会话 id，但不带
账号登录的 `X-User-Id` 或企业请求头。API Key 绝不会发往 WorkBuddy 的
OAuth 或账单端点。API Key 的 Claude 模型会保留 Messages 路径：请求只把
WorkBuddy 的 host 换成该版本的 CodeBuddy 网关，`/v1/messages` 不变。

**WorkBuddy 中国版的 Claude 模型走 Anthropic Messages API**：`@ai-sdk/anthropic`，
地址 `<endpoint>/v1/messages`（同样只支持流式）。2026-10-24 用 `/v3/config`
的 `cli` agent 逐个模型实测，`claude-opus-5.5`、`claude-sonnet-5.5`、
`claude-opus-5`、`claude-opus-4.8-1m` 在该路由正常回答；`glm-5.3` 和
`deepseek-v4.1-flash` 返回 500，`gpt-5.5` 和 `kimi-k3-1` 返回 400，因此其他
模型继续走 chat。WorkBuddy AI 没有这个路由（`/v1/messages` 对所有模型都是
`404 Route Not Found`），所以它的模型都走 chat，Claude 模型也一样。

Messages 请求按 Agent 发来的原样转发：不补默认 system 消息，不改写
`max_completion_tokens`/`developer`，不重塑工具，也不为被拒的 system 提示词
做移动——Claude Code 自己的提示词（包括计费行）会原样发出，而在 chat 上它
会被 11128 拒绝。唯一会去掉的是没有 `signature` 的 `thinking` 块：从 chat
（或其他 provider）开始的会话会带有这种块，一旦它与本路由产生的已签名块
放在一起，WorkBuddy 会在每次尝试时以 11159 拒绝整个请求（“Invalid
`signature` in `thinking` block … bound to a different conversation”）。
已签名的块原样返回。它和 chat 一样携带 WorkBuddy 的请求头，包括相同的会话
id 和轮次 id：`user` 消息里 `tool_result` 块中的工具结果，对应 chat 中的
`role: "tool"` 消息。

这条路由的重点是推理强度。chat 只带 `reasoning_effort`，而 WorkBuddy 的
chat 端点无论该值是什么，回答长度都差不多（2026-10-24，`claude-opus-5.5`，
同一问题各问四次：`low` 中位数 3884 个输出 token，`max` 5144，非档位值
5715）。Messages 带 `output_config.effort`，`max` 会被真正执行：同一模型和
问题各跑四次，中位数 30850，而 `low` 为 5748。因此 Messages 上的 Claude 模型
即使 `/v3/config` 只到 `xhigh`，也会在档位里列出 `max`。

`/v1/messages/count_tokens` **不提供服务**（404）。magpie 会把 count_tokens
的 404 当作“没有计数器”（`unsupportedCount`），用自己的估算回答。

每个聊天携带 WorkBuddy 的请求头：

- `Authorization`、`X-User-Id`、`X-Domain`、`X-Product: SaaS`、`X-IDE-Type: WorkBuddy`；
- `User-Agent: WorkBuddy/5.5.6`。缺少它，WorkBuddy 会返回错误 10085；
- 客户端请求头，WorkBuddy 的用量列表会据此显示发起请求的客户端（使用端）：
  `X-Agent-Purpose: conversation`、`X-IDE-Name: WorkBuddy`、`X-IDE-Version`、
  `X-Agent-Intent: craft`、`X-Requested-With`。两个版本都会发送这些头，与
  WorkBuddy 自己的客户端一致；缺少它们的聊天不会计入任何客户端；
- 会话 id：`X-Conversation-ID`、`X-Conversation-Request-ID`、
  `X-Conversation-Message-ID`、`X-Request-ID`。WorkBuddy 后端按
  `X-Conversation-Request-ID` 把一次用户发送算作一个请求，因此一次发送的
  每一步——回传工具结果、重试、换另一个账号回答——都携带同一个 id，而
  用户的下一条消息携带另一个。会话 id 来自 magpie（或 OpenCode）为该请求
  指定的 session，否则来自聊天的第一条用户消息；两者都没有时不会凭空
  生成，因为凭空生成的会话会在用量明细中把一次会话拆成很多次；
- WorkBuddy AI 还接受 `X-Agent-Type: main`。

不以 system 消息开头的聊天会补上 WorkBuddy 的默认 system 消息，与应用的
行为一致。

WorkBuddy 会把某些 Agent 的身份声明当作“未授权渠道”（11128）拒绝，因此
这些句子会在请求发出前改写。自 0.1.27（#279）起，其中包括 DeepSeek
Harness 的开场白。自 0.1.29 起，如果仍有未改写的句子被拒，会把 system
提示词移入第一条用户消息（放在 `<instructions>` 标签内），并在原位置放入
WorkBuddy 的默认 system 提示词，然后重发一次：WorkBuddy 只检查 system 和
assistant 消息，被匹配的句子此时两者都不在。位置靠后的 system 消息会原地
变成用户消息。插件会在本次加载期间记住每个被拒的 system 提示词，因此该
Agent 之后的聊天会直接以移动后的形式发出。这种移动触及不到 assistant
消息，所以模型把该句复述进 assistant 消息时，该聊天仍会被拒，直到这些词
在所有消息中都被改写（自 0.1.30 起，包括
“Web GUI whose URL the runtime context names”这一句，#291）；否则只有
新开聊天才能清除。移动之后仍被拒时，会给出不点名任何客户端的提示（自
0.1.28 起）：WorkBuddy 拒绝了该客户端提示词中的词；请从 Hermes、OpenCode
或 Pi 使用，或在分组中加入另一个 provider。这两种拒绝都不会让账号进入
休息状态。

loader 还会转换 WorkBuddy 不接受的 OpenAI 兼容写法：`max_completion_tokens`
改为 `max_tokens`，`developer` 消息改为 `system`，对象形式的 `tool_choice`
改为 WorkBuddy 的字符串形式。

聊天的工具会转换成 WorkBuddy 模型接受的结构。否则 WorkBuddy AI 会返回
400 “Invalid request parameters”（11133），DeepSeek 的模型对下面每种结构
都会拒绝，Kimi、GPT、Gemini 和 GLM 的模型会拒绝其中一部分：

- 工具参数没有 `type`、为空，或根上是联合类型（`anyOf`、`oneOf`、`allOf`）
  时，改为 object，并合并联合类型的字段；
- `pattern` 中的 `\0` 改为 `\u0000`，匹配含义相同；
- 元组的 `items`（列表）改为一个任一项都能满足的 schema；
- 没有 `type` 的 `enum` 取其值的类型（或该类型加 `"null"`），包含多种
  类型的 `enum` 在任意深度改为每种类型一个带类型 `enum` 的 `anyOf`；
  空 `enum` 会被移除（Kimi 和 DeepSeek，MCP 服务器的工具，#122）；
- 出现在 schema 位置的 `true` 和 `false` 分别改为 `{}` 和
  `{"not": {}}`（`additionalProperties` 保留）；不是列表的 `required`，
  以及 JSON Schema 不认识的 `type`，会被移除，`"String"` 改为 `"string"`；
- 工具名中除字母、数字、`_` 和 `-` 之外的字符（`.`、`:`、`/`、空格、
  CJK）会在该位置改为 `_`，模型调用返回时再恢复为工具自己的名字。

WorkBuddy AI 的 `gemini-3.8-flash` 对“工具结果后面紧跟用户消息”的聊天返回
400 “the conversation must end with a user message”（11153），而 magpie
会这样发送 Claude Code 的提醒、任务中途输入的文字和工具返回的图片。这类
聊天会在工具结果和用户消息之间插入一条空的 assistant 消息后重发，该模型
接受这种形式；某个模型拒绝过一次后，在插件重启前都会直接这样发送。以
assistant 消息结尾的聊天（prefill）仍会像以前一样被拒绝。

## 模型

登录后，模型列表来自 WorkBuddy 给其 CLI Agent 的产品配置
（`GET /v3/config`），包括上下文长度、图片输入和推理档位。在此之前，或
WorkBuddy 没有响应时，使用下面的列表。

CodeBuddy API Key 始终使用下面的列表：`/v3/config` 需要用登录令牌读取，
而 Key 所属的套餐未必有相同的模型 id。

`workbuddy`：

- Auto
- Hy4 preview、Hy3、Hy3-X
- Deepseek-V4.1-Flash、Deepseek-V4-Pro
- GLM-5.3、GLM-5.3-Flash、GLM-5.2、GLM-5.1、GLM-5v-Turbo
- MiniMax-M3
- Kimi-K3、Kimi-K2.7-Code、Kimi-K2.6

`workbuddy-ai`：

- Default、Fast、Balanced、Primary、Deep
- GPT-5.5、GPT-5.4、GPT-5.3-Codex
- Gemini-3.1-Pro、Gemini-3.5-Flash
- GLM-5.3、GLM-5.2
- Hy3
- Kimi-K3、Kimi-K2.6
- MiniMax-M3

模型的推理档位就是它的 variants（`reasoningEffort`）。

模型价格由 `credits`（“x0.29”）和配置中的 `modelPromotions` 决定。按天
生效的折扣（Step-5-Preview 的独家限免）会把折后价作为当前价格，并把原价
写入 `rateWas`。只在一天中某些时段生效的价格（Hy4 preview，23:00–8:00
免费）按原价给出，绝不标成免费：magpie 会一直保留拿到的列表，直到再次
询问，因此夜间拿到的列表会把“免费”显示一整天（#121）。

## magpie 中的额度

magpie 的用量卡片会显示资源汇总中的账号额度。它还会根据 WorkBuddy 自己
客户端读取的付费和免费套餐列表，显示最早一批剩余额度的到期时间
（`runsOutAt`）和数量（`runsOut`）。每日 Free Plan 份额不计入：它在所有
账号上都在同一个午夜结束。magpie 的智能路由会优先消耗额度最早到期的账号。

CodeBuddy API Key 没有额度读取：WorkBuddy 的账单端点只接受 OAuth 令牌，
而 Key 没有公开的计量接口。插件会返回空窗口且不返回错误，因此 magpie
既不会标记账号，也不会报告它无法知道的余额。

企业（团队）账号的资源汇总不列出套餐。它的额度来自企业计量接口
（`/billing/meter/get-enterprise-user-usage`），也就是 WorkBuddy 自己的
用量页面读取的接口：当前周期的已用额度、总额度以及周期重置时间
（magpie #1904）。

## 免费模型可用、计费模型不可用时

在断定钱包为空之前，请分别检查出错的账号和模型：

- 使用账号模型列表中的准确 API id。例如 `glm-5.3-flash` 是 id，
  `GLM-5.3-Flash` 是显示名。从其他 provider 复制来的路由不一定是有效的
  WorkBuddy 模型 id。
- WorkBuddy 5.6+ 的“桌面端已加密”提示表示无法读取这次登录，而不是账号
  额度为零。请对同一版本/区域使用 **账号（浏览器）**。在确认新身份和模型
  列表之前，保留旧条目。桌面端文件不会被解密或修改。
- 被 WorkBuddy 限制的账号是另一种故障。代码 11140 及其异常活动提示需要
  在 WorkBuddy 中 **提交反馈**；反复登录或更换模型都无法解除。参见
  [magpie#1849](https://github.com/yetone/magpie/issues/1849)。
- 在 magpie 的路由详情中逐个检查尝试过的 provider/账号。ZCode 试用额度
  失败、另一个 provider 的额度不足，或某个账号被限制，都不代表所有
  WorkBuddy 账号的余额。

模型有响应只能说明所选账号能回答；没有对应的厂商用量记录，不能证明这次
请求扣了多少额度。额度读取出错意味着余额未知。

不需要账号，也可以用 `packages/workbuddy/usage.test.mjs` 在隔离的临时
HOME（Windows 上还有 USERPROFILE）中复现加密桌面端的结果。它覆盖登录、
额度和聊天，针对一个合成的加密桌面端文件，并检查该文件保持不变。仅浏览器
授权成功不算迁移：在替换条目前，请把返回的身份与目标桌面账号对比。已经
登录的浏览器可以直接为另一个已保存账号续期。

## 本包未提供

magpie 内置的 WorkBuddy 比本包做得更多：

- 每日签到；
- 额度计量（`/billing/meter/get-user-resource-summary`）；
- 一个 provider 下多个账号。

OpenCode 的插件 API 没有提供这些能力的位置。

额度倍率同时接受国际目录的 `x0.34 credits` 文本和 `x0.34`。空的 credits
值（例如 Auto）保持未知，绝不视为免费。

## 发布到 npm

本包直接从该文件夹发布，没有构建步骤。

1. 选择发布位置：
   - **上游（社区插件推荐）。** 向 `magpie-community/plugins` 提 PR，把该
     文件夹加到 `packages/workbuddy`。`main` 上的版本号变更会在
     `@magpie-community` 下发布，所有 magpie 会自动更新。只有社区维护者
     能发布到该 scope。
   - **你自己的 scope。** 把 `name` 改为
     `@<your-scope>/opencode-workbuddy-auth`（或不带 scope 的名字），并把
     `repository` 改为你的 fork。npm scope 必须已存在，且你的用户有发布
     权限。
2. 升级 `version`（SemVer）：修复是 patch，新增登录方式是 minor。
3. 检查将要发布的内容。`files` 只包含 `index.mjs`、`README.md` 和
   `README.zh.md`，测试不会进入包：
   ```bash
   cd packages/workbuddy
   npm pack --dry-run --json
   ```
4. 登录并发布：
   ```bash
   npm login
   npm publish --access public
   ```
   scoped 包必须加 `--access public`；不带 scope 的包默认公开。
5. 验证，然后用包名安装：
   ```bash
   npm view @<scope>/opencode-workbuddy-auth version
   magpie plugin add @<scope>/opencode-workbuddy-auth
   ```

如需无令牌发布，请为包和仓库工作流配置 npm trusted publishing（OIDC），
与 `magpie-community/plugins` 的做法一致。首次发布仍需要令牌；之后可以再
绑定 trusted publishing。

绝不要提交 API Key、`auth.json`/`plugin-auth.json`，或包含令牌的
`.npmrc`。本包没有运行时依赖，也没有安装脚本，因此 magpie 可以用
`bun add` 安装而不执行任何脚本。
