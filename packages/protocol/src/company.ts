import { z } from 'zod';

const uuidSchema = z.string().uuid();
const instantSchema = z.string().datetime();
const personNameSchema = z.string().trim().min(1).max(120);
const shortTextSchema = z.string().trim().min(1).max(200);
const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9_-]+$/);
const passwordSchema = z.string().min(12).max(200);
const thresholdSecondsSchema = z.number().int().min(1).max(86400);
const durationSecondsSchema = z.number().int().min(0).max(8640000).nullable();
const countSchema = z.number().int().min(0).max(1_000_000);
const MAX_QUALITY_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

export const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'fuso inválido');

export const activityAuthoritySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('assigned_only') }).strict(),
  z.object({ kind: z.literal('self_service') }).strict(),
]);

export const membershipSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('active') }).strict(),
  z
    .object({
      status: z.literal('suspended'),
      suspendedAt: instantSchema,
      reason: shortTextSchema,
    })
    .strict(),
]);

export const logoSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z
    .object({
      kind: z.literal('https'),
      url: z.string().url().startsWith('https://').max(500),
    })
    .strict(),
]);

export const visitorIdentitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('anonymous_allowed') }).strict(),
  z.object({ kind: z.literal('name_required') }).strict(),
]);

export const configuredAcceptanceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('accepting') }).strict(),
  z.object({ kind: z.literal('paused'), reason: shortTextSchema }).strict(),
]);

export const effectiveAcceptanceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('accepting') }).strict(),
  z.object({ kind: z.literal('paused'), reason: shortTextSchema }).strict(),
  z
    .object({
      kind: z.literal('outside_service_window'),
      resumesAt: instantSchema,
    })
    .strict(),
]);

export const serviceWindowSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .strict();

export const serviceCalendarSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('always_open') }).strict(),
  z
    .object({
      kind: z.literal('weekly'),
      windows: z.array(serviceWindowSchema).min(1).max(21),
    })
    .strict()
    .superRefine((calendar, ctx) => {
      for (let index = 0; index < calendar.windows.length; index += 1) {
        const window = calendar.windows[index];
        if (!window || window.endMinute <= window.startMinute) {
          ctx.addIssue('janela invertida');
        }
        for (let otherIndex = 0; otherIndex < index; otherIndex += 1) {
          const other = calendar.windows[otherIndex];
          if (!window || !other || window.weekday !== other.weekday) continue;
          if (window.startMinute < other.endMinute && other.startMinute < window.endMinute) {
            ctx.addIssue('janelas sobrepostas');
          }
        }
      }
    }),
]);

export const siteAppearanceSchema = z
  .object({
    primaryColor: hexColorSchema,
    logo: logoSchema,
    welcomeMessage: z.string().trim().min(1).max(300),
    identity: visitorIdentitySchema,
  })
  .strict();

export const siteConfigurationSchema = z
  .object({
    siteId: uuidSchema,
    publicId: publicIdSchema,
    name: personNameSchema,
    appearance: siteAppearanceSchema,
    acceptance: configuredAcceptanceSchema,
    calendar: serviceCalendarSchema,
    allowedOrigins: z.array(z.string().url()).max(20),
  })
  .strict();

export const companyProfileSchema = z
  .object({
    name: personNameSchema,
    slug: z.string().trim().min(1).max(80),
    timeZone: timeZoneSchema,
    concurrencyLimit: z.number().int().min(1).max(100),
    internalHistory: z.object({ policy: z.literal('retain_until_removed') }).strict(),
  })
  .strict();

export const queueAdminSchema = z
  .object({
    id: uuidSchema,
    name: personNameSchema,
  })
  .strict();

export const dispositionPublicationSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('active') }).strict(),
  z.object({ status: z.literal('retired'), retiredAt: instantSchema }).strict(),
]);

export const dispositionAdminSchema = z
  .object({
    id: uuidSchema,
    name: personNameSchema,
    publication: dispositionPublicationSchema,
  })
  .strict();

export const surveyCommentSchema = z.enum(['enabled', 'disabled']);

