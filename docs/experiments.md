# Thí nghiệm: RAG và đồ thị tri thức

Tài liệu duy nhất cho thiết kế, dữ liệu, kết quả và giới hạn của các thí nghiệm.
Script chạy lại: [backend/eval/experiments/](../backend/eval/experiments/) (`npm run experiment:all`).
Mọi số liệu dưới đây là từ **một lần chạy thống nhất**: cùng prompt, cùng model, cùng mã nguồn hiện tại.

## 1. Tổng quan

| # | Câu hỏi | Script | Kết quả chính |
|---|---|---|---|
| 1 | Đoạn chứa đáp án có lọt vào 5 đoạn đưa cho model không? | `experiment-1-retrieval.ts` | R@5 = 100% (HotpotQA), 82,7% (ViQuAD) |
| 2 | Model có trả lời đúng, biết từ chối và trích dẫn đúng đoạn không? | `experiment-2-answers.ts` | Ảo giác 91,0% → 38,5%; đoạn được trích chứa bằng chứng 65,8–85,7% so với 8,0–23,4% |
| 3 | Câu hỏi cần sách đã đọc trước: hệ thống có tìm sang và trả lời được không? KG có giúp không? | `experiment-3-kg-series.ts` | Trả lời đúng 2,5% → 52,5%. Cùng prompt, cùng đoạn văn, chỉ thêm khối quan hệ KG: 45,0% → 52,5% (test), 37,5% → 55,0% (dev, p = 0,039) |
| 4 | KG có học được thực thể và quan hệ từ hội thoại không? | `experiment-4-kg-chat.ts` | 88,0% thực thể, 47,4% quan hệ (baseline không LLM: 82,9% / 23,4%) |

### Thiết lập chung

| Thành phần | Giá trị |
|---|---|
| Hệ thống được đo | Chính các module production: `Chunker`, `embeddingService`, `hybridRetrieve`, bộ trích xuất KG, prompt của router LLM. Chỉ thay pgvector bằng kho trong bộ nhớ (xếp hạng cosine chính xác) |
| Chia chunk | 1.800 ký tự, chồng 200, ngưỡng ngữ nghĩa 0,45, gộp đoạn ngắn hơn 900 ký tự |
| Embedding | all-MiniLM-L6-v2 (384 chiều) |
| Truy xuất | top-k = 5; dense + BM25 hợp nhất bằng RRF (trọng số dense 0,5) |
| Model sinh câu trả lời | **qwen2.5:7b chạy local** (Ollama), temperature 0. Không gọi API trả phí. Production dùng deepseek-v4-flash qua HeFU |
| KG | KG-Series và KG-Chat: trích xuất bằng qwen2.5:7b local. Hai sách test một-cuốn: trích xuất trước đó bằng gpt-oss-120b trên Groq (lấy từ cache) |
| Chấm điểm | Tất định, theo nhãn của dataset, **không dùng LLM làm giám khảo** |
| Chọn tham số | Chỉ trên tập *dev* (split train của dataset; không huấn luyện gì). Tập *test* (split validation) chỉ dùng để báo cáo |

## 2. Dữ liệu

Không có câu hỏi hay đáp án nào do nhóm tự viết hoặc chọn tay. Mọi câu hỏi, đáp án và đoạn bằng chứng là nhãn của dataset.

| Bộ | Nguồn | Kích thước | Cách lấy mẫu | Dùng ở |
|---|---|---|---|---|
| UIT-ViQuAD 2.0 test | Split validation (tiếng Việt; VLSP 2021) | Sách 65,6K ký tự; 306 câu có đáp án, 156 câu không có đáp án (`is_impossible`) | Truy xuất: **toàn bộ** 306 câu. Sinh câu trả lời: 156/306 câu có đáp án và **cả 156** câu không có đáp án, xáo trộn với seed cố định 42 | TN1, TN2 |
| HotpotQA test | Distractor, split validation (Yang et al., EMNLP 2018) | Sách 104K ký tự; 17 câu multi-hop | **Toàn bộ** 17 câu | TN1, TN2 |
| KG-Series | Dựng từ HotpotQA validation: [datasheet](../backend/eval/datasets/kg-series/README.md) | 3 tập: 31K / 71K / 29K ký tự; 40 câu | Câu hỏi kiểu bridge, lấy **theo thứ tự dataset** với tiêu chí cố định; đáp án luôn ở tập đọc trước, không bao giờ ở tập đang mở | TN3 |
| KG-Chat | 40 hội thoại OpenDialKG (Moon et al., ACL 2019): [datasheet](../backend/eval/datasets/kg-chat/README.md) | 297 lượt; 175 thực thể, 137 quan hệ gán nhãn | 40 hội thoại đầu tiên **theo thứ tự file** có ít nhất 3 thực thể và 2 quan hệ được nói ra | TN4 |

