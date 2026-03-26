import { eq, desc, and, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../db/client.js';
import { emails } from '../../db/schema/emails.schema.js';
import type { NewEmail } from '../../db/schema/emails.schema.js';

type Db = typeof defaultDb;

export function createEmailRepository(db: Db = defaultDb) {
    return {

        async findAll(filters?: {
            userId?:       string;
            triaged?:      boolean;
            sender_email?: string;
            label?:        string;
            limit?:        number;
            offset?:       number;
        }) {
            const conditions = [];

            if (filters?.userId) {
                conditions.push(eq(emails.user_id, filters.userId));
            }
            if (filters?.triaged !== undefined) {
                conditions.push(eq(emails.triaged, filters.triaged));
            }
            if (filters?.sender_email) {
                conditions.push(eq(emails.sender_email, filters.sender_email));
            }
            if (filters?.label) {
                conditions.push(
                    sql`json_each.value = ${filters.label}`,
                );
            }

            return db
                .select()
                .from(emails)
                .where(conditions.length ? and(...conditions) : undefined)
                .orderBy(desc(emails.received_at))
                .limit(filters?.limit   ?? 50)
                .offset(filters?.offset ?? 0);
        },

        async findById(id: string, userId: string) {
            const [email] = await db
                .select()
                .from(emails)
                .where(and(eq(emails.id, id), eq(emails.user_id, userId)));
            return email ?? null;
        },

        async findByGmailId(gmail_id: string, userId: string) {
            const [email] = await db
                .select()
                .from(emails)
                .where(and(eq(emails.gmail_id, gmail_id), eq(emails.user_id, userId)));
            return email ?? null;
        },

        async findByContentHash(content_hash: string, userId: string) {
            const [email] = await db
                .select()
                .from(emails)
                .where(and(eq(emails.content_hash, content_hash), eq(emails.user_id, userId)));
            return email ?? null;
        },

        async findByThreadId(thread_id: string, userId: string) {
            return db
                .select()
                .from(emails)
                .where(and(eq(emails.thread_id, thread_id), eq(emails.user_id, userId)))
                .orderBy(desc(emails.received_at));
        },

        async findUntriaged(userId: string, limit = 50) {
            return db
                .select()
                .from(emails)
                .where(and(eq(emails.triaged, false), eq(emails.user_id, userId)))
                .orderBy(desc(emails.received_at))
                .limit(limit);
        },

        async create(data: NewEmail) {
            const [email] = await db
                .insert(emails)
                .values(data)
                .returning();
            return email;
        },

        async update(id: string, userId: string, data: Partial<Pick<NewEmail, 'body_summary' | 'labels' | 'triaged' | 'updated_at'>>) {
            const [email] = await db
                .update(emails)
                .set({ ...data, updated_at: new Date().toISOString() })
                .where(and(eq(emails.id, id), eq(emails.user_id, userId)))
                .returning();
            return email ?? null;
        },

        async delete(id: string, userId: string) {
            const [email] = await db
                .delete(emails)
                .where(and(eq(emails.id, id), eq(emails.user_id, userId)))
                .returning();
            return email ?? null;
        },

        async countUntriaged(userId: string) {
            const [result] = await db
                .select({ count: sql<number>`count(*)` })
                .from(emails)
                .where(and(eq(emails.triaged, false), eq(emails.user_id, userId)));
            return result.count;
        },
    };
}

export const emailRepository = createEmailRepository(defaultDb);
export type EmailRepository = ReturnType<typeof createEmailRepository>;