export const surveySlotSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('unpublished') }).strict(),
  z
    .object({
      status: z.literal('active'),
      id: uuidSchema,
      prompt: z.string().trim().min(1).max(300),
      scale: z.number().int().min(1).max(5),
      comment: surveyCommentSchema,
    })
    .strict(),
]);

export const agentPlacementSchema = z.discriminatedUnion('role', [
  z
    .object({
      role: z.literal('agent'),
      queueIds: z.array(uuidSchema).max(50),
      activityAuthority: activityAuthoritySchema,
    })
    .strict()
    .superRefine((placement, ctx) => {
      const seen = new Set<string>();
      for (const queueId of placement.queueIds) {
        if (seen.has(queueId)) ctx.addIssue('fila repetida');
        seen.add(queueId);
      }
    }),
  z.object({ role: z.literal('supervisor') }).strict(),
  z.object({ role: z.literal('admin') }).strict(),
]);

export const agentAdminSchema = z
  .object({
    agentId: uuidSchema,
    email: z.string().email().max(200),
    name: personNameSchema,
    membership: membershipSchema,
    placement: agentPlacementSchema,
  })
  .strict();

export const slaLifeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('active'), effectiveFrom: instantSchema }).strict(),
  z
    .object({
      status: z.literal('retired'),
      effectiveFrom: instantSchema,
      retiredAt: instantSchema,
    })
    .strict(),
]);

export const slaPolicyViewSchema = z
  .object({
    id: uuidSchema,
    queueId: uuidSchema,
    queueWait: z
      .object({
        metric: z.literal('queue_wait'),
        thresholdSeconds: thresholdSecondsSchema,
      })
      .strict(),
    firstResponse: z
      .object({
        metric: z.literal('first_response'),
        thresholdSeconds: thresholdSecondsSchema,
      })
      .strict(),
    life: slaLifeSchema,
  })
  .strict();

export const companyDeskSchema = z
  .object({
    company: companyProfileSchema,
    sites: z.array(siteConfigurationSchema).max(20),
    queues: z.array(queueAdminSchema).max(50),
    dispositions: z.array(dispositionAdminSchema).max(50),
    survey: surveySlotSchema,
    agents: z.array(agentAdminSchema).max(500),
    slaPolicies: z.array(slaPolicyViewSchema).max(200),
  })
  .strict();

