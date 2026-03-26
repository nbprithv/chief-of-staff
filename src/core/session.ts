import { createHmac } from 'node:crypto';
import { config } from './config.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

const COOKIE_NAME = 'uid';
const MAX_AGE     = 30 * 24 * 60 * 60; // 30 days in seconds

export function setUserCookie(reply: FastifyReply, userId: string): void {
    const signed = signValue(userId);
    reply.header('Set-Cookie',
        `${COOKIE_NAME}=${encodeURIComponent(signed)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}`,
    );
}

export function clearUserCookie(reply: FastifyReply): void {
    reply.header('Set-Cookie',
        `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
}

/** Reads and verifies the signed uid cookie. Returns null if missing or tampered. */
export function getUserId(req: FastifyRequest): string | null {
    const cookieHeader = req.headers.cookie ?? '';
    const match = cookieHeader.match(/(?:^|;\s*)uid=([^;]+)/);
    if (!match) return null;
    const raw = decodeURIComponent(match[1]);
    return verifyValue(raw);
}

function signValue(value: string): string {
    const sig = createHmac('sha256', config.SESSION_SECRET).update(value).digest('base64url');
    return `${value}.${sig}`;
}

function verifyValue(signed: string): string | null {
    const dot = signed.lastIndexOf('.');
    if (dot === -1) return null;
    const value = signed.slice(0, dot);
    const sig   = signed.slice(dot + 1);
    const expected = createHmac('sha256', config.SESSION_SECRET).update(value).digest('base64url');
    return sig === expected ? value : null;
}
