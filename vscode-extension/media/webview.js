// @ts-check
// Webview script — runs in the sandboxed VS Code webview context (no Node.js)

(function () {
  'use strict';

  /** @type {any} */
  const vscode = acquireVsCodeApi();

  // ─── DOM refs ────────────────────────────────────────────────────────────────
  const messagesEl = /** @type {HTMLElement} */ (document.getElementById('messages'));
  const inputEl = /** @type {HTMLTextAreaElement} */ (document.getElementById('prompt-input'));
  const sendBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-send'));
  const charCountEl = /** @type {HTMLElement} */ (document.getElementById('char-count'));
  const ctxBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-ctx'));
  const addFileCtxBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-add-file-context'));
  const activeFileLabel = /** @type {HTMLElement} */ (document.getElementById('active-file-label'));
  const contextUsageFill = /** @type {HTMLElement} */ (document.getElementById('context-usage-fill'));
  const contextUsageLabel = /** @type {HTMLElement} */ (document.getElementById('context-usage-label'));
  const statusDot = /** @type {HTMLElement} */ (document.getElementById('status-dot'));
  const statusLabel = /** @type {HTMLElement} */ (document.getElementById('status-label'));
  const confirmBanner = /** @type {HTMLElement} */ (document.getElementById('confirmation-banner'));
  const confirmTextEl = /** @type {HTMLElement} */ (document.getElementById('confirmation-text'));
  const confirmBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-confirm'));
  const cancelConfirmBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-cancel-confirm'));

  // ─── State ───────────────────────────────────────────────────────────────────
  let sendFileContext = true;
  let pendingConfirmation = /** @type {{ token: string; userId: string; sessionId: string } | null} */ (null);
  let isLoading = false;
  let activeFileContext = null;
  // Model selector state
  const storageSelectedModelKey = 'home-ai-agent-selected-model';
  let selectedModelId = localStorage.getItem(storageSelectedModelKey) ?? 'auto';
  let allOllamaModels = [];
  let allOpenRouterModels = [];
  const modelSelect = /** @type {HTMLSelectElement} */ (document.getElementById('model-select'));

  // ─── Init ────────────────────────────────────────────────────────────────────
  if (ctxBtn) ctxBtn.classList.add('active');
  vscode.postMessage({ type: 'ready' });

  if (addFileCtxBtn) {
    addFileCtxBtn.addEventListener('click', () => {
      // Request the extension to build the full active-file prompt (including contents)
      vscode.postMessage({ type: 'requestAddFileContext' });
    });
  }

  // ─── Input handlers ──────────────────────────────────────────────────────────
  inputEl.addEventListener('input', () => {
    charCountEl.textContent = String(inputEl.value.length);
  });

  inputEl.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  });

  sendBtn.addEventListener('click', handleSend);

  if (ctxBtn) {
    ctxBtn.addEventListener('click', () => {
      sendFileContext = !sendFileContext;
      ctxBtn.classList.toggle('active', sendFileContext);
      ctxBtn.title = sendFileContext
        ? 'Contexto do arquivo ativo: ativado'
        : 'Contexto do arquivo ativo: desativado';
    });
  }

  // ─── Confirmation ────────────────────────────────────────────────────────────
  confirmBtn.addEventListener('click', () => {
    if (!pendingConfirmation) return;
    const { token, userId, sessionId } = pendingConfirmation;
    pendingConfirmation = null;
    hideBanner();
    vscode.postMessage({ type: 'confirm', token, userId, sessionId });
  });

  cancelConfirmBtn.addEventListener('click', () => {
    pendingConfirmation = null;
    hideBanner();
    appendMessage('agent', 'Ação cancelada.', []);
  });

  // ─── Message from extension ──────────────────────────────────────────────────
  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'thinking':
        setLoading(true);
        appendThinking();
        break;

      case 'progress':
        appendProgressEvent(msg.stage, msg.message);
        break;

      case 'activeFileContext':
        activeFileContext = msg.payload ?? null;
        if (activeFileLabel) {
          activeFileLabel.textContent = activeFileContext?.label ?? 'Nenhum arquivo ativo';
        }
        if (addFileCtxBtn) {
          addFileCtxBtn.disabled = !activeFileContext || !activeFileContext.promptPrefix;
        }
        break;

      case 'response':
        setLoading(false);
        removeThinking();
        handleResponse(msg.result, msg.userId, msg.sessionId);
        // Update context usage UI from response if possible
        try {
          updateContextUsageFromResult(msg.result);
        } catch (e) {
          // ignore
        }
        break;

      case 'error':
        setLoading(false);
        removeThinking();
        appendError(msg.message);
        break;

      case 'cancelled':
        setLoading(false);
        removeThinking();
        appendMessage('agent', msg.message ?? 'Execução interrompida pelo usuário.', []);
        break;

      case 'prefill':
        inputEl.value = msg.text ?? '';
        charCountEl.textContent = String(inputEl.value.length);
        inputEl.focus();
        break;

      case 'insertFileContext': {
        const prefix = msg.promptPrefix;
        if (!prefix) return;
        if (!inputEl.value.startsWith(prefix)) {
          inputEl.value = `${prefix}\n\n${inputEl.value}`.trimStart();
          charCountEl.textContent = String(inputEl.value.length);
          inputEl.focus();
        }
        if (activeFileLabel && msg.label) activeFileLabel.textContent = msg.label;
        break;
      }

      case 'status':
        updateStatus(msg.connected);
        if (!msg.connected && msg.message) {
          statusLabel.textContent = `Erro: ${msg.message}`;
        }
        break;
        case 'models': {
          const payload = msg.payload || {};
          try {
            allOpenRouterModels = Array.isArray(payload.openrouter?.models) ? payload.openrouter.models : allOpenRouterModels;
            allOllamaModels = Array.isArray(payload.ollama?.models) ? payload.ollama.models : allOllamaModels;
            // refresh select options
            try { populateModelSelect(); } catch (e) { /* ignore */ }
          } catch (e) {
            // ignore
          }
          break;
        }
    }
  });

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function handleSend() {
    const text = inputEl.value.trim();
    if (!text || isLoading) return;

    appendMessage('user', text, []);
    inputEl.value = '';
    charCountEl.textContent = '0';
    hideBanner();

    vscode.postMessage({ type: 'execute', text, sendFileContext, modelId: selectedModelId });
  }

  // ── Model selector UI ─────────────────────────────────────────────────────
  function buildModelDisplayLabel(modelId) {
    if (!modelId || modelId === 'auto') return 'auto (OpenRouter)';
    if (modelId.startsWith('ollama:')) return `ollama: ${modelId.slice('ollama:'.length)}`;
    const found = allOpenRouterModels.find((m) => m.id === modelId);
    return found ? found.name ?? modelId : modelId;
  }

  function renderModelDropdown(filter) {
    const q = (filter ?? '').toLowerCase().trim();
    const matches = (text) => !q || (text && text.toLowerCase().includes(q));
    const openItems = allOpenRouterModels.filter((m) => matches(m.name) || matches(m.id));
    const ollamaItems = allOllamaModels.filter((m) => matches(m.name) || matches(m.id));
      // build a native <select> element (better UX in webview)
      if (openItems.length === 0 && ollamaItems.length === 0) {
        modelDropdownBody.innerHTML = '<p style="color:var(--vscode-editor-foreground)">Nenhum modelo encontrado.</p>';
        return;
      }

      const select = document.createElement('select');
      select.id = 'model-select';
      select.style.minWidth = '220px';
      select.style.maxWidth = '420px';
      select.style.padding = '6px';
      select.style.borderRadius = '6px';
      select.style.border = '1px solid var(--vscode-editorGroup-border)';

      // helper to add option
      const addOption = (value, label, selected) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        if (selected) opt.selected = true;
        select.appendChild(opt);
      };

      // auto option
      addOption('auto', 'auto (OpenRouter)', selectedModelId === 'auto');

      if (openItems.length > 0) {
        const og = document.createElement('optgroup');
        og.label = 'OpenRouter';
        for (const m of openItems) {
          const name = m.name ?? m.id;
          const ctx = typeof m.contextLength === 'number' ? ` (${Math.round(m.contextLength).toLocaleString()} ctx)` : '';
          const label = `${name}${ctx}`;
          const isSelected = selectedModelId === m.id;
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = label;
          if (isSelected) opt.selected = true;
          og.appendChild(opt);
        }
        select.appendChild(og);
      }

      if (ollamaItems.length > 0) {
        const og2 = document.createElement('optgroup');
        og2.label = 'Ollama (local)';
        for (const m of ollamaItems) {
          const name = m.name ?? m.id;
          const isSelected = selectedModelId === m.id;
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = name;
          if (isSelected) opt.selected = true;
          og2.appendChild(opt);
        }
        select.appendChild(og2);
      }

      // attach into the dedicated select container if present
      const selectContainer = document.getElementById('model-select') || select;
      if (selectContainer && selectContainer.tagName === 'SELECT') {
        // noop here — select was created and appended earlier
      } else if (modelDropdownBody) {
        modelDropdownBody.innerHTML = '';
        modelDropdownBody.appendChild(select);
      }

      select.focus();

      // when user picks a model
      select.addEventListener('change', () => {
        const id = select.value;
        selectedModelId = id;
        localStorage.setItem(storageSelectedModelKey, id);
      });
  }

  // Reworked: populate the single inline <select id="model-select"> in the HTML
  function populateModelSelect() {
    const select = /** @type {HTMLSelectElement|null} */ (document.getElementById('model-select'));
    if (!select) return;
    // clear
    select.innerHTML = '';

    // auto option
    const autoOpt = document.createElement('option');
    autoOpt.value = 'auto';
    autoOpt.textContent = 'auto (OpenRouter)';
    select.appendChild(autoOpt);

    if (allOpenRouterModels.length > 0) {
      const og = document.createElement('optgroup');
      og.label = 'OpenRouter';
      for (const m of allOpenRouterModels) {
        const opt = document.createElement('option');
        opt.value = m.id;
        const ctx = typeof m.contextLength === 'number' ? ` (${Math.round(m.contextLength).toLocaleString()} ctx)` : '';
        opt.textContent = `${m.name ?? m.id}${ctx}`;
        og.appendChild(opt);
      }
      select.appendChild(og);
    }

    if (allOllamaModels.length > 0) {
      const og2 = document.createElement('optgroup');
      og2.label = 'Ollama (local)';
      for (const m of allOllamaModels) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name ?? m.id;
        og2.appendChild(opt);
      }
      select.appendChild(og2);
    }

    try { select.value = selectedModelId; } catch (e) { /* ignore */ }
    select.onchange = () => {
      selectedModelId = select.value;
      localStorage.setItem(storageSelectedModelKey, selectedModelId);
    };
  }

  async function loadModels() {
    try {
      const [ollamaRes, openrouterRes] = await Promise.allSettled([
        fetch('/v1/models/ollama').then((r) => r.json()),
        fetch('/v1/models/openrouter').then((r) => r.json())
      ]);
      if (ollamaRes.status === 'fulfilled') allOllamaModels = Array.isArray(ollamaRes.value?.models) ? ollamaRes.value.models : [];
      if (openrouterRes.status === 'fulfilled') allOpenRouterModels = Array.isArray(openrouterRes.value?.models) ? openrouterRes.value.models : [];
      populateModelSelect();
    } catch (e) {
      // ignore
    }
  }

  loadModels();

  /** @param {{ summary: string; steps: string[]; status?: string; confirmationToken?: string; approvalDescription?: string; executionReport?: object }} result
   * @param {string} userId
   * @param {string} sessionId */
  function handleResponse(result, userId, sessionId) {
    if (result.status === 'pending_confirmation' && result.confirmationToken) {
      pendingConfirmation = { token: result.confirmationToken, userId, sessionId };
      showBanner(result.approvalDescription ?? 'Confirme a ação para continuar.');

      appendMessage('agent', result.summary, result.steps ?? []);
    } else if (result.status === 'rejected') {
      appendError(result.summary);
    } else {
      appendMessage('agent', result.summary, result.steps ?? [], result.executionReport);
    }
    scrollToBottom();
  }

  function updateContextUsageFromResult(result) {
    if (!result) return;

    // Try to extract OpenRouter interactions usage
    const exec = result.executionReport ?? result.execution_report ?? result.report ?? null;
    let interactions = null;
    if (exec) {
      interactions = exec?.openrouter?.interactions ?? exec?.open_router?.interactions ?? null;
    }

    let percent;
    if (Array.isArray(interactions) && interactions.length > 0) {
      // take the last interaction
      const last = interactions[interactions.length - 1];
      const usage = last?.usage ?? last?.metrics ?? null;
      if (usage) {
        if (typeof usage.contextUsedPercent === 'number') {
          percent = usage.contextUsedPercent;
        } else if (typeof usage.contextUsedTokens === 'number' && typeof usage.contextWindowTokens === 'number' && usage.contextWindowTokens > 0) {
          percent = (usage.contextUsedTokens / usage.contextWindowTokens) * 100;
        } else if (typeof usage.totalTokens === 'number' && typeof usage.contextWindowTokens === 'number' && usage.contextWindowTokens > 0) {
          percent = (usage.totalTokens / usage.contextWindowTokens) * 100;
        }
      }
    }

    // Fallback: check result.usage
    if (percent === undefined && result?.usage) {
      const u = result.usage;
      if (typeof u.contextUsedPercent === 'number') percent = u.contextUsedPercent;
      else if (typeof u.contextUsedTokens === 'number' && typeof u.contextWindowTokens === 'number' && u.contextWindowTokens > 0) {
        percent = (u.contextUsedTokens / u.contextWindowTokens) * 100;
      }
    }

    if (typeof percent === 'number' && contextUsageFill && contextUsageLabel) {
      const clamped = Math.max(0, Math.min(100, percent));
      contextUsageFill.style.width = `${clamped.toFixed(2)}%`;
      contextUsageLabel.textContent = `${clamped.toFixed(1)}%`;
    }
  }

  /** @param {unknown} report */
  function usedActiveFileHeuristic(report) {
    if (!report || typeof report !== 'object') {
      return false;
    }

    const reason = /** @type {any} */ (report)?.intent?.reason;
    if (typeof reason !== 'string') {
      return false;
    }

    return /heur[íi]stica local: solicitação refere-se ao arquivo ativo/i.test(reason);
  }

  /** @param {string} role @param {string} body @param {string[]} steps @param {object} [report] */
  function appendMessage(role, body, steps, report) {
    const wrap = document.createElement('div');
    wrap.className = `message ${role}`;

    const roleEl = document.createElement('div');
    roleEl.className = 'message-role';
    roleEl.textContent = role === 'user' ? 'Você' : role === 'error' ? 'Erro' : 'Agente';
    wrap.appendChild(roleEl);

    // Parse and render body (detect code blocks)
    renderBody(wrap, body);

    if (role === 'agent' && usedActiveFileHeuristic(report)) {
      const indicator = document.createElement('div');
      indicator.className = 'heuristic-indicator';
      indicator.textContent = 'Classificação: heurística de arquivo ativo aplicada';
      wrap.appendChild(indicator);
    }

    if (steps.length > 0) {
      const stepsEl = document.createElement('ul');
      stepsEl.className = 'message-steps';
      for (const step of steps) {
        const li = document.createElement('li');
        li.className = 'message-step';
        li.textContent = step;
        stepsEl.appendChild(li);
      }
      wrap.appendChild(stepsEl);
    }

    if (report && Object.keys(report).length > 0) {
      const details = document.createElement('details');
      details.className = 'report-details';

      const summary = document.createElement('summary');
      summary.textContent = 'Relatório técnico (JSON)';
      details.appendChild(summary);

      const reportStr = JSON.stringify(report, null, 2);
      const block = buildCodeBlock(reportStr, 'json');
      details.appendChild(block);
      wrap.appendChild(details);
    }

    messagesEl.appendChild(wrap);
    scrollToBottom();
  }

  /** @param {HTMLElement} container @param {string} text */
  function renderBody(container, text) {
    // Split by markdown code fences: ```lang\n...\n```
    const parts = text.split(/(```[\w]*\n[\s\S]*?```)/g);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'message-body';

    for (const part of parts) {
      const fenceMatch = part.match(/^```([\w]*)\n([\s\S]*?)```$/);
      if (fenceMatch) {
        const lang = fenceMatch[1] || 'text';
        const code = fenceMatch[2];
        bodyEl.appendChild(buildCodeBlock(code, lang));
      } else if (part.trim()) {
        const span = document.createElement('span');
        span.textContent = part;
        bodyEl.appendChild(span);
      }
    }

    container.appendChild(bodyEl);
  }

  /** @param {string} code @param {string} lang @returns {HTMLElement} */
  function buildCodeBlock(code, lang) {
    const wrap = document.createElement('div');
    wrap.className = 'code-block';

    const header = document.createElement('div');
    header.className = 'code-block-header';

    const langLabel = document.createElement('span');
    langLabel.className = 'code-block-lang';
    langLabel.textContent = lang;
    header.appendChild(langLabel);

    const actions = document.createElement('div');
    actions.className = 'code-block-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'code-action-btn';
    copyBtn.textContent = 'Copiar';
    copyBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'copyCode', code });
      copyBtn.textContent = '✓ Copiado';
      setTimeout(() => { copyBtn.textContent = 'Copiar'; }, 2000);
    });
    actions.appendChild(copyBtn);

    const insertBtn = document.createElement('button');
    insertBtn.className = 'code-action-btn primary';
    insertBtn.textContent = 'Inserir no editor';
    insertBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'insertCode', code, language: lang });
    });
    actions.appendChild(insertBtn);

    header.appendChild(actions);
    wrap.appendChild(header);

    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');
    codeEl.textContent = code;
    pre.appendChild(codeEl);
    wrap.appendChild(pre);

    return wrap;
  }

  function appendThinking() {
    const wrap = document.createElement('div');
    wrap.className = 'message agent';
    wrap.id = 'thinking-indicator';

    const roleEl = document.createElement('div');
    roleEl.className = 'message-role';
    roleEl.textContent = 'Agente';
    wrap.appendChild(roleEl);

    const body = document.createElement('div');
    body.className = 'message-body';

    const thinkingText = document.createElement('span');
    thinkingText.className = 'thinking-dots';
    thinkingText.textContent = 'Processando';
    body.appendChild(thinkingText);

    const progressWrap = document.createElement('div');
    progressWrap.id = 'progress-wrap';
    progressWrap.className = 'progress-bar-wrap';
    progressWrap.style.marginTop = '8px';
    body.appendChild(progressWrap);

    wrap.appendChild(body);
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }

  function removeThinking() {
    document.getElementById('thinking-indicator')?.remove();
  }

  /** @param {string} stage @param {string} message */
  function appendProgressEvent(stage, message) {
    const progressWrap = document.getElementById('progress-wrap');
    if (!progressWrap) return;

    const ev = document.createElement('div');
    ev.className = 'progress-event';

    const dot = document.createElement('span');
    dot.className = 'progress-dot';
    ev.appendChild(dot);

    const text = document.createElement('span');
    text.textContent = `[${stage}] ${message}`;
    ev.appendChild(text);

    progressWrap.appendChild(ev);
    scrollToBottom();
  }

  /** @param {string} message */
  function appendError(message) {
    appendMessage('error', message, []);
  }

  /** @param {string} description */
  function showBanner(description) {
    confirmTextEl.textContent = `⚠️ Ação de risco detectada: ${description}`;
    confirmBanner.classList.remove('hidden');
    scrollToBottom();
  }

  function hideBanner() {
    confirmBanner.classList.add('hidden');
    pendingConfirmation = null;
  }

  /** @param {boolean} loading */
  function setLoading(loading) {
    isLoading = loading;
    inputEl.disabled = loading;
    if (loading) {
      // switch to a cancel button
      sendBtn.disabled = false;
      sendBtn.textContent = 'Interromper Execução';
      sendBtn.classList.add('danger');
      sendBtn.style.background = 'var(--vscode-inputValidation-errorBackground)';
      sendBtn.style.color = 'var(--vscode-errorForeground)';
      // override click to cancel
      sendBtn.onclick = () => {
        vscode.postMessage({ type: 'cancel' });
      };
    } else {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Enviar';
      sendBtn.classList.remove('danger');
      sendBtn.style.background = '';
      sendBtn.style.color = '';
      sendBtn.onclick = handleSend;
    }
  }

  /** @param {boolean} connected */
  function updateStatus(connected) {
    if (connected) {
      statusDot.className = 'status-dot connected';
      statusLabel.textContent = 'Conectado';
    } else {
      statusDot.className = 'status-dot disconnected';
      statusLabel.textContent = 'Servidor offline';
    }
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
})();
