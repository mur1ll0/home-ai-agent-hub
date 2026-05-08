import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import ExcelJS from 'exceljs';
import pptxgen from 'pptxgenjs';
import type { OfficeDocumentTool } from '../../../core/ports/tools.js';

export interface SlideContent {
  title: string;
  bullets: string[];
  imageUrl?: string;
  imageSource?: string;
}

type PptxConstructor = new () => {
  addSlide: () => { addText: (...args: unknown[]) => void; addImage: (...args: unknown[]) => void };
  writeFile: (options: { fileName: string }) => Promise<void>;
};

export class OfficeDocumentToolImpl implements OfficeDocumentTool {
  async createWord(title: string, body: string, outputPath: string): Promise<void> {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 30 })] }),
            new Paragraph(body)
          ]
        }
      ]
    });

    const buffer = await Packer.toBuffer(doc);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, buffer);
  }

  async createSlides(title: string, bulletsOrSlides: string[] | SlideContent[], outputPath: string): Promise<void> {
    const Pptx = pptxgen as unknown as PptxConstructor;
    const pptx = new Pptx();

    // Determine if input is array of SlideContent or simple bullets
    const slides = this.normalizeSlides(title, bulletsOrSlides);

    // Create a slide for each item
    for (const slide of slides) {
      const pptxSlide = pptx.addSlide();
      const imagePath = slide.imageUrl
        ? await this.downloadImageToCache(slide.imageUrl)
        : null;
      const hasImage = !!imagePath;
      
      // Add title
      pptxSlide.addText(slide.title, {
        x: 0.5,
        y: 0.3,
        w: 12,
        h: 0.8,
        fontSize: 28,
        bold: true
      });

      // Add bullets
      pptxSlide.addText(
        slide.bullets.map((item) => ({
          text: `• ${item}`,
          options: { breakLine: true }
        })),
        {
          x: 0.7,
          y: 1.5,
          w: hasImage ? 5.6 : 11,
          h: 4,
          fontSize: hasImage ? 16 : 18
        }
      );

      if (hasImage && imagePath) {
        pptxSlide.addImage({
          path: imagePath,
          x: 6.6,
          y: 1.5,
          w: 5.8,
          h: 3.8,
          sizing: {
            type: 'contain',
            x: 6.6,
            y: 1.5,
            w: 5.8,
            h: 3.8
          }
        });

        const sourceText = slide.imageSource ?? slide.imageUrl;
        pptxSlide.addText(`Fonte: ${sourceText}`, {
          x: 6.6,
          y: 5.4,
          w: 5.8,
          h: 0.6,
          fontSize: 10,
          color: '666666'
        });
      }
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await pptx.writeFile({ fileName: outputPath });
  }

  private normalizeSlides(title: string, input: string[] | SlideContent[]): SlideContent[] {
    // If input contains objects with title/bullets, it's already normalized
    if (input.length > 0 && typeof input[0] === 'object' && 'title' in input[0]) {
      return input as SlideContent[];
    }

    // Otherwise, it's an array of bullet strings - create a single slide
    // (backward compatibility for simple requests)
    return [
      {
        title,
        bullets: input as string[]
      }
    ];
  }

  private async downloadImageToCache(url: string): Promise<string | null> {
    if (!/^https?:\/\//i.test(url)) {
      return null;
    }

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'home-ai-agent-hub/1.0'
        }
      });

      if (!response.ok) {
        return null;
      }

      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (!contentType.startsWith('image/')) {
        return null;
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 2048 || bytes.length > 8 * 1024 * 1024) {
        return null;
      }

      const extension = this.resolveImageExtension(contentType, url);
      const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
      const cacheDir = path.resolve('workspace', '.cache', 'slide-images');
      const imagePath = path.join(cacheDir, `${hash}.${extension}`);

      await fs.mkdir(cacheDir, { recursive: true });
      try {
        await fs.access(imagePath);
        return imagePath;
      } catch {
        // File does not exist yet.
      }

      await fs.writeFile(imagePath, bytes);
      return imagePath;
    } catch {
      return null;
    }
  }

  private resolveImageExtension(contentType: string, url: string): string {
    if (contentType.includes('png')) return 'png';
    if (contentType.includes('webp')) return 'webp';
    if (contentType.includes('gif')) return 'gif';
    if (contentType.includes('svg')) return 'svg';
    if (contentType.includes('bmp')) return 'bmp';
    if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';

    try {
      const parsedExt = path.extname(new URL(url).pathname).toLowerCase().replace('.', '');
      if (parsedExt.length > 0 && parsedExt.length <= 5) {
        return parsedExt;
      }
    } catch {
      // Ignore malformed URL and use fallback extension.
    }

    return 'jpg';
  }

  async createSpreadsheet(rows: string[][], outputPath: string): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Dados');
    rows.forEach((row) => sheet.addRow(row));

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    if (outputPath.endsWith('.csv')) {
      await workbook.csv.writeFile(outputPath);
      return;
    }

    await workbook.xlsx.writeFile(outputPath);
  }
}
