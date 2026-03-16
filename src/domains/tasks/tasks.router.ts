import type { FastifyInstance } from 'fastify';
import { tasksService } from './tasks.service.js';
import { CreateNodeSchema, UpdateNodeSchema } from '../types.js';
import { ValidationError } from '../../core/errors.js';

export async function tasksRouter(app: FastifyInstance) {

  app.get('/nodes', async (req, reply) => {
    const { type, status, parent_id, due_before } = req.query as Record<string, string>;
    const nodes = await tasksService.list({ type, status, parent_id, due_before });
    return reply.send({ nodes });
  });

  app.get('/nodes/inbox', async (_req, reply) => {
    const nodes = await tasksService.getInbox();
    return reply.send({ nodes });
  });

  app.get('/nodes/top-level', async (_req, reply) => {
    const nodes = await tasksService.getTopLevel();
    return reply.send({ nodes });
  });

  app.get('/nodes/due-soon', async (req, reply) => {
    const { days } = req.query as { days?: string };
    const nodes = await tasksService.getDueSoon(days ? parseInt(days) : 3);
    return reply.send({ nodes });
  });

  app.get('/nodes/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const node = await tasksService.getById(id);
    return reply.send({ node });
  });

  app.get('/nodes/:id/children', async (req, reply) => {
    const { id } = req.params as { id: string };
    const children = await tasksService.getChildren(id);
    return reply.send({ nodes: children });
  });

  app.post('/nodes', async (req, reply) => {
    const parsed = CreateNodeSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid node data', parsed.error.flatten());
    const node = await tasksService.create(parsed.data);
    return reply.status(201).send({ node });
  });

  app.patch('/nodes/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = UpdateNodeSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid node data', parsed.error.flatten());
    const node = await tasksService.update(id, parsed.data);
    return reply.send({ node });
  });

  app.delete('/nodes/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await tasksService.delete(id);
    return reply.status(204).send();
  });
}
