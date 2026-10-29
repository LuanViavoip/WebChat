import { CheckCircle2, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

type ToastTone = 'ok' | 'error';
type ToastItem = { id: number; tone: ToastTone; text: string };
type ToastApi = { notify: (tone: ToastTone, text: string) => void };

const ToastContext = createContext<ToastApi | null>(null);

const lifetimeMs: Record<ToastTone, number> = { ok: 3500, error: 8000 };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback(
    (tone: ToastTone, text: string) => {
      const id = nextId.current++;
      setItems((current) => [...current.slice(-3), { id, tone, text }]);
      timers.current.set(id, setTimeout(() => dismiss(id), lifetimeMs[tone]));
    },
    [dismiss],
  );

  useEffect(() => {
    const active = timers.current;
    return () => {
      for (const timer of active.values()) clearTimeout(timer);
      active.clear();
    };
  }, []);

  const api = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="ui-toasts" role="region" aria-label="Notificações" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`ui-toast ui-toast--${item.tone}`} data-testid="notice">
            {item.tone === 'ok' ? <CheckCircle2 size={18} aria-hidden="true" /> : <XCircle size={18} aria-hidden="true" />}
            <span>{item.text}</span>
            <button type="button" className="ui-icon-button" aria-label="Dispensar aviso" onClick={() => dismiss(item.id)}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast fora do ToastProvider');
  return api;
}
