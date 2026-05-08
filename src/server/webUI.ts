/**
 * Web UI for Claude Code - serves a self-contained chat interface.
 *
 * This module exports a function that returns the HTML for the web-based
 * chat interface. The auth token is embedded in the HTML so the browser
 * does not need to handle it separately.
 */

export function getWebUIHtml(authToken: string | undefined): string {
  // Safely embed the auth token as a JSON string
  const escapedToken = authToken ? JSON.stringify(authToken) : 'null'

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Claude Code Web</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0f0f14;
      --surface: #1a1a24;
      --surface2: #242433;
      --border: #2e2e44;
      --text: #e2e2f0;
      --text-muted: #8888aa;
      --accent: #7c6aff;
      --accent-hover: #9980ff;
      --user-bg: #1e1e30;
      --assistant-bg: #162240;
      --tool-bg: #1a2a1a;
      --tool-border: #2a4a2a;
      --error-bg: #2a1a1a;
      --error-border: #4a2a2a;
      --system-bg: #1a1a2a;
      --code-bg: #0d0d18;
      --radius: 12px;
      --radius-sm: 6px;
    }

    html, body {
      height: 100%;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', sans-serif;
      background: var(--bg);
      color: var(--text);
      font-size: 15px;
      line-height: 1.6;
    }

    body {
      display: flex;
      flex-direction: column;
      height: 100svh;
    }

    /* ── Header ── */
    .header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 20px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }

    .header-logo {
      width: 28px;
      height: 28px;
      background: var(--accent);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
    }

    .header-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--text);
    }

    .header-subtitle {
      font-size: 12px;
      color: var(--text-muted);
      margin-left: auto;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #555;
      flex-shrink: 0;
      transition: background 0.3s;
    }
    .status-dot.connected { background: #4caf50; }
    .status-dot.connecting { background: #ffc107; animation: pulse 1s infinite; }
    .status-dot.error { background: #f44336; }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    /* ── Messages area ── */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      scroll-behavior: smooth;
    }

    #messages::-webkit-scrollbar { width: 6px; }
    #messages::-webkit-scrollbar-track { background: transparent; }
    #messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

    /* ── Message bubbles ── */
    .msg {
      display: flex;
      flex-direction: column;
      max-width: 85%;
      animation: fadeIn 0.2s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .msg.user  { align-self: flex-end; }
    .msg.assistant { align-self: flex-start; }
    .msg.system { align-self: center; max-width: 70%; }
    .msg.error  { align-self: flex-start; }
    .msg.info   { align-self: center; max-width: 100%; }

    .msg-label {
      font-size: 11px;
      color: var(--text-muted);
      margin-bottom: 4px;
      padding: 0 4px;
    }

    .msg.user .msg-label { text-align: right; }

    .msg-body {
      border-radius: var(--radius);
      padding: 12px 16px;
      word-break: break-word;
      white-space: pre-wrap;
    }

    .msg.user .msg-body {
      background: var(--user-bg);
      border: 1px solid var(--border);
      border-bottom-right-radius: 4px;
    }

    .msg.assistant .msg-body {
      background: var(--assistant-bg);
      border: 1px solid #1e3560;
      border-bottom-left-radius: 4px;
    }

    .msg.system .msg-body {
      background: var(--system-bg);
      border: 1px solid var(--border);
      font-size: 13px;
      color: var(--text-muted);
      text-align: center;
      border-radius: var(--radius-sm);
      padding: 8px 14px;
    }

    .msg.error .msg-body {
      background: var(--error-bg);
      border: 1px solid var(--error-border);
      color: #ff8888;
    }

    .msg.info .msg-body {
      background: transparent;
      border: none;
      font-size: 13px;
      color: var(--text-muted);
      text-align: center;
      padding: 4px;
    }

    /* ── Tool use ── */
    .tool-block {
      margin-top: 8px;
      background: var(--tool-bg);
      border: 1px solid var(--tool-border);
      border-radius: var(--radius-sm);
      overflow: hidden;
    }

    .tool-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: rgba(0,0,0,0.2);
      cursor: pointer;
      user-select: none;
    }

    .tool-header:hover { background: rgba(0,0,0,0.35); }

    .tool-icon { font-size: 14px; }
    .tool-name { font-family: 'Menlo', 'Consolas', monospace; font-size: 13px; color: #88cc88; font-weight: 600; }
    .tool-status { margin-left: auto; font-size: 11px; color: var(--text-muted); }
    .tool-toggle { margin-left: 6px; color: var(--text-muted); font-size: 11px; }

    .tool-body { padding: 10px 12px; display: none; }
    .tool-body.open { display: block; }

    .tool-input, .tool-output {
      font-family: 'Menlo', 'Consolas', monospace;
      font-size: 12px;
      background: var(--code-bg);
      border-radius: 4px;
      padding: 8px 10px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
      margin-top: 6px;
      color: #cce8cc;
    }
    .tool-output { color: #ddeeff; }

    .tool-section-label {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 8px;
      margin-bottom: 2px;
    }
    .tool-section-label:first-child { margin-top: 0; }

    /* ── Code blocks inside assistant messages ── */
    .msg-body code {
      font-family: 'Menlo', 'Consolas', monospace;
      font-size: 0.88em;
      background: var(--code-bg);
      border-radius: 3px;
      padding: 1px 5px;
    }

    .msg-body pre {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 12px;
      overflow-x: auto;
      margin: 8px 0;
    }
    .msg-body pre code {
      background: transparent;
      padding: 0;
      font-size: 0.85em;
    }

    /* ── Permission dialog ── */
    .permission-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      animation: fadeIn 0.15s ease;
    }

    .permission-dialog {
      background: var(--surface2);
      border: 1px solid var(--accent);
      border-radius: var(--radius);
      padding: 24px;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 8px 40px rgba(0,0,0,0.5);
    }

    .permission-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--accent-hover);
    }

    .permission-desc {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 16px;
    }

    .permission-tool {
      font-family: 'Menlo', 'Consolas', monospace;
      font-size: 13px;
      background: var(--code-bg);
      border-radius: var(--radius-sm);
      padding: 10px 12px;
      margin-bottom: 16px;
      color: #88cc88;
    }

    .permission-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    }

    /* ── Thinking indicator ── */
    .thinking {
      align-self: flex-start;
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--text-muted);
      font-size: 13px;
      padding: 4px 0;
    }

    .thinking-dots {
      display: flex;
      gap: 4px;
    }

    .thinking-dots span {
      width: 6px;
      height: 6px;
      background: var(--accent);
      border-radius: 50%;
      animation: bounce 1.2s infinite;
    }
    .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
    .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }

    @keyframes bounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.6; }
      30% { transform: translateY(-6px); opacity: 1; }
    }

    /* ── Input area ── */
    .input-area {
      flex-shrink: 0;
      padding: 12px 20px;
      background: var(--surface);
      border-top: 1px solid var(--border);
      display: flex;
      align-items: flex-end;
      gap: 10px;
    }

    #input {
      flex: 1;
      resize: none;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text);
      font-family: inherit;
      font-size: 14px;
      line-height: 1.5;
      padding: 10px 14px;
      min-height: 44px;
      max-height: 200px;
      overflow-y: auto;
      transition: border-color 0.2s;
      outline: none;
    }

    #input:focus { border-color: var(--accent); }
    #input::placeholder { color: var(--text-muted); }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 10px 18px;
      border: none;
      border-radius: var(--radius-sm);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s, transform 0.1s;
      flex-shrink: 0;
      height: 44px;
    }

    .btn:active { transform: scale(0.97); }
    .btn:disabled { opacity: 0.45; cursor: not-allowed; }

    .btn-primary {
      background: var(--accent);
      color: #fff;
    }
    .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }

    .btn-danger {
      background: #7a2020;
      color: #ffaaaa;
    }
    .btn-danger:hover:not(:disabled) { background: #992020; }

    .btn-secondary {
      background: var(--surface2);
      color: var(--text);
      border: 1px solid var(--border);
    }
    .btn-secondary:hover:not(:disabled) { background: var(--border); }

    .btn-sm {
      padding: 7px 14px;
      font-size: 13px;
      height: 36px;
    }

    /* ── Hint ── */
    .input-hint {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 6px;
      padding: 0 2px;
    }

    .input-wrapper { flex: 1; display: flex; flex-direction: column; }

    /* ── Empty state ── */
    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      color: var(--text-muted);
      pointer-events: none;
    }

    .empty-state-icon { font-size: 48px; }
    .empty-state-title { font-size: 18px; color: var(--text); font-weight: 500; }
    .empty-state-sub { font-size: 14px; text-align: center; max-width: 300px; }

    /* ── New session button ── */
    #new-session-btn {
      position: fixed;
      bottom: 90px;
      right: 24px;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--surface2);
      border: 1px solid var(--border);
      color: var(--text-muted);
      font-size: 18px;
      display: none;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 2px 12px rgba(0,0,0,0.4);
      transition: background 0.2s, color 0.2s;
      z-index: 10;
    }
    #new-session-btn:hover { background: var(--border); color: var(--text); }

    @media (max-width: 640px) {
      .msg { max-width: 95%; }
      .msg.system { max-width: 90%; }
      #messages { padding: 12px; gap: 10px; }
      .input-area { padding: 10px 12px; }
    }
  </style>
