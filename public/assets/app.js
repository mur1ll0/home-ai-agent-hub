const form = document.querySelector('#agent-form');
const promptEl = document.querySelector('#prompt');
const submitBtn = document.querySelector('#submit-btn');
const responsePane = document.querySelector('#response-pane');
const reportPane = document.querySelector('#report-pane');
const tabs = document.querySelectorAll('.tab');
const toolsBtn = document.querySelector('#tools-btn');

let executionCounter = 0;
const storageUserKey = 'home-ai-agent-user-id';
const storageSessionKey = 'home-ai-agent-session-id';
const storageMcpServersKey = 'home-ai-agent-mcp-servers';
const storageSelectedModelKey = 'home-ai-agent-selected-model';
const inspectionByExecution = new Map();
const sessionModelsUsed = new Set();
let isExecutionRunning = false;
let activeExecutionController = null;

// ── Model selector state ──────────────────────────────────────
let selectedModelId = localStorage.getItem(storageSelectedModelKey) ?? 'auto';
let allOllamaModels = [];
let allOpenRouterModels = [];

const modelSelectorEl = document.querySelector('#model-selector');
const modelSelectorTrigger = document.querySelector('#model-selector-trigger');
const modelSelectorDisplay = document.querySelector('#model-selector-display');
const modelDropdown = document.querySelector('#model-selector-dropdown');
const modelDropdownBody = document.querySelector('#model-dropdown-body');
const modelSearchInput = document.querySelector('#model-search');
const modelTooltipEl = document.querySelector('#model-tooltip');

function formatContextLength(tokens) {
  if (!tokens || tokens <= 0) return '';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M ctx`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K ctx`;
  return `${tokens} ctx`;
}

function buildModelDisplayLabel(modelId) {
  if (!modelId || modelId === 'auto') return 'auto (OpenRouter)';
  if (modelId.startsWith('ollama:')) {
    return `ollama: ${modelId.slice('ollama:'.length)}`;
  }
  const found = allOpenRouterModels.find((m) => m.id === modelId);
  return found ? found.name : modelId;
}

function getModelDetails(modelId) {
  if (!modelId || modelId === 'auto') {
    return { name: 'auto (OpenRouter)', description: 'Escalonamento automático de modelos conforme a tarefa.' };
  }
  if (modelId.startsWith('ollama:')) {
    const id = modelId.slice('ollama:'.length);
    const found = allOllamaModels.find((m) => m.id === modelId);
    return { name: id, provider: 'Ollama (local)', details: found?.details };
  }
  return allOpenRouterModels.find((m) => m.id === modelId) ?? { name: modelId };
}

function showModelTooltip(details, anchorEl) {
  if (!modelTooltipEl || !details) return;
  const lines = [];
  if (details.name) lines.push(`<strong>${escapeHtml(details.name)}</strong>`);
  if (details.provider) lines.push(`Provider: ${escapeHtml(details.provider)}`);
  if (details.description) lines.push(escapeHtml(String(details.description).slice(0, 220)));
  if (details.contextLength) lines.push(`Contexto: ${escapeHtml(formatContextLength(details.contextLength))}`);
  if (details.architecture) lines.push(`Modalidade: ${escapeHtml(details.architecture)}`);
  if (details.pricing) {
    lines.push(`Preço: prompt ${escapeHtml(String(details.pricing.prompt))} / completion ${escapeHtml(String(details.pricing.completion))}`);
  }
  if (details.details && typeof details.details === 'object') {
    const d = details.details;
    if (d.parameter_size) lines.push(`Parâmetros: ${escapeHtml(String(d.parameter_size))}`);
    if (d.family) lines.push(`Família: ${escapeHtml(String(d.family))}`);
    if (d.quantization_level) lines.push(`Quantização: ${escapeHtml(String(d.quantization_level))}`);
  }

  modelTooltipEl.innerHTML = lines.join('<br>');
  modelTooltipEl.setAttribute('aria-hidden', 'false');

  const rect = anchorEl.getBoundingClientRect();
  const dropdownRect = modelDropdown.getBoundingClientRect();
  const ttWidth = 340;
  let left = rect.left;
  if (left + ttWidth > window.innerWidth - 8) {
    left = window.innerWidth - ttWidth - 8;
  }
  modelTooltipEl.style.left = `${left}px`;
  modelTooltipEl.style.top = `${dropdownRect.top - 8}px`;
  modelTooltipEl.style.transform = 'translateY(-100%)';
  modelTooltipEl.classList.add('visible');
}

function hideModelTooltip() {
  if (!modelTooltipEl) return;
  modelTooltipEl.classList.remove('visible');
  modelTooltipEl.setAttribute('aria-hidden', 'true');
}

function renderModelDropdown(filter) {
  const q = (filter ?? '').toLowerCase().trim();

  const matchesQuery = (text) => !q || text.toLowerCase().includes(q);

  const autoVisible = matchesQuery('auto openrouter');
  const ollamaItems = allOllamaModels.filter(
    (m) => matchesQuery(m.name) || matchesQuery(m.id)
  );
  const openrouterItems = allOpenRouterModels.filter(
    (m) => matchesQuery(m.name) || matchesQuery(m.id)
  );

  if (!autoVisible && ollamaItems.length === 0 && openrouterItems.length === 0) {
    modelDropdownBody.innerHTML = '<p class="model-empty">Nenhum modelo encontrado.</p>';
    return;
  }

  const parts = [];

  // OpenRouter section
  parts.push('<div class="model-section-label">OpenRouter</div>');

  if (autoVisible) {
    const isSelected = selectedModelId === 'auto';
    parts.push(`
      <button type="button" class="model-option" role="option" data-model-id="auto" aria-selected="${isSelected}">
        <span class="model-option-name">auto</span>
        <span class="model-option-badge">padrão</span>
      </button>
    `);
  }

  for (const m of openrouterItems) {
    const isSelected = selectedModelId === m.id;
    parts.push(`
      <button type="button" class="model-option" role="option" data-model-id="${escapeHtml(m.id)}" aria-selected="${isSelected}">
        <span class="model-option-name">${escapeHtml(m.name)}</span>
        <span class="model-option-ctx">${escapeHtml(formatContextLength(m.contextLength))}</span>
      </button>
    `);
  }

  // Ollama section
  if (ollamaItems.length > 0) {
    parts.push('<div class="model-section-label">Ollama (local)</div>');
    for (const m of ollamaItems) {
      const isSelected = selectedModelId === m.id;
      parts.push(`
        <button type="button" class="model-option" role="option" data-model-id="${escapeHtml(m.id)}" aria-selected="${isSelected}">
          <span class="model-option-name">${escapeHtml(m.name)}</span>
          <span class="model-option-badge ollama">local</span>
        </button>
      `);
    }
  }

  modelDropdownBody.innerHTML = parts.join('');

  // Attach tooltip and selection listeners
  modelDropdownBody.querySelectorAll('.model-option').forEach((btn) => {
    const modelId = btn.getAttribute('data-model-id');
    const details = getModelDetails(modelId);

    btn.addEventListener('mouseenter', () => showModelTooltip(details, btn));
    btn.addEventListener('mouseleave', hideModelTooltip);
    btn.addEventListener('focus', () => showModelTooltip(details, btn));
    btn.addEventListener('blur', hideModelTooltip);

    btn.addEventListener('click', () => {
      selectedModelId = modelId;
      localStorage.setItem(storageSelectedModelKey, modelId);
      modelSelectorDisplay.textContent = buildModelDisplayLabel(modelId);
      closeModelDropdown();
    });
  });
}

