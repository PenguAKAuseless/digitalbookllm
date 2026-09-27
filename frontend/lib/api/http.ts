export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export function authToken(): string | null {
    return typeof window !== 'undefined' ? localStorage.getItem('token') : null;
}

/** Shared JSON fetch wrapper: attaches the bearer token and unwraps `{ success, data }`. */
export async function apiRequest<T>(url: string, init?: RequestInit, timeoutMs = 30000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const token = authToken();
        const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (!(init?.body instanceof FormData)) headers['Content-Type'] = 'application/json';

        const res = await fetch(url, { ...init, headers, signal: controller.signal });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Request failed');
        return json.data as T;
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw new Error('Request timed out');
        if (err instanceof TypeError) throw new Error('Cannot reach the API server.');
        throw err;
    } finally {
        clearTimeout(timer);
    }
}
