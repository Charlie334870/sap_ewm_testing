import { z } from "zod";
import {
  ENVIRONMENT_KINDS,
  EWM_DEPLOYMENTS,
  EWM_PROCESSES,
  PROJECT_ROLES,
  SAP_ADAPTERS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from "./enums";

/** Request bodies accepted by the API. The web app uses the same schemas for its forms. */

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const PASSWORD_MIN_LENGTH = 12;
const password = z.string().min(PASSWORD_MIN_LENGTH).max(200);

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: password,
});

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: trimmed(120),
  password,
  isOrgAdmin: z.boolean().default(false),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({ isActive: z.boolean() });

export const resetPasswordSchema = z.object({ password });

export const createProjectSchema = z.object({
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, "2 to 10 letters or digits, starting with a letter"),
  name: trimmed(120),
  description: z.string().trim().max(2000).default(""),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const addMemberSchema = z.object({
  userId: z.uuid(),
  role: z.enum(PROJECT_ROLES),
});

export const createSapSystemSchema = z.object({
  name: trimmed(120),
  sid: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{2}$/, "A system ID is 3 characters, for example S4D"),
  client: z
    .string()
    .trim()
    .regex(/^\d{3}$/, "A client is 3 digits, for example 100"),
  environment: z.enum(ENVIRONMENT_KINDS),
  deployment: z.enum(EWM_DEPLOYMENTS).default("embedded"),
  adapter: z.enum(SAP_ADAPTERS).default("simulated"),
});
export type CreateSapSystemInput = z.infer<typeof createSapSystemSchema>;

export const createTicketSchema = z.object({
  title: trimmed(200),
  description: z.string().trim().max(10000).default(""),
  priority: z.enum(TICKET_PRIORITIES).default("medium"),
  process: z.enum(EWM_PROCESSES).default("unknown"),
  warehouse: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,4}$/, "A warehouse number is up to 4 letters or digits")
    .optional(),
  sapSystemId: z.uuid().optional(),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const commentSchema = z.object({ body: trimmed(10000) });

export const changeTicketStatusSchema = z.object({
  status: z.enum(TICKET_STATUSES),
  note: z.string().trim().max(2000).optional(),
});

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().positive().optional(),
});
