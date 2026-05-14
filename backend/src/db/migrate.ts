import { pool } from './config';
import * as fs from 'fs';
import * as path from 'path';

async function migrate() {
    const client = await pool.connect();
    try {
        const schemaSQL = fs.readFileSync(
            path.join(__dirname, 'schema.sql'),
            'utf-8'
        );

        await client.query(schemaSQL);
        console.log('Schema applied successfully');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        client.release();
    }
}

migrate();