## 3. TN1: Truy xuất trong một cuốn sách

**Metric:** R@k: có đoạn chứa bằng chứng gán nhãn trong top k. All-support@k: mọi đoạn bằng chứng của câu multi-hop đều nằm trong top k.

| | Chunk (trung bình ký tự) | R@1 | R@3 | **R@5** | MRR@5 | All-support@5 |
|---|---|---|---|---|---|---|
| ViQuAD (306 câu), chỉ dense | 45 (1.652) | 11,1% | 27,1% | 36,3% | 0,202 | 36,3% |
| ViQuAD, **hệ thống** (dense + BM25) | 45 (1.652) | 41,2% | 69,0% | **82,7%** | 0,565 | 82,7% |
| HotpotQA (17 câu), chỉ dense | 77 (1.549) | 82,4% | 94,1% | 100% | 0,897 | 100% |
| HotpotQA, **hệ thống** (dense + BM25) | 77 (1.549) | 94,1% | 100% | **100%** | 0,971 | 100% |

Bật lượt tìm thứ hai bằng KG không đổi kết quả trong một cuốn sách: lượt này chỉ tìm sang sách khác.
Top 5 chiếm khoảng 7% (HotpotQA) và 13% (ViQuAD) độ dài sách, nên R@5 cao không phải do lấy gần hết sách.

## 4. TN2: Trả lời, ảo giác, trích dẫn

**Metric:** *Trả lời đúng*: đáp án gán nhãn xuất hiện trong câu trả lời (chuẩn hoá theo SQuAD/HotpotQA).
*Ảo giác*: câu không có đáp án nhưng model vẫn trả lời thay vì từ chối.
*Từ chối nhầm*: câu có đáp án nhưng model từ chối.
*Hỗ trợ trích dẫn*: tỉ lệ đoạn được trích [n] có chứa bằng chứng gán nhãn, so với các đoạn được truy xuất nhưng không được trích.

| | HotpotQA: không RAG | HotpotQA: **hệ thống** | ViQuAD: không RAG | ViQuAD: **hệ thống** |
|---|---|---|---|---|
| n | 17 | 17 | 156 + 156 | 156 + 156 |
| Trả lời đúng | 17,6% | **64,7%** | 10,9% | **47,4%** |
| Ảo giác (câu không có đáp án) | – | – | 91,0% | **38,5%** |
| Từ chối nhầm (câu có đáp án) | 5,9% | 17,6% | 3,8% | 26,3% |
| Câu trả lời có trích dẫn [n] | – | 88,2% | – | 84,0% |
| Đoạn được trích có bằng chứng | – | **85,7%** | – | **65,8%** |
| Đoạn không được trích có bằng chứng | – | 23,4% | – | 8,0% |
| Trả lời sai ngôn ngữ (tiếng Trung) | 0% | 0% | 4,5% | 31,4% |

Điều kiện "RAG không KG" cho kết quả gần như trùng (ViQuAD: trả lời đúng 47,4%, ảo giác 38,5%), vì với một cuốn sách hệ thống không đưa quan hệ KG nào vào prompt.

**Đọc kết quả:** RAG giảm ảo giác hơn một nửa và tăng mạnh số câu trả lời đúng, đổi lại model từ chối nhầm nhiều hơn.
Trích dẫn có ý nghĩa: đoạn được trích chứa bằng chứng gấp khoảng 4 lần (HotpotQA) đến 8 lần (ViQuAD) so với đoạn không được trích.

## 5. TN3: Đồ thị tri thức giữa các cuốn sách (KG-Series)

Mô phỏng thứ tự đọc: câu hỏi ở tập v chỉ thấy tập 1..v và đồ thị trích từ các tập đó. Đáp án luôn nằm ở tập trước, không bao giờ ở tập đang mở.

### 5.1. Cách KG được đưa vào prompt

KG góp vào câu trả lời bằng **thông tin quan hệ giữa các thực thể**, đặt thành một khối riêng trong prompt
(`router.buildMessages`). Mọi điều kiện dùng cùng một prompt hệ thống; chỉ khối quan hệ là có hoặc không:

```
**Knowledge graph (relations between entities in the question, extracted from the user's documents):**
- Here We Go Round the Mulberry Bush — based on → Hunter Davies
- Edward Hunter Davies — occupation → author

**Retrieved document context:**
[1] ... [5] (các đoạn văn, gồm đoạn từ sách đã đọc trước)

**Question:** When was the British author who wrote the novel on which "Here We Go Round the Mulberry Bush" was based born?
```