function openModelDropdown() {
  updateModelDropdownPosition();
  modelDropdown.hidden = false;
  modelSelectorEl.setAttribute('aria-expanded', 'true');
  modelSearchInput.value = '';
  renderModelDropdown('');
  modelSearchInput.focus();
}

function updateModelDropdownPosition() {
  const rect = modelSelectorTrigger.getBoundingClientRect();
  modelDropdown.style.top = `${rect.bottom + 6}px`;
  modelDropdown.style.left = `${rect.left}px`;
  modelDropdown.style.width = `${rect.width}px`;
}

function closeModelDropdown() {
  modelDropdown.hidden = true;
  modelSelectorEl.setAttribute('aria-expanded', 'false');
  hideModelTooltip();
  modelSelectorTrigger.focus();
}

function toggleModelDropdown() {
  if (modelDropdown.hidden) {
    openModelDropdown();
  } else {
    closeModelDropdown();
  }
}

modelSelectorTrigger?.addEventListener('click', toggleModelDropdown);

modelSearchInput?.addEventListener('input', () => {
  renderModelDropdown(modelSearchInput.value);
});

document.addEventListener('click', (e) => {
  if (modelSelectorEl && !modelSelectorEl.contains(e.target) && !modelDropdown.contains(e.target) && !modelDropdown.hidden) {
    closeModelDropdown();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modelDropdown.hidden) {
    closeModelDropdown();
  }
});

window.addEventListener('scroll', () => {
  if (!modelDropdown.hidden) {
    updateModelDropdownPosition();
    hideModelTooltip();
  }
}, true);

window.addEventListener('resize', () => {
  if (!modelDropdown.hidden) {
    updateModelDropdownPosition();
    hideModelTooltip();
  }
});

async function loadModels() {
  try {
    const [ollamaRes, openrouterRes] = await Promise.allSettled([
      fetch('/v1/models/ollama').then((r) => r.json()),
      fetch('/v1/models/openrouter').then((r) => r.json())
    ]);

    if (ollamaRes.status === 'fulfilled') {
      allOllamaModels = Array.isArray(ollamaRes.value?.models) ? ollamaRes.value.models : [];
    }
    if (openrouterRes.status === 'fulfilled') {
      allOpenRouterModels = Array.isArray(openrouterRes.value?.models) ? openrouterRes.value.models : [];
    }

    // Update display label in case models loaded late
    if (modelSelectorDisplay) {
      modelSelectorDisplay.textContent = buildModelDisplayLabel(selectedModelId);
    }
  } catch {
    // Silently fail; dropdown will show empty sections
  }
}

// Restore persisted label immediately if models not yet loaded
if (modelSelectorDisplay) {
  modelSelectorDisplay.textContent = buildModelDisplayLabel(selectedModelId);
}

loadModels();


function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function valueOrDash(value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  return escapeHtml(value);
}

function numberOrDash(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : '-';
}

function formatNumber(value, options = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }

  const formatter = new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
    minimumFractionDigits: options.minimumFractionDigits ?? 0
  });

  return formatter.format(value);
}

function clampPercent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

