#!/usr/bin/env node
// tabbit-ai.mjs — 通过 CDP 操控 Tabbit AI 聊天
// 用法：
//   node tabbit-ai.mjs ask "你的问题"           → 新建 tab，发问题，等回复，返回 targetId + 回复
//   node tabbit-ai.mjs chat <targetId> "追问"   → 在已有 tab 中追加问题
//   node tabbit-ai.mjs read <targetId>          → 读取完整对话文本
//   node tabbit-ai.mjs list                     → 列出所有 Tabbit 聊天 tab

import http from 'node:http';

const PROXY = 'http://localhost:3456';

// JSON 序列化但保留中文（不转义为 \uXXXX）
function stringify(obj) {
  return JSON.stringify(obj, null, 2).replace(/\\u([0-9a-fA-F]{4})/g, (m, code) =>
    String.fromCharCode(parseInt(code, 16))
  );
}

// ========== CDP 工具函数 ==========

function api(path, body) {
  return new Promise((ok, fail) => {
    const url = new URL(path, PROXY);
    const opts = {
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search,
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'text/plain' } : {}
    };
    const r = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { ok(JSON.parse(d)); } catch { ok(d); } });
    });
    r.on('error', fail);
    if (body) r.write(body);
    r.end();
  });
}

function evalJs(tid, js) {
  return api(`/eval?target=${tid}`, js).then(r => r.value);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ========== 核心操作 ==========

/** 列出所有 Tabbit 聊天 tab */
async function listChats() {
  const targets = await api('/targets');
  const chats = targets.filter(t =>
    t.url && t.url.includes('tabbitbrowser.com/chat')
  ).map(t => ({ targetId: t.targetId, title: t.title, url: t.url }));
  return chats;
}

/** 获取页面完整文本 */
async function readChat(tid) {
  const text = await evalJs(tid, 'document.body.innerText');
  return text;
}

/** 等待 AI 回复完成（文本长度连续稳定，且超过 baseLen 足够多） */
async function waitResponse(tid, baseLen, timeoutSec = 180) {
  const stableThreshold = 5;     // 连续稳定次数（防 "思考中" 等中间状态误判）
  const pollInterval = 3000;     // 轮询间隔 ms
  const minGrowth = 100;         // 相比 baseLen 至少增长这么多才算有回复
  const maxPolls = Math.ceil(timeoutSec * 1000 / pollInterval);

  let prevLen = baseLen || 0;
  let stable = 0;

  for (let i = 0; i < maxPolls; i++) {
    await sleep(pollInterval);
    const len = await evalJs(tid, 'document.body.innerText.length');
    const delta = len - baseLen;

    if (delta < minGrowth) {
      // 还没开始回复（或者只有 "思考中" 等噪音），继续等
      stable = 0;
    } else if (len === prevLen) {
      // 长度不变且已有实质内容
      stable++;
    } else {
      // 长度还在增长
      stable = 0;
    }

    if (stable >= stableThreshold) {
      return { done: true, totalLen: len, polls: i + 1 };
    }
    prevLen = len;
  }
  return { done: false, totalLen: prevLen, polls: maxPolls, timeout: true };
}

/** 在已有 tab 中注入问题并发送（处理 ProseMirror 编辑器） */
async function injectAndSend(tid, question) {
  // 1. 清空编辑器 DOM（ProseMirror 需要先清空再输入）
  await evalJs(tid, `var e=document.querySelector('.ProseMirror'); if(e){e.innerHTML='<p><br></p>';} 'cleared'`);
  // 2. 聚焦并注入文本
  await evalJs(tid, `var e=document.querySelector('.ProseMirror'); if(e){e.focus(); document.execCommand('insertText', false, ${JSON.stringify(question)});} 'injected'`);
  // 3. 短暂等待 ProseMirror 内部状态同步
  await sleep(500);
  // 4. 检查发送按钮状态
  const disabled = await evalJs(tid, `document.getElementById('ChatSendButton') ? document.getElementById('ChatSendButton').disabled : 'no button'`);
  if (disabled === true || disabled === 'true') {
    // 编辑器内容可能没注入成功，尝试重试一次
    await evalJs(tid, `var e=document.querySelector('.ProseMirror'); if(e){e.focus(); document.execCommand('insertText', false, ${JSON.stringify(question)});} 'retry'`);
    await sleep(500);
  }
  // 5. 点击发送
  await api(`/click?target=${tid}`, '#ChatSendButton');
}

/** 新建 tab 发送问题 */
async function ask(question) {
  // 1. 新建 tab
  const tab = await api('/new?url=https://web.tabbitbrowser.com/newtab');
  const tid = tab.targetId;
  await sleep(3000); // 等待页面加载

  // 2. 记录初始文本长度
  const baseLen = await evalJs(tid, 'document.body.innerText.length');

  // 3. 注入并发送
  await injectAndSend(tid, question);

  // 4. 等待回复
  const result = await waitResponse(tid, baseLen);

  // 5. 提取回复文本
  const fullText = await readChat(tid);

  // 6. 输出结构化结果
  const output = {
    targetId: tid,
    url: `https://web.tabbitbrowser.com/newtab`,
    totalLen: fullText.length,
    responseDone: result.done,
    timedOut: result.timeout || false,
    text: fullText
  };
  return output;
}

/** 在已有 tab 中追问 */
async function chat(tid, question) {
  // 1. 记录当前文本长度
  const baseLen = await evalJs(tid, 'document.body.innerText.length');

  // 2. 注入并发送
  await injectAndSend(tid, question);

  // 3. 等待回复
  const result = await waitResponse(tid, baseLen);

  // 4. 提取完整对话文本
  const fullText = await readChat(tid);

  // 5. 只返回新增部分
  const newText = fullText.slice(baseLen);

  const output = {
    targetId: tid,
    totalLen: fullText.length,
    addedLen: newText.length,
    responseDone: result.done,
    timedOut: result.timeout || false,
    newText: newText,
    fullText: fullText
  };
  return output;
}

// ========== CLI 入口 ==========

const [,, command, ...args] = process.argv;

async function main() {
  try {
    switch (command) {
      case 'ask': {
        const question = args.join(' ');
        if (!question) { console.error('用法: node tabbit-ai.mjs ask "你的问题"'); process.exit(1); }
        console.log(`[ask] 发送问题: ${question.slice(0, 60)}...`);
        const result = await ask(question);
        // 输出 JSON 到 stdout（供 Claude Code 解析）
        console.log('\n---RESULT---');
        console.log(stringify(result));
        break;
      }
      case 'chat': {
        const tid = args[0];
        const question = args.slice(1).join(' ');
        if (!tid || !question) { console.error('用法: node tabbit-ai.mjs chat <targetId> "追问内容"'); process.exit(1); }
        console.log(`[chat] 在 ${tid} 中追问: ${question.slice(0, 60)}...`);
        const result = await chat(tid, question);
        console.log('\n---RESULT---');
        console.log(stringify(result));
        break;
      }
      case 'read': {
        const tid = args[0];
        if (!tid) { console.error('用法: node tabbit-ai.mjs read <targetId>'); process.exit(1); }
        const text = await readChat(tid);
        const output = { targetId: tid, totalLen: text.length, text };
        console.log(stringify(output));
        break;
      }
      case 'list': {
        const chats = await listChats();
        if (chats.length === 0) {
          console.log('没有找到 Tabbit 聊天标签页');
        } else {
          console.log(stringify(chats));
        }
        break;
      }
      default:
        console.log(`Tabbit AI CDP 工具

用法:
  node tabbit-ai.mjs ask "你的问题"          新建 tab，发问题，等 AI 回复
  node tabbit-ai.mjs chat <targetId> "追问"  在已有 tab 中追加问题
  node tabbit-ai.mjs read <targetId>         读取完整对话文本
  node tabbit-ai.mjs list                    列出所有 Tabbit 聊天 tab

注意:
  - ask 命令会创建新 tab，不会关闭，用 targetId 后续可追问
  - chat 命令在已有 tab 中追问，需要先通过 list 或 ask 拿到 targetId
  - read 命令只读取，不发送任何消息
  - 所有命令依赖 CDP Proxy 运行（先运行 check-deps.mjs）`);
    }
  } catch (e) {
    console.error('错误:', e.message);
    process.exit(1);
  }
}

main();
