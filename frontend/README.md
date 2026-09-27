# DigitalBookLLM Frontend

Next.js client application for document viewing, RAG chat, and browser text-to-speech.

## Scripts

```bash
npm run dev
npm run build
npm run start
```

## Environment

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

For Vercel, set `NEXT_PUBLIC_API_URL` to the public Render API URL ending in
`/api`. Do not add database credentials, Supabase service-role keys, JWT
secrets, or LLM provider keys to Vercel.

## Notes

- The chat panel includes browser-native text-to-speech controls for assistant responses.
- Document PDF rendering uses `react-pdf` and the backend `/api/documents/:id/pdf` endpoint.
