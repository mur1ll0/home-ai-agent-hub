# Spec 01 - Architecture (Clean + SOLID)

## Camadas

1. Core
- Entidades, regras e casos de uso.
- Portas (interfaces) de entrada e saída.

2. Application
- Serviços de orquestração de regra de negócio.
- Implementa portas de aplicação.
- Inclui composer de instruções e roteador de skills (quando aplicável).

3. Infrastructure
- Adaptadores para APIs, filesystem, Playwright, Office libs, MCP.

4. Interfaces
- CLI/HTTP/UI para entrada e saída.

## Princípios SOLID aplicados

- S: cada serviço com responsabilidade única.
- O: novos tools entram via porta, sem alterar core.
- L: adaptadores substituíveis por contrato.
- I: interfaces pequenas e específicas por capability.
- D: casos de uso dependem de abstrações.

## Fluxo principal

1. Entrada do usuário
2. Classificação de intenção
3. Seleção de skill e composição de instruções
4. Detecção de idioma
5. Validação de segurança
6. Seleção de ferramenta
7. Execução
8. Resposta e registro

## Requisitos não funcionais

- Segurança por padrão (deny-by-default para áreas sensíveis)
- Observabilidade (logs estruturados e rastreáveis)
- Extensibilidade por adaptadores
- Testabilidade por mocks de portas
