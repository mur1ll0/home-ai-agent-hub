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
