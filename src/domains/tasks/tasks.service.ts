import { eq, and, lte, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { nodes } from '../../db/schema/index.js';
import { NotFoundError } from '../../core/errors.js';
import type { CreateNodeInput, UpdateNodeInput } from '../types.js';

/**
 * Tasks service — operates on nodes of type todo, event, idea, project.
 * All queries scope to the given userId.
 */
export const tasksService = {

  async list(filters: {
    type?:       string;
    status?:     string;
    parent_id?:  string;
    due_before?: string;
  } | undefined, userId: string) {
    const conditions = [eq(nodes.user_id, userId)];
    if (filters?.type)       conditions.push(eq(nodes.type, filters.type as any));
    if (filters?.status)     conditions.push(eq(nodes.status, filters.status as any));
    if (filters?.parent_id)  conditions.push(eq(nodes.parent_id, filters.parent_id));
    if (filters?.due_before) conditions.push(lte(nodes.due_at, filters.due_before));

    return db
      .select()
      .from(nodes)
      .where(and(...conditions))
      .orderBy(nodes.created_at);
  },

  async getById(id: string, userId: string) {
    const [node] = await db
      .select()
      .from(nodes)
      .where(and(eq(nodes.id, id), eq(nodes.user_id, userId)));
    if (!node) throw new NotFoundError('Node', id);
    return node;
  },

  async getChildren(parent_id: string, userId: string) {
    return db
      .select()
      .from(nodes)
      .where(and(eq(nodes.parent_id, parent_id), eq(nodes.user_id, userId)))
      .orderBy(nodes.created_at);
  },

  async create(input: CreateNodeInput, userId: string) {
    const [node] = await db
      .insert(nodes)
      .values({
        ...input,
        user_id:  userId,
        metadata: JSON.stringify(input.metadata ?? {}),
        status:   input.status ?? 'inbox',
      })
      .returning();
    return node;
  },

  async update(id: string, input: UpdateNodeInput, userId: string) {
    await tasksService.getById(id, userId);
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
      .where(and(eq(nodes.id, id), eq(nodes.user_id, userId)))
      .returning();
    return node;
  },

  async delete(id: string, userId: string) {
    await tasksService.getById(id, userId);
    await db.delete(nodes).where(and(eq(nodes.id, id), eq(nodes.user_id, userId)));
  },

  async getInbox(userId: string) {
    return db
      .select()
      .from(nodes)
      .where(and(eq(nodes.status, 'inbox'), isNull(nodes.parent_id), eq(nodes.user_id, userId)))
      .orderBy(nodes.created_at);
  },

  async getDueSoon(days: number, userId: string) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);
    return tasksService.list({ due_before: cutoff.toISOString() }, userId);
  },

  async getTopLevel(userId: string) {
    return db
      .select()
      .from(nodes)
      .where(and(isNull(nodes.parent_id), eq(nodes.user_id, userId)))
      .orderBy(nodes.priority, nodes.created_at);
  },
};
