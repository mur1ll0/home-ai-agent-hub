# Spec 05 - Memory Backend Evaluation (MemPalace vs Obsidian)

## Contexto

O agente precisa de memória persistente útil entre interações, sem comprometer segurança e portabilidade.

## Opção A - Obsidian

### Prós
- simples de operar localmente
- arquivos markdown auditáveis
- baixo lock-in
- fácil versionamento com Git

### Contras
- sem semântica avançada nativa
- exige camada extra para busca estruturada

## Opção B - MemPalace

### Prós
- potencialmente mais orientado a memória de agentes
- pode oferecer recuperação contextual avançada

### Contras
- dependência externa
- risco de lock-in e custo
- requisitos de integração a validar

## Recomendação para MVP

- Iniciar com Obsidian como backend padrão.
- Definir interface `MemoryGateway` para trocar backend sem impacto no core.
- Preparar implementação futura de MemPalace como adaptador alternativo.

## Estado atual de implementação

Implementado:
- Interface de memória no core (`MemoryGateway`).
- Adaptador `ObsidianMemoryGateway` em infraestrutura.
- Integração com o caso de uso para leitura/escrita de memória operacional (`last_summary`, `last_status`).
- Registro de operações de memória no execution report.

Ajustes aplicados para prontidão:
- `OBSIDIAN_VAULT_PATH` agora possui default seguro para execução local: `./workspace/obsidian-vault`.
- Backend Obsidian é inicializado automaticamente quando `MEMORY_BACKEND=obsidian`.
- Relatório de memória passou a refletir disponibilidade real do gateway injetado.

## Obsidian precisa de banco de dados?

Não para o MVP atual.

Motivo:
- O backend atual usa arquivos Markdown no vault do Obsidian.
- Persistência é baseada em filesystem local.
- Não há dependência de banco relacional ou NoSQL para funcionar.

Quando considerar banco adicional:
- Busca semântica em grande volume (milhares de notas).
- Requisitos de multiusuário concorrente com consistência forte.
- Analytics e ranking avançado de memória.

## Como usar a memória Obsidian no projeto

1. Configure o ambiente:
- `MEMORY_BACKEND=obsidian`
- `OBSIDIAN_VAULT_PATH=./workspace/obsidian-vault` (ou caminho do seu vault real)

2. Execute o agente normalmente (`npm run dev`).

3. Durante as execuções, o agente escreve/consulta memória por usuário.

4. Verifique os arquivos em:
- `${OBSIDIAN_VAULT_PATH}/home-ai-agent-memory/<userId>.md`

Formato esperado por linha:
- `- <timestamp> | <key> | <value>`

## Limitações atuais

- Sem indexação semântica nativa.
- Recuperação por chave simples (último valor por chave).
- Sem política de retenção/compactação por volume.

## Próxima evolução recomendada

1. Short-term memory estruturada por sessão
- salvar objetivos, decisões e pendências por sessão.

2. Long-term memory com recuperação contextual
- adicionar busca por similaridade (embedding) mantendo a interface de porta.

3. Governança de memória
- política de retenção, anonimização e limpeza para dados sensíveis.

## Critérios para reavaliar

- volume de memória
- necessidade de busca semântica
- latência de recuperação
- custo operacional
