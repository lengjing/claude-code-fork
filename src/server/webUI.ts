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
<html lang="zh-CN" style="color-scheme:dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#0a0a0f" />
  <title>Claude Code</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:           #0a0a0f;
      --surface:      #111118;
      --surface2:     #18181f;
      --surface3:     #1f1f28;
      --border:       #27272f;
      --border-focus: #6366f1;
      --text:         #edecf8;
      --text-muted:   #7b7a9a;
      --text-dim:     #4a4a6a;
      --accent:       #6366f1;
      --accent-hover: #818cf8;
      --success:      #34d399;
      --warning:      #fbbf24;
      --danger:       #f87171;
      --code-bg:      #0d0d15;
      --radius:       10px;
      --radius-sm:    6px;
      --radius-xs:    4px;
      --sidebar-w:    260px;
      --header-h:     52px;
    }

    html, body {
      height: 100%;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", sans-serif;
      background: var(--bg);
      color: var(--text);
      font-size: 14px;
      line-height: 1.6;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }

    body { display: flex; flex-direction: column; height: 100svh; overflow: hidden; }

    /* ── Skip link ── */
    .skip-link {
      position: absolute;
      top: -100%;
      left: 8px;
      background: var(--accent);
      color: #fff;
      padding: 6px 12px;
      border-radius: var(--radius-sm);
      z-index: 9999;
      font-size: 13px;
      text-decoration: none;
    }
    .skip-link:focus { top: 8px; }

    /* ── Layout ── */
    .app { display: flex; flex: 1; overflow: hidden; }

    /* ── Sidebar ── */
    .sidebar {
      width: var(--sidebar-w);
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      background: var(--surface);
      border-right: 1px solid var(--border);
      overflow: hidden;
      transition: width 0.2s ease, opacity 0.2s ease;
    }
    .sidebar.collapsed { width: 0; opacity: 0; pointer-events: none; }

    .sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .sidebar-title { font-size: 13px; font-weight: 600; color: var(--text-muted); letter-spacing: 0.05em; text-transform: uppercase; }

    .btn-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 16px;
      transition: background 0.15s, color 0.15s;
      flex-shrink: 0;
    }
    .btn-icon:hover { background: var(--surface3); color: var(--text); }
    .btn-icon:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
    .btn-icon:active { opacity: 0.7; }

    .sessions-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }
    .sessions-list::-webkit-scrollbar { width: 4px; }
    .sessions-list::-webkit-scrollbar-track { background: transparent; }
    .sessions-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

    .session-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 8px 10px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      border: 1px solid transparent;
      transition: background 0.1s, border-color 0.1s;
      min-width: 0;
    }
    .session-item:hover { background: var(--surface2); }
    .session-item:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
    .session-item.active { background: var(--surface2); border-color: var(--border); }
    .session-item.selected { background: var(--surface3); border-color: var(--accent); }

    .session-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }
    .session-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--text-muted);
    }
    .session-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
    }
    .session-badge.running { background: rgba(52,211,153,0.12); color: var(--success); }
    .session-badge.detached { background: rgba(251,191,36,0.12); color: var(--warning); }
    .session-badge.persisted { background: rgba(123,122,154,0.12); color: var(--text-muted); }

    .sessions-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 32px 16px;
      color: var(--text-dim);
      font-size: 12px;
      text-align: center;
    }

    /* ── Main ── */
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
    }

    /* ── Header ── */
    .header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 16px;
      height: var(--header-h);
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }

    .header-logo {
      width: 26px;
      height: 26px;
      background: var(--accent);
      border-radius: 7px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      flex-shrink: 0;
      color: #fff;
      aria-hidden: true;
    }

    .header-title { font-size: 15px; font-weight: 600; }

    .header-spacer { flex: 1; }

    .status-indicator {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--text-dim);
      flex-shrink: 0;
      transition: background 0.3s;
    }
    .status-dot.connected  { background: var(--success); }
    .status-dot.connecting { background: var(--warning); animation: pulse 1.4s ease-in-out infinite; }
    .status-dot.error      { background: var(--danger); }

    @media (prefers-reduced-motion: reduce) {
      .status-dot.connecting { animation: none; }
      .thinking-dots span    { animation: none; opacity: 0.7; }
      .fadeIn                { animation: none !important; }
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.35; }
    }

    /* ── Messages ── */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px 20px 8px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      scroll-behavior: smooth;
    }
    #messages::-webkit-scrollbar { width: 5px; }
    #messages::-webkit-scrollbar-track { background: transparent; }
    #messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

    /* ── Message bubbles ── */
    .msg {
      display: flex;
      flex-direction: column;
      max-width: 82%;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(5px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .msg.anim { animation: fadeIn 0.18s ease; }

    .msg.user      { align-self: flex-end; }
    .msg.assistant { align-self: flex-start; }
    .msg.system    { align-self: center; max-width: 72%; }
    .msg.error     { align-self: flex-start; }
    .msg.info      { align-self: center; max-width: 100%; }

    .msg-label {
      font-size: 11px;
      color: var(--text-muted);
      margin-bottom: 4px;
      padding: 0 3px;
    }
    .msg.user .msg-label { text-align: right; }

    .msg-body {
      border-radius: var(--radius);
      padding: 10px 14px;
      word-break: break-word;
      white-space: pre-wrap;
      min-width: 0;
    }
    .msg.user .msg-body {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-bottom-right-radius: 3px;
    }
    .msg.assistant .msg-body {
      background: rgba(99,102,241,0.07);
      border: 1px solid rgba(99,102,241,0.15);
      border-bottom-left-radius: 3px;
    }
    .msg.system .msg-body {
      background: var(--surface2);
      border: 1px solid var(--border);
      font-size: 12px;
      color: var(--text-muted);
      text-align: center;
      border-radius: var(--radius-sm);
      padding: 6px 12px;
    }
    .msg.error .msg-body {
      background: rgba(248,113,113,0.08);
      border: 1px solid rgba(248,113,113,0.2);
      color: var(--danger);
      border-radius: var(--radius);
    }
    .msg.info .msg-body {
      background: transparent;
      border: none;
      font-size: 12px;
      color: var(--text-dim);
      text-align: center;
      padding: 3px;
    }

    /* ── Code in messages ── */
    .msg-body code {
      font-family: "Menlo", "Consolas", "JetBrains Mono", monospace;
      font-size: 0.87em;
      background: var(--code-bg);
      border-radius: var(--radius-xs);
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
      font-size: 0.84em;
    }

    /* ── Tool blocks ── */
    .tool-block {
      margin-top: 8px;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      overflow: hidden;
    }
    .tool-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 12px;
      cursor: pointer;
      user-select: none;
      transition: background 0.12s;
    }
    .tool-header:hover { background: var(--surface3); }
    .tool-header:focus-visible { outline: 2px solid var(--border-focus); outline-offset: -2px; }
    .tool-name {
      font-family: "Menlo", "Consolas", monospace;
      font-size: 12px;
      color: #86efac;
      font-weight: 600;
      min-width: 0;
      truncate: ellipsis;
    }
    .tool-status { margin-left: auto; font-size: 11px; color: var(--text-muted); flex-shrink: 0; }
    .tool-toggle { color: var(--text-dim); font-size: 10px; flex-shrink: 0; }
    .tool-body { padding: 8px 12px; display: none; }
    .tool-body.open { display: block; }
    .tool-section-label {
      font-size: 10px;
      font-weight: 600;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin: 6px 0 3px;
    }
    .tool-section-label:first-child { margin-top: 0; }
    .tool-input, .tool-output {
      font-family: "Menlo", "Consolas", monospace;
      font-size: 11px;
      background: var(--code-bg);
      border-radius: var(--radius-xs);
      padding: 7px 10px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
      color: #a5f3a5;
    }
    .tool-output { color: #bfdbfe; }

    /* ── Permission dialog ── */
    .perm-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.65);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      padding: 16px;
    }
    .perm-dialog {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px 22px;
      max-width: 460px;
      width: 100%;
      box-shadow: 0 16px 48px rgba(0,0,0,0.6);
      overscroll-behavior: contain;
    }
    .perm-title { font-size: 15px; font-weight: 600; margin-bottom: 6px; }
    .perm-desc  { font-size: 13px; color: var(--text-muted); margin-bottom: 12px; }
    .perm-tool  {
      font-family: "Menlo", "Consolas", monospace;
      font-size: 12px;
      background: var(--code-bg);
      border-radius: var(--radius-sm);
      padding: 9px 11px;
      margin-bottom: 16px;
      color: #86efac;
      word-break: break-all;
      white-space: pre-wrap;
    }
    .perm-actions { display: flex; gap: 8px; justify-content: flex-end; }

    /* ── Thinking indicator ── */
    .thinking {
      align-self: flex-start;
      display: flex;
      align-items: center;
      gap: 9px;
      color: var(--text-muted);
      font-size: 13px;
      padding: 4px 0;
    }
    .thinking-dots { display: flex; gap: 4px; }
    .thinking-dots span {
      width: 5px;
      height: 5px;
      background: var(--accent);
      border-radius: 50%;
      animation: bounce 1.3s ease-in-out infinite;
    }
    .thinking-dots span:nth-child(2) { animation-delay: 0.18s; }
    .thinking-dots span:nth-child(3) { animation-delay: 0.36s; }
    @keyframes bounce {
      0%, 60%, 100% { transform: translateY(0);    opacity: 0.5; }
      30%            { transform: translateY(-5px); opacity: 1;   }
    }

    /* ── Empty state ── */
    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: var(--text-dim);
      pointer-events: none;
      padding-bottom: 60px;
    }
    .empty-icon  { font-size: 40px; opacity: 0.6; }
    .empty-title { font-size: 17px; color: var(--text-muted); font-weight: 500; }
    .empty-sub   { font-size: 13px; text-align: center; max-width: 260px; line-height: 1.5; }

    /* ── Input area ── */
    .input-area {
      flex-shrink: 0;
      padding: 10px 16px 14px;
      background: var(--surface);
      border-top: 1px solid var(--border);
    }
    .input-row {
      display: flex;
      align-items: flex-end;
      gap: 8px;
    }
    .input-wrapper { flex: 1; min-width: 0; }

    #chat-input {
      display: block;
      width: 100%;
      resize: none;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text);
      font-family: inherit;
      font-size: 14px;
      line-height: 1.55;
      padding: 9px 13px;
      min-height: 42px;
      max-height: 200px;
      overflow-y: auto;
      transition: border-color 0.18s;
      autocomplete: off;
    }
    #chat-input:focus-visible { outline: none; border-color: var(--border-focus); }
    #chat-input::placeholder { color: var(--text-dim); }

    .input-hint {
      font-size: 11px;
      color: var(--text-dim);
      margin-top: 5px;
    }

    /* ── Buttons ── */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 9px 16px;
      border: none;
      border-radius: var(--radius-sm);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      flex-shrink: 0;
      height: 40px;
      transition: background 0.15s, opacity 0.15s;
    }
    .btn:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
    .btn:active  { opacity: 0.8; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }

    .btn-primary {
      background: var(--accent);
      color: #fff;
    }
    .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }

    .btn-danger {
      background: rgba(248,113,113,0.12);
      color: var(--danger);
      border: 1px solid rgba(248,113,113,0.2);
    }
    .btn-danger:hover:not(:disabled) { background: rgba(248,113,113,0.2); }

    .btn-ghost {
      background: transparent;
      color: var(--text-muted);
      border: 1px solid var(--border);
    }
    .btn-ghost:hover:not(:disabled) { background: var(--surface3); color: var(--text); }

    .btn-sm { padding: 6px 12px; font-size: 12px; height: 32px; }

    /* ── New session bar ── */
    .new-session-bar {
      display: none;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 10px;
      border-bottom: 1px solid var(--border);
      background: rgba(248,113,113,0.05);
      font-size: 13px;
      color: var(--text-muted);
    }
    .new-session-bar.visible { display: flex; }

    /* ── Responsive ── */
    @media (max-width: 600px) {
      .sidebar { position: fixed; left: 0; top: 0; bottom: 0; z-index: 50; }
      .sidebar.collapsed { transform: translateX(-100%); width: var(--sidebar-w); opacity: 1; pointer-events: auto; }
      .sidebar-backdrop {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.5);
        z-index: 49;
      }
      .sidebar-backdrop.visible { display: block; }
      .msg { max-width: 93%; }
      .msg.system { max-width: 90%; }
      #messages { padding: 12px 12px 6px; }
      .input-area { padding: 8px 10px 12px; }
    }
  </style>
