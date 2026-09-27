import * as fs from 'fs';
import * as path from 'path';
import { StorageDriver } from './index';

/** Filesystem-backed storage, used in local development and tests. */
export class LocalStorageDriver implements StorageDriver {
    constructor(private baseDir: string) {
        fs.mkdirSync(baseDir, { recursive: true });
    }

    private resolve(key: string): string {
        const target = path.join(this.baseDir, key);
        const normalizedBase = path.resolve(this.baseDir);
        const normalizedTarget = path.resolve(target);
        if (!normalizedTarget.startsWith(normalizedBase)) {
            throw new Error('Invalid storage key');
        }
        return normalizedTarget;
    }

    async put(key: string, data: Buffer): Promise<void> {
        const filePath = this.resolve(key);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, data);
    }

    async get(key: string): Promise<Buffer> {
        return fs.readFileSync(this.resolve(key));
    }

    async getSignedUrl(key: string): Promise<string> {
        // No signing needed for local dev; served through a dedicated route instead.
        return `/api/documents/local-file?key=${encodeURIComponent(key)}`;
    }

    async delete(key: string): Promise<void> {
        const filePath = this.resolve(key);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
}
