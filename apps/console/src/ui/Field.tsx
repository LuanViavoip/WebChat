import type { ComponentProps, ReactNode } from 'react';

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="ui-field">
      <span className="ui-field__label">{label}</span>
      {children}
      {hint && !error ? <span className="ui-field__hint">{hint}</span> : null}
      {error ? <span className="ui-field__error" role="alert">{error}</span> : null}
    </label>
  );
}

function cx(base: string, extra: string | undefined): string {
  return extra ? `${base} ${extra}` : base;
}

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={cx('ui-control', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: ComponentProps<'select'>) {
  return <select className={cx('ui-control ui-control--select', className)} {...rest}>{children}</select>;
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={cx('ui-control ui-control--textarea', className)} {...rest} />;
}
