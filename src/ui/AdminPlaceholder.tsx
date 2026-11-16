import { ArrowLeft } from 'lucide-react';

/** Marcador da Etapa 5: o console de administração ainda não existe. */
export function AdminPlaceholder({ onBack }: { onBack: () => void }) {
  return (
    <section className="admin-screen" aria-labelledby="admin-title">
      <div className="login-card">
        <div className="login-brand">
          <p className="brand-wordmark">ViaVoip</p>
        </div>
        <h1 id="admin-title" className="login-title">
          Administração
        </h1>
        <p className="login-hint">O console de administração chega na Etapa 5. Por enquanto, use o chat normalmente.</p>
        <button type="button" className="admin-back" onClick={onBack}>
          <ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />
          Voltar ao chat
        </button>
      </div>
    </section>
  );
}
