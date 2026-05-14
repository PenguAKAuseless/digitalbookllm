const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
const TIMEOUT = 10000;

export interface Workspace {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    created_at: string;
    updated_at: string;
    document_count: number;
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

class WorkspaceAPI {
    async getWorkspaces(): Promise<Workspace[]> {
        return apiRequest(`${API_BASE}/workspaces`);
    }

    async getWorkspace(id: string): Promise<Workspace> {
        return apiRequest(`${API_BASE}/workspaces/${id}`);
    }

    async createWorkspace(name: string, description?: string): Promise<Workspace> {
        return apiRequest(`${API_BASE}/workspaces`, {
            method: 'POST',
            body: JSON.stringify({ name, description }),
        });
    }

    async updateWorkspace(id: string, name: string, description?: string): Promise<Workspace> {
        return apiRequest(`${API_BASE}/workspaces/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ name, description }),
        });
    }

    async deleteWorkspace(id: string): Promise<void> {
        await apiRequest(`${API_BASE}/workspaces/${id}`, { method: 'DELETE' });
    }
}

export const workspaceAPI = new WorkspaceAPI();
