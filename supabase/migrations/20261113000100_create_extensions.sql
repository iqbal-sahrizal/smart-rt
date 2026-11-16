-- Step 09 Migration 0001: Required PostgreSQL extensions

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";

