import path from 'node:path';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableLambda, RunnableSequence } from '@langchain/core/runnables';
import type { ActionPlan, AgentRequest, SupportedAction } from '../../core/domain/agent-types.js';
import { SafetyApprovalRequiredError } from '../../core/domain/safety-errors.js';
import type { SafetyGuard } from '../../core/ports/agent-services.js';
import type { LlmGateway } from '../../infrastructure/llm/openrouter-chat.gateway.js';
import type { AppEnv } from '../../infrastructure/config/env.js';

export class SafetyGuardService implements SafetyGuard {
  private static readonly APPROVAL_ELIGIBLE_ACTIONS = new Set<SupportedAction>([
    'file.read',
    'file.write',
    'file.move',
    'file.replace',
    'file.delete',
    'fs.list',
    'doc.create',
    'slide.create',
    'sheet.create'
  ]);

  private static readonly REQUEST_SCOPED_ROOT_ACTIONS = new Set<SupportedAction>([
    'file.read',
    'file.write',
    'file.move',
    'file.replace',
    'fs.list'
  ]);

  private readonly allowedRoot: string;
  private readonly allowedRootsByAction: Record<string, string[]>;
  private readonly blockedPaths: string[];

  constructor(
    env: AppEnv,
    private readonly llmGateway?: LlmGateway
  ) {
    this.allowedRoot = path.resolve(env.AGENT_ALLOWED_ROOT);
    this.allowedRootsByAction = {
      'file.read': this.parseRoots(env.AGENT_ALLOWED_READ_ROOTS),
      'file.write': this.parseRoots(env.AGENT_ALLOWED_WRITE_ROOTS),
      'file.delete': this.parseRoots(env.AGENT_ALLOWED_DELETE_ROOTS),
      'file.move': this.parseRoots(env.AGENT_ALLOWED_MOVE_ROOTS),
      'file.replace': this.parseRoots(env.AGENT_ALLOWED_REPLACE_ROOTS),
      'fs.list': this.parseRoots(env.AGENT_ALLOWED_LIST_ROOTS)
    };
    this.blockedPaths = env.AGENT_SENSITIVE_PATHS.split(',').map((entry) =>
      this.normalizePath(path.resolve(entry.trim()))
    );
  }

  async validate(input: AgentRequest, plan: ActionPlan): Promise<void> {
    await this.llmSafetyPrecheck(input.text, plan.action);

    const text = this.normalizePath(input.text.toLowerCase());
    if (text.includes('senha') || text.includes('password')) {
      throw new Error('Solicitação bloqueada por potencial conteúdo sensível.');
    }

    const mentionsBlocked = this.blockedPaths.some((blocked) => text.includes(blocked));
    if (mentionsBlocked) {
      throw new SafetyApprovalRequiredError(
        'Acesso a caminho sensível requer confirmação explícita do usuário.',
        'A solicitação menciona diretório sensível e só pode seguir com aprovação explícita.'
      );
    }

    if (plan.action.startsWith('file.') || plan.action === 'fs.list') {
      const likelyPaths = this.extractLikelyPaths(input.text, input.workspaceRoot);
      const roots = this.allowedRootsForAction(plan.action, input.workspaceRoot);

      for (const targetPath of likelyPaths) {
        if (!this.isInsideAnyRoot(targetPath, roots)) {
          throw new SafetyApprovalRequiredError(
            `Caminho fora das raízes permitidas para ${plan.action}.`,
            `Confirme explicitamente para permitir acesso excepcional em ${targetPath}. Permitidas: ${roots.join(', ')}`
          );
        }
      }
    }
  }

  private async llmSafetyPrecheck(text: string, action: SupportedAction): Promise<void> {
    if (!this.llmGateway) {
      return;
    }

    const prompt = ChatPromptTemplate.fromMessages([
      [
        'system',
        [
          'Você analisa risco de segurança em comandos de um agente local.',
          'Retorne APENAS JSON válido no formato:',
          '{{"allow":true,"requiresApproval":false,"reason":"..."}}'
        ].join(' ')
      ],
      ['human', 'Ação: {action}. Texto do usuário: {text}']
    ]);

    const chain = RunnableSequence.from([
      prompt,
      RunnableLambda.from((value) =>
        this.llmGateway?.ask(String(value), { operation: 'safety_precheck' }) ?? ''
      ),
      new StringOutputParser()
    ]);

    const raw = await chain.invoke({ action, text: text.slice(0, 1000) });
    const normalized = raw.trim().replace(/^```json\s*/i, '').replace(/```$/i, '');

    let parsed: { allow?: boolean; requiresApproval?: boolean; reason?: string } | null = null;
    try {
      parsed = JSON.parse(normalized) as {
        allow?: boolean;
        requiresApproval?: boolean;
        reason?: string;
      };
    } catch {
      // Fallback silencioso: mantém validações determinísticas locais como fonte da verdade.
      return;
    }

    if (parsed.allow === false) {
      if (parsed.requiresApproval || SafetyGuardService.APPROVAL_ELIGIBLE_ACTIONS.has(action)) {
        throw new SafetyApprovalRequiredError(
          'Acao bloqueada ate aprovacao explicita do usuario.',
          parsed.reason
        );
      }

      throw new Error(parsed.reason ?? 'Solicitacao bloqueada pela cadeia de seguranca.');
    }
  }

