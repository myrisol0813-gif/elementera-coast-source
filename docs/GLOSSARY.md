# Glossary

The source project uses the following public vocabulary consistently.

| English | 中文 | Meaning |
| --- | --- | --- |
| Owner | 屋主 | Human owner of the self-hosted source deployment |
| Model Partner | 另一位屋主 | Model-side participant in the workspace |
| Visitor | 访客 | Person using the Visitor Mailbox |
| Visitor Mailbox | 访客信箱 | Slow-message visitor surface |
| Human Thought Chain | 人类思考链 | Owner-authored private per-turn/context note |
| Turn Context Preview | 本轮上下文预览 | Preview of context assembled for a turn |
| Conversation Note | 整理当前对话的纸条 | Rolling note for the current conversation |
| Active Thread | 当前活跃线索 | Active conversational cue kept with the note |
| Memory Library | 记忆库 | Confirmed long-term memory entries |
| Review Queue | 待确认区 | Candidate items awaiting confirmation |
| Worldbook | 世界书 | Structured world/context entries |
| Dictionary | 词典 | Dictionary/worldbook-style lookup surface |
| Model Desk | 模型工作台 | Model/context work surface |
| Tool Call Log | 工具调用记录 | Source-safe record of tool calls and outcomes |
| Widgets | 小组件 | Source short-post and diary surfaces |
| External Entry Messages | 外部入口消息 | Messages entering through source external contracts |
| Common Room | 官端 MCP 与 API 共通聊天室 | Shared room contract for official MCP / API ingress |
| MCP Room | 与官端 MCP 对话区 | Conversation area for official MCP exchange |
| Dev Hands | 开发手 | Generic development/integration workbench skeleton |

## Naming rule

Do not use `Assistant` / `助手` as an Elementera Coast concept name. The model-side concept is **Model Partner / 另一位屋主**.

The protocol-level third-party field `role: "assistant"` is allowed when required by an external model API. It is a transport field, not a product concept.
