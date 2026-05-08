export class SafetyApprovalRequiredError extends Error {
  constructor(
    message: string,
    public readonly approvalReason?: string
  ) {
    super(message);
    this.name = 'SafetyApprovalRequiredError';
  }
}
