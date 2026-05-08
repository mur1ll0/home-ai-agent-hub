# Spec 07 - Open Questions and Decisions Needed

## Decisões definidas

1. Interface principal do agente no MVP
- CLI + API HTTP + UI Web

2. Backend de memória inicial
- Obsidian

3. Estratégia de confirmação de ações destrutivas
- confirmação sempre

4. Geração de imagem/vídeo/3D
- apenas planejamento de prompts no MVP

5. Prioridade de capabilities para próxima sprint
- Segurança + arquivo

6. Persistência de auditoria
- arquivo local JSONL

7. Idiomas alvo
- multilíngue

8. Backend de memória MVP
- Obsidian sem banco adicional

## Pendências abertas (prioridade)

1. Contrato final da camada de instruções
- Quais blocos de instrução serão versionados por arquivo e por capability.

2. Skill registry do runtime
- Formato final dos gatilhos e do score de ativação.

3. Estratégia de modelos OpenRouter por operação
- Definir baseline por tarefa e fallback por custo/latência.

4. Política de retenção de memória
- Limite por usuário/sessão e critério de limpeza de conteúdo sensível.

5. Critérios de qualidade do agente
- Definir benchmark mínimo para utilidade, segurança e latência por fluxo.
