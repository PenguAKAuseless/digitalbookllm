import dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

// Integration tests need DB_* / DATABASE_URL pointed at a disposable test
// database (docs/deployment.md → "Running the tests" for a docker-compose
// snippet). Unit tests have no external dependency and always run.