function normalizeModelLabel(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function registerModelInSession(value) {
  const label = normalizeModelLabel(value);
  if (!label) {
    return;
  }

  sessionModelsUsed.add(label);
}

function registerInteractionModelsInSession(interactions) {
  if (!Array.isArray(interactions)) {
    return;
  }

  interactions.forEach((item) => {
    registerModelInSession(item?.resolvedModel);
    registerModelInSession(item?.configuredModel);
  });
}

function listSessionModels() {
  return [...sessionModelsUsed.values()];
}

function buildContextBarHtml(usedTokens, windowTokens, fallbackPercent) {
  let percent =
    typeof usedTokens === 'number' && typeof windowTokens === 'number' && windowTokens > 0
      ? (usedTokens / windowTokens) * 100
      : fallbackPercent;
  percent = clampPercent(percent);

  return `
    <div class="context-progress" role="img" aria-label="Uso de contexto ${escapeHtml(formatNumber(percent))}%">
      <div class="context-progress-track">
        <div class="context-progress-fill" style="width: ${percent.toFixed(2)}%"></div>
      </div>
      <span class="context-progress-label">${escapeHtml(formatNumber(percent))}%</span>
    </div>
  `;
}

function renderSessionModelBadges(models) {
  if (!Array.isArray(models) || models.length === 0) {
    return '<p class="muted">Nenhum modelo utilizado nesta sessão ainda.</p>';
  }

  return `<div class="model-badge-list">${models
    .map((model) => `<span class="model-badge">${escapeHtml(model)}</span>`)
    .join('')}</div>`;
}

function renderOpenRouterInteractions(interactions) {
  if (!Array.isArray(interactions) || interactions.length === 0) {
    return '<p class="muted">Nenhuma interação OpenRouter nesta execução.</p>';
  }

  return interactions
    .map((item, index) => {
      const modelUsed = item?.resolvedModel ?? item?.configuredModel;
      const usage = item?.usage ?? {};
      const inputTokens = usage.inputTokens;
      const outputTokens = usage.outputTokens;
      const totalTokens = usage.totalTokens;
      const contextWindowTokens = usage.contextWindowTokens;
      const contextUsedTokens =
        typeof usage.contextUsedTokens === 'number'
          ? usage.contextUsedTokens
          : typeof totalTokens === 'number'
            ? totalTokens
            : undefined;
      const contextPercent =
        typeof usage.contextUsedPercent === 'number'
          ? usage.contextUsedPercent
          : typeof contextUsedTokens === 'number' &&
              typeof contextWindowTokens === 'number' &&
              contextWindowTokens > 0
            ? (contextUsedTokens / contextWindowTokens) * 100
            : undefined;

      registerModelInSession(modelUsed);
      registerModelInSession(item?.configuredModel);

      return `
        <article class="openrouter-interaction ${item?.error ? 'has-error' : ''}">
          <header class="openrouter-interaction-head">
            <h4>#${index + 1} ${escapeHtml(item?.operation ?? 'operação')}</h4>
            <span class="status-chip ${item?.error ? 'error' : 'ok'}">${item?.error ? 'erro' : 'ok'}</span>
          </header>

          <div class="openrouter-metrics-grid">
            <div><strong>Modelo usado</strong><span>${valueOrDash(modelUsed)}</span></div>
            <div><strong>Modelo configurado</strong><span>${valueOrDash(item?.configuredModel)}</span></div>
            <div><strong>Duração</strong><span>${numberOrDash(item?.durationMs)} ms</span></div>
            <div><strong>Input tokens</strong><span>${numberOrDash(inputTokens)}</span></div>
            <div><strong>Output tokens</strong><span>${numberOrDash(outputTokens)}</span></div>
            <div><strong>Total tokens</strong><span>${numberOrDash(totalTokens)}</span></div>
            <div><strong>Janela de contexto</strong><span>${numberOrDash(contextWindowTokens)}</span></div>
            <div><strong>Contexto usado</strong><span>${numberOrDash(contextUsedTokens)}</span></div>
          </div>

          ${buildContextBarHtml(contextUsedTokens, contextWindowTokens, contextPercent)}

          <details class="interaction-payload" open>
            <summary>Enviado e recebido</summary>
            <p><strong>Prompt enviado</strong> (${escapeHtml(String((item?.requestPrompt ?? '').length))} chars)</p>
            <pre class="raw-block">${escapeHtml(item?.requestPrompt ?? '')}</pre>
            <p><strong>Resposta recebida</strong> (${escapeHtml(String((item?.responseText ?? '').length))} chars)</p>
            <pre class="raw-block">${escapeHtml(item?.responseText ?? '')}</pre>
            ${item?.error ? `<p class="error-note"><strong>Erro:</strong> ${escapeHtml(item.error)}</p>` : ''}
          </details>
        </article>
      `;
    })
    .join('');
}

function renderMarkdown(value) {
  const content = String(value ?? '').trim();
  if (!content) {
    return '<p class="muted">Sem conteúdo final para exibir.</p>';
  }

  if (window.marked?.parse) {
    const rawHtml = window.marked.parse(content);
    if (window.DOMPurify?.sanitize) {
      return window.DOMPurify.sanitize(rawHtml);
    }

    return rawHtml;
  }

  return `<pre class="raw-block">${escapeHtml(content)}</pre>`;
}

function buildFinalMarkdown(payload) {
  const summary = String(payload?.summary ?? '').trim();
  const steps = Array.isArray(payload?.steps)
    ? payload.steps.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : [];

  if (!summary && steps.length === 0) {
    return '';
  }

  if (steps.length === 0) {
    return summary;
  }

  return `${summary}\n\n### Etapas\n${steps.map((step) => `- ${step}`).join('\n')}`;
}

function toIso(value) {
  if (!value) {
    return new Date().toISOString();
  }

  return value;
}

function getUserId() {
  const existing = localStorage.getItem(storageUserKey);
  if (existing) {
    return existing;
  }

  const userId = `web-user-${crypto.randomUUID().slice(0, 10)}`;
  localStorage.setItem(storageUserKey, userId);
  return userId;
}

function getSessionId() {
  const existing = sessionStorage.getItem(storageSessionKey);
  if (existing) {
    return existing;
  }

  const sessionId = `web-session-${Date.now()}`;
  sessionStorage.setItem(storageSessionKey, sessionId);
  return sessionId;
}

function getSavedMcpServers() {
  try {
    const raw = localStorage.getItem(storageMcpServersKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => ({
        serverName: String(item?.serverName ?? '').trim(),
        transport: item?.transport === 'stdio' ? 'stdio' : 'sse',
        endpoint: String(item?.endpoint ?? '').trim()
      }))
      .filter((item) => item.serverName && (item.transport !== 'sse' || item.endpoint));
  } catch {
    return [];
  }
}

function saveMcpServers(servers) {
  localStorage.setItem(storageMcpServersKey, JSON.stringify(servers));
}

function renderMcpServerRows(servers) {
  if (servers.length === 0) {
    return '<p class="muted">Nenhum servidor MCP salvo localmente.</p>';
  }

  return `
    <table class="table compact">
      <thead>
        <tr><th>Nome</th><th>Transporte</th><th>Endpoint</th><th>Ações</th></tr>
      </thead>
      <tbody>
        ${servers
          .map(
            (item, index) => `<tr>
              <td>${valueOrDash(item.serverName)}</td>
              <td>${valueOrDash(item.transport)}</td>
              <td>${valueOrDash(item.endpoint || '-')}</td>
              <td>
                <div class="inline-actions">
                  <button type="button" class="mini-btn" data-connect-index="${index}">Conectar</button>
                  <button type="button" class="mini-btn danger" data-remove-index="${index}">Remover</button>
                </div>
              </td>
            </tr>`
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderToolRows(tools) {
  if (!Array.isArray(tools) || tools.length === 0) {
    return '<p class="muted">Nenhuma tool registrada.</p>';
  }

  return `
    <table class="table compact">
      <thead>
        <tr><th>ID</th><th>Tool</th><th>Categoria</th><th>Status</th></tr>
      </thead>
      <tbody>
        ${tools
          .map(
            (item) => `<tr>
              <td>${valueOrDash(item.id)}</td>
              <td>${valueOrDash(item.tool)}</td>
              <td>${valueOrDash(item.category)}</td>
              <td>${valueOrDash(item.status)}</td>
            </tr>`
          )
          .join('')}
      </tbody>
    </table>
  `;
}

async function getToolsCatalog() {
  const response = await fetch('/v1/tools/catalog');
  if (!response.ok) {
    throw new Error('Falha ao carregar catálogo de tools');
  }

  return response.json();
}

async function connectMcpServer(server) {
  const response = await fetch('/v1/mcp/connect', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(server)
  });

  const payload = await response.json();
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message ?? payload?.error ?? 'Falha ao conectar MCP');
  }

  return payload?.message ?? 'Conectado com sucesso.';
}

async function openToolsModal() {
  if (typeof window.Swal === 'undefined') {
    window.alert('SweetAlert2 não disponível.');
    return;
  }

  const catalog = await getToolsCatalog();
  let servers = getSavedMcpServers();

  const repaint = async () => {
    const toolsHtml = renderToolRows(catalog.tools);
    const serversHtml = renderMcpServerRows(servers);
    const playwright = catalog.playwright ?? {};

    window.Swal.update({
      html: `
        <div class="settings-modal">
          <section>
            <h3>Tools disponíveis</h3>
            <p class="muted">Playwright: ${playwright.installed ? 'pronto' : 'instalação pendente'}.</p>
            <p class="muted">${valueOrDash(playwright.message)}</p>
            <p class="muted">Setup: ${valueOrDash(playwright.setupCommand)}</p>
            ${toolsHtml}
          </section>

          <section class="mcp-settings">
            <h3>Servidores MCP (persistência local)</h3>
            <div class="form-inline">
              <input id="mcp-name" placeholder="Nome do servidor" />
              <select id="mcp-transport">
                <option value="sse">sse</option>
                <option value="stdio">stdio</option>
              </select>
              <input id="mcp-endpoint" placeholder="http://localhost:3001/sse" />
              <button type="button" id="mcp-add" class="mini-btn">Adicionar</button>
            </div>
            <div id="mcp-servers-wrap">${serversHtml}</div>
          </section>
        </div>
      `
    });

    const addBtn = document.querySelector('#mcp-add');
    const nameEl = document.querySelector('#mcp-name');
    const transportEl = document.querySelector('#mcp-transport');
    const endpointEl = document.querySelector('#mcp-endpoint');
    const serversWrap = document.querySelector('#mcp-servers-wrap');

    addBtn?.addEventListener('click', () => {
      const serverName = nameEl?.value?.trim();
      const transport = transportEl?.value === 'stdio' ? 'stdio' : 'sse';
      const endpoint = endpointEl?.value?.trim();

      if (!serverName) {
        window.Swal.showValidationMessage('Informe o nome do servidor MCP.');
        return;
      }

      if (transport === 'sse' && !endpoint) {
        window.Swal.showValidationMessage('Informe o endpoint SSE para o servidor MCP.');
        return;
      }

      servers = [
        ...servers.filter((item) => item.serverName !== serverName),
        { serverName, transport, endpoint }
      ];
      saveMcpServers(servers);
      window.Swal.resetValidationMessage();
      repaint().catch(() => {
        window.Swal.showValidationMessage('Falha ao atualizar lista de servidores.');
      });
    });

    serversWrap?.querySelectorAll('[data-remove-index]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.getAttribute('data-remove-index'));
        servers = servers.filter((_, position) => position !== index);
        saveMcpServers(servers);
        repaint().catch(() => {
          window.Swal.showValidationMessage('Falha ao atualizar lista de servidores.');
        });
      });
    });

    serversWrap?.querySelectorAll('[data-connect-index]').forEach((button) => {
      button.addEventListener('click', async () => {
        const index = Number(button.getAttribute('data-connect-index'));
        const server = servers[index];
        if (!server) {
          return;
        }

        try {
          const message = await connectMcpServer(server);
          window.Swal.showValidationMessage(escapeHtml(message));
        } catch (error) {
          window.Swal.showValidationMessage(
            `Falha na conexão: ${escapeHtml(error instanceof Error ? error.message : String(error))}`
          );
        }
      });
    });
  };

  await window.Swal.fire({
    title: 'Configuração de Tools e MCP',
    width: 'min(980px, 95vw)',
    showConfirmButton: false,
    showCloseButton: true,
    html: '<div class="settings-modal"><p>Carregando...</p></div>',
    didOpen: () => {
      repaint().catch((error) => {
        window.Swal.showValidationMessage(
          `Falha ao montar modal: ${escapeHtml(error instanceof Error ? error.message : String(error))}`
        );
      });
    }
  });
}

function appendExecutionBlock(target, title, contentHtml) {
  if (target.querySelector('.muted')) {
    target.innerHTML = '';
  }

  const block = document.createElement('article');
  block.className = 'execution-block';
  block.innerHTML = `
    <header>
      <strong>${escapeHtml(title)}</strong>
    </header>
    ${contentHtml}
  `;
  target.prepend(block);

  return block;
}

function updateExecutionBlock(block, title, contentHtml) {
  block.innerHTML = `
    <header>
      <strong>${escapeHtml(title)}</strong>
    </header>
    ${contentHtml}
  `;
}

function setExecutionButtonState(running) {
  if (!submitBtn) {
    return;
  }

  isExecutionRunning = running;

  if (running) {
    submitBtn.textContent = 'Interromper execução...';
    submitBtn.type = 'button';
    submitBtn.classList.add('danger');
    toolsBtn?.setAttribute('disabled', 'true');
    return;
  }

  submitBtn.textContent = 'Executar';
  submitBtn.type = 'submit';
  submitBtn.classList.remove('danger');
  toolsBtn?.removeAttribute('disabled');
}

function isAbortError(error) {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

function renderProcessingList(processingLogs) {
  if (!Array.isArray(processingLogs) || processingLogs.length === 0) {
    return '<li>Sem eventos de processamento registrados.</li>';
  }

  return processingLogs
    .map((item) => {
      const modelLabel = item.resolvedModel ?? item.configuredModel;
      const tokenPill =
        typeof item.tokensTotal === 'number'
          ? ` <span class="token-pill">tokens: ${escapeHtml(String(item.tokensTotal))}</span>`
          : '';
      const contextPill =
        typeof item.contextUsedPercent === 'number' && typeof item.contextWindowTokens === 'number'
          ? ` <span class="token-pill">contexto: ${escapeHtml(String(item.contextUsedPercent.toFixed(2)))}% (${escapeHtml(String(item.contextUsedTokens ?? item.tokensTotal ?? '-'))}/${escapeHtml(String(item.contextWindowTokens))})</span>`
          : '';
      const modelPill = modelLabel
        ? ` <span class="token-pill model-pill">modelo: ${escapeHtml(modelLabel)}</span>`
        : '';

      return `<li><span class="process-time">${escapeHtml(item.time)}</span> ${escapeHtml(item.message)}${modelPill}${tokenPill}${contextPill}</li>`;
    })
    .join('');
}

function renderEditedFilesPanel(editedFiles) {
  if (!Array.isArray(editedFiles) || editedFiles.length === 0) {
    return '';
  }

  const pendingCount = editedFiles.filter((item) => item?.status === 'pending').length;

  return `
    <section class="edited-files-panel">
      <div class="edited-files-head">
        <h3>Arquivos editados</h3>
        <button type="button" class="mini-btn" data-edit-keep-all="true" ${pendingCount === 0 ? 'disabled' : ''}>Keep All</button>
      </div>
      <div class="edited-files-list">
        ${editedFiles
          .map((item) => {
            const status = item?.status ?? 'pending';
            const canDecide = status === 'pending';
            return `
              <article class="edited-file-item" data-edit-row="${escapeHtml(item.editId)}" data-edit-user="${escapeHtml(item.userId ?? '')}" data-edit-session="${escapeHtml(item.sessionId ?? '')}">
                <p class="edited-file-path">${valueOrDash(item.filePath)}</p>
                <p class="edited-file-meta">${item?.isNewFile ? 'novo arquivo' : 'backup salvo'} | status: <span data-edit-status>${escapeHtml(status)}</span></p>
                <div class="inline-actions">
                  <button type="button" class="mini-btn" data-edit-open="${escapeHtml(item.editId)}" data-edit-user="${escapeHtml(item.userId ?? '')}" data-edit-session="${escapeHtml(item.sessionId ?? '')}">Abrir</button>
                  <button type="button" class="mini-btn" data-edit-keep="${escapeHtml(item.editId)}" data-edit-user="${escapeHtml(item.userId ?? '')}" data-edit-session="${escapeHtml(item.sessionId ?? '')}" ${canDecide ? '' : 'disabled'}>Keep</button>
                  <button type="button" class="mini-btn danger" data-edit-reject="${escapeHtml(item.editId)}" data-edit-user="${escapeHtml(item.userId ?? '')}" data-edit-session="${escapeHtml(item.sessionId ?? '')}" ${canDecide ? '' : 'disabled'}>Reject</button>
                </div>
              </article>
            `;
          })
          .join('')}
      </div>
    </section>
  `;
}

function buildResponseBlockContent(payload, inputText, startedAt, finishedAt, processingLogs) {
  const status = payload.status ?? 'completed';
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  const report = payload.executionReport ?? {};
  const intent = report.intent ?? {};
  const intentReason = typeof intent.reason === 'string' ? intent.reason : '';
  const usedActiveFileHeuristic = /heur[íi]stica local: solicitação refere-se ao arquivo ativo/i.test(intentReason);
  const model = report.model ?? {};
  const latestTokenLog = [...processingLogs]
    .reverse()
    .find((item) => typeof item.tokensTotal === 'number');
  const liveTokens = typeof latestTokenLog?.tokensTotal === 'number' ? latestTokenLog.tokensTotal : undefined;
  const tokenDisplay = typeof model.totalTokens === 'number' ? model.totalTokens : liveTokens;
  const resolvedModel =
    report.resolvedModel ??
    [...processingLogs].reverse().find((item) => item.resolvedModel)?.resolvedModel ??
    model.model;
  const contextWindowTokens =
    typeof model.contextWindowTokens === 'number'
      ? model.contextWindowTokens
      : [...processingLogs].reverse().find((item) => typeof item.contextWindowTokens === 'number')
          ?.contextWindowTokens;
  const contextUsedTokens =
    typeof model.contextUsedTokens === 'number'
      ? model.contextUsedTokens
      : typeof model.estimatedContextUsedTokens === 'number'
        ? model.estimatedContextUsedTokens
        : [...processingLogs].reverse().find((item) => typeof item.contextUsedTokens === 'number')
            ?.contextUsedTokens;
  const contextUsedPercent =
    typeof model.contextUsedPercent === 'number'
      ? model.contextUsedPercent
      : typeof model.estimatedContextUsedPercent === 'number'
        ? model.estimatedContextUsedPercent
        : [...processingLogs].reverse().find((item) => typeof item.contextUsedPercent === 'number')
            ?.contextUsedPercent;
  registerModelInSession(resolvedModel);
  const sessionModels = listSessionModels();
  const isProcessing = status === 'processing';
  const finalMarkdown = buildFinalMarkdown(payload);
  const hasFinalResult = !isProcessing && finalMarkdown.trim().length > 0;
  const editedFilesHtml = !isProcessing ? renderEditedFilesPanel(payload.editedFiles) : '';
  const processingPanelAttrs = isProcessing ? ' open' : '';

  return `
    <p class="marker">INICIO: ${escapeHtml(startedAt)}</p>
    <p class="marker">FIM: ${escapeHtml(finishedAt)}</p>
    <p class="status ${escapeHtml(status)}">Status: ${escapeHtml(status)}</p>
    ${usedActiveFileHeuristic ? '<p class="marker"><strong>Classificação:</strong> heurística de arquivo ativo aplicada.</p>' : ''}
    <p><strong>Prompt:</strong> ${escapeHtml(inputText)}</p>
    <div class="quick-meta">
      <span><strong>Modelo:</strong> ${valueOrDash(resolvedModel)}</span>
      <span><strong>Modelos na sessão:</strong> ${valueOrDash(sessionModels.join(', '))}</span>
      <span><strong>Tokens acumulados:</strong> ${numberOrDash(tokenDisplay)}</span>
      <span><strong>Janela atual:</strong> ${numberOrDash(contextWindowTokens)} tokens</span>
      <span><strong>Uso de contexto:</strong> ${numberOrDash(contextUsedTokens)} tokens (${numberOrDash(contextUsedPercent)}%)</span>
    </div>
    <details class="processing-panel"${processingPanelAttrs}>
      <summary>Processando</summary>
      <ol class="processing-list">${renderProcessingList(processingLogs)}</ol>
    </details>
    ${
      hasFinalResult
        ? `<section class="final-answer"><h3>Resultado Final</h3><div class="markdown-body">${renderMarkdown(finalMarkdown)}</div></section>`
        : ''
    }
    ${editedFilesHtml}
    ${payload.approvalDescription ? `<p><strong>Aprovação necessária:</strong> ${escapeHtml(payload.approvalDescription)}</p>` : ''}
    ${
      !isProcessing && steps.length > 0
        ? `<details class="steps-panel"><summary>Etapas técnicas</summary><ol class="steps">${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol></details>`
        : ''
    }
  `;
}

function renderResponseBlock(payload, inputText, startedAt, finishedAt, processingLogs) {
  const contentHtml = buildResponseBlockContent(payload, inputText, startedAt, finishedAt, processingLogs);
  appendExecutionBlock(responsePane, `Execução #${executionCounter}`, contentHtml);
}

function renderReportBlock(executionReport, startedAt, finishedAt) {
  const safeReport = executionReport ?? {};
  const requestId = safeReport.requestId ? String(safeReport.requestId) : `exec-${executionCounter}`;
  const model = executionReport?.model ?? {};
  const runtime = executionReport?.runtime ?? {};
  const requestContext = executionReport?.requestContext ?? {};
  const intent = executionReport?.intent ?? {};
  const memory = executionReport?.memory ?? {};
  const tools = Array.isArray(executionReport?.tools) ? executionReport.tools : [];
  const stages = Array.isArray(executionReport?.stages) ? executionReport.stages : [];
  const notes = Array.isArray(executionReport?.notes) ? executionReport.notes : [];
  const llmInteractions = Array.isArray(executionReport?.llmInteractions)
    ? executionReport.llmInteractions
    : [];
  registerModelInSession(model.model);
  registerModelInSession(executionReport?.resolvedModel);
  registerInteractionModelsInSession(llmInteractions);
  const sessionModels = listSessionModels();
  const sessionTokens = llmInteractions.reduce(
    (acc, item) => {
      const usage = item?.usage ?? {};
      return {
        input: acc.input + (typeof usage.inputTokens === 'number' ? usage.inputTokens : 0),
        output: acc.output + (typeof usage.outputTokens === 'number' ? usage.outputTokens : 0),
        total: acc.total + (typeof usage.totalTokens === 'number' ? usage.totalTokens : 0)
      };
    },
    { input: 0, output: 0, total: 0 }
  );
  if (llmInteractions.length === 0) {
    sessionTokens.input = typeof model.inputTokens === 'number' ? model.inputTokens : 0;
    sessionTokens.output = typeof model.outputTokens === 'number' ? model.outputTokens : 0;
    sessionTokens.total = typeof model.totalTokens === 'number' ? model.totalTokens : sessionTokens.input + sessionTokens.output;
  }

  inspectionByExecution.set(requestId, {
    generatedAt: new Date().toISOString(),
    executionNumber: executionCounter,
    startedAt,
    finishedAt,
    executionReport: safeReport
  });

  const contentHtml = `
    <p class="marker">INICIO: ${escapeHtml(startedAt)}</p>
    <p class="marker">FIM: ${escapeHtml(finishedAt)}</p>
    <div class="report-grid">
      <article class="report-card">
        <h3>Modelo e contexto</h3>
        <ul>
          <li><strong>Provider:</strong> ${valueOrDash(model.provider)}</li>
          <li><strong>Modelo configurado:</strong> ${valueOrDash(model.model)}</li>
          <li><strong>Modelo resolvido:</strong> ${valueOrDash(executionReport?.resolvedModel)}</li>
          <li><strong>Janela máxima:</strong> ${numberOrDash(model.contextWindowTokens)} tokens</li>
          <li><strong>Contexto usado (real):</strong> ${numberOrDash(model.contextUsedTokens ?? model.estimatedContextUsedTokens)} tokens (${numberOrDash(model.contextUsedPercent ?? model.estimatedContextUsedPercent)}%)</li>
          <li><strong>Input tokens:</strong> ${numberOrDash(model.inputTokens)}</li>
          <li><strong>Output tokens:</strong> ${numberOrDash(model.outputTokens)}</li>
          <li><strong>Total tokens:</strong> ${numberOrDash(model.totalTokens)}</li>
        </ul>
      </article>

      <article class="report-card">
        <h3>Runtime e memória</h3>
        <ul>
          <li><strong>Request ID:</strong> ${valueOrDash(executionReport?.requestId)}</li>
          <li><strong>Duração total:</strong> ${numberOrDash(executionReport?.totalDurationMs)} ms</li>
          <li><strong>Prompt chars:</strong> ${numberOrDash(executionReport?.promptChars)}</li>
          <li><strong>RSS:</strong> ${numberOrDash(runtime.memoryRssMb)} MB</li>
          <li><strong>Heap usado:</strong> ${numberOrDash(runtime.memoryHeapUsedMb)} MB</li>
          <li><strong>Heap total:</strong> ${numberOrDash(runtime.memoryHeapTotalMb)} MB</li>
        </ul>
      </article>

      <article class="report-card">
        <h3>Contexto da requisição</h3>
        <ul>
          <li><strong>Workspace root:</strong> ${valueOrDash(requestContext.workspaceRoot)}</li>
          <li><strong>Arquivo ativo:</strong> ${valueOrDash(requestContext.activeFilePath)}</li>
          <li><strong>Ação classificada:</strong> ${valueOrDash(intent.action)}</li>
          <li><strong>Motivo da classificação:</strong> ${valueOrDash(intent.reason)}</li>
        </ul>
      </article>

      <article class="report-card span-full">
        <h3>Uso de memória Obsidian</h3>
        <ul>
          <li><strong>Backend:</strong> ${valueOrDash(memory.backend)}</li>
          <li><strong>Ativo:</strong> ${memory.enabled ? 'sim' : 'não'}</li>
          <li><strong>Leituras:</strong> ${numberOrDash(memory.reads?.length ?? 0)}</li>
          <li><strong>Gravações:</strong> ${numberOrDash(memory.writes?.length ?? 0)}</li>
        </ul>
        <table class="table">
          <thead>
            <tr><th>Operação</th><th>Chave</th><th>Prévia</th><th>Timestamp</th></tr>
          </thead>
          <tbody>
            ${
              [...(memory.reads ?? []), ...(memory.writes ?? [])].length === 0
                ? '<tr><td colspan="4">Nenhuma leitura/gravação de memória nesta execução.</td></tr>'
                : [...(memory.reads ?? []), ...(memory.writes ?? [])]
                    .map(
                      (item) => `<tr>
                        <td>${valueOrDash(item.type)}</td>
                        <td>${valueOrDash(item.key)}</td>
                        <td>${valueOrDash(item.valuePreview)}</td>
                        <td>${valueOrDash(item.timestamp)}</td>
                      </tr>`
                    )
                    .join('')
            }
          </tbody>
        </table>
      </article>

      <article class="report-card span-full">
        <h3>OpenRouter</h3>
        <div class="openrouter-overview">
          <div class="openrouter-summary-card">
            <strong>Modelos usados na sessão</strong>
            ${renderSessionModelBadges(sessionModels)}
          </div>
          <div class="openrouter-summary-card">
            <strong>Resumo desta execução</strong>
            <p>Interações: ${escapeHtml(String(llmInteractions.length))}</p>
            <p>Input tokens: ${escapeHtml(formatNumber(sessionTokens.input, { maximumFractionDigits: 0 }))}</p>
            <p>Output tokens: ${escapeHtml(formatNumber(sessionTokens.output, { maximumFractionDigits: 0 }))}</p>
            <p>Total tokens: ${escapeHtml(formatNumber(sessionTokens.total, { maximumFractionDigits: 0 }))}</p>
          </div>
        </div>
        <div class="openrouter-interactions-wrap">
          ${renderOpenRouterInteractions(llmInteractions)}
        </div>
      </article>

      <article class="report-card span-full">
        <h3>Ferramentas executadas</h3>
        <table class="table">
          <thead>
            <tr><th>Tool</th><th>Ação</th><th>Status</th><th>Duração</th><th>Detalhes</th></tr>
          </thead>
          <tbody>
            ${
              tools.length === 0
                ? '<tr><td colspan="5">Nenhuma tool executada.</td></tr>'
                : tools
                    .map(
                      (tool) =>
                        `<tr>
                          <td>${valueOrDash(tool.tool)}</td>
                          <td>${valueOrDash(tool.action)}</td>
                          <td>${valueOrDash(tool.status)}</td>
                          <td>${numberOrDash(tool.durationMs)} ms</td>
                          <td>${valueOrDash(tool.details)}</td>
                        </tr>`
                    )
                    .join('')
            }
          </tbody>
        </table>
      </article>

      <article class="report-card span-full">
        <h3>Linha do tempo</h3>
        <table class="table">
          <thead>
            <tr><th>Etapa</th><th>Status</th><th>Duração</th><th>Detalhes</th></tr>
          </thead>
          <tbody>
            ${
              stages.length === 0
                ? '<tr><td colspan="4">Sem etapas registradas.</td></tr>'
                : stages
                    .map(
                      (stage) =>
                        `<tr>
                          <td>${valueOrDash(stage.stage)}</td>
                          <td>${valueOrDash(stage.status)}</td>
                          <td>${numberOrDash(stage.durationMs)} ms</td>
                          <td>${valueOrDash(stage.details)}</td>
                        </tr>`
                    )
                    .join('')
            }
          </tbody>
        </table>
      </article>

      <article class="report-card span-full">
        <h3>Notas</h3>
        <ul>
          ${notes.length === 0 ? '<li>Sem notas.</li>' : notes.map((note) => `<li>${valueOrDash(note)}</li>`).join('')}
        </ul>
        <div class="inline-actions">
          <button type="button" class="mini-btn" data-export-inspection="${escapeHtml(requestId)}">
            Exportar inspeção
          </button>
        </div>
      </article>
    </div>
  `;

  appendExecutionBlock(reportPane, `Relatório #${executionCounter}`, contentHtml);
}

async function execute(text, options = {}) {
  const body = {
    text,
    userId: getUserId(),
    sessionId: getSessionId(),
    ...(options.clientRequestId ? { clientRequestId: options.clientRequestId } : {}),
    ...(selectedModelId && selectedModelId !== 'auto' ? { selectedModel: selectedModelId } : {})
  };

  const response = await fetch('/v1/agent/execute', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    ...(options.signal ? { signal: options.signal } : {}),
    body: JSON.stringify(body)
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error ?? 'request_failed');
  }

  return payload;
}

