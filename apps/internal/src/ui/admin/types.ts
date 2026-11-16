import type { AdminActionResult, ChatSession } from '../../chat/ChatSession';
import type { GrantLogEntry } from '@viavoip/internal-domain';
import type { Directory, IlhaId, StaffUser, UserId } from '@viavoip/internal-domain';

/** As ações que o console usa; `ChatSession` as cumpre (e o resultado de sucesso traz o usuário/ilha criado). */
export type AdminActions = Pick<
  ChatSession,
  | 'registerSupervisor'
  | 'registerAgent'
  | 'deactivateUser'
  | 'reactivateUser'
  | 'createIlha'
  | 'renameIlha'
  | 'assignIlhaSupervisor'
  | 'moveAgent'
  | 'setGrant'
  | 'loadGrantLog'
>;

export type Selection =
  | { readonly kind: 'user'; readonly id: UserId }
  | { readonly kind: 'ilha'; readonly id: IlhaId }
  | { readonly kind: 'new' };

export type ConsoleContext = {
  readonly me: StaffUser;
  readonly directory: Directory;
  readonly grantLog: readonly GrantLogEntry[] | null;
  readonly timeZone: string;
  readonly actions: AdminActions;
  /** Roda uma ação: limpa o aviso, mostra o erro em `role="alert"` ou o sucesso em `role="status"`. */
  readonly perform: <T>(call: () => Promise<AdminActionResult<T>>, success: (value: T) => string) => Promise<AdminActionResult<T>>;
  /** Há uma ação em andamento: botões e envios ficam desabilitados e a reentrada é ignorada. */
  readonly busy: boolean;
  /** Erro de validação do formulário (mesmo `role="alert"`). */
  readonly fail: (message: string) => void;
  readonly select: (selection: Selection) => void;
};
