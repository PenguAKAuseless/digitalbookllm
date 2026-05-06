import { pool } from './config';
import * as fs from 'fs';
import * as path from 'path';

async function migrate() {
    try {
        const schemaSQL = fs.readFileSync(
            path.join(__dirname, 'schema.sql'),
            'utf-8'
        );

        await pool.query(schemaSQL);
        // Create default guest user for mockup
        await pool.query(`
      INSERT INTO users (id, email) 
      VALUES ('guest', 'guest@digitalbookllm.com')
      ON CONFLICT (id) DO NOTHING
    `);

        await pool.query(`
      INSERT INTO user_sessions (id, queries_today, last_reset_date)
      VALUES ('guest', 0, CURRENT_DATE)
      ON CONFLICT (id) DO NOTHING
    `);

        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
