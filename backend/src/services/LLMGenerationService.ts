import axios from 'axios';
import { RetrievedChunk } from '../types';

export class LLMGenerationService {
    private togetherApiKey = process.env.TOGETHER_API_KEY || '';
    private togetherApiUrl = process.env.TOGETHER_API_URL || 'https://api.together.xyz/v1/chat/completions';
    private togetherModel = process.env.TOGETHER_MODEL || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

    async generateResponse(
        query: string,
        selectedText: string | undefined,
        retrievedChunks: RetrievedChunk[]
    ): Promise<string> {
        const prompt = this.buildPrompt(query, selectedText, retrievedChunks);

        try {
            if (this.togetherApiKey && this.togetherApiKey !== 'your_together_api_key_here') {
                const response = await axios.post(
                    this.togetherApiUrl,
                    {
                        model: this.togetherModel,
                        messages: [
                            {
                                role: 'system',
                                content: 'You are a helpful, accurate, and educational AI assistant that provides clear explanations based on document context.'
                            },
                            {
                                role: 'user',
                                content: prompt
                            }
                        ],
                        temperature: 0.7,
                        max_tokens: 500,
                        top_p: 0.9,
                        stop: ['**QUESTION:', '\n\n\n']
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${this.togetherApiKey}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 30000
                    }
                );

                return response.data.choices[0].message.content;
            }

            return this.generateMockResponse(query, selectedText, retrievedChunks);
        } catch (error: any) {
            console.error('Error calling Together AI API:', error.response?.data || error.message);
            return this.generateMockResponse(query, selectedText, retrievedChunks);
        }
    }

    private buildPrompt(
        query: string,
        selectedText: string | undefined,
        retrievedChunks: RetrievedChunk[]
    ): string {
        let prompt = `You are an AI study assistant helping a student understand their document. Answer the question based STRICTLY on the provided context.

**PRIMARY CONTEXT (Selected by user - highest priority):**
${selectedText || 'None'}

**AUGMENTED CONTEXT (Related information from document):**
`;

        retrievedChunks.forEach((chunk, idx) => {
            prompt += `\n[${idx + 1}] ${chunk.text}\n`;
        });

        prompt += `\n**QUESTION:** ${query}

**INSTRUCTIONS:**
1. Answer primarily based on the PRIMARY CONTEXT if provided
2. Use AUGMENTED CONTEXT to provide additional relevant details
3. If the answer is not in the context, say "I cannot find this information in the provided document section"
4. Be concise, clear, and educational
5. Use examples from the context when helpful

**ANSWER:**`;

        return prompt;
    }

    private generateMockResponse(
        query: string,
        selectedText: string | undefined,
        retrievedChunks: RetrievedChunk[]
    ): string {
        const context = selectedText || (retrievedChunks[0]?.text || '');

        return `Based on the document context, here's what I can explain:\n\n` +
            `${context.substring(0, 300)}${context.length > 300 ? '...' : ''}\n\n` +
            `This appears to relate to your question about "${query}". `;
    }
}

export const llmGenerationService = new LLMGenerationService();
