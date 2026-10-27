import type {
  SMAdapter,
  SmAssignmentRef,
  SmClosureRef,
  SmConversationRef,
  SmReleaseRef,
  SmTransferRef,
} from './types.js';

export type SmCall =
  | { method: 'onConversationQueued'; input: SmConversationRef }
  | { method: 'onConversationAssigned'; input: SmAssignmentRef }
  | { method: 'onConversationClosed'; input: SmClosureRef }
  | { method: 'onConversationReleased'; input: SmReleaseRef }
  | { method: 'onConversationTransferred'; input: SmTransferRef };

export class MockSMAdapter implements SMAdapter {
  readonly calls: SmCall[] = [];

  async onConversationQueued(input: SmConversationRef): Promise<void> {
    this.calls.push({ method: 'onConversationQueued', input: structuredClone(input) });
  }

  async onConversationAssigned(input: SmAssignmentRef): Promise<void> {
    this.calls.push({ method: 'onConversationAssigned', input: structuredClone(input) });
  }

  async onConversationClosed(input: SmClosureRef): Promise<void> {
    this.calls.push({ method: 'onConversationClosed', input: structuredClone(input) });
  }

  async onConversationReleased(input: SmReleaseRef): Promise<void> {
    this.calls.push({ method: 'onConversationReleased', input: structuredClone(input) });
  }

  async onConversationTransferred(input: SmTransferRef): Promise<void> {
    this.calls.push({ method: 'onConversationTransferred', input: structuredClone(input) });
  }
}
