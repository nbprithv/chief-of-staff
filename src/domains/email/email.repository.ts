import { eq, desc, and, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../db/client.js';
import { emails } from '../../db/schema/emails.schema.js';
import type { NewEmail } from '../../db/schema/emails.schema.js';

type Db = typeof defaultDb;

export function createEmailRepository(db: Db = defaultDb) {
    return {

        async findAll(filters?: {
            triaged?:      boolean;
            sender_email?: string;
            label?:        string;
            limit?:        number;
            offset?:       number;
        }) {
            const conditions = [];

            if (filters?.triaged !== undefined) {
                conditions.push(eq(emails.triaged, filters.triaged));
            }
            if (filters?.sender_email) {
                conditions.push(eq(emails.sender_email, filters.sender_email));
            }
            // Label filter — SQLite JSON array contains check
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

        async findById(id: string) {
            const [email] = await db
                .select()
                .from(emails)
                .where(eq(emails.id, id));
            return email ?? null;
        },

        async findByGmailId(gmail_id: string) {
            const [email] = await db
                .select()
                .from(emails)
                .where(eq(emails.gmail_id, gmail_id));
            return email ?? null;
        },

        async findByContentHash(content_hash: string) {
            const [email] = await db
                .select()
                .from(emails)
                .where(eq(emails.content_hash, content_hash));
            return email ?? null;
        },

        async findByThreadId(thread_id: string) {
            return db
                .select()
                .from(emails)
                .where(eq(emails.thread_id, thread_id))
                .orderBy(desc(emails.received_at));
        },

        async findUntriaged(limit = 50) {
            return db
                .select()
                .from(emails)
                .where(eq(emails.triaged, false))
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

        async update(id: string, data: Partial<Pick<NewEmail, 'body_summary' | 'labels' | 'triaged' | 'updated_at'>>) {
            const [email] = await db
                .update(emails)
                .set({ ...data, updated_at: new Date().toISOString() })
                .where(eq(emails.id, id))
                .returning();
            return email ?? null;
        },

        async delete(id: string) {
            const [email] = await db
                .delete(emails)
                .where(eq(emails.id, id))
                .returning();
            return email ?? null;
        },

        async countUntriaged() {
            const [result] = await db
                .select({ count: sql<number>`count(*)` })
                .from(emails)
                .where(eq(emails.triaged, false));
            return result.count;
        },
    };
}

export const emailRepository = createEmailRepository(defaultDb);
export type EmailRepository = ReturnType<typeof createEmailRepository>;