</head>
<body>

<a href="#main-content" class="skip-link">Skip to main content</a>

<!-- Sidebar backdrop (mobile) -->
<div class="sidebar-backdrop" id="sidebar-backdrop" aria-hidden="true"></div>

<div class="app">
  <!-- Sidebar: Session History -->
  <nav class="sidebar" id="sidebar" aria-label="Session history">
    <div class="sidebar-header">
      <span class="sidebar-title">会话历史</span>
      <button class="btn-icon" id="new-chat-btn" aria-label="新建会话" title="新建会话">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <div class="sessions-list" id="sessions-list" role="list" aria-label="会话列表">
      <div class="sessions-empty" id="sessions-empty" role="listitem">
        <span aria-hidden="true">💬</span>
        <span>暂无历史会话</span>
      </div>
    </div>
  </nav>

  <!-- Main content -->
  <main class="main" id="main-content">
    <!-- Header -->
    <header class="header" role="banner">
      <button class="btn-icon" id="sidebar-toggle" aria-label="切换侧边栏" aria-expanded="true" aria-controls="sidebar">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
      </button>
      <div class="header-logo" aria-hidden="true">✦</div>
      <span class="header-title">Claude Code</span>
      <div class="header-spacer"></div>
      <div class="status-indicator" role="status" aria-live="polite" aria-atomic="true">
        <div class="status-dot connecting" id="status-dot" aria-hidden="true"></div>
        <span id="status-text">正在连接…</span>
      </div>
    </header>

    <!-- Disconnected bar -->
    <div class="new-session-bar" id="disconnected-bar" role="alert" aria-live="assertive">
      <span>会话已断开。</span>
      <button class="btn btn-ghost btn-sm" id="reconnect-btn">重新连接</button>
    </div>

    <!-- Messages -->
    <div id="messages" role="log" aria-label="对话消息" aria-live="polite" aria-relevant="additions">
      <div class="empty-state" id="empty-state" aria-hidden="true">
        <span class="empty-icon" aria-hidden="true">✦</span>
        <span class="empty-title">开始对话</span>
        <span class="empty-sub">在下方输入消息，与 Claude Code 开始对话</span>
      </div>
    </div>

    <!-- Input -->
    <div class="input-area">
      <div class="input-row">
        <div class="input-wrapper">
          <textarea
            id="chat-input"
            name="message"
            rows="1"
            placeholder="输入消息… (Ctrl+Enter 发送)"
            autocomplete="off"
            spellcheck="false"
            aria-label="消息输入框"
            disabled
          ></textarea>
          <div class="input-hint" id="input-hint" aria-live="polite"></div>
        </div>
        <button class="btn btn-danger" id="interrupt-btn" style="display:none" aria-label="停止当前请求">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
            <rect x="2" y="2" width="10" height="10" rx="1.5"/>
          </svg>
          停止
        </button>
        <button class="btn btn-primary" id="send-btn" disabled aria-label="发送消息">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M12 7H2M8 3l4 4-4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          发送
        </button>
      </div>
    </div>
  </main>
