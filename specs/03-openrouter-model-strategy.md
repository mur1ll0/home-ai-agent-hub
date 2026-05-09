# Spec 03 - OpenRouter Model Strategy

## Objetivo

Escolher dinamicamente modelos gratuitos por categoria de tarefa, com fallback automático.

## Categorias de tarefa

1. Conversa geral
2. Raciocínio/planejamento
3. Código/automação
4. Extração/sumarização web
5. Geração de prompts multimodais

## Estratégia proposta

- Manter catálogo local de modelos com metadados:
  - id do modelo
  - modalidade suportada
  - janela de contexto
  - estabilidade observada
  - custo (esperado: gratuito)
- Atualizar catálogo periodicamente por endpoint de modelos da OpenRouter.

## Roteamento

1. Mapear intenção -> categoria
2. Filtrar modelos gratuitos aptos
3. Ordenar por disponibilidade/latência histórica
4. Executar chamada
5. Se falhar, fallback para próximo modelo

## Telemetria mínima

- modelo escolhido
- latência
- sucesso/falha
- motivo de fallback

## Riscos

- disponibilidade de modelos gratuitos varia ao longo do tempo
- diferenças de qualidade entre modelos por idioma/tarefa

## Mitigação

- fallback em cascata
- baseline de modelos estáveis por categoria
- testes periódicos de sanidade

## Limitação conhecida: janelas de contexto variáveis e impacto em análises de repositório

- Problema: provedores como OpenRouter podem resolver o `openrouter/auto` para um modelo com janela de contexto menor (por exemplo ~8k tokens). O agente atualmente calcula o orçamento de prompt com base em um valor configurado estático (`OPENROUTER_CONTEXT_WINDOW_TOKENS`), o que pode resultar em prompts maiores que a janela real do modelo resolvido e levar a truncamento de prompts/respostas ou falhas.

- Observação operacional: em execução real foi observado `google/gemini-2.5-flash-lite` com janela limitada (~8k tokens) enquanto o agente havia preparado ~66k tokens de contexto.

### Ações recomendadas (curto prazo)

1. Expor uma API assíncrona em gateways LLM para resolver e retornar o `contextWindowTokens` real do modelo final antes de montar prompts grandes. Ex.: `getModelInfoAsync()` / tornar `getModelInfo()` assíncrono.
2. Recalcular `charBudget` com o valor resolvido antes de carregar arquivos/specs no prompt.
3. Ao detectar que o `synthesis` retornado tem `contextWindowTokens` menor que o utilizado para calcular o prompt, retornar uma resposta de "partial analysis" com instruções de chunking automático (ou reexecutar em modo chunked).

### Ações recomendadas (médio prazo)

1. Garantir que `OpenRouterChatGateway` consulte o catálogo de modelos (`/api/v1/models`) e cacheie `context_length` por `model id` (já suportado parcialmente). Forçar refresh antes de decisões de orquestração que montam grandes prompts.
2. Registrar `resolvedModel` e `contextWindowTokens` em `executionReport` e telemetria para auditoria e tuning.
3. Implementar uma política conservadora de margem para contextos críticos (ex.: margin = 0.5) e usar um tokenizer estimador em vez de "4 chars/token" fixo.

### Estratégias de design para contornar limitações de contexto (boas práticas)

- Retrieval-Augmented Generation (RAG): indexar arquivos (embeddings) e incluir apenas trechos relevantes.
- Chunking + hierarchical summarization: dividir repositório em lotes, gerar resumos por lote, agregar resumos e enviar apenas o agregador.
- Progressive probing: pedir ao LLM um plano de quais arquivos são relevantes e só então ler os arquivos apontados.
- Model cascade: escolher modelos com janelas maiores para tarefas de "full project analysis" e modelos menores para respostas curtas; suportar override por configuração/env.
- Compression heuristics: extrair somente trechos relevantes (funções, cabeçalhos, TODOs) e remover comentários/espacos.

### Testes e validação

1. Teste automatizado que simula um catálogo com modelos de janelas distintas e valida que a ordem de seleção e o budget respeitam o `contextWindowTokens` resolvido.
2. Teste de integração que executa uma análise de projeto grande e valida que, quando o modelo tem janela pequena, o agente retorna análise parcial e sugere chunking.

### Observabilidade

- Incluir em logs/exec report: `configuredModel`, `resolvedModel`, `contextWindowTokens` (resolvido), `charBudgetUsed`, `filesSampledCount`.