Prompt hệ thống quy định cách dùng khối này: *"Use the knowledge-graph relations only to connect entities across passages;
never state a fact that no passage or the selected text supports."* KG dùng để **nối** thực thể giữa các đoạn văn,
còn sự kiện thì vẫn phải lấy từ đoạn văn. Quan hệ được chọn là những quan hệ có một đầu nằm trong đoạn văn từ sách khác,
đầu kia nằm trong câu hỏi hoặc trong sách đang mở (`linkFacts`, tối đa 8 quan hệ).

### 5.2. Bằng chứng chính: cùng prompt, cùng đoạn văn, chỉ thêm khối KG

Hai điều kiện dùng **đúng cùng 5 đoạn văn** (lượt tìm thứ hai thông thường sang sách đã đọc) và cùng prompt hệ thống.
Khác biệt duy nhất là có hay không khối quan hệ KG.

| | Test (40 câu) | Dev (40 câu) |
|---|---|---|
| Không có khối KG | 45,0% | 37,5% |
| **Có khối KG** | **52,5%** | **55,0%** |
| Chỉ có KG đúng / chỉ không KG đúng | +4 / −1 | +8 / −1 |
| p (McNemar chính xác) | 0,375 | 0,039 |
| Từ chối | 25,0% → 22,5% | 40,0% → 22,5% |

Thêm khối KG giúp trả lời đúng hơn ở cả hai tập và giảm từ chối, do model nối được thực thể giữa hai cuốn sách.
Trên dev, mức tăng có ý nghĩa thống kê. Trên test (tập báo cáo), chiều tác động giống dev nhưng 40 câu chưa đủ để có ý nghĩa thống kê.
Lưu ý: cách chọn quan hệ ("chỉ quan hệ nối") được chọn trên dev, nên con số dev không phải bằng chứng độc lập; test mới là phép đo sạch.

Ví dụ cơ chế (test, KGS-34). Tập đang mở chỉ nói phim dựa trên tiểu thuyết của "Hunter Davies"; tập trước có đoạn về
"Edward Hunter Davies". Có khối KG ("…based on → Hunter Davies", "Edward Hunter Davies — occupation → author"),
model nối hai tên và trả lời đúng "7 January 1936" [5]. Không có khối KG, model trả lời "the document does not provide the birth date".
KGS-10 tương tự: "2011–12 VCU Rams men's basketball team — represents → VCU" giúp model lấy năm thành lập 1838.
Trong 4 câu chỉ có KG mới đúng ở test, 2 câu (KGS-10, KGS-34) có quan hệ nối đúng; 2 câu còn lại (KGS-07, KGS-17)
có quan hệ không liên quan, nhiều khả năng là do model dao động.

### 5.3. Các điều kiện còn lại

**Trả lời** (40 câu test):

| Điều kiện | Đoạn văn | Khối KG | Đúng | Từ chối | Đoạn được trích có bằng chứng |
|---|---|---|---|---|---|
| Chỉ sách đang mở | sách đang mở | không | 2,5% | 65,0% | 50,0% |
| Lượt 2 sang sách trước | thường | không | 45,0% | 25,0% | 72,5% |
| Lượt 2 sang sách trước | thường | quan hệ nối | 52,5% | 22,5% | 72,9% |
| Lượt 2, KG xếp hạng lại | KG xếp hạng | không | 40,0% | 30,0% | 71,4% |
| Lượt 2, KG xếp hạng lại | KG xếp hạng | mọi quan hệ | 47,5% | 25,0% | 83,7% |
| **Hệ thống** | KG xếp hạng | quan hệ nối | **52,5%** | 25,0% | 67,8% |

Hệ thống so với chỉ sách đang mở: +20 / −0, p < 0,001.
Hệ thống so với "thường + quan hệ nối": 2 / 2 (p = 1,0) trên test, 0 / 0 trên dev: **xếp hạng lại bằng KG không cộng thêm gì**;
giá trị của KG nằm ở khối quan hệ trong prompt.

**Truy xuất** (đoạn đáp án ở tập trước trong top k, test):

| Điều kiện | k=1 | k=2 | k=3 | k=5 | Cả chuỗi @5 |
|---|---|---|---|---|---|
| Chỉ sách đang mở | 0,0% | 0,0% | 0,0% | 0,0% | 0,0% |
| Một lần tìm trên mọi sách đã đọc | 22,5% | 67,5% | 80,0% | 92,5% | 87,5% |
| Lượt 2 sang sách trước, thường | 70,0% | 90,0% | 95,0% | 95,0% | 92,5% |
| Lượt 2 do KG dẫn đường | 65,0% | 85,0% | 95,0% | 95,0% | 92,5% |
| **Hệ thống**: lượt 2, KG xếp hạng lại | 70,0% | 85,0% | 92,5% | 92,5% | 90,0% |

