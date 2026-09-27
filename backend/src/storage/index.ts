/**
 * Storage abstraction (ADR-05): documents and cover images live in object
 * storage, never on the ephemeral container disk. `driver()` selects the
 * backing implementation from env so the rest of the app only depends on
 * this interface.
 */

export interface StorageDriver {
    /** Persist a buffer under `key` and return the key (not a URL). */
    put(key: string, data: Buffer, contentType: string): Promise<void>;
    /** Fetch the raw bytes for `key`. */
    get(key: string): Promise<Buffer>;
    /** Produce a time-limited URL a browser can fetch directly. */
    getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
    delete(key: string): Promise<void>;
}

import { SupabaseStorageDriver } from './supabase';
import { LocalStorageDriver } from './local';

let instance: StorageDriver | null = null;

export function storage(): StorageDriver {
    if (instance) return instance;

    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        instance = new SupabaseStorageDriver(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY,
            process.env.SUPABASE_STORAGE_BUCKET || 'documents'
        );
    } else {
        instance = new LocalStorageDriver(process.env.UPLOAD_DIR || './uploads');
    }
    return instance;
}

export function makeStorageKey(workspaceId: string, documentId: string, filename: string): string {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${workspaceId}/${documentId}/${safe}`;
}
