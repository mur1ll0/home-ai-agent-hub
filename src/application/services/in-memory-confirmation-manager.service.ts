import { randomUUID } from 'node:crypto';
import type { ConfirmationTicket } from '../../core/domain/agent-types.js';
import type { ActionPlan, AgentRequest } from '../../core/domain/agent-types.js';
import type { ConfirmationManager } from '../../core/ports/agent-services.js';

interface StoredTicket {
  ticket: ConfirmationTicket;
  userId: string;
  sessionId: string;
}

export class InMemoryConfirmationManagerService implements ConfirmationManager {
  private readonly tickets = new Map<string, StoredTicket>();

  constructor(private readonly ttlMs = 1000 * 60 * 5) {}

  async createTicket(request: AgentRequest, plan: ActionPlan): Promise<ConfirmationTicket> {
    const token = randomUUID().slice(0, 8);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlMs);

    const ticket: ConfirmationTicket = {
      token,
      request,
      plan,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    };

    this.tickets.set(token, {
      ticket,
      userId: request.userId,
      sessionId: request.sessionId
    });

    return ticket;
  }

  async consumeTicket(
    token: string,
    userId: string,
    sessionId: string
  ): Promise<ConfirmationTicket | null> {
    const stored = this.tickets.get(token);
    if (!stored) {
      return null;
    }

    if (stored.userId !== userId || stored.sessionId !== sessionId) {
      return null;
    }

    this.tickets.delete(token);

    const expiresAt = new Date(stored.ticket.expiresAt).getTime();
    if (expiresAt < Date.now()) {
      return null;
    }

    return stored.ticket;
  }

  extractConfirmationToken(text: string): string | null {
    const match = text.trim().match(/^(confirmar|confirm)\s+([a-zA-Z0-9-]{6,})$/i);
    return match?.[2] ?? null;
  }
}
