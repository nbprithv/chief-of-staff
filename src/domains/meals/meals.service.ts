import { eq, and, gte, lte } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { nodes } from '../../db/schema/index.js';
import { NotFoundError } from '../../core/errors.js';
import type { CreateNodeInput } from '../types.js';

function dayBounds(dateStr: string): { start: string; end: string } {
  return {
    start: `${dateStr}T00:00:00.000Z`,
    end:   `${dateStr}T23:59:59.999Z`,
  };
}

function weekBounds(weekStart: string): { start: string; end: string } {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 7);
  return {
    start: `${weekStart}T00:00:00.000Z`,
    end:   end.toISOString(),
  };
}

export const mealsService = {

  async list(filters: { date?: string; week_start?: string }, userId: string) {
    const conditions = [eq(nodes.user_id, userId), eq(nodes.type, 'meal' as any)];

    if (filters.date) {
      const { start, end } = dayBounds(filters.date);
      conditions.push(gte(nodes.due_at, start), lte(nodes.due_at, end));
    } else if (filters.week_start) {
      const { start, end } = weekBounds(filters.week_start);
      conditions.push(gte(nodes.due_at, start), lte(nodes.due_at, end));
    }

    return db.select().from(nodes).where(and(...conditions)).orderBy(nodes.due_at);
  },

  async create(input: CreateNodeInput, userId: string) {
    const [meal] = await db
      .insert(nodes)
      .values({
        ...input,
        type:     'meal' as any,
        user_id:  userId,
        metadata: JSON.stringify(input.metadata ?? {}),
        status:   input.status ?? 'active',
      })
      .returning();
    return meal;
  },

  async delete(id: string, userId: string) {
    const [existing] = await db
      .select()
      .from(nodes)
      .where(and(eq(nodes.id, id), eq(nodes.user_id, userId)));
    if (!existing) throw new NotFoundError('Meal', id);
    await db.delete(nodes).where(and(eq(nodes.id, id), eq(nodes.user_id, userId)));
  },

  /**
   * Reads all meals in the given week, extracts unique ingredients from metadata,
   * and creates grocery_item nodes for any ingredient not already tracked.
   * Returns the list of newly created nodes.
   */
  async generateGroceryList(weekStart: string | undefined, userId: string) {
    const start = weekStart ?? new Date().toISOString().slice(0, 10);
    const meals = await this.list({ week_start: start }, userId);

    // Aggregate ingredients across all meals
    const aggregated = new Map<string, { name: string; quantity: number; unit: string }>();
    for (const meal of meals) {
      let meta: { ingredients?: Array<{ name: string; quantity?: number; unit?: string }> } = {};
      try { meta = JSON.parse(meal.metadata || '{}'); } catch { /* skip */ }
      for (const ing of meta.ingredients ?? []) {
        const key = ing.name.trim().toLowerCase();
        const existing = aggregated.get(key);
        if (existing && existing.unit === (ing.unit ?? '')) {
          existing.quantity += ing.quantity ?? 1;
        } else {
          aggregated.set(key, { name: ing.name.trim(), quantity: ing.quantity ?? 1, unit: ing.unit ?? '' });
        }
      }
    }

    const created = [];
    for (const [, ing] of aggregated) {
      // Only create if no grocery_item with this title already exists
      const [existing] = await db
        .select()
        .from(nodes)
        .where(and(
          eq(nodes.user_id, userId),
          eq(nodes.type,    'grocery_item'),
          eq(nodes.title,   ing.name),
        ));
      if (!existing) {
        const [node] = await db
          .insert(nodes)
          .values({
            user_id:  userId,
            type:     'grocery_item',
            title:    ing.name,
            quantity: ing.quantity,
            unit:     ing.unit || null,
            status:   'active',
            priority: 'p1',
            metadata: '{}',
          })
          .returning();
        created.push(node);
      }
    }
    return created;
  },
};
