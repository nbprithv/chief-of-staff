import { eq, and, lte, isNull, isNotNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { nodes } from '../../db/schema/index.js';
import { NotFoundError } from '../../core/errors.js';
import type { CreateNodeInput, UpdateNodeInput } from '../types.js';

/**
 * Tasks service — operates on nodes of type todo, event, idea, project.
 * All queries scope to task-like types unless otherwise specified.
 */
export const tasksService = {

  async list(filters?: {
    type?:       string;
    status?:     string;
    parent_id?:  string;
    due_before?: string;
  }) {
    const conditions = [];
    if (filters?.type)       conditions.push(eq(nodes.type, filters.type as any));
    if (filters?.status)     conditions.push(eq(nodes.status, filters.status as any));
    if (filters?.parent_id)  conditions.push(eq(nodes.parent_id, filters.parent_id));
    if (filters?.due_before) conditions.push(lte(nodes.due_at, filters.due_before));

    return db
      .select()
      .from(nodes)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(nodes.created_at);
  },

  async getById(id: string) {
    const [node] = await db.select().from(nodes).where(eq(nodes.id, id));
    if (!node) throw new NotFoundError('Node', id);
    return node;
  },

  async getChildren(parent_id: string) {
    return db
      .select()
      .from(nodes)
      .where(eq(nodes.parent_id, parent_id))
      .orderBy(nodes.created_at);
  },

  async create(input: CreateNodeInput) {
    const [node] = await db
      .insert(nodes)
      .values({
        ...input,
        metadata: JSON.stringify(input.metadata ?? {}),
        status: input.status ?? 'inbox',
      })
      .returning();
    return node;
  },

  async update(id: string, input: UpdateNodeInput) {
    await tasksService.getById(id);
    const data: Record<string, unknown> = {
      ...input,
      updated_at: new Date().toISOString(),
    };
    if (input.metadata) data.metadata = JSON.stringify(input.metadata);
    if (input.status === 'done' && !input.completed_at) {
      data.completed_at = new Date().toISOString();
    }
    const [node] = await db
      .update(nodes)
      .set(data)
      .where(eq(nodes.id, id))
      .returning();
    return node;
  },

  async delete(id: string) {
    await tasksService.getById(id);
    await db.delete(nodes).where(eq(nodes.id, id));
  },

  async getInbox() {
    return db
      .select()
      .from(nodes)
      .where(and(eq(nodes.status, 'inbox'), isNull(nodes.parent_id)))
      .orderBy(nodes.created_at);
  },

  async getDueSoon(days = 3) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);
    return tasksService.list({ due_before: cutoff.toISOString() });
  },

  async getTopLevel() {
    return db
      .select()
      .from(nodes)
      .where(isNull(nodes.parent_id))
      .orderBy(nodes.priority, nodes.created_at);
  },
};