export const companyCommandSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('agent.create'),
      email: z.string().trim().toLowerCase().email().max(200),
      name: personNameSchema,
      password: passwordSchema,
      placement: agentPlacementSchema,
    })
    .strict(),
  z.object({ kind: z.literal('agent.suspend'), agentId: uuidSchema, reason: shortTextSchema }).strict(),
  z.object({ kind: z.literal('agent.reactivate'), agentId: uuidSchema }).strict(),
  z
    .object({
      kind: z.literal('agent.role_change'),
      agentId: uuidSchema,
      placement: agentPlacementSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('agent.queues_replace'),
      agentId: uuidSchema,
      queueIds: z.array(uuidSchema).max(50),
    })
    .strict()
    .superRefine((command, ctx) => {
      const seen = new Set<string>();
      for (const queueId of command.queueIds) {
        if (seen.has(queueId)) ctx.addIssue('fila repetida');
        seen.add(queueId);
      }
    }),
  z
    .object({
      kind: z.literal('agent.activity_authority'),
      agentId: uuidSchema,
      activityAuthority: activityAuthoritySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('agent.credential_reset'),
      agentId: uuidSchema,
      password: passwordSchema,
    })
    .strict(),
  z.object({ kind: z.literal('agent.sessions_revoke'), agentId: uuidSchema }).strict(),
  z.object({ kind: z.literal('queue.create'), name: personNameSchema }).strict(),
  z.object({ kind: z.literal('queue.rename'), queueId: uuidSchema, name: personNameSchema }).strict(),
  z.object({ kind: z.literal('disposition.create'), name: personNameSchema }).strict(),
  z
    .object({
      kind: z.literal('disposition.rename'),
      dispositionId: uuidSchema,
      name: personNameSchema,
    })
    .strict(),
  z.object({ kind: z.literal('disposition.retire'), dispositionId: uuidSchema }).strict(),
  z
    .object({
      kind: z.literal('survey.publish'),
      prompt: z.string().trim().min(1).max(300),
      scale: z.number().int().min(1).max(5),
      comment: surveyCommentSchema,
    })
    .strict(),
  z.object({ kind: z.literal('company.rename'), name: personNameSchema }).strict(),
  z
    .object({
      kind: z.literal('company.concurrency_limit'),
      max: z.number().int().min(1).max(100),
    })
    .strict(),
  z.object({ kind: z.literal('company.time_zone'), timeZone: timeZoneSchema }).strict(),
  z.object({ kind: z.literal('site.create'), publicId: publicIdSchema, name: personNameSchema }).strict(),
  z
    .object({
      kind: z.literal('site.appearance_replace'),
      siteId: uuidSchema,
      name: personNameSchema,
      appearance: siteAppearanceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('site.acceptance_set'),
      siteId: uuidSchema,
      acceptance: configuredAcceptanceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('site.origins_replace'),
      siteId: uuidSchema,
      allowedOrigins: z.array(z.string().url()).max(20),
    })
    .strict()
    .superRefine((command, ctx) => {
      const seen = new Set<string>();
      for (const origin of command.allowedOrigins) {
        if (seen.has(origin)) ctx.addIssue('origem repetida');
        seen.add(origin);
      }
    }),
  z
    .object({
      kind: z.literal('site.service_windows_replace'),
      siteId: uuidSchema,
      calendar: serviceCalendarSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('sla.publish'),
      queueId: uuidSchema,
      effectiveFrom: instantSchema,
      queueWaitThresholdSeconds: thresholdSecondsSchema,
      firstResponseThresholdSeconds: thresholdSecondsSchema,
    })
    .strict(),
  z.object({ kind: z.literal('sla.retire'), queueId: uuidSchema }).strict(),
]);

export const qualityScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tenant') }).strict(),
  z.object({ kind: z.literal('sector'), sectorId: uuidSchema }).strict(),
  z.object({ kind: z.literal('queue'), queueId: uuidSchema }).strict(),
]);

export const qualityReportQuerySchema = z
  .object({
    scopeKind: z.enum(['tenant', 'sector', 'queue']),
    sectorId: uuidSchema.optional(),
    queueId: uuidSchema.optional(),
    from: instantSchema,
    to: instantSchema,
  })
  .strict()
  .superRefine((query, ctx) => {
    if (query.scopeKind === 'tenant' && (query.sectorId !== undefined || query.queueId !== undefined)) {
      ctx.addIssue('escopo do tenant não leva identificador');
    }
    if (query.scopeKind === 'sector' && (query.sectorId === undefined || query.queueId !== undefined)) {
      ctx.addIssue('escopo de setor exige sectorId');
    }
    if (query.scopeKind === 'queue' && (query.queueId === undefined || query.sectorId !== undefined)) {
      ctx.addIssue('escopo de fila exige queueId');
    }
    const from = Date.parse(query.from);
    const to = Date.parse(query.to);
    if (Number.isNaN(from) || Number.isNaN(to) || from >= to || to - from > MAX_QUALITY_WINDOW_MS) {
      ctx.addIssue('período inválido');
    }
  })
  .transform((query) => {
    const window = { from: query.from, to: query.to };
    switch (query.scopeKind) {
      case 'tenant':
        return { scope: { kind: 'tenant' as const }, ...window };
      case 'sector': {
        if (!query.sectorId) throw new Error('setor obrigatório');
        return { scope: { kind: 'sector' as const, sectorId: query.sectorId }, ...window };
      }
      case 'queue': {
        if (!query.queueId) throw new Error('fila obrigatória');
        return { scope: { kind: 'queue' as const, queueId: query.queueId }, ...window };
      }
      default: {
        const unexpected: never = query.scopeKind;
        return unexpected;
      }
    }
  });

