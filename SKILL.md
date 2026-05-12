---
name: tabbit-ai
license: MIT
github: https://github.com/liu184205909/tabbit-ai
description:
  通过 CDP 操控 Tabbit 浏览器内置 AI 聊天，实现零成本多轮对话和信息提取。
  触发场景：需要利用 Tabbit 浏览器的 GPT-5.5 聊天能力获取信息、分析问题、多轮追问，
  且不想消耗额外 API 额度时使用。也适用于读取已有的 Tabbit 聊天标签页内容。
metadata:
  author: 一泽Eze
  version: "1.0.0"
---

# Tabbit AI Skill

通过 CDP（Chrome DevTools Protocol）操控 Tabbit 浏览器内置的 AI 聊天功能，实现：

- **零 API 成本**：直接使用 Tabbit 内置的 GPT-5.5，不需要额外 API key
- **自动联网搜索**：AI 会自动搜索网页、引用来源，获得 Perplexity 级别的搜索增强
- **多轮对话**：在同一个标签页中连续追问，AI 基于上下文回答
- **完整文本提取**：从任意已有聊天标签页提取完整对话文本，无需手动复制

## 前置条件

| 条件 | 说明 |
|------|------|
| **Tabbit 浏览器** | 必须安装 Tabbit 浏览器（内置 AI 聊天功能） |
| **web-access skill** | 必须安装 [web-access](https://github.com/eze-is/web-access) skill，提供 CDP Proxy |
| **Node.js 22+** | CDP Proxy 依赖 |
| **CDP 已连接** | 运行 `node "${CLAUDE_SKILL_DIR}/../web-access/scripts/check-deps.mjs"` 确认 |

## 使用方式

所有操作通过脚本 `scripts/tabbit-ai.mjs` 执行：

```bash
SCRIPT="${CLAUDE_SKILL_DIR}/scripts/tabbit-ai.mjs"

# 列出所有 Tabbit 聊天标签页
node "$SCRIPT" list

# 新建标签页，发送问题，等 AI 回复
node "$SCRIPT" ask "你的问题"

# 在已有标签页中追加问题（多轮对话）
node "$SCRIPT" chat <targetId> "追问内容"

# 读取某个标签页的完整对话文本
node "$SCRIPT" read <targetId>
```

### 命令详解

#### `list` — 列出聊天标签页

```bash
node "$SCRIPT" list
```

返回所有 Tabbit 聊天标签页的 targetId、标题和 URL。

#### `ask "问题"` — 新建对话

```bash
node "$SCRIPT" ask "帮我分析一下 crystals 关键词的 SEO 竞争格局"
```

- 自动创建新标签页
- 注入问题并发送
- 等待 AI 回复完成
- 返回 targetId（用于后续追问）和完整回复文本
- **不会关闭标签页**，用户可继续查看或追问

#### `chat <targetId> "追问"` — 多轮追问

```bash
node "$SCRIPT" chat ABC123 "如果只做美国市场，这个竞争格局有什么变化？"
```

- 在已有标签页中追加问题
- AI 基于之前对话上下文回答
- 返回新增部分和完整对话文本

#### `read <targetId>` — 读取对话

```bash
node "$SCRIPT" read ABC123
```

- 只读取，不发送任何消息
- 返回完整对话文本（含所有历史消息）
- 适合在不打扰的情况下提取已有对话内容

### 推荐工作流

```
1. ask/list  → 发送问题或找到已有标签页
2. read      → 读取 AI 回复
3. 分析      → Claude 分析回复内容，判断是否需要追问
4. chat      → 根据分析结果，提出有针对性的追问
5. 重复 2-4  → 直到获得足够信息
```

**重要**：不要连续发多个问题。应该先 `read` 读取回复 → Claude 分析 → 再决定 `chat` 追问什么。

## 技术原理

### 架构

```
Claude Code → tabbit-ai.mjs → CDP Proxy (localhost:3456) → Tabbit 浏览器
                                      ↑
                              由 web-access skill 提供
```

### ProseMirror 编辑器处理

Tabbit AI 的输入框使用 ProseMirror 富文本编辑器，不能直接用 `innerHTML` 赋值（会破坏内部状态）。正确的注入流程：

1. `innerHTML = '<p><br></p>'` — 清空编辑器
2. `editor.focus()` — 聚焦
3. `document.execCommand('insertText', false, text)` — 注入文本
4. 点击 `#ChatSendButton` — 发送

`execCommand('insertText')` 会触发完整的输入事件链，支持中文等 Unicode 字符。

### 回复完成检测

通过轮询 `document.body.innerText.length` 检测回复是否完成：

- 文本长度连续 5 次（15 秒）不变，且相比发送前增长超过 100 字符 → 判定为完成
- 超时上限 180 秒
- "思考中" 等中间状态的文本量小于阈值，不会被误判为完成

## 注意事项

- **不要频繁关闭标签页**：用户可能需要查看历史对话，只在明确要求时关闭
- **提问方式影响回复长度**：如果不加 "简短回答" 等限定词，AI 会尽量详细展开
- **中文支持**：中英文问题都完全支持，输出不会出现乱码
- **依赖 CDP Proxy**：如果脚本报连接错误，先检查 CDP Proxy 是否在运行
- **每个标签页是独立对话**：不同 targetId 对应不同的对话上下文

## 安装

### 方式一：作为 Claude Code Skill 安装

```bash
# 克隆到 Claude Code skills 目录
cd ~/.claude/skills
git clone https://github.com/liu184205909/tabbit-ai.git

# 确认 web-access skill 已安装
ls ~/.claude/skills/web-access/scripts/cdp-proxy.mjs
```

### 方式二：手动安装

将 `scripts/tabbit-ai.mjs` 复制到任意位置，确保 CDP Proxy 运行后即可使用。

## 文件结构

```
tabbit-ai/
├── SKILL.md              # 本文件
├── scripts/
│   └── tabbit-ai.mjs     # 核心脚本
└── README.md             # GitHub 说明（可选）
```
