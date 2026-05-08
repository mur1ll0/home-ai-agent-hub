import { chromium } from 'playwright';
import type { WebTool } from '../../../core/ports/tools.js';

interface SearchCandidate {
  title: string;
  href: string;
  snippet: string;
}

export class PlaywrightWebTool implements WebTool {
  constructor(private readonly headless = true) {}

  async extract(url: string, query?: string): Promise<string> {
    let browser;
    try {
      browser = await chromium.launch({ headless: this.headless });
    } catch (error) {
      if (error instanceof Error && error.message.includes("Executable doesn't exist")) {
        throw new Error(
          'Playwright Chromium não está instalado. Execute: npx playwright install chromium'
        );
      }

      throw error;
    }

    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const content = await page.content();

      if (!query) {
        return content.slice(0, 4000);
      }

      const plainText = await page.locator('body').innerText();
      const snippet = plainText
        .split(/\n+/)
        .find((line) => line.toLowerCase().includes(query.toLowerCase()));
      return snippet ?? plainText.slice(0, 2000);
    } finally {
      await browser.close();
    }
  }

  async search(query: string, maxResults = 4): Promise<string> {
    let browser;
    try {
      browser = await chromium.launch({ headless: this.headless });
    } catch (error) {
      if (error instanceof Error && error.message.includes("Executable doesn't exist")) {
        throw new Error(
          'Playwright Chromium não está instalado. Execute: npx playwright install chromium'
        );
      }

      throw error;
    }

    try {
      const page = await browser.newPage();
      const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

      const results = await page.$$eval('li.b_algo', (items) =>
        items
          .map((item) => {
            const link = item.querySelector('h2 a') as HTMLAnchorElement | null;
            const snippet = (item.querySelector('.b_caption p')?.textContent ?? '').trim();
            return {
              title: (link?.textContent ?? '').trim(),
              href: (link?.href ?? '').trim(),
              snippet
            };
          })
          .filter((item) => item.title && item.href)
      );

      const candidates = results
        .map((item) => ({
          ...item,
          href: this.decodeBingRedirect(item.href)
        }))
        .filter((item) => !/bing\.com\/(search|images|videos|ck\/a)/i.test(item.href))
        .filter((item) => /^https?:\/\//i.test(item.href));

      const selected = this.selectTechnicalSources(query, candidates, maxResults);

      if (selected.length === 0) {
        return `Busca web por "${query}" não encontrou resultados úteis.`;
      }

      const snippets: string[] = [];
      for (const item of selected) {
        const detailPage = await browser.newPage();
        try {
          await detailPage.goto(item.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
          const text = await detailPage.locator('body').innerText();
          const cleaned = text.replace(/\s+/g, ' ').trim().slice(0, 1600);
          const imageUrl = await this.extractRelevantImage(detailPage);
          const imageLines = imageUrl
            ? `\nImagem: ${imageUrl}\nImagemFonte: ${item.href}`
            : '';
          snippets.push(`Fonte: ${item.title}\nURL: ${item.href}\nTrecho: ${cleaned}${imageLines}`);
        } catch {
          snippets.push(`Fonte: ${item.title}\nURL: ${item.href}\nTrecho: falha ao coletar conteúdo.`);
        } finally {
          await detailPage.close();
        }
      }

      return [`Consulta: ${query}`, ...snippets].join('\n\n');
    } finally {
      await browser.close();
    }
  }

  private decodeBingRedirect(url: string): string {
    try {
      const parsed = new URL(url);
      if (!/bing\.com$/i.test(parsed.hostname) || !parsed.pathname.includes('/ck/a')) {
        return url;
      }

      const encodedTarget = parsed.searchParams.get('u');
      if (!encodedTarget) {
        return url;
      }

      const normalized = encodedTarget.startsWith('a1') ? encodedTarget.slice(2) : encodedTarget;
      const base64 = normalized.replace(/-/g, '+').replace(/_/g, '/');
      const paddingLength = (4 - (base64.length % 4)) % 4;
      const padded = `${base64}${'='.repeat(paddingLength)}`;
      const decoded = Buffer.from(padded, 'base64').toString('utf-8');

      if (/^https?:\/\//i.test(decoded)) {
        return decoded;
      }

      return url;
    } catch {
      return url;
    }
  }

  private selectTechnicalSources(
    query: string,
    candidates: SearchCandidate[],
    maxResults: number
  ): SearchCandidate[] {
    const ranked = candidates
      .map((candidate) => ({
        candidate,
        score: this.scoreCandidate(query, candidate)
      }))
      .filter((item) => item.score >= 1)
      .sort((a, b) => b.score - a.score);

    const selected: SearchCandidate[] = [];
    const seenDomains = new Set<string>();

    // First pass: maximize domain diversity among high-quality sources.
    for (const item of ranked) {
      if (selected.length >= maxResults) {
        break;
      }

      const domain = this.extractDomain(item.candidate.href);
      if (seenDomains.has(domain)) {
        continue;
      }

      selected.push(item.candidate);
      seenDomains.add(domain);
    }

    // Second pass: fill remaining slots by score, even from repeated domains.
    if (selected.length < maxResults) {
      for (const item of ranked) {
        if (selected.length >= maxResults) {
          break;
        }

        if (selected.some((candidate) => candidate.href === item.candidate.href)) {
          continue;
        }

        selected.push(item.candidate);
      }
    }

    return selected;
  }

  private scoreCandidate(query: string, candidate: SearchCandidate): number {
    const queryTokens = this.tokenize(query);
    const title = candidate.title.toLowerCase();
    const snippet = candidate.snippet.toLowerCase();
    const url = candidate.href.toLowerCase();
    const haystack = `${title} ${snippet} ${url}`;

    const overlap = queryTokens.filter((token) => haystack.includes(token)).length;
    let score = overlap * 2;

    const highSignalDomains = [
      'docs.',
      'developer.',
      'github.com',
      'stackoverflow.com',
      'arxiv.org',
      'wikipedia.org',
      'medium.com',
      'dev.to',
      'learn.microsoft.com',
      'cloud.google.com',
      'aws.amazon.com',
      'mongodb.com',
      'obsidian.md'
    ];

    if (highSignalDomains.some((domain) => url.includes(domain))) {
      score += 6;
    }

    const technicalTerms = [
      'api',
      'sdk',
      'documentation',
      'docs',
      'guide',
      'tutorial',
      'architecture',
      'implementation',
      'integration',
      'llm',
      'agent',
      'prompt',
      'vector',
      'embedding',
      'memory'
    ];
    const technicalHits = technicalTerms.filter((term) => haystack.includes(term)).length;
    score += Math.min(technicalHits, 5);

    const lowSignalPatterns = [
      'dicio.com',
      'microsoft.com/pt-br/outlook_com/forum',
      'kmdevantagens.com.br',
      'fale-conosco',
      'login',
      'cadastre',
      'promoc',
      'resultado',
      'gk',
      'sinônimo',
      'dicionário'
    ];

    if (lowSignalPatterns.some((pattern) => haystack.includes(pattern))) {
      score -= 8;
    }

    return score;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3)
      .slice(0, 20);
  }

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  private async extractRelevantImage(page: import('playwright').Page): Promise<string | null> {
    try {
      const candidate = await page.evaluate(() => {
        const isValidUrl = (value: string): boolean => /^https?:\/\//i.test(value);

        const metaSelectors = [
          'meta[property="og:image"]',
          'meta[property="og:image:url"]',
          'meta[name="twitter:image"]'
        ];

        for (const selector of metaSelectors) {
          const content = document.querySelector(selector)?.getAttribute('content')?.trim();
          if (content) {
            try {
              const absolute = new URL(content, location.href).href;
              if (isValidUrl(absolute)) {
                return absolute;
              }
            } catch {
              // ignore invalid URL candidate
            }
          }
        }

        const images = Array.from(document.querySelectorAll<HTMLImageElement>('article img, main img, img'))
          .map((img) => {
            const src = img.currentSrc || img.src || '';
            const width = img.naturalWidth || img.width || 0;
            const height = img.naturalHeight || img.height || 0;
            return { src, width, height };
          })
          .filter((img) => img.src && !img.src.startsWith('data:'))
          .map((img) => {
            try {
              return {
                src: new URL(img.src, location.href).href,
                width: img.width,
                height: img.height,
                area: img.width * img.height
              };
            } catch {
              return null;
            }
          })
          .filter((img): img is { src: string; width: number; height: number; area: number } => !!img)
          .filter((img) => isValidUrl(img.src))
          .filter((img) => img.width >= 240 && img.height >= 140)
          .sort((a, b) => b.area - a.area);

        return images[0]?.src ?? null;
      });

      return candidate;
    } catch {
      return null;
    }
  }
}
