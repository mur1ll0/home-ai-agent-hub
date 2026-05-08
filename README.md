# Home AI Agent Hub

Agente pessoal de IA em Node.js 24.15.0, orientado por Clean Architecture, SOLID e Spec-Driven Development.

## Objetivo

Criar um agente customizado que executa tarefas do dia a dia com segurança, usando OpenRouter para selecionar modelos gratuitos ideais por tipo de tarefa.

## Capacidades planejadas

- Operações de arquivos: ler, escrever, mover, substituir e excluir.
- Navegação de diretórios locais.
- Navegação web e extração de conteúdo com Playwright.
- Geração de documentos Office e LibreOffice:
  - Word (`.docx`)
  - Apresentações (`.pptx`)
  - Planilhas (`.csv`, `.xlsx`)
- Conexão com servidores MCP para ampliar ferramentas.
- Geração de imagem, vídeo simples e pipeline para 3D/textura/animação.

## Stack base

- Node.js 24.15.0
- TypeScript
- LangChain
- OpenRouter (via API compatível OpenAI)
- Playwright
- docx, pptxgenjs, exceljs
- MCP SDK

## Começando

1. Instale dependências:

```bash
npm install
```

2. Configure ambiente:

```bash
cp .env.example .env
```

3. Inicie em modo desenvolvimento:

```bash
npm run dev
```

4. Abra a interface web:

```text
http://localhost:3000
```

## Modos de execução

- `APP_MODE=http`: inicia API HTTP + UI web.
- `APP_MODE=cli`: inicia somente CLI.
- `APP_MODE=both`: inicia HTTP e depois CLI.

## API

- `POST /v1/agent/execute`
- Request JSON:

```json
{
  "text": "excluir './workspace/arquivo.txt'",
  "userId": "web-user",
  "sessionId": "web-session"
}
```

- Para ações destrutivas, a API retorna `status: pending_confirmation` com `confirmationToken`.
- Para confirmar, envie novo request com `text: "confirmar <token>"`.

## LangChain no fluxo

O pipeline de decisão usa LangChain em cinco estágios:

1. classificação de intenção
2. detecção de idioma
3. precheck de segurança por LLM + validações determinísticas locais
4. seleção de ferramenta (derivada da intenção)
5. execução + resumo de resposta

## Como testar o LangChain

1. Garanta que o `.env` contém `OPENROUTER_API_KEY` válido.
2. Rode o smoke test da chain:

```bash
npm run test:langchain
```

3. Resultado esperado:
- saída textual com JSON retornado pela chain
- ausência de erro `[test:langchain] failed`

## LangGraph Studio (árvore de decisões + chat/debug)

A ferramenta que você descreveu (grafo visual com painel de chat para depurar) é o **LangGraph Studio**.

1. Inicie seu app HTTP:

```bash
npm run dev
```

2. Em outro terminal, inicie o Studio local vinculado ao projeto:

```bash
npm run dev:langgraph
```

3. Abra:

```text
http://localhost:2025
```

4. A UI web principal do projeto agora possui um link direto para o Studio local.

Arquivos de configuração adicionados para isso:

- `langgraph.json`
- `src/langgraph/agent/graph.ts`
- `src/langgraph/agent/state.ts`

## Estrutura

- `src/core`: regras de domínio, casos de uso e portas.
- `src/application`: serviços de aplicação.
- `src/infrastructure`: adaptadores externos (OpenRouter, arquivos, web, office, mídia, MCP).
- `src/interfaces`: interface CLI.
- `specs`: especificações e roadmap orientado a entregas.

## Status atual

Base do projeto criada com esqueleto funcional, safeguards de confirmação para ações destrutivas, política granular por dire
tório e auditoria JSONL.

O projeto também já está preparado para o passo 2 com contrato HTTP em `src/interfaces/contracts/agent-http.contract.ts` e spec de implementação em `specs/08-step2-api-ui-readiness.md`.


## Extensão para VSCode

Para instalar a extensão use:
```text
code --install-extension "f:\Node Projects\home-ai-agent-hub\vscode-extension\home-ai-agent-0.1.0.vsix" --force
```

Depois comando de recarregar janela:
```text
code --reuse-window "f:\Node Projects\home-ai-agent-hub"
```

