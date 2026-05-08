# 09 - Source Ranking and Dynamic Slide Capacity

## Context

The slide generation pipeline was producing noisy research inputs and could over-generate slides when user requests exceeded available content quality.

## Goals

1. Prioritize technical and relevant web sources during search collection.
2. Enforce dynamic slide count rule:
   - finalSlides <= min(requestedSlides, contentCapacity)
3. Preserve pipeline order:
   - raw web data -> processed research notes -> slide synthesis -> PPT generation.

## Functional Requirements

### FR-01 Source ranking and filtering
- The web search adapter must score candidates before extraction.
- Score must favor:
  - technical/documentation domains
  - query-token overlap in title/snippet/url
  - explicit technical terms (API, SDK, architecture, implementation, etc.)
- Score must penalize low-signal pages (dictionary, promo, login/contact-heavy pages).
- Selected sources should prefer domain diversity when possible.

### FR-02 Dynamic slide count
- If the user requests N slides, the planner should treat N as upper bound.
- The planner must estimate contentCapacity from processed topic research.
- The synthesis target must be min(N, contentCapacity).
- If user does not provide N, planner chooses automatic count from available capacity.

### FR-03 Processed-data-only synthesis
- Slide synthesis prompt must consume processed topic notes, not raw crawl output.
- The execution report should include processing stage before synthesis.

## Non-functional Requirements
- Keep current public interfaces stable where possible.
- Preserve backward compatibility for simple `slide.create` requests.
- Add automated test coverage for FR-02.

## Acceptance Criteria

1. Search ranking returns technical sources ahead of generic/noisy pages for technical queries.
2. For request `20 slides` with capacity `4`, generated slides are `<= 4`.
3. Integration test validates the FR-02 rule.
4. Existing test suite remains green.