</head>
<body>

<!-- Header -->
<div class="header">
  <div class="header-logo">✦</div>
  <span class="header-title">Claude Code</span>
  <div class="status-dot connecting" id="status-dot"></div>
  <span class="header-subtitle" id="status-text">正在连接...</span>
</div>

<!-- Messages -->
<div id="messages">
  <div class="empty-state" id="empty-state">
    <div class="empty-state-icon">✦</div>
    <div class="empty-state-title">Claude Code</div>
    <div class="empty-state-sub">在下方输入消息，开始与 AI 对话</div>
  </div>
</div>

<button id="new-session-btn" title="新建会话">＋</button>

<!-- Input area -->
<div class="input-area">
  <div class="input-wrapper">
    <textarea
      id="input"
      rows="1"
      placeholder="输入消息… (Ctrl+Enter 发送)"
      disabled
    ></textarea>
    <div class="input-hint" id="input-hint"></div>
  </div>
  <button class="btn btn-danger" id="interrupt-btn" style="display:none" title="中断当前请求">⏹ 停止</button>
  <button class="btn btn-primary" id="send-btn" disabled>发送</button>
</div>

<!-- Permission dialog (hidden by default) -->
<div class="permission-overlay" id="permission-overlay" style="display:none">
  <div class="permission-dialog">
    <div class="permission-title">🔐 权限请求</div>
    <div class="permission-desc">Claude 请求使用以下工具：</div>
    <div class="permission-tool" id="permission-tool-info"></div>
    <div class="permission-actions">
      <button class="btn btn-secondary btn-sm" id="permission-deny">拒绝</button>
      <button class="btn btn-primary btn-sm" id="permission-allow">允许</button>
    </div>
  </div>
