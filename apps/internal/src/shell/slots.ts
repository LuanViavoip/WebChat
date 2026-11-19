import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type {
  AnnouncementRefMessage,
  Brand,
  ConversationId,
  Directory,
  StaffUser,
  Tenant,
} from '@viavoip/internal-domain';
import type { ChatSession, ChatSessionState } from '../chat/ChatSession';
import type { ChatTransport } from '../transport/ChatTransport';

export type ShellContext = {
  readonly session: ChatSession;
  readonly state: ChatSessionState;
  readonly me: StaffUser;
  readonly directory: Directory;
  readonly tenant: Tenant;
  readonly transport: ChatTransport;
  readonly openConversation: (id: ConversationId) => void;
};

export type ShellViewId = Brand<string, 'ShellViewId'>;

export function asShellViewId(value: string): ShellViewId {
  return value as ShellViewId;
}

export type ShellView = {
  readonly id: ShellViewId;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly visible: (ctx: ShellContext) => boolean;
  readonly badge?: (ctx: ShellContext) => number;
  readonly render: (ctx: ShellContext & { readonly onClose: () => void }) => ReactNode;
};

export type ShellMenuItem = {
  readonly label: string;
  readonly visible: (ctx: ShellContext) => boolean;
  readonly onSelect: (ctx: ShellContext) => void;
};

export type ShellSlots = {
  readonly views: readonly ShellView[];
  readonly overlays: readonly ((ctx: ShellContext) => ReactNode)[];
  readonly menuItems: readonly ShellMenuItem[];
  readonly messageRenderers: {
    readonly announcement?: (message: AnnouncementRefMessage, ctx: ShellContext) => ReactNode;
  };
};