async function fetchProgress(requestId, cursor, options = {}) {
  const response = await fetch(
    `/v1/agent/progress/${encodeURIComponent(requestId)}?cursor=${cursor}`,
    {
      ...(options.signal ? { signal: options.signal } : {})
    }
  );

  if (!response.ok) {
    throw new Error('Falha ao carregar progresso da execução');
  }

  return response.json();
}

async function postEditedFileAction(endpoint, body) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.message ?? payload?.error ?? 'Falha ao aplicar ação de edição');
  }

  return payload;
}

function updateEditedRowStatus(editId, status) {
  const row = responsePane.querySelector(`[data-edit-row="${CSS.escape(editId)}"]`);
  if (!row) {
    return;
  }

  const statusEl = row.querySelector('[data-edit-status]');
  if (statusEl) {
    statusEl.textContent = status;
  }

  if (status !== 'pending') {
    row.querySelectorAll('[data-edit-keep], [data-edit-reject]').forEach((btn) => {
      btn.setAttribute('disabled', 'true');
    });
  }
}

function markAllEditedRowsKept() {
  responsePane.querySelectorAll('[data-edit-row]').forEach((row) => {
    const statusEl = row.querySelector('[data-edit-status]');
    if (statusEl) {
      statusEl.textContent = 'kept';
    }
    row.querySelectorAll('[data-edit-keep], [data-edit-reject]').forEach((btn) => {
      btn.setAttribute('disabled', 'true');
    });
  });
  responsePane.querySelectorAll('[data-edit-keep-all="true"]').forEach((btn) => {
    btn.setAttribute('disabled', 'true');
    btn.textContent = 'Keep All';
  });
}

