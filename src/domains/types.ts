import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Shared base
// ─────────────────────────────────────────────────────────────────────────────

export const BaseRecordSchema = z.object({
  id:         z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const PaginationSchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(200).default(50),
});

export type Pagination = z.infer<typeof PaginationSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

export const NodeType = z.enum([
  'idea', 'project', 'todo', 'event', 'grocery_item', 'habit',
]);

export const NodeStatus = z.enum([
  'inbox', 'active', 'todo', 'in_progress', 'done', 'cancelled', 'archived',
]);

export const NodePriority = z.enum(['p0', 'p1', 'p2', 'p3']);

export type NodeTypeValue     = z.infer<typeof NodeType>;
export type NodeStatusValue   = z.infer<typeof NodeStatus>;
export type NodePriorityValue = z.infer<typeof NodePriority>;

// ─────────────────────────────────────────────────────────────────────────────
// Metadata schemas (stored as JSON in nodes.metadata)
// ─────────────────────────────────────────────────────────────────────────────

export const HabitMetadataSchema = z.object({
  frequency:   z.enum(['daily', 'weekdays', 'weekly', 'custom']).default('daily'),
  target_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

export const EventMetadataSchema = z.object({
  attendees:        z.array(z.object({
    name:     z.string().optional(),
    email:    z.string().email(),
    response: z.enum(['accepted', 'declined', 'tentative', 'awaiting']).default('awaiting'),
  })).default([]),
  recurrence_rule:  z.string().optional(),
  all_day:          z.boolean().default(false),
  gcal_id:          z.string().optional(),
});

export const GroceryMetadataSchema = z.object({
  reorder_threshold: z.number().positive().optional(),
  typical_quantity:  z.number().positive().optional(),
});

export type HabitMetadata   = z.infer<typeof HabitMetadataSchema>;
export type EventMetadata   = z.infer<typeof EventMetadataSchema>;
export type GroceryMetadata = z.infer<typeof GroceryMetadataSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Node — create / update / read
// ─────────────────────────────────────────────────────────────────────────────

export const CreateNodeSchema = z.object({
  type:            NodeType,
  title:           z.string().min(1).max(500),
  description:     z.string().optional(),
  parent_id:       z.string().optional(),
  status:          NodeStatus.optional(),
  priority:        NodePriority.default('p2'),
  // scheduling
  starts_at:       z.string().datetime().optional(),
  ends_at:         z.string().datetime().optional(),
  due_at:          z.string().datetime().optional(),
  // location
  location:        z.string().optional(),
  // grocery
  is_p0:           z.boolean().default(false),
  quantity:        z.number().positive().optional(),
  unit:            z.string().optional(),
  shelf_life_days: z.number().int().positive().optional(),
  // type-specific extras
  metadata:        z.record(z.unknown()).default({}),
});

export const UpdateNodeSchema = CreateNodeSchema.partial().extend({
  completed_at: z.string().datetime().optional(),
});

export const NodeSchema = BaseRecordSchema.extend({
  parent_id:       z.string().nullable(),
  type:            NodeType,
  title:           z.string(),
  description:     z.string().nullable(),
  status:          NodeStatus,
  priority:        NodePriority,
  starts_at:       z.string().nullable(),
  ends_at:         z.string().nullable(),
  due_at:          z.string().nullable(),
  completed_at:    z.string().nullable(),
  location:        z.string().nullable(),
  is_p0:           z.boolean(),
  quantity:        z.number().nullable(),
  unit:            z.string().nullable(),
  shelf_life_days: z.number().nullable(),
  metadata:        z.string(), // raw JSON — parse with parseMetadata()
});

export type CreateNodeInput = z.infer<typeof CreateNodeSchema>;
export type UpdateNodeInput = z.infer<typeof UpdateNodeSchema>;
export type Node            = z.infer<typeof NodeSchema>;

/** Parse a node's metadata JSON string into a typed object */
export function parseMetadata<T = Record<string, unknown>>(raw: string): T {
  try { return JSON.parse(raw) as T; } catch { return {} as T; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Email
// ─────────────────────────────────────────────────────────────────────────────

export const CreateEmailSchema = z.object({
  gmail_id:     z.string(),
  thread_id:    z.string().optional(),
  subject:      z.string().max(500),
  sender_email: z.string().email(),
  sender_name:  z.string().optional(),
  recipients:   z.array(z.string().email()).default([]),
  body_summary: z.string().optional(),
  body_raw:     z.string().optional(),
  labels:       z.array(z.string()).default(['inbox']),
  received_at:  z.string().datetime(),
});

export const UpdateEmailSchema = z.object({
  body_summary: z.string().optional(),
  labels:       z.array(z.string()).optional(),
  triaged:      z.boolean().optional(),
});

export const EmailSchema = BaseRecordSchema.extend({
  gmail_id:     z.string(),
  thread_id:    z.string().nullable(),
  content_hash: z.string(),
  subject:      z.string(),
  sender_email: z.string(),
  sender_name:  z.string().nullable(),
  recipients:   z.string(),  // raw JSON
  body_summary: z.string().nullable(),
  body_raw:     z.string().nullable(),
  labels:       z.string(),  // raw JSON
  triaged:      z.boolean(),
  received_at:  z.string(),
});

export type CreateEmailInput = z.infer<typeof CreateEmailSchema>;
export type UpdateEmailInput = z.infer<typeof UpdateEmailSchema>;
export type Email            = z.infer<typeof EmailSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Node–Email link
// ─────────────────────────────────────────────────────────────────────────────

export const LinkType = z.enum(['generated_from', 'referenced_in', 'follow_up_for']);

export const CreateNodeEmailLinkSchema = z.object({
  node_id:   z.string(),
  email_id:  z.string(),
  link_type: LinkType.default('generated_from'),
});

export type CreateNodeEmailLinkInput = z.infer<typeof CreateNodeEmailLinkSchema>;
export type LinkTypeValue            = z.infer<typeof LinkType>;

// ─────────────────────────────────────────────────────────────────────────────
// Habit log
// ─────────────────────────────────────────────────────────────────────────────

export const HabitLogStatus = z.enum(['done', 'skipped', 'missed']);

export const CreateHabitLogSchema = z.object({
  node_id:  z.string(),
  status:   HabitLogStatus,
  log_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  notes:    z.string().optional(),
});

export type CreateHabitLogInput = z.infer<typeof CreateHabitLogSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Consumption log
// ─────────────────────────────────────────────────────────────────────────────

export const CreateConsumptionLogSchema = z.object({
  node_id:       z.string(),
  quantity_used: z.number().positive(),
  notes:         z.string().optional(),
  logged_at:     z.string().datetime().optional(),
});

export type CreateConsumptionLogInput = z.infer<typeof CreateConsumptionLogSchema>;
