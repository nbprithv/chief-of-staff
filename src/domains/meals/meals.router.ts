import type { FastifyInstance } from 'fastify';
import { mealsService } from './meals.service.js';
import { CreateNodeSchema } from '../types.js';
import { ValidationError } from '../../core/errors.js';
import { getUserId } from '../../core/session.js';

export async function mealsRouter(app: FastifyInstance) {

  app.addHook('preHandler', async (req, reply) => {
    if (!getUserId(req)) {
      return reply.status(401).send({ error: 'Not authenticated' });
    }
  });

  // GET /meals?date=YYYY-MM-DD  or  ?week_start=YYYY-MM-DD
  app.get('/meals', async (req, reply) => {
    const userId = getUserId(req)!;
    const { date, week_start } = req.query as Record<string, string>;
    const meals = await mealsService.list({ date, week_start }, userId);
    return reply.send({ meals });
  });

  // POST /meals
  app.post('/meals', async (req, reply) => {
    const userId = getUserId(req)!;
    const parsed = CreateNodeSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid meal data', parsed.error.flatten());
    const meal = await mealsService.create(parsed.data, userId);
    return reply.status(201).send({ meal });
  });

  // DELETE /meals/:id
  app.delete('/meals/:id', async (req, reply) => {
    const userId = getUserId(req)!;
    const { id } = req.params as { id: string };
    await mealsService.delete(id, userId);
    return reply.status(204).send();
  });

  // POST /meals/grocery-list — generate grocery_item nodes from meals in a week
  app.post('/meals/grocery-list', async (req, reply) => {
    const userId = getUserId(req)!;
    const { week_start } = (req.body as Record<string, string>) ?? {};
    const items = await mealsService.generateGroceryList(week_start, userId);
    return reply.send({ items, count: items.length });
  });
}
