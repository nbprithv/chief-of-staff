import type { FastifyInstance } from 'fastify';
import { tasksService } from './tasks.service.js';
import { CreateNodeSchema, UpdateNodeSchema } from '../types.js';
import { ValidationError } from '../../core/errors.js';
import { getUserId } from '../../core/session.js';

export async function tasksRouter(app: FastifyInstance) {

  // Require userId on all node routes
  app.addHook('preHandler', async (req, reply) => {
    if (!getUserId(req)) {
      return reply.status(401).send({ error: 'Not authenticated' });
    }
  });

  app.get('/nodes', async (req, reply) => {
    const userId = getUserId(req)!;
    const { type, status, parent_id, due_before } = req.query as Record<string, string>;
    const nodes = await tasksService.list({ type, status, parent_id, due_before }, userId);
    return reply.send({ nodes });
  });

  app.get('/nodes/inbox', async (req, reply) => {
    const userId = getUserId(req)!;
    const nodes = await tasksService.getInbox(userId);
    return reply.send({ nodes });
  });

  app.get('/nodes/top-level', async (req, reply) => {
    const userId = getUserId(req)!;
    const nodes = await tasksService.getTopLevel(userId);
    return reply.send({ nodes });
  });

  app.get('/nodes/due-soon', async (req, reply) => {
    const userId = getUserId(req)!;
    const { days } = req.query as { days?: string };
    const nodes = await tasksService.getDueSoon(days ? parseInt(days) : 3, userId);
    return reply.send({ nodes });
  });

  app.get('/nodes/:id', async (req, reply) => {
    const userId = getUserId(req)!;
    const { id } = req.params as { id: string };
    const node = await tasksService.getById(id, userId);
    return reply.send({ node });
  });

  app.get('/nodes/:id/children', async (req, reply) => {
    const userId = getUserId(req)!;
    const { id } = req.params as { id: string };
    const children = await tasksService.getChildren(id, userId);
    return reply.send({ nodes: children });
  });

  app.post('/nodes', async (req, reply) => {
    const userId = getUserId(req)!;
    const parsed = CreateNodeSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid node data', parsed.error.flatten());
    const node = await tasksService.create(parsed.data, userId);
    return reply.status(201).send({ node });
  });

  app.patch('/nodes/:id', async (req, reply) => {
    const userId = getUserId(req)!;
    const { id } = req.params as { id: string };
    const parsed = UpdateNodeSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid node data', parsed.error.flatten());
    const node = await tasksService.update(id, parsed.data, userId);
    return reply.send({ node });
  });

  app.delete('/nodes/:id', async (req, reply) => {
    const userId = getUserId(req)!;
    const { id } = req.params as { id: string };
    await tasksService.delete(id, userId);
    return reply.status(204).send();
  });
}