  private extractLikelyPaths(text: string, workspaceRoot?: string): string[] {
    const matches = new Set<string>();

    const contextAbsolutePath = text.match(/\[Arquivo ativo absoluto:\s*([^\]\r\n]+)\]/i);
    if (contextAbsolutePath?.[1]) {
      matches.add(path.resolve(contextAbsolutePath[1].trim()));
    }

    const contextRelativePath = text.match(/\[Arquivo ativo relativo:\s*([^\]\r\n]+)\]/i);
    if (contextRelativePath?.[1] && this.looksLikePath(contextRelativePath[1].trim())) {
      matches.add(this.resolveForSafety(contextRelativePath[1].trim(), workspaceRoot));
    }

    const quoted = text.matchAll(/['"]([^'"]+)['"]/g);
    for (const item of quoted) {
      const value = item[1];
      if (value && this.looksLikePath(value)) {
        matches.add(this.resolveForSafety(value, workspaceRoot));
      }
    }

    const windows = text.matchAll(/[a-zA-Z]:[\\/][^\r\n\]]+/g);
    for (const item of windows) {
      matches.add(path.resolve(item[0].trim()));
    }

    const unixLike = text.matchAll(/(?:^|\s)(\/[\w./-]+)/g);
    for (const item of unixLike) {
      if (item[1]) {
        matches.add(path.resolve(item[1]));
      }
    }

    const relative = text.matchAll(/(?:\.\.?[\\/]|workspace[\\/])[\w./\\-]+/g);
    for (const item of relative) {
      matches.add(this.resolveForSafety(item[0], workspaceRoot));
    }

    const repoRelative = text.matchAll(/\b[\w.-]+(?:[\\/][\w.-]+)+\b/g);
    for (const item of repoRelative) {
      if (item[0] && this.looksLikePath(item[0])) {
        matches.add(this.resolveForSafety(item[0], workspaceRoot));
      }
    }

    return [...matches];
  }

  private isInsideAllowedRoot(targetPath: string, rootPath: string): boolean {
    const relative = path.relative(rootPath, path.resolve(targetPath));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }

  private isInsideAnyRoot(targetPath: string, roots: string[]): boolean {
    return roots.some((root) => this.isInsideAllowedRoot(targetPath, root));
  }

  private parseRoots(raw: string): string[] {
    const parsed = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => path.resolve(entry));

    return parsed.length > 0 ? parsed : [this.allowedRoot];
  }

  private allowedRootsForAction(action: SupportedAction, workspaceRoot?: string): string[] {
    const configuredRoots = this.allowedRootsByAction[action] ?? [this.allowedRoot];
    const requestScopedRoot = this.normalizeOptionalRequestRoot(workspaceRoot);

    if (!requestScopedRoot || !SafetyGuardService.REQUEST_SCOPED_ROOT_ACTIONS.has(action)) {
      return configuredRoots;
    }

    return [...new Set([...configuredRoots, requestScopedRoot])];
  }

  private resolveForSafety(targetPath: string, workspaceRoot?: string): string {
    if (!workspaceRoot || path.isAbsolute(targetPath)) {
      return path.resolve(targetPath);
    }

    const root = path.resolve(workspaceRoot);
    const normalizedRelative = this.stripWorkspaceFolderPrefix(targetPath, root);
    return path.resolve(root, normalizedRelative);
  }

  private stripWorkspaceFolderPrefix(targetPath: string, workspaceRoot: string): string {
    const workspaceFolderName = path.basename(workspaceRoot).toLowerCase();
    const normalized = targetPath.replaceAll('\\', '/');
    const normalizedLower = normalized.toLowerCase();

    if (normalizedLower === workspaceFolderName) {
      return '.';
    }

    if (normalizedLower.startsWith(`${workspaceFolderName}/`)) {
      return normalized.slice(workspaceFolderName.length + 1);
    }

    return targetPath;
  }

  private normalizeOptionalRequestRoot(workspaceRoot?: string): string | null {
    if (!workspaceRoot?.trim()) {
      return null;
    }

    const resolvedRoot = path.resolve(workspaceRoot.trim());
    const normalizedRoot = this.normalizePath(resolvedRoot);
    const isBlocked = this.blockedPaths.some(
      (blocked) => normalizedRoot === blocked || normalizedRoot.startsWith(`${blocked}/`)
    );

    return isBlocked ? null : resolvedRoot;
  }

  private looksLikePath(value: string): boolean {
    return /^([a-zA-Z]:[\\/]|\.|\/|workspace[\\/])/.test(value)
      || /^[\w.-]+(?:[\\/][\w.-]+)+$/.test(value)
      || /^[\w.-]+\.[a-zA-Z0-9]+$/.test(value);
  }

  private normalizePath(value: string): string {
    return value.replaceAll('\\', '/').toLowerCase();
  }
}
