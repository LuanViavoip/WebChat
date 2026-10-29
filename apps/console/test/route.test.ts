import { describe, expect, it } from 'vitest';
import { parseHashRoute, routeHash } from '../src/ui/route.js';

type Page = 'home' | 'inbox' | 'admin';
const slugs = { home: 'inicio', inbox: 'caixa-de-entrada', admin: 'administracao' } as const;
const allowed: Page[] = ['home', 'inbox'];

describe('parseHashRoute', () => {
  it('reconhece o slug depois de #/', () => {
    expect(parseHashRoute('#/caixa-de-entrada', slugs, allowed, 'home')).toBe('inbox');
  });

  it('aceita hash sem a barra e ignora sufixos de caminho e query', () => {
    expect(parseHashRoute('#inicio', slugs, allowed, 'inbox')).toBe('home');
    expect(parseHashRoute('#/caixa-de-entrada/detalhe', slugs, allowed, 'home')).toBe('inbox');
    expect(parseHashRoute('#/caixa-de-entrada?x=1', slugs, allowed, 'home')).toBe('inbox');
  });

  it('cai na rota padrão quando o hash é vazio ou desconhecido', () => {
    expect(parseHashRoute('', slugs, allowed, 'home')).toBe('home');
    expect(parseHashRoute('#', slugs, allowed, 'home')).toBe('home');
    expect(parseHashRoute('#/nao-existe', slugs, allowed, 'home')).toBe('home');
  });

  it('não permite rotas fora da lista do papel', () => {
    expect(parseHashRoute('#/administracao', slugs, allowed, 'home')).toBe('home');
  });
});

describe('routeHash', () => {
  it('monta o hash a partir do slug', () => {
    expect(routeHash('inbox', slugs)).toBe('#/caixa-de-entrada');
  });
});
