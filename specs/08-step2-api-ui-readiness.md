# Spec 08 - Step 2 Readiness (API HTTP + UI Web)

## Objetivo

Deixar definido o plano de implementação da interface HTTP e UI mantendo o core já pronto no passo 1.

## Pré-condições já atendidas

- Caso de uso único para entrada textual.
- Fluxo de confirmação explícita para ações destrutivas.
- Contrato de resposta com status e token de confirmação.
- Auditoria JSONL habilitada.

## Implementação proposta do passo 2

1. API HTTP com Fastify
- endpoint `POST /v1/agent/execute`
- validação por schema Zod
- retorno direto do caso de uso

2. UI Web mínima
- formulário de prompt
- painel de resposta com steps
- fluxo para confirmar token quando status `pending_confirmation`

3. Segurança de borda
- rate limit básico
- CORS configurável
- correlação por `userId` e `sessionId`

## Contratos

- request/response tipados em `src/interfaces/contracts/agent-http.contract.ts`

## Critérios de pronto do passo 2

- API funcional com teste de integração
- UI capaz de enviar prompt e confirmar token
- documentação de execução local
