import { z } from 'zod';
import { dispositionSummarySchema, queueSummarySchema, roleSchema } from './models.js';

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const widgetSettingsSchema = z
  .object({
    siteName: z.string().min(1).max(120),
    primaryColor: hexColorSchema,
    logoUrl: z.string().url().startsWith('https://').nullable(),
    welcomeMessage: z.string().min(1).max(300),
    requireVisitorName: z.boolean(),
    acceptingChats: z.boolean(),
    allowedOrigins: z.array(z.string().url()).max(20),
    queues: z.array(queueSummarySchema).max(50),
  })
  .strict();

export const createVisitorSessionBodySchema = z
  .object({
    sitePublicId: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9_-]+$/),
    parentOrigin: z.string().url(),
  })
  .strict();

export const publicWidgetSchema = widgetSettingsSchema;

export const visitorContextSchema = widgetSettingsSchema;

export const visitorSessionCreatedSchema = widgetSettingsSchema.extend({
  token: z.string().min(20).max(200),
});

export const loginBodySchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(200),
    password: z.string().min(1).max(200),
  })
  .strict();

export const loginResponseSchema = z
  .object({
    token: z.string().min(20).max(200),
    role: roleSchema,
    name: z.string().min(1).max(120),
  })
  .strict();

export const authMeSchema = z
  .object({
    selfId: z.string().uuid(),
    name: z.string().min(1).max(120),
    role: roleSchema,
    queues: z.array(queueSummarySchema).max(50),
    dispositions: z.array(dispositionSummarySchema).max(50),
    maxConcurrentAssignments: z.number().int().min(1).max(100),
  })
  .strict();

export const logoutResponseSchema = z
  .object({
    ok: z.literal(true),
  })
  .strict();

export type WidgetSettings = z.infer<typeof widgetSettingsSchema>;
export type CreateVisitorSessionBody = z.infer<typeof createVisitorSessionBodySchema>;
export type PublicWidget = z.infer<typeof publicWidgetSchema>;
export type VisitorContext = z.infer<typeof visitorContextSchema>;
export type VisitorSessionCreated = z.infer<typeof visitorSessionCreatedSchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type AuthMe = z.infer<typeof authMeSchema>;
