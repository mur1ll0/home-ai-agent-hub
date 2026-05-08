# Copilot Instructions - Home AI Agent Hub

## Contexto do projeto

Este projeto implementa um agente pessoal de IA com Node 24.15.0, LangChain e OpenRouter, seguindo Clean Architecture, SOLID e Spec-Driven Development.

## Regras obrigatórias

1. Respeitar arquitetura em camadas:
   - `core` não depende de `infrastructure`.
   - dependências apontam para dentro (Dependency Rule).
2. Manter serviços pequenos e com responsabilidade única (SRP).
3. Novas features devem começar por spec em `specs/` antes do código.
4. Qualquer integração externa deve entrar via porta + adaptador.
5. Toda ação destrutiva (delete, replace, move) requer validação de segurança e confirmação explícita do usuário.
6. Não acessar caminhos fora da raiz permitida sem consentimento explícito.

## Fluxo de implementação esperado

1. Ler specs relevantes.
2. Escrever/ajustar testes de aceitação da feature.
3. Implementar caso de uso.
4. Implementar/adaptar portas e adaptadores.
5. Atualizar documentação técnica.

## Leitura automática de specs por intenção do usuário

- Sempre que o usuário solicitar implementação, ajuste arquitetural, decisão técnica, segurança, memória, capacidades, roadmap ou priorização, ler primeiro as specs relevantes em `specs/` antes de propor ou alterar código.
- Tratar cada spec abaixo como uma “tool de contexto”: selecionar e carregar apenas as necessárias para a tarefa atual, mas sem pular specs críticas de segurança e arquitetura.
- Em caso de conflito entre specs, priorizar nesta ordem: segurança (`04`) > arquitetura (`01`) > roadmap/execução (`02`) > demais.
- Ao responder, aplicar as decisões das specs de forma implícita no plano e na implementação, sem depender de nova confirmação para a leitura.

### Catálogo de specs (uso como tools de contexto)

- `specs/00-product-vision.md`
  - Serve para: alinhar objetivo do produto, escopo MVP, público-alvo e critérios de valor.
  - Acionar quando: pedido estiver ambíguo, houver dúvida de escopo, ou necessidade de validar se algo pertence ao produto.

- `specs/01-architecture.md`
  - Serve para: regras de camadas, Clean Architecture, dependências, portas e adaptadores.
  - Acionar quando: criar/refatorar serviços, casos de uso, contratos, integração entre módulos.

- `specs/02-spec-driven-roadmap.md`
  - Serve para: ordem de entrega, fases, priorização e recorte incremental de features.
  - Acionar quando: usuário pedir “próximo passo”, planejamento, divisão por etapas ou estimativa de evolução.

- `specs/03-openrouter-model-strategy.md`
  - Serve para: seleção de modelos por tarefa, fallback, custo/latência e estratégia de provedores.
  - Acionar quando: mudanças em LLM, roteamento de modelo, tuning de qualidade, custo ou robustez.

- `specs/04-security-and-safeguards.md`
  - Serve para: políticas de segurança, consentimento, bloqueios, validações e redução de risco.
  - Acionar quando: operações destrutivas, acesso a arquivos/web, dados sensíveis, execução de ações de risco.

- `specs/05-memory-backend-evaluation.md`
  - Serve para: decisões de backend de memória, trade-offs, persistência e estratégia evolutiva.
  - Acionar quando: alterações em memória, retenção de contexto, troca de backend, critérios de escolha técnica.

- `specs/06-capabilities-and-providers.md`
  - Serve para: catálogo de capacidades do agente, provedores externos, limites e responsabilidades.
  - Acionar quando: adicionar/remover capacidade, integrar ferramenta/provedor, revisar fronteira entre domínio e infraestrutura.

- `specs/07-open-questions.md`
  - Serve para: pendências estratégicas, hipóteses em aberto e decisões ainda não fechadas.
  - Acionar quando: houver bloqueio decisório, falta de regra, ou necessidade de registrar/endereçar incerteza.

- `specs/08-step2-api-ui-readiness.md`
  - Serve para: prontidão de API/UI, critérios de aceitação para interfaces e integração end-to-end.
  - Acionar quando: tarefas de HTTP, contratos, UI web, experiência de uso e readiness de entrega.

- `specs/09-source-ranking-and-slide-capacity.md`
  - Serve para: ranking de fontes, limites de geração de slides e políticas de capacidade/qualidade.
  - Acionar quando: pedidos de sumarização por fontes, geração de apresentações, controle de volume e priorização de conteúdo.

### Regra prática de seleção rápida

- Implementação de feature: `00` + `01` + `02` + specs específicas do tema.
- Segurança/ações de risco: incluir obrigatoriamente `04`.
- LLM/modelos/provedores: incluir `03` e `06`.
- Memória/contexto: incluir `05`.
- API/UI: incluir `08`.
- Ranking de fontes/slides: incluir `09`.

## Convenções de código

- TypeScript estrito.
- Funções curtas e orientadas a intenção.
- Evitar classes utilitárias com estado global.
- Erros devem ter mensagens acionáveis.
- Evitar side effects fora de adaptadores.

## Segurança

- Bloquear padrões de dados sensíveis por padrão.
- Exigir allowlist de diretórios.
- Registrar auditoria de ações de arquivo e web.
- Implementar política de consentimento por operação de risco.

## LangChain e tomada de decisão

- Separar cadeia de decisão em estágios:
  1. classificação de intenção
  2. detecção de idioma de resposta
  3. checagem de segurança
  4. seleção de ferramenta
  5. execução + resumo
- Usar saída estruturada para decisões críticas.

## Estratégia OpenRouter

- Selecionar modelos por classe de tarefa.
- Priorizar modelos gratuitos estáveis.
- Definir fallback por capacidade (chat, reasoning, code, vision).
- Salvar telemetria de custo, latência e taxa de erro por modelo.
