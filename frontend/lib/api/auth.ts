import { API_BASE } from './http';
const TIMEOUT = 10000;

export interface AuthUser {
    id: string;
    email: string;
    created_at: string;
}

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);

    try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (!(init?.body instanceof FormData)) headers['Content-Type'] = 'application/json';

        const res = await fetch(url, { ...init, headers, signal: controller.signal });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Request failed');
        return json.data as T;
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw new Error('Request timed out');
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

class AuthAPI {
    async register(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
        return apiRequest(`${API_BASE}/auth/register`, {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        });
    }

    async login(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
        return apiRequest(`${API_BASE}/auth/login`, {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        });
    }

    async me(): Promise<{ user: AuthUser }> {
        return apiRequest(`${API_BASE}/auth/me`);
    }
}

export const authAPI = new AuthAPI();