async function askForConfirmationIfNeeded(payload, options = {}) {
  if (payload.status !== 'pending_confirmation' || !payload.confirmationToken) {
    return payload;
  }

  options.onLog?.('Aguardando decisão de confirmação do usuário.');

  if (options.signal?.aborted) {
    throw new DOMException('Execução interrompida pelo usuário.', 'AbortError');
  }

  const message = payload.approvalDescription ?? 'Ação sensível detectada.';
  let approved = false;

  if (typeof window.Swal !== 'undefined') {
    const result = await window.Swal.fire({
      icon: 'warning',
      title: 'Confirmação necessária',
      html: `<p>${escapeHtml(message)}</p><p>Deseja aprovar e continuar?</p>`,
      showCancelButton: true,
      confirmButtonText: 'Aprovar e executar',
      cancelButtonText: 'Cancelar'
    });
    approved = Boolean(result.isConfirmed);
  } else {
    approved = window.confirm(`${message}\n\nDeseja aprovar e executar?`);
  }

  if (!approved) {
    options.onLog?.('Confirmação negada pelo usuário.');
    return {
      ...payload,
      status: 'rejected',
      summary: 'Execução cancelada pelo usuário no modal de confirmação.',
      steps: ['A ação pendente não foi executada.']
    };
  }

  options.onLog?.('Confirmação aprovada. Executando ação pendente.');
  return execute(`confirmar ${payload.confirmationToken}`, { signal: options.signal });
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    tabs.forEach((item) => item.classList.remove('active'));
    tab.classList.add('active');

    if (target === 'response') {
      responsePane.classList.add('active');
      reportPane.classList.remove('active');
      return;
    }

    reportPane.classList.add('active');
    responsePane.classList.remove('active');
  });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (isExecutionRunning) {
    return;
  }

  const inputText = promptEl.value.trim();
  if (!inputText) {
    return;
  }

  const startedAt = new Date().toISOString();
  executionCounter += 1;
  const executionTitle = `Execução #${executionCounter}`;
  const initialPayload = {
    status: 'processing',
    summary: 'Processando solicitação...',
    steps: ['Aguardando resposta do agente...'],
    executionReport: null
  };
  const liveBlock = appendExecutionBlock(
    responsePane,
    executionTitle,
    buildResponseBlockContent(initialPayload, inputText, startedAt, '-', [])
  );

  const processingLogs = [];
  const logProcessing = (message, options = {}) => {
    processingLogs.push({
      time: new Date().toISOString(),
      message,
      ...(typeof options.tokensTotal === 'number' ? { tokensTotal: options.tokensTotal } : {}),
      ...(typeof options.inputTokens === 'number' ? { inputTokens: options.inputTokens } : {}),
      ...(typeof options.outputTokens === 'number' ? { outputTokens: options.outputTokens } : {}),
      ...(typeof options.contextWindowTokens === 'number'
        ? { contextWindowTokens: options.contextWindowTokens }
        : {}),
      ...(typeof options.contextUsedTokens === 'number' ? { contextUsedTokens: options.contextUsedTokens } : {}),
      ...(typeof options.contextUsedPercent === 'number' ? { contextUsedPercent: options.contextUsedPercent } : {}),
      ...(options.configuredModel ? { configuredModel: options.configuredModel } : {}),
      ...(options.resolvedModel ? { resolvedModel: options.resolvedModel } : {})
    });

    const livePayload = {
      status: 'processing',
      summary: 'Processando solicitação...',
      steps: ['Aguardando resposta do agente...'],
      executionReport: null
    };

    updateExecutionBlock(
      liveBlock,
      executionTitle,
      buildResponseBlockContent(livePayload, inputText, startedAt, '-', processingLogs)
    );
  };

  const executionController = new AbortController();
  activeExecutionController = executionController;
  setExecutionButtonState(true);
  const clientRequestId = `web-exec-${crypto.randomUUID()}`;
  let progressCursor = 0;
  let keepPollingProgress = true;

  const pollProgress = (async () => {
    while (keepPollingProgress && !executionController.signal.aborted) {
      try {
        const progressPayload = await fetchProgress(clientRequestId, progressCursor, {
          signal: executionController.signal
        });
        const events = Array.isArray(progressPayload.events) ? progressPayload.events : [];
        events.forEach((event) => {
          logProcessing(`[${event.stage ?? 'processando'}] ${event.message ?? ''}`, {
            ...(typeof event.tokensTotal === 'number' ? { tokensTotal: event.tokensTotal } : {}),
            ...(typeof event.inputTokens === 'number' ? { inputTokens: event.inputTokens } : {}),
            ...(typeof event.outputTokens === 'number' ? { outputTokens: event.outputTokens } : {}),
            ...(typeof event.contextWindowTokens === 'number'
              ? { contextWindowTokens: event.contextWindowTokens }
              : {}),
            ...(typeof event.contextUsedTokens === 'number'
              ? { contextUsedTokens: event.contextUsedTokens }
              : {}),
            ...(typeof event.contextUsedPercent === 'number'
              ? { contextUsedPercent: event.contextUsedPercent }
              : {}),
            ...(event.configuredModel ? { configuredModel: event.configuredModel } : {}),
            ...(event.resolvedModel ? { resolvedModel: event.resolvedModel } : {})
          });
        });

        if (Number.isFinite(progressPayload.cursor)) {
          progressCursor = Number(progressPayload.cursor);
        }

        if (progressPayload.done) {
          keepPollingProgress = false;
          break;
        }
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        logProcessing(
          `Falha ao consultar progresso: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  })();

  logProcessing('Solicitação preparada no cliente.');

  try {
    logProcessing('Enviando requisição para /v1/agent/execute.');
    const firstPayload = await execute(inputText, {
      signal: executionController.signal,
      clientRequestId
    });
    logProcessing(`Resposta inicial recebida. status=${firstPayload.status ?? 'completed'}`);

    if (Array.isArray(firstPayload.executionReport?.stages)) {
      firstPayload.executionReport.stages.forEach((stage) => {
        logProcessing(
          `Etapa: ${stage.stage} (${stage.status}) - ${numberOrDash(stage.durationMs)} ms`
        );
      });
    }

    const payload = await askForConfirmationIfNeeded(firstPayload, {
      signal: executionController.signal,
      onLog: logProcessing
    });

    if (payload.status === 'pending_confirmation') {
      logProcessing('Aguardando confirmação do usuário.');
    }

    if (payload.status === 'completed') {
      logProcessing('Execução finalizada com sucesso.');
    }

    if (payload.status === 'rejected') {
      logProcessing('Execução finalizada com rejeição/cancelamento.');
    }

    const llmInteractions = Array.isArray(payload.executionReport?.llmInteractions)
      ? payload.executionReport.llmInteractions
      : [];

    const tools = Array.isArray(payload.executionReport?.tools)
      ? payload.executionReport.tools
      : [];
    tools.forEach((tool, index) => {
      logProcessing(
        `Tool #${index + 1} chamada: ${tool.tool} (${tool.action})`
      );
      logProcessing(
        `Tool #${index + 1} retorno: status=${tool.status}, duração=${numberOrDash(tool.durationMs)} ms, detalhes=${tool.details ?? '-'}`
      );
    });

    llmInteractions.forEach((item, index) => {
      logProcessing(
        `OpenRouter #${index + 1}: ${item.operation} (${item.error ? 'erro' : 'ok'}) ${numberOrDash(item.durationMs)} ms`
      );
    });

    const finishedAt = toIso(payload.executionReport?.finishedAt);
    keepPollingProgress = false;
    await pollProgress;
    updateExecutionBlock(
      liveBlock,
      executionTitle,
      buildResponseBlockContent(payload, inputText, startedAt, finishedAt, processingLogs)
    );
    renderReportBlock(payload.executionReport, startedAt, finishedAt);
  } catch (error) {
    const finishedAt = new Date().toISOString();
    keepPollingProgress = false;
    await pollProgress;
    const interrupted = isAbortError(error);
    logProcessing(
      interrupted
        ? 'Execução interrompida manualmente pelo usuário.'
        : `Falha na execução: ${error instanceof Error ? error.message : String(error)}`
    );
    const payload = {
      status: 'rejected',
      summary: interrupted
        ? 'Execução interrompida pelo usuário.'
        : `Falha: ${error instanceof Error ? error.message : String(error)}`,
      steps: interrupted ? ['A requisição HTTP foi cancelada localmente.'] : [],
      executionReport: null
    };
    updateExecutionBlock(
      liveBlock,
      executionTitle,
      buildResponseBlockContent(payload, inputText, startedAt, finishedAt, processingLogs)
    );
    renderReportBlock(payload.executionReport, startedAt, finishedAt);
  } finally {
    activeExecutionController = null;
    setExecutionButtonState(false);
  }

  form.reset();
});

