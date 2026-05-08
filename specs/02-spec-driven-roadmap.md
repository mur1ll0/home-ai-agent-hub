# Spec 02 - Spec-Driven Roadmap

## Status consolidado (maio/2026)

## Fase 0 - Foundation (concluída)

- Base Node 24.15.0 + TypeScript
- Estrutura em camadas (core/application/infrastructure/interfaces)
- Caso de uso central de orquestração
- CLI + HTTP + UI web mínima

## Fase 1 - Segurança e execução confiável (concluída)

- Permissões por escopo de diretórios para ações de arquivo
- Confirmação explícita para ações destrutivas via token temporário
- Auditoria local em JSONL
- Testes unitários de segurança e confirmação

## Fase 2 - Decision Pipeline e observabilidade (parcialmente concluída)

Implementado:
- Classificação de intenção (regras + fallback por LLM)
- Detecção de idioma via LLM
- Pré-checagem de segurança por LLM com validação determinística local
- Relatório de execução com estágios, uso de modelo, tools e progresso

Lacunas:
- Falta camada explícita de instruções base (persona, política de resposta, critérios de tool-use)
- Falta registro/versionamento formal de skills e critérios de ativação
- Falta roteamento de modelo por classe de tarefa com catálogo dinâmico completo

## Fase 3 - Conteúdo Office e pesquisa web (parcialmente concluída)

Implementado:
- Geração de DOCX/PPTX/XLSX/CSV
- Pipeline de slides com pesquisa web, processamento de conteúdo e capacidade dinâmica
- Captura de mídia relevante para slides quando disponível

Lacunas:
- Biblioteca de templates e estilos reutilizáveis
- Métricas de qualidade de conteúdo (cobertura, precisão, repetição)

## Fase 4 - Web + MCP (parcialmente concluída)

Implementado:
- Extração e pesquisa web com Playwright
- Conector MCP base (SSE)

Lacunas:
- Discovery dinâmico de tools MCP
- Suporte completo a múltiplos transportes (incluindo stdio) com política de confiança

## Fase 5 - Mídia avançada (não iniciada para execução real)

Status atual:
- Imagem/vídeo/3D ainda em modo planejamento de prompt/pipeline

Próximo passo:
- Definir provedores reais com custo, SLA e fallback

## Próximas entregas prioritárias (ordem recomendada)

1. Camada de instruções base do agente
- Criar contrato explícito de comportamento: objetivo, tom, limites, formato de resposta, tool-use, confirmação
- Versionar instruções por contexto (geral, código, web, office, segurança)

2. Sistema de skills do runtime
- Definir skill registry interno com: nome, descrição, gatilhos, pré-condições, limites, pós-condições
- Rotear skill por intenção + confiança + risco

3. Roteamento de modelos por tarefa
- Separar modelos para: classificação, planejamento, síntese, resposta final
- Adicionar fallback por disponibilidade e telemetria por operação

4. Memória de longo prazo com política explícita
- Consolidar política de escrita/leitura (o que salvar, quando salvar, TTL semântico)
- Adicionar busca por contexto recente e resumo incremental

5. Avaliação de qualidade contínua
- Criar suíte de testes de comportamento do agente (golden prompts)
- Medir regressão em: segurança, utilidade, latência e custo

## Critérios de aceitação por fase

- Spec aprovada
- Testes automatizados mínimos
- Logs e erros acionáveis
- Documentação atualizada
- Evidência de execução local (comandos + resultado esperado)
