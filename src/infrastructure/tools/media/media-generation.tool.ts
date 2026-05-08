import type { MediaTool } from '../../../core/ports/tools.js';
import type { LlmGateway } from '../../llm/openrouter-chat.gateway.js';

export class MediaGenerationTool implements MediaTool {
  constructor(private readonly llmGateway: LlmGateway) {}

  async generateImage(prompt: string): Promise<string> {
    const details = await this.llmGateway.ask(
      `Crie um prompt técnico para geração de imagem a partir desta descrição: ${prompt}`,
      { operation: 'media_image_prompt' }
    );
    return `Imagem solicitada. Prompt preparado: ${details.slice(0, 200)}`;
  }

  async generateVideo(prompt: string): Promise<string> {
    const details = await this.llmGateway.ask(
      `Crie um storyboard curto para geração de vídeo a partir desta descrição: ${prompt}`,
      { operation: 'media_video_storyboard' }
    );
    return `Vídeo simples solicitado. Storyboard preparado: ${details.slice(0, 200)}`;
  }

  async generate3D(prompt: string): Promise<string> {
    const details = await this.llmGateway.ask(
      `Crie um plano de modelagem 3D com texturas e animação para: ${prompt}`,
      { operation: 'media_3d_plan' }
    );
    return `Pipeline 3D solicitado. Plano preparado: ${details.slice(0, 200)}`;
  }
}