submitBtn?.addEventListener('click', () => {
  if (!isExecutionRunning || !activeExecutionController) {
    return;
  }

  activeExecutionController.abort();
});

toolsBtn?.addEventListener('click', async () => {
  try {
    await openToolsModal();
  } catch (error) {
    if (typeof window.Swal !== 'undefined') {
      window.Swal.fire({
        icon: 'error',
        title: 'Falha ao abrir configurações',
        text: error instanceof Error ? error.message : String(error)
      });
    }
  }
});

responsePane.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const editIdOpen = target.getAttribute('data-edit-open');
  if (editIdOpen) {
    const actorUserId = target.getAttribute('data-edit-user') || getUserId();
    const actorSessionId = target.getAttribute('data-edit-session') || getSessionId();
    try {
      await postEditedFileAction('/v1/file-edits/open', {
        editId: editIdOpen,
        userId: actorUserId,
        sessionId: actorSessionId
      });
    } catch (error) {
      if (typeof window.Swal !== 'undefined') {
        window.Swal.fire({
          icon: 'error',
          title: 'Falha ao abrir arquivo',
          text: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return;
  }

  const editIdKeep = target.getAttribute('data-edit-keep');
  if (editIdKeep) {
    const actorUserId = target.getAttribute('data-edit-user') || getUserId();
    const actorSessionId = target.getAttribute('data-edit-session') || getSessionId();
    try {
      const payload = await postEditedFileAction('/v1/file-edits/keep', {
        editId: editIdKeep,
        userId: actorUserId,
        sessionId: actorSessionId
      });
      updateEditedRowStatus(editIdKeep, payload?.editedFile?.status ?? 'kept');
    } catch (error) {
      if (typeof window.Swal !== 'undefined') {
        window.Swal.fire({
          icon: 'error',
          title: 'Falha ao manter edição',
          text: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return;
  }

  const editIdReject = target.getAttribute('data-edit-reject');
  if (editIdReject) {
    const actorUserId = target.getAttribute('data-edit-user') || getUserId();
    const actorSessionId = target.getAttribute('data-edit-session') || getSessionId();
    try {
      const payload = await postEditedFileAction('/v1/file-edits/reject', {
        editId: editIdReject,
        userId: actorUserId,
        sessionId: actorSessionId
      });
      updateEditedRowStatus(editIdReject, payload?.editedFile?.status ?? 'reverted');
    } catch (error) {
      if (typeof window.Swal !== 'undefined') {
        window.Swal.fire({
          icon: 'error',
          title: 'Falha ao reverter edição',
          text: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return;
  }

  const keepAll = target.getAttribute('data-edit-keep-all');
  if (keepAll === 'true') {
    const firstRow = responsePane.querySelector('[data-edit-row]');
    const actorUserId = firstRow?.getAttribute('data-edit-user') || getUserId();
    const actorSessionId = firstRow?.getAttribute('data-edit-session') || getSessionId();
    const previousText = target.textContent;
    target.setAttribute('disabled', 'true');
    target.textContent = 'Aplicando...';
    try {
      await postEditedFileAction('/v1/file-edits/keep-all', {
        userId: actorUserId,
        sessionId: actorSessionId
      });
      markAllEditedRowsKept();
    } catch (error) {
      target.removeAttribute('disabled');
      if (typeof previousText === 'string') {
        target.textContent = previousText;
      }
      if (typeof window.Swal !== 'undefined') {
        window.Swal.fire({
          icon: 'error',
          title: 'Falha ao aplicar Keep All',
          text: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
});

reportPane.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const exportId = target.getAttribute('data-export-inspection');
  if (!exportId) {
    return;
  }

  const payload = inspectionByExecution.get(exportId);
  if (!payload) {
    return;
  }

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `inspection-${exportId}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});
