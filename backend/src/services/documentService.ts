import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/config';
import { embeddingService } from './embeddingService';
import * as fs from 'fs';

export class DocumentService {
    private chunkSize = parseInt(process.env.CHUNK_SIZE || '500');
    private chunkOverlap = parseInt(process.env.CHUNK_OVERLAP || '50');

    async extractText(filePath: string, fileType: string): Promise<string> {
        const buffer = fs.readFileSync(filePath);

        switch (fileType) {
            case 'application/pdf':
                const pdfData = await pdfParse(buffer);
                return pdfData.text;

            case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                const result = await mammoth.extractRawText({ buffer });
                return result.value;

            case 'text/plain':
            case 'text/markdown':
                return buffer.toString('utf-8');

            default:
                throw new Error('Unsupported file type');
        }
    }

    chunkText(text: string): string[] {
        const chunks: string[] = [];
        const words = text.split(/\s+/);

        for (let i = 0; i < words.length; i += this.chunkSize - this.chunkOverlap) {
            const chunk = words.slice(i, i + this.chunkSize).join(' ');
            if (chunk.trim().length > 0) {
                chunks.push(chunk.trim());
            }
        }

        return chunks;
    }

    async saveDocument(
        userId: string,
        name: string,
        fileType: string,
        fileSize: number,
        fullText: string,
        filePath?: string
    ): Promise<string> {
        const documentId = uuidv4();

        // Store file path for PDFs so we can serve them directly
        const filePathToStore = fileType === 'application/pdf' ? filePath : null;

        await pool.query(
            `INSERT INTO documents (id, user_id, name, file_type, file_size, full_text, file_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [documentId, userId, name, fileType, fileSize, fullText, filePathToStore]
        );

        // Chunk the text and generate embeddings
        const chunks = this.chunkText(fullText);
        console.log(`📄 Processing ${chunks.length} chunks for document ${name}`);

        for (let i = 0; i < chunks.length; i++) {
            const chunkId = uuidv4();
            const embedding = await embeddingService.generateEmbedding(chunks[i]);

            await pool.query(
                `INSERT INTO chunks (id, document_id, chunk_index, text, embedding)
         VALUES ($1, $2, $3, $4, $5)`,
                [chunkId, documentId, i, chunks[i], JSON.stringify(embedding)]
            );

            if ((i + 1) % 10 === 0) {
                console.log(`  ⏳ Processed ${i + 1}/${chunks.length} chunks`);
            }
        }

        console.log(`✅ Document ${name} saved successfully with ${chunks.length} chunks`);
        return documentId;
    }

    async getDocument(documentId: string) {
        const result = await pool.query(
            'SELECT * FROM documents WHERE id = $1',
            [documentId]
        );
        return result.rows[0];
    }

    async getUserDocuments(userId: string) {
        const result = await pool.query(
            `SELECT id, name, file_type, file_size, created_at, updated_at 
       FROM documents 
       WHERE user_id = $1 
       ORDER BY updated_at DESC`,
            [userId]
        );
        return result.rows;
    }

    async deleteDocument(documentId: string) {
        await pool.query('DELETE FROM documents WHERE id = $1', [documentId]);
    }
}

export const documentService = new DocumentService();
