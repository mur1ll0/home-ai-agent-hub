# Spec 10 - Agent Behavior, Instruction Stack and Skills

## Objetivo

Definir um comportamento de agente moderno, previsível e útil, inspirado nas práticas observadas em Claude, Copilot e Cursor, sem quebrar os princípios de segurança e arquitetura do projeto.

## Problema atual

O agente já executa ações e usa ferramentas, porém ainda carece de:

- uma camada central de instruções base (com prioridade e versionamento)
- um sistema explícito de skills no runtime
- critérios de ativação de ferramentas por contexto e risco

Isso gera respostas inconsistentes e menor autonomia prática em tarefas compostas.

## Referências externas analisadas (internet)

1. Anthropic Docs (Prompting e Tool Use)
- https://platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering/system-prompts
- https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/overview

Pontos aplicáveis:
- instruções claras e explícitas melhoram consistência
- agentes precisam de política explícita de quando agir vs quando perguntar
- uso paralelo de ferramentas deve ser deliberado, não aleatório
- decisões destrutivas devem exigir confirmação humana

2. GitHub Copilot Docs (custom instructions)
- https://docs.github.com/en/copilot/concepts/prompting/response-customization
- https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot

Pontos aplicáveis:
- hierarquia de instruções (pessoal, repositório, organização)
- instruções curtas, reutilizáveis e amplamente aplicáveis
- instruções por escopo de arquivo/tarefa reduzem ambiguidades

3. Cursor Docs (Rules)
- https://cursor.com/docs/rules

Pontos aplicáveis:
- regras pequenas e componíveis
- aplicação por globs/escopo e por relevância
- evitar regras gigantes e ambíguas

4. LangGraph Overview
- https://docs.langchain.com/oss/javascript/langgraph/overview

Pontos aplicáveis:
- foco em orquestração stateful
- human-in-the-loop e memória como recursos de primeira classe
- observabilidade e depuração no ciclo de execução

## Contrato de comportamento do agente

## Princípios

1. Utilidade pragmática
- agir para concluir tarefas, não apenas sugerir próximos passos.

2. Segurança por padrão
- bloquear ou pedir confirmação em operações de alto risco.

3. Transparência operacional
- reportar progresso, ferramenta usada e resultado.

4. Persistência orientada a resultado
- manter foco até concluir ou encontrar bloqueio real.

5. Escopo mínimo necessário
- evitar mudanças extras e overengineering.

## Modos de atuação

1. Modo Assistente
- objetivo: explicar, orientar e responder perguntas.
- padrão: sem alterar estado externo.

2. Modo Executor
- objetivo: executar ação concreta em ferramentas/sistema.
- padrão: confirmar antes de operações destrutivas.

3. Modo Pesquisador
- objetivo: coletar, comparar e sintetizar fontes.
- padrão: incluir evidências e confiabilidade básica.

## Instruction stack proposta

Ordem de prioridade (maior para menor):

1. Segurança e consentimento
- políticas de risco e confirmação obrigatória.

2. Restrições arquiteturais
- clean architecture, portas/adaptadores, sem acoplamento indevido.

3. Instruções de produto
- idioma, tom, formato de resposta, experiência esperada.

4. Instruções por skill
- regras específicas da capacidade selecionada.

5. Preferências contextuais do usuário
- estilo, nível de detalhe e convenções locais.

## Skills do runtime (MVP)

Cada skill deve declarar:

- id
- descrição
- gatilhos (intenção, palavras-chave, contexto)
- ferramentas permitidas
- pré-condições
- pós-condições
- risco
- contrato de saída

Skills iniciais recomendadas:

1. skill.file-operations
- foco: leitura/escrita/movimentação/listagem segura.

2. skill.web-research
- foco: pesquisa web com síntese e evidências.

3. skill.office-generation
- foco: geração de docs/slides/planilhas com estrutura.

4. skill.mcp-connectivity
- foco: conexão e execução em tools remotas confiáveis.

5. skill.memory-management
- foco: persistência e recuperação contextual (Obsidian no MVP).

## Regras de ativação de skill

1. Seleção inicial por intenção classificada.
2. Revalidação por risco de segurança.
3. Replanejamento se falha de tool ou baixa confiança.
4. Fallback para modo assistente quando nenhuma skill for segura o suficiente.

## Critérios de qualidade

Para cada execução registrar:

- skill escolhida
- motivo da escolha
- tool calls executadas
- falhas e fallback
- latência e tokens
- status final

## Critérios de aceitação

1. Toda resposta deve indicar contexto operacional claro (assistente/executor/pesquisador).
2. Ações destrutivas nunca executam sem confirmação explícita.
3. Pelo menos uma skill é selecionada em tarefas não triviais.
4. Execution report inclui skill + instruções aplicadas.
5. Testes de regressão cobrem cenários com e sem fallback.

## Plano incremental de implementação

1. Criar módulo de instruction composer.
2. Criar skill registry estático e roteador.
3. Integrar skill selection ao fluxo de classificação.
4. Persistir metadados de skill no execution report.
5. Cobrir com testes de comportamento (golden prompts).