export const durationSummarySchema = z
  .object({
    samples: countSchema,
    p50Seconds: durationSecondsSchema,
    p90Seconds: durationSecondsSchema,
    maxSeconds: durationSecondsSchema,
  })
  .strict()
  .superRefine((summary, ctx) => {
    const empty = summary.samples === 0;
    const missing = summary.p50Seconds === null && summary.p90Seconds === null && summary.maxSeconds === null;
    const present = summary.p50Seconds !== null && summary.p90Seconds !== null && summary.maxSeconds !== null;
    if (empty ? !missing : !present) ctx.addIssue('resumo de duração inconsistente');
  });

export const slaTallySchema = z
  .object({
    within: countSchema,
    breached: countSchema,
    notApplicable: countSchema,
  })
  .strict();

export const surveySummarySchema = z
  .object({
    responses: countSchema,
    averageScore: z.number().min(1).max(5).nullable(),
    comments: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('none') }).strict(),
      z.object({ kind: z.literal('some'), count: z.number().int().min(1).max(1_000_000) }).strict(),
    ]),
  })
  .strict()
  .superRefine((summary, ctx) => {
    if (summary.responses === 0 && (summary.averageScore !== null || summary.comments.kind !== 'none')) {
      ctx.addIssue('pesquisa vazia inconsistente');
    }
    if (summary.responses > 0 && summary.averageScore === null) ctx.addIssue('média ausente');
  });

export const qualityReportSchema = z
  .object({
    scope: qualityScopeSchema,
    window: z.object({ from: instantSchema, to: instantSchema }).strict(),
    queueWait: durationSummarySchema,
    firstResponse: durationSummarySchema,
    handleTime: durationSummarySchema,
    completions: z
      .object({
        classified: countSchema,
        leftWhileQueued: countSchema,
        stillOpen: countSchema,
        unreadable: countSchema,
      })
      .strict(),
    survey: surveySummarySchema,
    sla: z
      .object({
        queueWait: slaTallySchema,
        firstResponse: slaTallySchema,
      })
      .strict(),
    presenceSeconds: z
      .object({
        available: countSchema,
        busy: countSchema,
        away: countSchema,
        offline: countSchema,
      })
      .strict(),
  })
  .strict();

export const knownAuditActions = [
  'conversation.watch',
  'sector.save',
  'sector.member_added',
  'sector.member_removed',
  'announcement.publish',
  'announcement.update',
  'announcement.archive',
  'activity.type_save',
  'activity.assign',
  'activity.finish',
  'agent.create',
  'agent.suspend',
  'agent.reactivate',
  'agent.role_change',
  'agent.queues_replace',
  'agent.activity_authority',
  'agent.credential_reset',
  'agent.sessions_revoke',
  'queue.create',
  'queue.rename',
  'disposition.create',
  'disposition.rename',
  'disposition.retire',
  'survey.publish',
  'company.rename',
  'company.concurrency_limit',
  'company.time_zone',
  'site.create',
  'site.appearance_replace',
  'site.acceptance_set',
  'site.origins_replace',
  'site.service_windows_replace',
  'sla.publish',
  'sla.retire',
] as const;

export const knownAuditActionSchema = z.enum(knownAuditActions);

function auditKind<Kind extends (typeof knownAuditActions)[number]>(kind: Kind) {
  return z.object({ kind: z.literal(kind) }).strict();
}

export const auditActionSchema = z.discriminatedUnion('kind', [
  auditKind('conversation.watch'),
  auditKind('sector.save'),
  auditKind('sector.member_added'),
  auditKind('sector.member_removed'),
  auditKind('announcement.publish'),
  auditKind('announcement.update'),
  auditKind('announcement.archive'),
  auditKind('activity.type_save'),
  auditKind('activity.assign'),
  auditKind('activity.finish'),
  auditKind('agent.create'),
  auditKind('agent.suspend'),
  auditKind('agent.reactivate'),
  auditKind('agent.role_change'),
  auditKind('agent.queues_replace'),
  auditKind('agent.activity_authority'),
  auditKind('agent.credential_reset'),
  auditKind('agent.sessions_revoke'),
  auditKind('queue.create'),
  auditKind('queue.rename'),
  auditKind('disposition.create'),
  auditKind('disposition.rename'),
  auditKind('disposition.retire'),
  auditKind('survey.publish'),
  auditKind('company.rename'),
  auditKind('company.concurrency_limit'),
  auditKind('company.time_zone'),
  auditKind('site.create'),
  auditKind('site.appearance_replace'),
  auditKind('site.acceptance_set'),
  auditKind('site.origins_replace'),
  auditKind('site.service_windows_replace'),
  auditKind('sla.publish'),
  auditKind('sla.retire'),
  z.object({ kind: z.literal('unrecognized'), raw: z.string().min(1).max(80) }).strict(),
]);

