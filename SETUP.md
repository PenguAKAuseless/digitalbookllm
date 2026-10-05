# Experiments
## Setup
```
ollama pull qwen2.5:7b          # model local; thí nghiệm không gọi API trả phí
ollama serve                    # nếu Ollama chưa chạy (mặc định http://localhost:11434)

cd backend
npm install
npx ts-node eval/experiments/build-benchmark.ts                 # tải ViQuAD + HotpotQA, dựng sách test/dev → eval/experiments/data/
SPLIT=train npx ts-node eval/experiments/build-series.ts        # bản dev của KG-Series (chỉ để chọn tham số)
```
## Run experiments
```
cd backend
npm run experiment:all            # all

# hoặc từng thí nghiệm
npm run experiment:retrieval      # TN1: truy xuất trong một sách
npm run experiment:answers        # TN2: trả lời, ảo giác, trích dẫn
npm run experiment:kg-series      # TN3: KG giữa các sách (test)
npm run experiment:kg-chat        # TN4: KG học từ hội thoại

SERIES=dev npm run experiment:kg-series   # TN3 trên bản dev
```
# Start project
## Backend

```
cd backend
cp .env.example .env     # điền DATABASE_URL, JWT_SECRET, HEFU_API_KEY (+ HEFU_MODEL, HEFU_GRAPH_MODEL)
npm install
npm run migrate          # tạo bảng (lần đầu hoặc khi schema đổi)
npm run dev              # chạy dev, tự reload
# production: npm run build && npm start
```

## Frontend

```
cd frontend
npm install
# file .env.local: NEXT_PUBLIC_API_URL=http://localhost:3001/api
npm run dev
# production: npm run build && npm start
```

## Testing

```
cd backend && npm test        # unit + integration (integration cần Postgres trong DATABASE_URL)
cd frontend && npm test       # vitest
```