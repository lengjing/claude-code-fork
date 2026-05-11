/**
 * Web UI for Claude Code - serves a self-contained chat interface.
 */

export function getWebUIHtml(authToken: string | undefined): string {
  const escapedToken = authToken ? JSON.stringify(authToken) : 'null'

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#f2f4f8" />
  <title>Claude Code</title>
  <style>
    :root {
      --bg: #f6f8fa;
      --surface: #ffffff;
      --surface-soft: #f6f8fa;
      --line: #d1d9e0;
      --line-strong: #afb8c1;
      --text: #1f2328;
      --text-soft: #59636e;
      --text-faint: #656d76;
      --brand: #0969da;
      --danger: #cf222e;
      --radius-lg: 12px;
      --radius-md: 12px;
      --radius-sm: 8px;
      --shadow: 0 1px 0 rgba(31, 35, 40, 0.04);
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
      color: var(--text);
      background: var(--bg);
      overflow: hidden;
    }

    .shell {
      height: 100%;
      display: grid;
      grid-template-columns: 320px minmax(0, 1fr);
      gap: 12px;
      padding: 12px;
    }

    .panel {
      min-height: 0;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow);
    }

    .sidebar {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .sidebar-head {
      padding: 12px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      background: var(--surface-soft);
    }

    .title {
      font-size: 11px;
      letter-spacing: .08em;
      text-transform: uppercase;
      color: var(--text-soft);
      font-weight: 700;
    }

    .icon-btn {
      width: 30px;
      height: 30px;
      border-radius: 6px;
      border: 1px solid var(--line);
      background: var(--surface-soft);
      color: var(--text-soft);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: border-color .14s ease, color .14s ease, background .14s ease;
    }

    .icon-btn:hover {
      border-color: var(--line-strong);
      color: var(--brand);
      background: #f3f4f6;
    }

    .session-list {
      padding: 8px;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .session-empty {
      border: 1px dashed var(--line-strong);
      border-radius: var(--radius-sm);
      padding: 20px 14px;
      text-align: center;
      color: var(--text-faint);
      font-size: 13px;
      background: var(--surface-soft);
    }

    .session-item {
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 10px;
      background: #fff;
      cursor: pointer;
      transition: all .15s ease;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .session-item:hover {
      border-color: #b8c6e2;
      background: var(--surface-soft);
    }

    .session-item.active {
      border-color: #54aeff;
      background: #ddf4ff;
    }

    .session-name {
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .session-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--text-soft);
    }

    .badge {
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 700;
      border: 1px solid transparent;
    }

    .badge.running { background: #dafbe1; color: #1a7f37; border-color: #aceebb; }
    .badge.detached { background: #fff8c5; color: #9a6700; border-color: #eed87c; }
    .badge.persisted { background: #f6f8fa; color: #57606a; border-color: #d8dee4; }

    .workspace {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      overflow: hidden;
    }

    .topbar {
      border-bottom: 1px solid var(--line);
      padding: 12px 16px;
      background: var(--surface);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-size: 16px;
      font-weight: 600;
      letter-spacing: 0;
    }

    .brand-mark {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      color: #fff;
      background: var(--brand);
    }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--text-faint);
      font-size: 12px;
      font-weight: 400;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #9ca3af;
    }

    .status-dot.connected { background: #1a7f37; }
    .status-dot.connecting { background: #bf8700; }
    .status-dot.error { background: var(--danger); }

    .chip-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .chip {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 12px;
      color: var(--text-faint);
      background: var(--surface-soft);
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 400;
    }

    .chip.primary {
      border-color: #b6e3ff;
      background: #ddf4ff;
      color: #0969da;
    }

    .feed {
      min-height: 0;
      overflow: auto;
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      background: var(--surface);
    }

    .notice {
      border: 1px dashed var(--line-strong);
      border-radius: var(--radius-sm);
      background: var(--surface-soft);
      color: var(--text-soft);
      padding: 12px;
      font-size: 13px;
      text-align: center;
    }

    .event {
      border: 0;
      border-radius: 0;
      background: transparent;
      padding: 0;
      animation: show .16s ease;
    }

    @keyframes show {
      from { opacity: 0; transform: translateY(5px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .event-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 6px;
    }

    .event-label {
      font-size: 12px;
      letter-spacing: .07em;
      text-transform: uppercase;
      color: var(--text-faint);
      font-weight: 700;
    }

    .event-time {
      font-size: 12px;
      color: var(--text-faint);
    }

    .event-body {
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.5;
      font-size: 14px;
      color: var(--text);
    }

    .event-box {
      display: inline-block;
      max-width: min(640px, 100%);
      background: var(--surface-soft);
      border-radius: 12px;
      padding: 16px 24px;
      color: var(--text);
    }

    .event.user .event-box {
      background: var(--surface-soft);
    }

    .event.system .event-box,
    .event.error .event-box,
    .event.tool .event-box {
      border: 1px solid var(--line);
      padding: 12px 16px;
      border-radius: 8px;
      background: #ffffff;
    }

    .event.assistant {
      margin-top: 4px;
    }

    .event.assistant .event-head {
      margin-bottom: 2px;
    }

    .event.assistant .event-box {
      background: transparent;
      padding: 0;
      max-width: 100%;
    }

    .event.error .event-box {
      border-color: #ff8182;
      background: #ffebe9;
    }

    .tool-box {
      margin-top: 8px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      overflow: hidden;
      background: #f8fafc;
    }

    .tool-title {
      padding: 8px 10px;
      font-size: 11px;
      font-weight: 700;
      color: #4b5563;
      border-bottom: 1px solid var(--line);
    }

    .tool-json {
      margin: 0;
      padding: 10px;
      max-height: 220px;
      overflow: auto;
      font-size: 12px;
      line-height: 1.45;
      font-family: Consolas, "Cascadia Mono", "Courier New", monospace;
      color: #1f2937;
      background: #fff;
    }

    .composer-wrap {
      border-top: 1px solid var(--line);
      padding: 8px 16px 12px;
      background: #fff;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .quick-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 4px 8px;
      border-radius: 12px 12px 0 0;
      background: var(--surface-soft);
      border: 1px solid var(--line);
      border-bottom: 0;
    }

    .quick-pill {
      border: 0;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 12px;
      color: var(--text-faint);
      background: transparent;
      font-weight: 400;
    }

    .composer {
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 0 0 12px 12px;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .input {
      width: 100%;
      border: none;
      resize: none;
      font-size: 14px;
      line-height: 1.5;
      min-height: 84px;
      max-height: 220px;
      outline: none;
      color: var(--text);
      font-weight: 400;
      padding: 16px;
      font-family: inherit;
    }

    .input::placeholder {
      color: var(--text-faint);
      font-weight: 400;
    }

    .actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 0 8px 8px;
      min-height: 40px;
    }

    .actions-left,
    .actions-right {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .actions-right {
      border-left: 1px solid var(--line);
      padding-left: 8px;
    }

    .action {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      border: 1px solid transparent;
      background: transparent;
      cursor: pointer;
      color: var(--text-faint);
      font-weight: 600;
      font-size: 13px;
      line-height: 1;
    }

    .action:hover {
      background: var(--surface-soft);
      border-color: var(--line);
      color: var(--text);
    }

    .action:disabled {
      opacity: .42;
      cursor: not-allowed;
    }

    .action.send {
      color: var(--text-faint);
      border-color: transparent;
      background: transparent;
      font-size: 14px;
    }

    .hint {
      font-size: 12px;
      color: var(--text-faint);
      min-height: 16px;
      padding-left: 2px;
    }

    .modal {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.35);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
      z-index: 40;
    }

    .modal.open { display: flex; }

    .dialog {
      width: min(560px, 100%);
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 14px;
      box-shadow: 0 8px 24px rgba(31, 35, 40, 0.2);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .dialog-title {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
    }

    .dialog-text {
      font-size: 13px;
      color: var(--text-soft);
    }

    .dialog-box {
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: #f8fafc;
      padding: 10px;
      font-size: 12px;
      color: #334155;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 260px;
      overflow: auto;
      font-family: Consolas, "Cascadia Mono", "Courier New", monospace;
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .btn {
      border: 1px solid var(--line);
      border-radius: 6px;
      height: 36px;
      padding: 0 14px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      background: #fff;
      color: #334155;
    }

    .btn.primary {
      border-color: var(--brand);
      color: #fff;
      background: var(--brand);
    }

    @media (max-width: 1050px) {
      .shell {
        grid-template-columns: 1fr;
      }

      .sidebar {
        max-height: 260px;
      }

      .quick-row { flex-wrap: wrap; }
      .actions { flex-wrap: wrap; }
      .actions-right { border-left: 0; padding-left: 0; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="panel sidebar" aria-label="会话历史">
      <div class="sidebar-head">
        <div class="title">会话历史</div>
        <button id="new-session" class="icon-btn" aria-label="新建会话" title="新建会话">+</button>
      </div>
      <div id="session-list" class="session-list">
        <div class="session-empty">暂无历史会话</div>
      </div>
    </aside>

    <section class="panel workspace" aria-label="聊天面板">
      <header class="topbar">
        <div class="heading">
          <div class="brand"><span class="brand-mark">✦</span>Claude Code</div>
          <div class="status"><span id="status-dot" class="status-dot connecting"></span><span id="status-text">正在连接</span></div>
        </div>
        <div class="chip-row">
          <span class="chip primary">Task Chat</span>
          <span class="chip">WebSocket + HTTP</span>
        </div>
      </header>

      <main id="feed" class="feed" role="log" aria-live="polite">
        <div class="notice">会话建立后，消息和工具步骤会显示在这里。</div>
      </main>

      <footer class="composer-wrap">
        <div class="quick-row">
          <span class="quick-pill">What would you like to do next?</span>
          <span class="quick-pill">Auto</span>
        </div>

        <div class="composer">
          <textarea id="chat-input" class="input" rows="1" placeholder="What would you like to do next?" disabled></textarea>
          <div class="actions">
            <div class="actions-left">
              <button id="interrupt-btn" class="action" title="停止当前请求" style="display:none">■</button>
              <button id="refresh-btn" class="action" title="重新连接">↻</button>
            </div>
            <div class="actions-right">
              <button id="send-btn" class="action send" title="发送" disabled>➤</button>
            </div>
          </div>
        </div>

        <div id="hint" class="hint"></div>
      </footer>
    </section>
  </div>

  <div id="permission-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="permission-title">
    <div class="dialog">
      <div id="permission-title" class="dialog-title">权限请求</div>
      <div class="dialog-text">Claude 请求执行以下工具调用：</div>
      <div id="permission-info" class="dialog-box"></div>
      <div class="dialog-actions">
        <button id="permission-deny" class="btn">拒绝</button>
        <button id="permission-allow" class="btn primary">允许</button>
      </div>
    </div>
  </div>

  <script>
    (function () {
      'use strict';

      const AUTH_TOKEN = ${escapedToken};
      const BASE_URL = window.location.origin;
      const WS_ORIGIN = window.location.origin.replace('http://', 'ws://').replace('https://', 'wss://');

      const dom = {
        sessionList: document.getElementById('session-list'),
        newSessionBtn: document.getElementById('new-session'),
        feed: document.getElementById('feed'),
        input: document.getElementById('chat-input'),
        sendBtn: document.getElementById('send-btn'),
        interruptBtn: document.getElementById('interrupt-btn'),
        refreshBtn: document.getElementById('refresh-btn'),
        hint: document.getElementById('hint'),
        statusDot: document.getElementById('status-dot'),
        statusText: document.getElementById('status-text'),
        permissionModal: document.getElementById('permission-modal'),
        permissionInfo: document.getElementById('permission-info'),
        permissionAllow: document.getElementById('permission-allow'),
        permissionDeny: document.getElementById('permission-deny'),
      };

      const state = {
        ws: null,
        sessionId: null,
        wsUrl: null,
        isRunning: false,
        pendingMessageText: null,
        pendingPermissionId: null,
        sessions: [],
        assistantTextByToolMessage: new Map(),
        assistantNodeByMessageId: new Map(),
      };

      function authHeaders() {
        return AUTH_TOKEN ? { Authorization: 'Bearer ' + AUTH_TOKEN } : {};
      }

      function escHtml(value) {
        return String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      }

      function formatTime(ts) {
        const d = new Date(ts || Date.now());
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return hh + ':' + mm;
      }

      function relativeTime(ms) {
        if (!ms) return '';
        const diff = Date.now() - ms;
        const sec = Math.floor(diff / 1000);
        if (sec < 60) return '刚刚';
        const min = Math.floor(sec / 60);
        if (min < 60) return min + ' 分钟前';
        const hr = Math.floor(min / 60);
        if (hr < 24) return hr + ' 小时前';
        return Math.floor(hr / 24) + ' 天前';
      }

      function renderMarkdownLite(raw) {
        const html = escHtml(raw || '');
        return html
          .split(String.fromCharCode(10))
          .join('<br/>');
      }

      function setHint(text) {
        dom.hint.textContent = text || '';
      }

      function setStatus(kind, text) {
        dom.statusDot.className = 'status-dot ' + kind;
        dom.statusText.textContent = text;
      }

      function setRunning(running) {
        state.isRunning = running;
        const wsReady = state.ws && state.ws.readyState === WebSocket.OPEN;
        dom.sendBtn.disabled = running || (!wsReady && !state.sessionId);
        dom.input.disabled = running;
        dom.interruptBtn.style.display = running ? '' : 'none';
        if (!running) dom.input.focus();
      }

      function appendEvent(options) {
        const item = document.createElement('article');
        item.className = 'event ' + options.kind;

        const timeText = options.time || formatTime(Date.now());
        item.innerHTML =
          '<div class="event-head">' +
            '<div class="event-label">' + escHtml(options.label || '消息') + '</div>' +
            '<div class="event-time">' + escHtml(timeText) + '</div>' +
          '</div>' +
          '<div class="event-box"><div class="event-body">' + (options.html || '') + '</div></div>';

        dom.feed.appendChild(item);
        dom.feed.scrollTop = dom.feed.scrollHeight;
        return item.querySelector('.event-body');
      }

      function clearFeed() {
        dom.feed.innerHTML = '';
        state.assistantTextByToolMessage.clear();
        state.assistantNodeByMessageId.clear();
      }

      function showEmptyFeed(text) {
        const note = document.createElement('div');
        note.className = 'notice';
        note.textContent = text;
        dom.feed.appendChild(note);
      }

      function normalizeUserContent(record) {
        const content = record && record.message && record.message.content;
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block && block.type === 'text' && typeof block.text === 'string') {
              return block.text;
            }
          }
        }
        return '';
      }

      function formatSessionTitle(session) {
        if (session.customTitle) return session.customTitle;
        if (session.firstPrompt) {
          return session.firstPrompt.length > 48
            ? session.firstPrompt.slice(0, 48) + '...'
            : session.firstPrompt;
        }
        return '会话 ' + String(session.sessionId || '').slice(0, 8);
      }

      function renderSessionList() {
        dom.sessionList.innerHTML = '';
        if (!state.sessions.length) {
          const empty = document.createElement('div');
          empty.className = 'session-empty';
          empty.textContent = '暂无历史会话';
          dom.sessionList.appendChild(empty);
          return;
        }

        for (const session of state.sessions) {
          const item = document.createElement('div');
          const active = session.sessionId === state.sessionId;
          item.className = 'session-item' + (active ? ' active' : '');

          const badgeClass = session.status === 'running'
            ? 'running'
            : session.status === 'detached'
              ? 'detached'
              : 'persisted';
          const badgeText = session.status === 'running'
            ? '运行中'
            : session.status === 'detached'
              ? '空闲'
              : '已结束';

          item.innerHTML =
            '<div class="session-name">' + escHtml(formatSessionTitle(session)) + '</div>' +
            '<div class="session-meta">' +
              '<span class="badge ' + badgeClass + '">' + escHtml(badgeText) + '</span>' +
              '<span>' + escHtml(relativeTime(session.lastActiveAt || session.lastModified || 0)) + '</span>' +
            '</div>';

          item.addEventListener('click', function () {
            void selectSession(session.sessionId);
          });
          dom.sessionList.appendChild(item);
        }
      }

      async function loadSessions() {
        try {
          const response = await fetch(BASE_URL + '/sessions?limit=50', {
            headers: authHeaders(),
          });
          if (!response.ok) {
            return;
          }
          const payload = await response.json();
          state.sessions = (payload.sessions || []).sort(function (a, b) {
            return (b.lastActiveAt || b.lastModified || 0) - (a.lastActiveAt || a.lastModified || 0);
          });
          renderSessionList();
        } catch (_) {
          // best effort list refresh
        }
      }

      function websocketUrlWithAuth(rawUrl) {
        const source = typeof rawUrl === 'string' ? rawUrl : '';
        if (!source) return '';

        let urlText = source.startsWith('ws://') || source.startsWith('wss://')
          ? source
          : WS_ORIGIN + source;

        if (AUTH_TOKEN) {
          try {
            const parsed = new URL(urlText);
            parsed.searchParams.set('token', AUTH_TOKEN);
            urlText = parsed.toString();
          } catch (_) {
            const suffix = urlText.indexOf('?') >= 0 ? '&' : '?';
            urlText = urlText + suffix + 'token=' + encodeURIComponent(AUTH_TOKEN);
          }
        }

        return urlText;
      }

      function connectWebSocket() {
        if (!state.wsUrl) {
          return;
        }

        if (state.ws) {
          state.ws.close();
          state.ws = null;
        }

        const wsFullUrl = websocketUrlWithAuth(state.wsUrl);
        if (!wsFullUrl) {
          setStatus('error', '连接地址无效');
          appendEvent({
            kind: 'error',
            label: '连接错误',
            html: escHtml('无法连接会话：WebSocket 地址无效。'),
          });
          return;
        }

        setStatus('connecting', '正在连接');
        state.ws = new WebSocket(wsFullUrl);

        state.ws.onopen = function () {
          setStatus('connected', '已连接');
          setRunning(false);
          setHint('连接成功，可直接发送消息。');

          if (state.pendingMessageText) {
            const queued = state.pendingMessageText;
            state.pendingMessageText = null;
            sendSocketUserMessage(queued);
            setRunning(true);
          }

          void loadSessions();
        };

        state.ws.onclose = function () {
          setStatus('error', '连接已断开');
          setRunning(false);
          setHint('连接已断开，可点击刷新按钮重连。');
          void loadSessions();
        };

        state.ws.onerror = function () {
          setStatus('error', '连接异常');
        };

        state.ws.onmessage = async function (event) {
          let raw = '';
          if (typeof event.data === 'string') {
            raw = event.data;
          } else if (event.data && typeof event.data.text === 'function') {
            raw = await event.data.text();
          } else if (event.data instanceof ArrayBuffer) {
            raw = new TextDecoder().decode(new Uint8Array(event.data));
          } else if (ArrayBuffer.isView(event.data)) {
            const view = event.data;
            raw = new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
          }

          const lines = raw.split('\\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              handleServerMessage(JSON.parse(trimmed));
            } catch (_) {
              // ignore malformed lines
            }
          }
        };
      }

      function sendSocketUserMessage(text) {
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
          return;
        }
        state.ws.send(JSON.stringify({
          type: 'user',
          message: { role: 'user', content: text },
          parent_tool_use_id: null,
          session_id: state.sessionId || '',
        }));
      }

      function showPermissionDialog(request, requestId) {
        state.pendingPermissionId = requestId;
        let detail = request.tool_name || 'unknown';
        if (request.tool_input) {
          try {
            detail += '\\n' + JSON.stringify(request.tool_input, null, 2);
          } catch (_) {
            // ignore stringify failures
          }
        }
        dom.permissionInfo.textContent = detail;
        dom.permissionModal.classList.add('open');
      }

      function resolvePermission(behavior) {
        if (!state.pendingPermissionId || !state.ws || state.ws.readyState !== WebSocket.OPEN) {
          return;
        }

        state.ws.send(JSON.stringify({
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: state.pendingPermissionId,
            response: {
              behavior: behavior,
              ...(behavior === 'deny' ? { message: '用户拒绝了此操作' } : {}),
            },
          },
        }));

        state.pendingPermissionId = null;
        dom.permissionModal.classList.remove('open');
      }

      function handleAssistantMessage(message) {
        const content = message && message.message && Array.isArray(message.message.content)
          ? message.message.content
          : [];
        const messageId = message.uuid || ('assistant-' + Date.now());

        let textBuffer = '';
        let textNode = state.assistantNodeByMessageId.get(messageId);

        if (!textNode) {
          textNode = appendEvent({
            kind: 'assistant',
            label: 'Claude',
            html: '',
          });
          state.assistantNodeByMessageId.set(messageId, textNode);
          state.assistantTextByToolMessage.set(messageId, '');
        }

        for (const block of content) {
          if (block && block.type === 'text' && typeof block.text === 'string') {
            textBuffer += block.text;
          } else if (block && block.type === 'tool_use') {
            const title = '<div class="tool-box">' +
              '<div class="tool-title">' + escHtml(block.name || 'tool_use') + '</div>' +
              '<pre class="tool-json">' + escHtml(JSON.stringify(block.input || {}, null, 2)) + '</pre>' +
            '</div>';
            appendEvent({
              kind: 'tool',
              label: 'Tool Call',
              html: title,
            });
          }
        }

        if (textBuffer) {
          const prior = state.assistantTextByToolMessage.get(messageId) || '';
          const next = prior + textBuffer;
          state.assistantTextByToolMessage.set(messageId, next);
          textNode.innerHTML = renderMarkdownLite(next);
        }
      }

      function handleServerMessage(message) {
        const type = message.type;

        if (type === 'user') {
          return;
        }

        if (type === 'system') {
          if (message.subtype === 'api_retry') {
            appendEvent({
              kind: 'system',
              label: 'API Retry',
              html: escHtml('正在重试上游请求 (' + (message.attempt || '?') + '/' + (message.max_retries || '?') + ')'),
            });
          }
          return;
        }

        if (type === 'assistant') {
          handleAssistantMessage(message);
          return;
        }

        if (type === 'result') {
          setRunning(false);
          setHint('');
          if (message.is_error) {
            const text = Array.isArray(message.errors)
              ? message.errors.filter(Boolean).join('\\n')
              : (message.error || '请求执行出错');
            appendEvent({
              kind: 'error',
              label: 'Result Error',
              html: escHtml(text),
            });
          }
          return;
        }

        if (type === 'control_request') {
          const req = message.request || {};
          if (req.subtype === 'can_use_tool') {
            showPermissionDialog(req, message.request_id);
            return;
          }

          if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({
              type: 'control_response',
              response: {
                subtype: 'error',
                request_id: message.request_id,
                error: 'unsupported',
              },
            }));
          }
        }
      }

      async function loadSessionHistory(sessionId) {
        appendEvent({
          kind: 'system',
          label: 'History',
          html: escHtml('正在加载会话历史...'),
        });

        try {
          const response = await fetch(BASE_URL + '/sessions/' + encodeURIComponent(sessionId), {
            headers: authHeaders(),
          });
          if (!response.ok) {
            appendEvent({
              kind: 'error',
              label: 'History Error',
              html: escHtml('历史加载失败：HTTP ' + response.status),
            });
            return;
          }

          const payload = await response.json();
          const records = payload.records || payload.messages || [];

          clearFeed();
          if (!records.length) {
            showEmptyFeed('该会话暂无消息，直接发送新消息即可。');
            return;
          }

          for (const record of records) {
            if (record.type === 'user') {
              const text = normalizeUserContent(record);
              if (text) {
                appendEvent({
                  kind: 'user',
                  label: 'You',
                  html: renderMarkdownLite(text),
                });
              }
              continue;
            }

            if (record.type === 'assistant') {
              const messageObj = record.message || {};
              const blocks = Array.isArray(messageObj.content) ? messageObj.content : [];
              let text = '';
              for (const block of blocks) {
                if (block && block.type === 'text' && typeof block.text === 'string') {
                  text += block.text;
                } else if (block && block.type === 'tool_use') {
                  appendEvent({
                    kind: 'tool',
                    label: 'Tool Call',
                    html:
                      '<div class="tool-box">' +
                        '<div class="tool-title">' + escHtml(block.name || 'tool_use') + '</div>' +
                        '<pre class="tool-json">' + escHtml(JSON.stringify(block.input || {}, null, 2)) + '</pre>' +
                      '</div>',
                  });
                }
              }

              if (text.trim()) {
                appendEvent({
                  kind: 'assistant',
                  label: 'Claude',
                  html: renderMarkdownLite(text),
                });
              }
            }
          }
        } catch (error) {
          appendEvent({
            kind: 'error',
            label: 'History Error',
            html: escHtml('历史加载失败: ' + (error && error.message ? error.message : String(error))),
          });
        }
      }

      async function createSession() {
        if (state.ws) {
          state.ws.close();
          state.ws = null;
        }

        clearFeed();
        showEmptyFeed('正在创建会话...');

        state.sessionId = null;
        state.wsUrl = null;
        state.pendingMessageText = null;

        setStatus('connecting', '创建会话中');

        try {
          const response = await fetch(BASE_URL + '/sessions', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
            body: JSON.stringify({}),
          });

          if (!response.ok) {
            throw new Error('HTTP ' + response.status + ' ' + response.statusText);
          }

          const payload = await response.json();
          state.sessionId = payload.session_id;
          state.wsUrl = payload.ws_url;

          clearFeed();
          showEmptyFeed('会话已创建，发送消息开始对话。');

          connectWebSocket();
          await loadSessions();
          renderSessionList();
        } catch (error) {
          setStatus('error', '创建失败');
          appendEvent({
            kind: 'error',
            label: 'Create Session Failed',
            html: escHtml(String(error && error.message ? error.message : error)),
          });
        }
      }

      async function selectSession(sessionId) {
        if (!sessionId || sessionId === state.sessionId) {
          return;
        }

        if (state.ws) {
          state.ws.close();
          state.ws = null;
        }

        state.sessionId = sessionId;
        state.wsUrl = '/sessions/' + sessionId + '/ws';

        setRunning(false);
        await loadSessionHistory(sessionId);
        connectWebSocket();
        renderSessionList();
      }

      async function sendMessage() {
        const text = dom.input.value.trim();
        if (!text || state.isRunning) {
          return;
        }

        appendEvent({
          kind: 'user',
          label: 'You',
          html: renderMarkdownLite(text),
        });

        dom.input.value = '';
        dom.input.style.height = 'auto';

        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
          sendSocketUserMessage(text);
          setRunning(true);
          setHint('请求已发送，等待模型响应...');
          return;
        }

        if (!state.sessionId) {
          appendEvent({
            kind: 'error',
            label: 'Send Error',
            html: escHtml('没有可用会话，请先创建新会话。'),
          });
          return;
        }

        state.pendingMessageText = text;
        setRunning(true);
        setHint('正在重连会话并发送消息...');

        if (!state.wsUrl) {
          state.wsUrl = '/sessions/' + state.sessionId + '/ws';
        }

        connectWebSocket();
      }

      function interruptRun() {
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
          return;
        }

        state.ws.send(JSON.stringify({
          type: 'control_request',
          request_id: crypto.randomUUID(),
          request: { subtype: 'interrupt' },
        }));

        appendEvent({
          kind: 'system',
          label: 'Interrupt',
          html: escHtml('已发送中断请求。'),
        });
      }

      function reconnectCurrent() {
        if (!state.sessionId) {
          void createSession();
          return;
        }

        if (!state.wsUrl) {
          state.wsUrl = '/sessions/' + state.sessionId + '/ws';
        }
        connectWebSocket();
      }

      dom.sendBtn.addEventListener('click', function () {
        void sendMessage();
      });

      dom.newSessionBtn.addEventListener('click', function () {
        void createSession();
      });

      dom.interruptBtn.addEventListener('click', interruptRun);
      dom.refreshBtn.addEventListener('click', reconnectCurrent);

      dom.input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          void sendMessage();
        }
      });

      dom.input.addEventListener('input', function () {
        dom.input.style.height = 'auto';
        dom.input.style.height = Math.min(dom.input.scrollHeight, 220) + 'px';
      });

      dom.permissionAllow.addEventListener('click', function () {
        resolvePermission('allow');
      });

      dom.permissionDeny.addEventListener('click', function () {
        resolvePermission('deny');
      });

      dom.permissionModal.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          resolvePermission('deny');
        }
      });

      setInterval(function () {
        void loadSessions();
      }, 30000);

      void loadSessions().then(function () {
        if (state.sessions.length) {
          void selectSession(state.sessions[0].sessionId);
        } else {
          void createSession();
        }
      });
    })();
  </script>
</body>
</html>`
}