KG không đưa đoạn đúng lên trước tốt hơn (k = 1 bằng nhau). Trên dev, xếp hạng lại hơn 7,5 điểm ở k ≥ 3,
nhưng lợi thế này không lặp lại trên test. Với k ≤ 3, lượt 2 chiếm toàn bộ số suất nên không còn đoạn nào của sách đang mở
("cả chuỗi" = 0); production dùng k = 5 nên không bị ảnh hưởng.

### 5.4. Giới hạn của đồ thị trong lần chạy này

| Quan sát | Số đo |
|---|---|
| Đồ thị thưa | 452 thực thể, 262 quan hệ; trung vị 1 quan hệ mỗi thực thể |
| Thiếu liên kết cần thiết | Cạnh nối thực thể bài cầu nối với thực thể bài đáp án chỉ có ở 14/40 câu |
| Chọn cầu nối | Đúng ở 11/40 câu: 8 trong 14 câu có cạnh, cộng 3 câu qua đường gián tiếp |
| Nút có nhiều cạnh lấn át | Ở 6/14 câu có cạnh, cầu nối đúng bị đẩy xuống ("Manchester United", "Great Eastern Conventions": 9 cạnh) |
| Khối quan hệ bị nhiễu | Trung bình 4 quan hệ mỗi câu; chỉ 25/38 câu có quan hệ chạm tới thực thể của bài đáp án |

Mức tăng nhờ khối KG ở 5.2 đạt được **dù** đồ thị chỉ có khoảng một phần ba liên kết cần thiết.
Đây là hiệu năng thực tế, không có chỉnh sửa hay bổ sung nào vào đồ thị.
Hai hướng cải thiện tương ứng: trích xuất nhiều quan hệ hơn mỗi cửa sổ (hiện tối đa 25 quan hệ cho khoảng 12 bài),
và phạt các nút có nhiều cạnh khi chọn cầu nối cũng như khi chọn quan hệ đưa vào prompt.

## 6. TN4: KG học từ hội thoại (KG-Chat)

Đồ thị ban đầu là đồ thị của 3 tập KG-Series (một người dùng đã đọc các sách đó); 40 hội thoại lần lượt đi qua bộ trích xuất production.

| Đo lường | Bộ trích xuất LLM (hệ thống) | Baseline không LLM (cụm từ viết hoa + đồng xuất hiện) |
|---|---|---|
| Thực thể gán nhãn được tìm thấy | **88,0%** (154/175) | 82,9% |
| Quan hệ gán nhãn được tìm thấy | **47,4%** (65/137) | 23,4% |
| Thực thể trích ra có trong lời thoại | 96,8% | 100% (theo cách dựng) |

| Sự phát triển của đồ thị | |
|---|---|
| Trước → sau 40 hội thoại | 452 → 719 thực thể; 262 → 427 quan hệ |
| Thực thể mới mỗi hội thoại | 6,7 |
| Thực thể mới có ít nhất một quan hệ | 74,2% |
| Thực thể mới nối với một nút đã có | 10,1% (đa số hội thoại nói về chủ đề mới với đồ thị) |
| Thực thể gán nhãn đã có sẵn trong đồ thị | 7; trong đó 6 được trích ra và **cả 6** được gộp vào node cũ, 1 không được trích ra |
| Thực thể trùng do khác hoa thường | 0 |

## 7. Giới hạn

- **Model sinh là qwen2.5:7b chạy local**, không phải model production. Model này trả lời bằng tiếng Trung ở 31% câu ViQuAD khi có RAG, và phần lớn câu từ chối được viết bằng tiếng Trung. Nếu chỉ xét các câu trả lời không phải tiếng Trung, tỉ lệ ảo giác là 65,5% (n = 87).
- Temperature 0 nhưng suy luận trên GPU không hoàn toàn tất định; chênh lệch nhỏ giữa các lần chạy là bình thường.
- Mẫu nhỏ ở HotpotQA (17 câu) và KG-Series (40 câu): chênh lệch dưới khoảng 10 điểm cần kiểm định cặp mới kết luận được.
- KG trong TN3 thiếu phần lớn liên kết cần thiết, và bộ chọn cầu nối thiên về các nút có nhiều cạnh (mục 5.4). Mức tăng nhờ khối KG trên test (+7,5 điểm) chưa có ý nghĩa thống kê với 40 câu.
- Bộ chấm phát hiện câu từ chối theo mẫu câu (tiếng Anh, tiếng Việt, tiếng Trung giản thể và phồn thể); đã soát tay một mẫu ngẫu nhiên các phán định.

## 8. Chạy lại

```bash
cd backend
ollama pull qwen2.5:7b
npx ts-node eval/experiments/build-benchmark.ts   # một lần: tải dataset, dựng sách
npm run experiment:all
```

Câu trả lời được cache theo hash của chính prompt gửi đi; embedding và KG cũng được cache, nên chạy lại chỉ tính phần thay đổi.
