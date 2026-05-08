import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { McpToolConnector } from '../../../core/ports/tools.js';

export class McpToolConnectorImpl implements McpToolConnector {
  private readonly client: Client;

  constructor() {
    this.client = new Client({ name: 'home-ai-agent-hub', version: '0.1.0' });
  }

  async connect(serverName: string, transport: 'stdio' | 'sse', endpoint?: string): Promise<string> {
    if (transport !== 'sse') {
      return `Conector MCP (${serverName}) em modo stdio ainda não implementado.`;
    }

    if (!endpoint) {
      throw new Error('Endpoint é obrigatório para transporte SSE.');
    }

    const sseTransport = new SSEClientTransport(new URL(endpoint));
    await this.client.connect(sseTransport);
    const tools = await this.client.listTools();

    return `Conectado ao MCP ${serverName}. Tools disponíveis: ${tools.tools.length}`;
  }
}
