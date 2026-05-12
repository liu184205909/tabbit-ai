# Tabbit AI

通过 CDP（Chrome DevTools Protocol）操控 Tabbit 浏览器内置 AI 聊天，实现零成本多轮对话和信息提取的 Claude Code Skill。

## 功能

- **零 API 成本** — 直接使用 Tabbit 内置的 GPT-5.5，不需要额外 API key 或付费
- **自动联网搜索** — AI 会自动搜索网页并引用来源，获得 Perplexity 级别的搜索增强能力
- **多轮对话** — 在同一个标签页中连续追问，AI 基于上下文回答
- **完整文本提取** — 从任意已有聊天标签页提取完整对话文本，无需手动复制下载
- **中英文支持** — 中英文问题都完全支持，输出无乱码

## 前置条件

| 条件 | 说明 |
|------|------|
| [Tabbit 浏览器](https://tabbitbrowser.com) | 内置 AI 聊天功能（基于 GPT-5.5） |
| [web-access skill](https://github.com/eze-is/web-access) | 提供 CDP Proxy，Tabbit AI 依赖它连接浏览器 |
| Node.js 22+ | CDP Proxy 运行依赖 |

## 安装

```bash
# 1. 先安装 web-access skill（如果还没装）
git clone https://github.com/eze-is/web-access ~/.claude/skills/web-access

# 2. 安装 Tabbit AI skill
git clone https://github.com/liu184205909/tabbit-ai ~/.claude/skills/tabbit-ai

# 3. 启动 CDP Proxy
node ~/.claude/skills/web-access/scripts/check-deps.mjs
```

## 使用

所有操作通过脚本 `scripts/tabbit-ai.mjs` 执行：

```bash
SCRIPT="~/.claude/skills/tabbit-ai/scripts/tabbit-ai.mjs"

# 列出所有 Tabbit 聊天标签页
node "$SCRIPT" list

# 新建标签页，发送问题，等 AI 回复
node "$SCRIPT" ask "帮我分析一下 crystals 关键词的 SEO 竞争格局"

# 在已有标签页中追问（多轮对话）
node "$SCRIPT" chat <targetId> "如果只做美国市场呢？"

# 读取某个标签页的完整对话文本
node "$SCRIPT" read <targetId>
```

### 推荐工作流

```
ask/list → 发送问题或找到已有标签页
  ↓
read → 读取 AI 回复
  ↓
分析 → Claude 分析回复内容，判断是否需要追问
  ↓
chat → 根据分析结果提出有针对性的追问
  ↓
重复 read → 分析 → chat，直到获得足够信息
```

## 命令详解

### `list` — 列出聊天标签页

返回所有 Tabbit 聊天标签页的 `targetId`、标题和 URL。

### `ask "问题"` — 新建对话

创建新标签页，注入问题并发送，等待 AI 回复完成后返回完整文本。**不会关闭标签页**，可用返回的 `targetId` 继续追问。

### `chat <targetId> "追问"` — 多轮追问

在已有标签页中追加问题。AI 基于之前对话的完整上下文回答。返回新增部分和完整对话文本。

### `read <targetId>` — 读取对话

只读取不发送任何消息。适合提取已有对话内容。

## 架构

```
Claude Code → tabbit-ai.mjs → CDP Proxy (localhost:3456) → Tabbit 浏览器
                                      ↑
                              web-access skill 提供
```

核心技术细节：

- **ProseMirror 编辑器**：Tabbit AI 输入框使用 ProseMirror 富文本编辑器，通过 `innerHTML` 清空 + `execCommand('insertText')` 注入文本，完整支持中文
- **回复完成检测**：轮询 `innerText.length`，连续 5 次（15 秒）不变且增长超过 100 字符判定为完成，避免 "思考中" 等中间状态误判

## 注意事项

- 不要频繁关闭标签页，用户可能需要查看历史对话
- 提问方式影响回复长度，不加 "简短回答" 等限定词时 AI 会尽量详细展开
- 依赖 CDP Proxy 运行，连接错误时先检查 Proxy 状态
- 每个 targetId 对应独立的对话上下文

## 文件结构

```
tabbit-ai/
├── SKILL.md              # Claude Code Skill 描述
├── README.md             # 本文件
└── scripts/
    └── tabbit-ai.mjs     # 核心脚本
```

## License

MIT
