# Spec 04 - Security and Safeguards

## Política de segurança

- Deny-by-default para caminhos sensíveis.
- Allowlist explícita de raiz de trabalho.
- Confirmação humana para ações de risco.
- Sanitização de entrada antes de executar tools.

## Ações de risco

- file.delete
- file.move
- file.replace
- escrita fora de pasta permitida
- conexão MCP com endpoint não confiável

## Controles obrigatórios

1. Validador de caminho canônico
2. Detecção de conteúdo sensível
3. Consentimento por operação
4. Log de auditoria com timestamp e usuário
5. Timeouts e limites de retry

## Testes obrigatórios

- bloquear acesso a diretório sensível
- bloquear path traversal
- exigir confirmação em delete/move
- permitir execução em paths autorizados
