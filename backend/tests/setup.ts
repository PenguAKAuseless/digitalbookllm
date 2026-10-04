import dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

// Integration tests need DB_* / DATABASE_URL pointed at a disposable test
// database (docs/deployment.md → "Running the tests" for a docker-compose
// snippet). Unit tests have no external dependency and always run.

// LLM transient-retry waits (src/llm/retry.ts) are read at import time; tests exercise
// the retry paths without sleeping through production delays.
process.env.LLM_RETRY_DELAYS_MS ??= '0,0';
