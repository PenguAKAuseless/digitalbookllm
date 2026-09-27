import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { StorageDriver } from './index';

/** Supabase Storage (S3-compatible) driver — see ADR-05. */
export class SupabaseStorageDriver implements StorageDriver {
    private client: SupabaseClient;

    constructor(url: string, serviceRoleKey: string, private bucket: string) {
        this.client = createClient(url, serviceRoleKey);
    }

    async put(key: string, data: Buffer, contentType: string): Promise<void> {
        const { error } = await this.client.storage
            .from(this.bucket)
            .upload(key, data, { contentType, upsert: true });
        if (error) throw new Error(`Supabase upload failed: ${error.message}`);
    }

    async get(key: string): Promise<Buffer> {
        const { data, error } = await this.client.storage.from(this.bucket).download(key);
        if (error || !data) throw new Error(`Supabase download failed: ${error?.message}`);
        return Buffer.from(await data.arrayBuffer());
    }

    async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
        const { data, error } = await this.client.storage
            .from(this.bucket)
            .createSignedUrl(key, expiresInSeconds);
        if (error || !data) throw new Error(`Supabase signed URL failed: ${error?.message}`);
        return data.signedUrl;
    }

    async delete(key: string): Promise<void> {
        await this.client.storage.from(this.bucket).remove([key]);
    }
}
