import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/config';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export interface AuthUser {
    id: string;
    email: string;
    created_at: Date;
}

export interface TokenPayload {
    userId: string;
    email: string;
}

class AuthService {
    async register(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
        if (existing.rows.length > 0) {
            throw Object.assign(new Error('Email already registered'), { status: 409 });
        }

        const password_hash = await bcrypt.hash(password, 12);
        const id = uuidv4();

        const result = await pool.query(
            'INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email, created_at',
            [id, email.toLowerCase(), password_hash]
        );

        await pool.query(
            'INSERT INTO user_sessions (id, queries_today, last_reset_date) VALUES ($1, 0, CURRENT_DATE)',
            [id]
        );

        const user: AuthUser = result.rows[0];
        const token = this.signToken({ userId: user.id, email: user.email });
        return { user, token };
    }

    async login(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
        const result = await pool.query(
            'SELECT id, email, password_hash, created_at FROM users WHERE email = $1',
            [email.toLowerCase()]
        );

        if (result.rows.length === 0) {
            throw Object.assign(new Error('Invalid email or password'), { status: 401 });
        }

        const row = result.rows[0];
        const valid = await bcrypt.compare(password, row.password_hash);
        if (!valid) {
            throw Object.assign(new Error('Invalid email or password'), { status: 401 });
        }

        const user: AuthUser = { id: row.id, email: row.email, created_at: row.created_at };
        const token = this.signToken({ userId: user.id, email: user.email });
        return { user, token };
    }

    async getUser(userId: string): Promise<AuthUser | null> {
        const result = await pool.query(
            'SELECT id, email, created_at FROM users WHERE id = $1',
            [userId]
        );
        return result.rows[0] ?? null;
    }

    signToken(payload: TokenPayload): string {
        return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
    }

    verifyToken(token: string): TokenPayload {
        return jwt.verify(token, JWT_SECRET) as TokenPayload;
    }
}

export const authService = new AuthService();