</div>

<script>
(function () {
  'use strict';

  const AUTH_TOKEN = ${escapedToken};
  const BASE_URL   = window.location.origin;
  const WS_ORIGIN  = window.location.origin.replace(/^http/, 'ws');

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const messagesEl      = document.getElementById('messages');
  const inputEl         = document.getElementById('input');
  const sendBtn         = document.getElementById('send-btn');
  const interruptBtn    = document.getElementById('interrupt-btn');
  const statusDot       = document.getElementById('status-dot');
  const statusText      = document.getElementById('status-text');
  const emptyState      = document.getElementById('empty-state');
  const permOverlay     = document.getElementById('permission-overlay');
  const permToolInfo    = document.getElementById('permission-tool-info');
  const permAllow       = document.getElementById('permission-allow');
  const permDeny        = document.getElementById('permission-deny');
  const newSessionBtn   = document.getElementById('new-session-btn');
  const inputHint       = document.getElementById('input-hint');

  // ── State ─────────────────────────────────────────────────────────────────
  let ws                 = null;
  let sessionId          = null;
  let wsUrl              = null;
  let isRunning          = false;
  let pendingPermReqId   = null;
  let currentAssistantEl = null; // accumulate streaming text here
  let thinkingEl         = null;

  // ── Utilities ─────────────────────────────────────────────────────────────
  function authHeaders() {
    return AUTH_TOKEN ? { Authorization: 'Bearer ' + AUTH_TOKEN } : {};
  }

  function setStatus(state, text) {
    statusDot.className = 'status-dot ' + state;
    statusText.textContent = text;
  }

  function setRunning(running) {
    isRunning = running;
    sendBtn.disabled = running || !ws || ws.readyState !== WebSocket.OPEN;
    interruptBtn.style.display = running ? 'inline-flex' : 'none';
    inputEl.disabled = running;
    if (!running) { inputEl.focus(); }
    removeThinking();
    if (running) showThinking();
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ── Simple markdown-ish text renderer ────────────────────────────────────
  function renderText(raw) {
    // Escape HTML first
    let text = raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Fenced code blocks: \`\`\`lang\\n...\\n\`\`\`
    text = text.replace(/\`\`\`([\\w+-]*)\\n([\\s\\S]*?)\`\`\`/g, (_, lang, code) => {
      return '<pre><code class="lang-' + lang + '">' + code + '</code></pre>';
    });

    // Inline code: \`...\`
    text = text.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

    // Bold: **text**
    text = text.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');

    // Italic: *text*
    text = text.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');

    // Links: [label](url)
    text = text.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)]+)\\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    return text;
  }

  // ── Message rendering ─────────────────────────────────────────────────────
  function hideEmpty() {
    if (emptyState) emptyState.style.display = 'none';
  }

  function appendMsg(role, bodyHtml, label) {
    hideEmpty();
    const wrapper = document.createElement('div');
    wrapper.className = 'msg ' + role;

    if (label) {
      const lbl = document.createElement('div');
      lbl.className = 'msg-label';
      lbl.textContent = label;
      wrapper.appendChild(lbl);
    }

    const body = document.createElement('div');
    body.className = 'msg-body';
    body.innerHTML = bodyHtml;
    wrapper.appendChild(body);

    messagesEl.appendChild(wrapper);
    scrollToBottom();
    return body;
  }

  function appendUserMessage(text) {
    appendMsg('user', renderText(text), '你');
  }

  function appendSystemMsg(text) {
    appendMsg('system', escHtml(text));
  }

  function appendInfoMsg(text) {
    appendMsg('info', escHtml(text));
  }

  function appendErrorMsg(text) {
    appendMsg('error', escHtml(text), '错误');
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Start a new assistant bubble (returns the body element for streaming)
  function startAssistantBubble() {
    hideEmpty();
    const wrapper = document.createElement('div');
    wrapper.className = 'msg assistant';

    const lbl = document.createElement('div');
    lbl.className = 'msg-label';
    lbl.textContent = 'Claude';
    wrapper.appendChild(lbl);

    const body = document.createElement('div');
    body.className = 'msg-body';
    wrapper.appendChild(body);

    messagesEl.appendChild(wrapper);
    scrollToBottom();
    return body;
  }

  // ── Thinking indicator ────────────────────────────────────────────────────
  function showThinking() {
    if (thinkingEl) return;
    hideEmpty();
    thinkingEl = document.createElement('div');
    thinkingEl.className = 'thinking';
    thinkingEl.innerHTML =
      '<span>Claude 正在思考</span>' +
      '<div class="thinking-dots"><span></span><span></span><span></span></div>';
    messagesEl.appendChild(thinkingEl);
    scrollToBottom();
  }

  function removeThinking() {
    if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; }
  }

  // ── Tool use block ────────────────────────────────────────────────────────
  function appendToolUse(name, input) {
    hideEmpty();
    const toolEl = document.createElement('div');
    toolEl.className = 'tool-block';

    const inputStr = typeof input === 'string' ? input : JSON.stringify(input, null, 2);

    toolEl.innerHTML =
      '<div class="tool-header">' +
        '<span class="tool-icon">⚙</span>' +
        '<span class="tool-name">' + escHtml(name) + '</span>' +
        '<span class="tool-status">运行中...</span>' +
        '<span class="tool-toggle">▼</span>' +
      '</div>' +
      '<div class="tool-body open">' +
        '<div class="tool-section-label">输入</div>' +
        '<div class="tool-input">' + escHtml(inputStr) + '</div>' +
      '</div>';

    const header = toolEl.querySelector('.tool-header');
    const body   = toolEl.querySelector('.tool-body');
    const toggle = toolEl.querySelector('.tool-toggle');
    header.addEventListener('click', () => {
      const open = body.classList.toggle('open');
      toggle.textContent = open ? '▼' : '▶';
    });

    messagesEl.appendChild(toolEl);
    scrollToBottom();
    return toolEl;
  }

  // track tool blocks by id for result injection
  const toolBlocksById = {};

  function addToolResult(toolUseId, content, isError) {
    const el = toolBlocksById[toolUseId];
    if (!el) return;
    const status = el.querySelector('.tool-status');
    const body   = el.querySelector('.tool-body');
    if (status) status.textContent = isError ? '失败' : '完成';
    if (body) {
      const resultStr = Array.isArray(content)
        ? content.map(b => b.text || JSON.stringify(b)).join('\\n')
        : (typeof content === 'string' ? content : JSON.stringify(content));
      const outDiv = document.createElement('div');
      outDiv.innerHTML =
        '<div class="tool-section-label">输出</div>' +
        '<div class="tool-output ' + (isError ? 'error' : '') + '">' + escHtml(resultStr) + '</div>';
      body.appendChild(outDiv);
      scrollToBottom();
    }
  }

  // ── Permission handling ───────────────────────────────────────────────────
  function showPermissionDialog(request, requestId) {
    pendingPermReqId = requestId;
    let info = request.tool_name || 'unknown';
    if (request.tool_input) {
      try {
        info += '\\n' + JSON.stringify(request.tool_input, null, 2);
      } catch { /**/ }
    }
    permToolInfo.textContent = info;
    permOverlay.style.display = 'flex';
  }

  function resolvePermission(behavior) {
    if (!pendingPermReqId || !ws || ws.readyState !== WebSocket.OPEN) return;
    const msg = JSON.stringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: pendingPermReqId,
        response: {
          behavior,
          ...(behavior === 'deny' ? { message: '用户拒绝了此操作' } : {}),
        },
      },
    });
    ws.send(msg);
    permOverlay.style.display = 'none';
    pendingPermReqId = null;
  }

  permAllow.addEventListener('click', () => resolvePermission('allow'));
  permDeny.addEventListener('click',  () => resolvePermission('deny'));

  // ── WebSocket management ──────────────────────────────────────────────────
  function connectWs() {
    if (!wsUrl) return;

    let url = WS_ORIGIN + wsUrl;
    if (AUTH_TOKEN) {
      url += (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(AUTH_TOKEN);
    }

    setStatus('connecting', '正在连接...');
    ws = new WebSocket(url);

    ws.onopen = () => {
      setStatus('connected', '已连接');
      sendBtn.disabled = false;
      inputEl.disabled = false;
      inputEl.focus();
      appendInfoMsg('连接成功 — 请开始对话');
    };

    ws.onclose = () => {
      setStatus('error', '连接已断开');
      sendBtn.disabled = true;
      inputEl.disabled = true;
      setRunning(false);
      appendInfoMsg('连接已断开，请刷新页面重新连接');
      newSessionBtn.style.display = 'flex';
    };

    ws.onerror = () => {
      setStatus('error', '连接错误');
    };

    ws.onmessage = evt => {
      const raw = typeof evt.data === 'string' ? evt.data : '';
      const lines = raw.split('\\n').filter(l => l.trim());
      for (const line of lines) {
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        handleServerMessage(msg);
      }
    };
  }

  // ── Server message handler ────────────────────────────────────────────────
  function handleServerMessage(msg) {
    const type = msg.type;

    if (type === 'system') {
      if (msg.subtype === 'init') {
        // Session initialized; nothing to show
      }
      return;
    }

    if (type === 'user') {
      // echoed user message — skip, we already rendered it
      return;
    }

    if (type === 'assistant') {
      removeThinking();
      const content = msg.message?.content ?? [];
      if (!Array.isArray(content)) return;

      // Merge consecutive text blocks into one bubble; tool_use → separate block
      let textAccum = '';
      const flushText = () => {
        if (!textAccum.trim()) return;
        if (!currentAssistantEl) {
          currentAssistantEl = startAssistantBubble();
        }
        currentAssistantEl.innerHTML = renderText(textAccum);
        scrollToBottom();
      };

      for (const block of content) {
        if (block.type === 'text') {
          textAccum += block.text;
        } else if (block.type === 'tool_use') {
          flushText();
          textAccum = '';
          currentAssistantEl = null;
          const el = appendToolUse(block.name, block.input);
          toolBlocksById[block.id] = el;
        }
      }
      flushText();
      return;
    }

    if (type === 'tool_result') {
      // Deprecated top-level tool_result (pre SDK 2.x); ignore here
      return;
    }

    if (type === 'result') {
      removeThinking();
      setRunning(false);
      currentAssistantEl = null;
      if (msg.is_error) {
        appendErrorMsg(msg.error ?? '请求失败');
      }
      return;
    }

    if (type === 'control_request') {
      const req = msg.request ?? {};
      if (req.subtype === 'can_use_tool') {
        showPermissionDialog(req, msg.request_id);
      } else if (req.subtype === 'interrupt') {
        // server-initiated interrupt; nothing to do
      } else {
        // Auto-respond with error for unknown control subtypes
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'control_response',
            response: { subtype: 'error', request_id: msg.request_id, error: 'unsupported' },
          }));
        }
      }
      return;
    }
  }

  // ── Send message ──────────────────────────────────────────────────────────
  function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN || isRunning) return;

    appendUserMessage(text);
    currentAssistantEl = null;

    const payload = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: sessionId ?? '',
    });
    ws.send(payload);

    inputEl.value = '';
    inputEl.style.height = 'auto';
    setRunning(true);
    inputHint.textContent = '';
  }

  sendBtn.addEventListener('click', sendMessage);

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
  });

  // ── Interrupt ─────────────────────────────────────────────────────────────
  interruptBtn.addEventListener('click', () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: { subtype: 'interrupt' },
    }));
    appendInfoMsg('已发送中断信号...');
  });

  // ── New session ───────────────────────────────────────────────────────────
  async function createSession() {
    setStatus('connecting', '正在创建会话...');
    try {
      const resp = await fetch(BASE_URL + '/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ cwd: undefined }),
      });
      if (!resp.ok) {
        throw new Error('HTTP ' + resp.status + ': ' + resp.statusText);
      }
      const data = await resp.json();
      sessionId = data.session_id;
      wsUrl = data.ws_url;
      connectWs();
    } catch (err) {
      setStatus('error', '连接失败');
      appendErrorMsg('无法创建会话: ' + err.message);
    }
  }

  newSessionBtn.addEventListener('click', () => {
    if (ws) { ws.close(); ws = null; }
    messagesEl.innerHTML = '';
    if (emptyState) { messagesEl.appendChild(emptyState); emptyState.style.display = ''; }
    newSessionBtn.style.display = 'none';
    createSession();
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  createSession();

})();
</script>
</body>
</html>`
}
