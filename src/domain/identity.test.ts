import { makeDirectory, makeIlha, makeUser, seedDirectory, T1, T2, uid, iid } from '../test/domainFixtures';
import { CAPABILITIES } from './capabilities';
import { parseStaffUser, supervisorOf, validateDirectory, type Agent } from './identity';

describe('validateDirectory', () => {
  it('aceita o seed válido', () => {
    const d = seedDirectory();
    expect(validateDirectory(d)).toEqual({ ok: true, value: d });
  });

  it('cross-tenant: usuário ou ilha de outro tenant', () => {
    const d = seedDirectory();
    const intruso = makeUser('agent', 'intruso', { tenantId: T2, ilhaId: iid('ilha-1') });
    expect(validateDirectory(makeDirectory(T1, [...Object.values(d.users), intruso], Object.values(d.ilhas)))).toEqual({
      ok: false,
      error: 'cross-tenant',
    });
    const ilhaB = makeIlha('ilha-b', 'sup-1', T2);
    expect(validateDirectory(makeDirectory(T1, Object.values(d.users), [...Object.values(d.ilhas), ilhaB]))).toEqual({
      ok: false,
      error: 'cross-tenant',
    });
  });

  it('orphan-agent: ilha inexistente ou supervisor que não existe/não é supervisor', () => {
    const d = seedDirectory();
    const semIlha = makeUser('agent', 'sem-ilha', { ilhaId: iid('nao-existe') });
    expect(validateDirectory(makeDirectory(T1, [...Object.values(d.users), semIlha], Object.values(d.ilhas)))).toEqual({
      ok: false,
      error: 'orphan-agent',
    });
    const ilhaSemSup = makeIlha('ilha-1', 'fantasma');
    const users = Object.values(d.users);
    expect(validateDirectory(makeDirectory(T1, users, [ilhaSemSup, makeIlha('ilha-2', 'sup-2')]))).toEqual({
      ok: false,
      error: 'orphan-agent',
    });
    const ilhaComAgente = makeIlha('ilha-1', 'ag-2');
    expect(validateDirectory(makeDirectory(T1, users, [ilhaComAgente, makeIlha('ilha-2', 'sup-2')]))).toEqual({
      ok: false,
      error: 'orphan-agent',
    });
  });

  it('grant-above-ceiling: agente com capacidade de supervisor, supervisor com admin.console', () => {
    const d = seedDirectory();
    const agenteForte = makeUser('agent', 'ag-1', { grants: ['chat.use', 'group.manage'], ilhaId: iid('ilha-1') });
    const withAgent = { ...d, users: { ...d.users, [uid('ag-1')]: agenteForte } };
    expect(validateDirectory(withAgent)).toEqual({ ok: false, error: 'grant-above-ceiling' });
    const supForte = makeUser('supervisor', 'sup-1', { grants: ['chat.use', 'admin.console'] });
    const withSup = { ...d, users: { ...d.users, [uid('sup-1')]: supForte } };
    expect(validateDirectory(withSup)).toEqual({ ok: false, error: 'grant-above-ceiling' });
  });

  it('multiple-admins: um admin por empresa', () => {
    const d = seedDirectory();
    const segundo = makeUser('admin', 'admin-2');
    expect(validateDirectory(makeDirectory(T1, [...Object.values(d.users), segundo], Object.values(d.ilhas)))).toEqual({
      ok: false,
      error: 'multiple-admins',
    });
  });

  it('aceita diretório sem admin (provisionamento externo) e diretório vazio', () => {
    expect(validateDirectory(makeDirectory(T1, [], [])).ok).toBe(true);
  });
});

describe('supervisorOf', () => {
  it('devolve o supervisor da ilha do agente', () => {
    const d = seedDirectory();
    expect(supervisorOf(d, d.users[uid('ag-3')] as Agent)?.id).toBe('sup-2');
  });

  it('undefined para ilha ou supervisor ausente', () => {
    const d = seedDirectory();
    const orfao = makeUser('agent', 'o', { ilhaId: iid('x') }) as Agent;
    expect(supervisorOf(d, orfao)).toBeUndefined();
  });
});

describe('parseStaffUser', () => {
  const raw = { id: 'u1', tenantId: 't1', name: 'Ana', active: true, grants: ['chat.use'] };

  it('rejeita client', () => {
    expect(parseStaffUser({ ...raw, role: 'client' })).toEqual({ error: 'client-not-supported' });
  });

  it('aceita admin, supervisor e agente (com ilhaId)', () => {
    const admin = parseStaffUser({ ...raw, role: 'admin' });
    expect('error' in admin).toBe(false);
    expect('role' in admin && admin.role).toBe('admin');
    const agent = parseStaffUser({ ...raw, role: 'agent', ilhaId: 'i1' });
    expect('role' in agent && agent.role === 'agent' && agent.ilhaId).toBe('i1');
    expect('grants' in agent && agent.grants.has('chat.use')).toBe(true);
    expect('role' in parseStaffUser({ ...raw, role: 'supervisor' })).toBe(true);
  });

  it('rejeita o que é inválido', () => {
    expect(parseStaffUser(null)).toEqual({ error: 'invalid' });
    expect(parseStaffUser('x')).toEqual({ error: 'invalid' });
    expect(parseStaffUser({ ...raw, role: 'agent' })).toEqual({ error: 'invalid' }); // sem ilhaId
    expect(parseStaffUser({ ...raw, role: 'dono' })).toEqual({ error: 'invalid' });
    expect(parseStaffUser({ ...raw, role: 'admin', grants: ['voar'] })).toEqual({ error: 'invalid' });
    expect(parseStaffUser({ ...raw, role: 'admin', grants: 'chat.use' })).toEqual({ error: 'invalid' });
    expect(parseStaffUser({ ...raw, role: 'admin', active: 'sim' })).toEqual({ error: 'invalid' });
    expect(parseStaffUser({ ...raw, role: 'admin', id: '' })).toEqual({ error: 'invalid' });
  });

  it('o catálogo inteiro é aceito como grants', () => {
    const parsed = parseStaffUser({ ...raw, role: 'admin', grants: [...CAPABILITIES] });
    expect('grants' in parsed && parsed.grants.size).toBe(CAPABILITIES.length);
  });
});
