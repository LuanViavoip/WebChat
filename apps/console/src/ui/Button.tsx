import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
};

export function Button({ variant = 'primary', size = 'md', icon, className, children, type = 'button', ...rest }: Props) {
  const iconOnly = Boolean(icon) && !children;
  const classes = ['ui-button', `ui-button--${variant}`, `ui-button--${size}`, iconOnly ? 'ui-button--icon' : '', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} {...rest}>
      {icon ? <span className="ui-button__icon" aria-hidden="true">{icon}</span> : null}
      {children}
    </button>
  );
}
