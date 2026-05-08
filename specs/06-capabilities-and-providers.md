# Spec 06 - Capabilities and Providers

## Estado por capability

1. Arquivos locais
- Status: implementado com permissões granulares por ação e confirmação explícita
- Próximo: políticas por perfil de usuário e trilha de aprovação por risco

2. Navegação web
- Status: pesquisa + extração implementadas com ranking técnico básico
- Próximo: extração estruturada por tipo de fonte e citação de evidências

3. Office docs
- Status: criação funcional + pipeline de slides orientado a pesquisa
- Próximo: templates reutilizáveis, qualidade visual e validação de consistência

4. MCP
- Status: conector base (SSE)
- Próximo: stdio, discovery de tools, políticas de confiança por servidor

5. Imagem
- Status: preparação de prompt
- Próximo: definir provedor de renderização final

6. Vídeo simples
- Status: storyboard/prompt
- Próximo: definir provedor e formato de saída

7. 3D/textura/animação
- Status: plano textual de pipeline
- Próximo: definir ferramentas (ex: Blender pipeline/API externa)

8. Memória
- Status: backend Obsidian implementado e integrado ao caso de uso
- Próximo: recuperação semântica e política de retenção

9. Camada de instruções do agente
- Status: parcial; prompts locais por serviço, sem contrato central versionado
- Próximo: formalizar instruction stack (system/base, task-specific, safety overrides)

10. Skills do agente
- Status: inexistente como componente explícito do runtime
- Próximo: criar skill registry com gatilhos, pré-condições e métricas de acerto

## Premissas

- OpenRouter cobre decisão e geração textual.
- Renderização real de imagem/vídeo/3D pode exigir provedores adicionais.
- O agente deve expor claramente quando uma operação é planejamento versus execução final.

## Gaps críticos identificados

1. Falta de instruction stack formal
- Hoje o comportamento depende de prompts espalhados em serviços.
- Impacto: inconsistência de decisão e sensação de agente "burro" em tarefas abertas.

2. Falta de skill activation explícita
- Não há mecanismo declarativo para "quando usar capacidade X".
- Impacto: uso subótimo de ferramentas e respostas genéricas.

3. Falta de contrato de comportamento por modo
- Não há política explícita para estilos "assistente", "executor" e "pesquisador".
- Impacto: baixa previsibilidade em tarefas longas.

## Próxima implementação recomendada

1. Skill Registry (MVP)
- Estrutura: `id`, `description`, `triggers`, `requiredTools`, `riskLevel`, `outputContract`.
- Executor seleciona skill antes da ação final.

2. Instruction Composer
- Combinar camadas: base global + segurança + instrução por skill + contexto do usuário.
- Persistir versão de instrução usada no execution report.

3. Rubrica de qualidade por capability
- Medir utilidade, segurança, latência, custo e taxa de fallback.