export const auditResourceSchema = z.discriminatedUnion('presence', [
  z.object({ presence: z.literal('none'), type: z.string().min(1).max(40) }).strict(),
  z.object({ presence: z.literal('id'), type: z.string().min(1).max(40), id: uuidSchema }).strict(),
]);

export const auditEntrySchema = z
  .object({
    id: uuidSchema,
    at: instantSchema,
    actorId: uuidSchema,
    actorName: personNameSchema,
    action: auditActionSchema,
    resource: auditResourceSchema,
  })
  .strict();

export const auditPageSchema = z
  .object({
    entries: z.array(auditEntrySchema).max(100),
    nextCursor: z.string().min(1).max(200).nullable(),
  })
  .strict();

export const auditQuerySchema = z
  .object({
    from: instantSchema.optional(),
    to: instantSchema.optional(),
    action: knownAuditActionSchema.optional(),
    cursor: z.string().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((query, ctx) => {
    const hasFrom = query.from !== undefined;
    const hasTo = query.to !== undefined;
    if (hasFrom !== hasTo) ctx.addIssue('período incompleto');
    if (!query.from || !query.to) return;
    const from = Date.parse(query.from);
    const to = Date.parse(query.to);
    if (Number.isNaN(from) || Number.isNaN(to) || from >= to || to - from > MAX_QUALITY_WINDOW_MS) {
      ctx.addIssue('período inválido');
    }
  });

export type ActivityAuthority = z.infer<typeof activityAuthoritySchema>;
export type Membership = z.infer<typeof membershipSchema>;
export type Logo = z.infer<typeof logoSchema>;
export type VisitorIdentity = z.infer<typeof visitorIdentitySchema>;
export type ConfiguredAcceptance = z.infer<typeof configuredAcceptanceSchema>;
export type EffectiveAcceptance = z.infer<typeof effectiveAcceptanceSchema>;
export type ServiceWindow = z.infer<typeof serviceWindowSchema>;
export type ServiceCalendar = z.infer<typeof serviceCalendarSchema>;
export type SiteAppearance = z.infer<typeof siteAppearanceSchema>;
export type SiteConfiguration = z.infer<typeof siteConfigurationSchema>;
export type CompanyProfile = z.infer<typeof companyProfileSchema>;
export type QueueAdmin = z.infer<typeof queueAdminSchema>;
export type DispositionAdmin = z.infer<typeof dispositionAdminSchema>;
export type SurveySlot = z.infer<typeof surveySlotSchema>;
export type AgentPlacement = z.infer<typeof agentPlacementSchema>;
export type AgentAdmin = z.infer<typeof agentAdminSchema>;
export type SlaPolicyView = z.infer<typeof slaPolicyViewSchema>;
export type CompanyDesk = z.infer<typeof companyDeskSchema>;
export type CompanyCommand = z.infer<typeof companyCommandSchema>;
export type QualityScope = z.infer<typeof qualityScopeSchema>;
export type QualityQuery = z.infer<typeof qualityReportQuerySchema>;
export type QualityReport = z.infer<typeof qualityReportSchema>;
export type KnownAuditAction = z.infer<typeof knownAuditActionSchema>;
export type AuditAction = z.infer<typeof auditActionSchema>;
export type AuditEntry = z.infer<typeof auditEntrySchema>;
export type AuditPage = z.infer<typeof auditPageSchema>;
export type AuditQuery = z.infer<typeof auditQuerySchema>;
