-- Migration: Add file_path column to documents table
-- This allows us to store PDF files for direct serving

-- Add file_path column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'documents' 
        AND column_name = 'file_path'
    ) THEN
        ALTER TABLE documents ADD COLUMN file_path VARCHAR(1000);
        RAISE NOTICE 'Added file_path column to documents table';
    ELSE
        RAISE NOTICE 'file_path column already exists';
    END IF;
END $$;