</div>

<!-- Permission dialog -->
<div class="perm-overlay" id="perm-overlay" style="display:none" role="dialog" aria-modal="true" aria-labelledby="perm-title">
  <div class="perm-dialog">
    <h2 class="perm-title" id="perm-title">🔐 权限请求</h2>
    <p class="perm-desc">Claude 请求使用以下工具：</p>
    <div class="perm-tool" id="perm-tool-info" aria-label="工具详情"></div>
    <div class="perm-actions">
      <button class="btn btn-ghost btn-sm" id="perm-deny">拒绝</button>
      <button class="btn btn-primary btn-sm" id="perm-allow">允许</button>
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
  const inputEl         = document.getElementById('chat-input');
  const sendBtn         = document.getElementById('send-btn');
  const interruptBtn    = document.getElementById('interrupt-btn');
  const statusDot       = document.getElementById('status-dot');
  const statusText      = document.getElementById('status-text');
  const emptyState      = document.getElementById('empty-state');
  const permOverlay     = document.getElementById('perm-overlay');
  const permToolInfo    = document.getElementById('perm-tool-info');
  const permAllow       = document.getElementById('perm-allow');
  const permDeny        = document.getElementById('perm-deny');
  const inputHint       = document.getElementById('input-hint');
  const sessionsList    = document.getElementById('sessions-list');
  const sessionsEmpty   = document.getElementById('sessions-empty');
  const newChatBtn      = document.getElementById('new-chat-btn');
  const sidebar         = document.getElementById('sidebar');
  const sidebarToggle   = document.getElementById('sidebar-toggle');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const disconnectedBar = document.getElementById('disconnected-bar');
  const reconnectBtn    = document.getElementById('reconnect-btn');

  // ── State ─────────────────────────────────────────────────────────────────
  let ws                 = null;
  let sessionId          = null;
  let wsUrl              = null;
  let isRunning          = false;
  let pendingPermReqId   = null;
  let currentAssistantEl = null;
  let thinkingEl         = null;
  let sidebarOpen        = true;
  let sessions           = [];

  // ── Utilities ─────────────────────────────────────────────────────────────
  function authHeaders() {
    return AUTH_TOKEN ? { 'Authorization': 'Bearer ' + AUTH_TOKEN } : {};
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function relativeTime(ms) {
    if (!ms) return '';
    const diff = Date.now() - ms;
    const sec  = Math.floor(diff / 1000);
    if (sec < 60)   return '刚刚';
    const min = Math.floor(sec / 60);
    if (min < 60)   return min + ' 分钟前';
    const hr  = Math.floor(min / 60);
    if (hr < 24)    return hr + ' 小时前';
    const day = Math.floor(hr / 24);
    return day + ' 天前';
  }

  // ── Status ────────────────────────────────────────────────────────────────
  function setStatus(state, text) {
    statusDot.className = 'status-dot ' + state;
    statusText.textContent = text;
  }

  // ── Running state ─────────────────────────────────────────────────────────
  function setRunning(running) {
    isRunning = running;
    const wsReady = ws && ws.readyState === WebSocket.OPEN;
    sendBtn.disabled = running || !wsReady;
    interruptBtn.style.display = running ? 'inline-flex' : 'none';
    inputEl.disabled = running;
    if (!running) { inputEl.focus(); }
    removeThinking();
    if (running) showThinking();
  }

  // ── Scroll ────────────────────────────────────────────────────────────────
  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ── Markdown-lite renderer ────────────────────────────────────────────────
  function renderText(raw) {
    let text = raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Fenced code blocks
    text = text.replace(/\`\`\`([\\w+-]*)\\n([\\s\\S]*?)\`\`\`/g, (_, lang, code) =>
      '<pre><code class="lang-' + (lang || 'text') + '">' + code + '</code></pre>',
    );

    // Inline code
    text = text.replace(/\`([^\`\\n]+)\`/g, '<code>$1</code>');

    // Bold
    text = text.replace(/\\*\\*([^*\\n]+)\\*\\*/g, '<strong>$1</strong>');

    // Links
    text = text.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)]+)\\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    );

    return text;
  }

  // ── Message helpers ───────────────────────────────────────────────────────
  function hideEmpty() {
    if (emptyState) emptyState.setAttribute('aria-hidden', 'true');
    if (emptyState) emptyState.style.display = 'none';
  }

  function appendMsg(role, bodyHtml, label) {
    hideEmpty();
    const wrapper = document.createElement('div');
    wrapper.className = 'msg ' + role + ' anim';
    wrapper.setAttribute('role', 'listitem');

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

  function appendUserMessage(text)  { appendMsg('user', renderText(text), '你'); }
  function appendSystemMsg(text)    { appendMsg('system', escHtml(text)); }
  function appendInfoMsg(text)      { appendMsg('info', escHtml(text)); }
  function appendErrorMsg(text)     { appendMsg('error', escHtml(text), '错误'); }

  function startAssistantBubble() {
    hideEmpty();
    const wrapper = document.createElement('div');
    wrapper.className = 'msg assistant anim';
    wrapper.setAttribute('role', 'listitem');

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
    thinkingEl.className = 'thinking anim';
    thinkingEl.setAttribute('aria-label', 'Claude 正在思考');
    thinkingEl.innerHTML =
      '<span aria-hidden="true">Claude 正在思考…</span>' +
      '<div class="thinking-dots" aria-hidden="true"><span></span><span></span><span></span></div>';
    messagesEl.appendChild(thinkingEl);
    scrollToBottom();
  }

  function removeThinking() {
    if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; }
  }

  // ── Tool use blocks ───────────────────────────────────────────────────────
  const toolBlocksById = {};

  function appendToolUse(name, input) {
    hideEmpty();
    const toolEl = document.createElement('div');
    toolEl.className = 'tool-block anim';

    const inputStr = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
    const headId   = 'th-' + Math.random().toString(36).slice(2);
    const bodyId   = 'tb-' + Math.random().toString(36).slice(2);

    toolEl.innerHTML =
      '<button class="tool-header" aria-expanded="true" aria-controls="' + bodyId + '" id="' + headId + '">' +
        '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">' +
          '<path d="M2 6.5a4.5 4.5 0 1 0 9 0 4.5 4.5 0 0 0-9 0m4.5-1.5v3m0-3V4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
        '</svg>' +
        '<span class="tool-name">' + escHtml(name) + '</span>' +
        '<span class="tool-status" aria-live="polite">运行中…</span>' +
        '<span class="tool-toggle" aria-hidden="true">▼</span>' +
      '</button>' +
      '<div class="tool-body open" id="' + bodyId + '" role="region" aria-labelledby="' + headId + '">' +
        '<div class="tool-section-label">输入</div>' +
        '<div class="tool-input">' + escHtml(inputStr) + '</div>' +
      '</div>';

    const header = toolEl.querySelector('.tool-header');
    const body   = toolEl.querySelector('.tool-body');
    const toggle = toolEl.querySelector('.tool-toggle');
    header.addEventListener('click', () => {
      const open = body.classList.toggle('open');
      toggle.textContent = open ? '▼' : '▶';
      header.setAttribute('aria-expanded', String(open));
    });
    header.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); header.click(); }
    });

    messagesEl.appendChild(toolEl);
    scrollToBottom();
    return toolEl;
  }

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
        '<div class="tool-output' + (isError ? ' error' : '') + '">' + escHtml(resultStr) + '</div>';
      body.appendChild(outDiv);
      scrollToBottom();
    }
  }

  // ── Permission dialog ─────────────────────────────────────────────────────
  function showPermissionDialog(request, requestId) {
    pendingPermReqId = requestId;
    let info = request.tool_name || 'unknown';
    if (request.tool_input) {
      try { info += '\\n' + JSON.stringify(request.tool_input, null, 2); } catch { /**/ }
    }
    permToolInfo.textContent = info;
    permOverlay.style.display = 'flex';
    permAllow.focus();
  }

  function resolvePermission(behavior) {
    if (!pendingPermReqId || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: pendingPermReqId,
        response: {
          behavior,
          ...(behavior === 'deny' ? { message: '用户拒绝了此操作' } : {}),
        },
      },
    }));
    permOverlay.style.display = 'none';
    pendingPermReqId = null;
  }

  permAllow.addEventListener('click', () => resolvePermission('allow'));
  permDeny.addEventListener('click',  () => resolvePermission('deny'));
  permOverlay.addEventListener('keydown', e => {
    if (e.key === 'Escape') { resolvePermission('deny'); }
  });

  // ── Sessions sidebar ──────────────────────────────────────────────────────
  function formatSessionTitle(s) {
    if (s.customTitle) return s.customTitle;
    if (s.firstPrompt) return s.firstPrompt.slice(0, 50) + (s.firstPrompt.length > 50 ? '\u2026' : '');
    return '会话 ' + s.sessionId.slice(0, 8);
  }

  function renderSessionList() {
    // Remove old session items (keep sessionsEmpty)
    Array.from(sessionsList.querySelectorAll('.session-item')).forEach(el => el.remove());

    if (!sessions.length) {
      sessionsEmpty.style.display = '';
      return;
    }
    sessionsEmpty.style.display = 'none';

    for (const s of sessions) {
      const item = document.createElement('div');
      item.className = 'session-item' +
        (s.active ? '' : '') +
        (s.sessionId === sessionId ? ' selected' : '');
      item.setAttribute('role', 'listitem');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-label',
        formatSessionTitle(s) + (s.active ? ' (活跃)' : ' (已结束)'));

      const statusClass = s.status === 'running' ? 'running'
                        : s.status === 'detached' ? 'detached'
                        : 'persisted';
      const statusLabel = s.status === 'running' ? '运行中'
                        : s.status === 'detached' ? '空闲'
                        : '已结束';

      const time = s.lastActiveAt || s.lastModified
        ? relativeTime(s.lastActiveAt || s.lastModified)
        : '';

      item.innerHTML =
        '<div class="session-title">' + escHtml(formatSessionTitle(s)) + '</div>' +
        '<div class="session-meta">' +
          '<span class="session-badge ' + statusClass + '">' + statusLabel + '</span>' +
          (time ? '<span>' + escHtml(time) + '</span>' : '') +
        '</div>';

      item.addEventListener('click', () => selectSession(s));
      item.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSession(s); }
      });
      sessionsList.appendChild(item);
    }
  }

  async function loadSessions() {
    try {
      const resp = await fetch(BASE_URL + '/sessions?limit=50', {
        headers: authHeaders(),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      sessions = (data.sessions || []).sort((a, b) =>
        (b.lastActiveAt || b.lastModified || 0) - (a.lastActiveAt || a.lastModified || 0),
      );
      renderSessionList();
    } catch { /**/ }
  }

  function selectSession(s) {
    // Close mobile sidebar
    if (window.innerWidth <= 600) toggleSidebar(false);

    if (s.sessionId === sessionId) return;

    // Disconnect from current session
    if (ws) { ws.close(); ws = null; }

    // Clear messages
    clearMessages();

    if (s.active) {
      // Attach to active session
      sessionId = s.sessionId;
      wsUrl = '/sessions/' + s.sessionId + '/ws';
      connectWs();
    } else {
      // Load history for finished session
      sessionId = s.sessionId;
      wsUrl = null;
      loadSessionHistory(s.sessionId);
      setStatus('error', '已结束');
      sendBtn.disabled = true;
      inputEl.disabled = true;
    }
    renderSessionList();
  }

  async function loadSessionHistory(sid) {
    appendInfoMsg('正在加载会话历史…');
    try {
      const resp = await fetch(BASE_URL + '/sessions/' + encodeURIComponent(sid), {
        headers: authHeaders(),
      });
      if (!resp.ok) {
        appendErrorMsg('无法加载历史：HTTP ' + resp.status);
        return;
      }
      const data = await resp.json();
      const records = data.records || data.messages || [];
      let msgCount = 0;
      for (const rec of records) {
        if (rec.type === 'user') {
          const text = typeof rec.message?.content === 'string'
            ? rec.message.content
            : (rec.message?.content?.[0]?.text ?? '');
          if (text) { appendUserMessage(text); msgCount++; }
        } else if (rec.type === 'assistant') {
          const content = rec.message?.content ?? [];
          if (!Array.isArray(content)) continue;
          let textAccum = '';
          const flush = () => {
            if (!textAccum.trim()) return;
            if (!currentAssistantEl) currentAssistantEl = startAssistantBubble();
            currentAssistantEl.innerHTML = renderText(textAccum);
            msgCount++;
          };
          for (const block of content) {
            if (block.type === 'text') { textAccum += block.text; }
            else if (block.type === 'tool_use') {
              flush(); textAccum = ''; currentAssistantEl = null;
              appendToolUse(block.name, block.input);
            }
          }
          flush();
          currentAssistantEl = null;
        }
      }
      if (msgCount === 0) appendInfoMsg('该会话暂无消息记录');
      else appendInfoMsg('--- 历史会话（只读）---');
    } catch (e) {
      appendErrorMsg('加载历史失败: ' + e.message);
    }
  }

  function clearMessages() {
    messagesEl.innerHTML = '';
    if (emptyState) {
      emptyState.setAttribute('aria-hidden', 'true');
      emptyState.style.display = 'flex';
      messagesEl.appendChild(emptyState);
    }
    Object.keys(toolBlocksById).forEach(k => delete toolBlocksById[k]);
    currentAssistantEl = null;
    thinkingEl = null;
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────
  function connectWs() {
    if (!wsUrl) return;

    let url = WS_ORIGIN + wsUrl;
    if (AUTH_TOKEN) {
      url += (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(AUTH_TOKEN);
    }

    setStatus('connecting', '正在连接…');
    ws = new WebSocket(url);

    ws.onopen = () => {
      setStatus('connected', '已连接');
      sendBtn.disabled = false;
      inputEl.disabled = false;
      inputEl.focus();
      disconnectedBar.classList.remove('visible');
      appendInfoMsg('连接成功 — 开始对话吧');
      // Refresh session list to show updated status
      void loadSessions();
    };

    ws.onclose = () => {
      setStatus('error', '连接已断开');
      sendBtn.disabled = true;
      inputEl.disabled = true;
      setRunning(false);
      disconnectedBar.classList.add('visible');
      void loadSessions();
    };

    ws.onerror = () => {
      setStatus('error', '连接错误');
    };

    ws.onmessage = evt => {
      const raw = typeof evt.data === 'string' ? evt.data : '';
      for (const line of raw.split('\\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let msg;
        try { msg = JSON.parse(trimmed); } catch { continue; }
        handleServerMessage(msg);
      }
    };
  }

  // ── Server message handler ────────────────────────────────────────────────
  function handleServerMessage(msg) {
    const type = msg.type;

    if (type === 'system' || type === 'user') return;

    if (type === 'assistant') {
      removeThinking();
      const content = msg.message?.content ?? [];
      if (!Array.isArray(content)) return;

      let textAccum = '';
      const flush = () => {
        if (!textAccum.trim()) return;
        if (!currentAssistantEl) currentAssistantEl = startAssistantBubble();
        currentAssistantEl.innerHTML = renderText(textAccum);
        scrollToBottom();
      };

      for (const block of content) {
        if (block.type === 'text') {
          textAccum += block.text;
        } else if (block.type === 'tool_use') {
          flush(); textAccum = ''; currentAssistantEl = null;
          const el = appendToolUse(block.name, block.input);
          toolBlocksById[block.id] = el;
        }
      }
      flush();
      return;
    }

    if (type === 'result') {
      removeThinking();
      setRunning(false);
      currentAssistantEl = null;
      if (msg.is_error) {
        appendErrorMsg(msg.error || '请求执行出错');
      }
      return;
    }

    if (type === 'control_request') {
      const req = msg.request ?? {};
      if (req.subtype === 'can_use_tool') {
        showPermissionDialog(req, msg.request_id);
      } else if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'control_response',
          response: { subtype: 'error', request_id: msg.request_id, error: 'unsupported' },
        }));
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

    ws.send(JSON.stringify({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: sessionId ?? '',
    }));

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
    appendInfoMsg('已发送中断信号…');
  });

  // ── Create new session ────────────────────────────────────────────────────
  async function createSession() {
    if (ws) { ws.close(); ws = null; }
    clearMessages();
    sessionId = null;
    wsUrl = null;
    disconnectedBar.classList.remove('visible');

    setStatus('connecting', '正在创建会话…');
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
      await loadSessions();
      renderSessionList();
    } catch (err) {
      setStatus('error', '创建失败');
      appendErrorMsg('无法创建会话: ' + err.message);
    }
  }

  // ── Sidebar toggle ────────────────────────────────────────────────────────
  function toggleSidebar(forceOpen) {
    sidebarOpen = forceOpen !== undefined ? forceOpen : !sidebarOpen;
    sidebar.classList.toggle('collapsed', !sidebarOpen);
    sidebarToggle.setAttribute('aria-expanded', String(sidebarOpen));
    sidebarBackdrop.classList.toggle('visible', sidebarOpen && window.innerWidth <= 600);
  }

  sidebarToggle.addEventListener('click', () => toggleSidebar());
  sidebarBackdrop.addEventListener('click', () => toggleSidebar(false));

  newChatBtn.addEventListener('click', () => void createSession());
  reconnectBtn.addEventListener('click', () => void createSession());

  // ── Init ──────────────────────────────────────────────────────────────────
  void loadSessions();
  void createSession();

  // Periodically refresh session list
  setInterval(() => void loadSessions(), 30000);

})();
</script>
</body>
</html>`
}
