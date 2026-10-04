# Kịch bản demo và kiểm thử trên production

Kịch bản này dùng để quay video demo và trình bày trước hội đồng. Mỗi bước ghi:
thao tác, kết quả mong đợi, kết quả đã kiểm chứng khi diễn tập, và cách xử lý nếu
có sự cố. Mọi câu hỏi và đáp án đều lấy từ tập test của bộ dữ liệu, không tự đặt.

- Frontend: https://digitalbookllm.vercel.app
- Backend: https://digitalbookllm.onrender.com (kiểm tra sống: `/health`)
- Dữ liệu demo: [docs/demo/](./demo/)

## 1. Dữ liệu demo

Hai file TXT nhỏ, để server free (Render, 512 MB) xử lý nhẹ:

| File | Kích thước | Nội dung |
|---|---|---|
| [demo-volume-1.txt](./demo/demo-volume-1.txt) | 6,8K ký tự, 13 bài, 3 trang | "Tập 1": bài chứa **đáp án** của 5 câu hỏi xuyên sách, kèm vài bài khác |
| [demo-volume-2.txt](./demo/demo-volume-2.txt) | 13,2K ký tự, 13 bài, 5 trang | "Tập 2": bài **cầu nối** dẫn sang tập 1, kèm vài bài khác |

Nguồn: rút từ bộ KG-Series ([eval/datasets/kg-series](../backend/eval/datasets/kg-series/)),
vốn được dựng từ HotpotQA *validation* (tập test). Các bài được chép nguyên văn.
Đáp án và câu bằng chứng của từng câu hỏi nằm trong [demo-questions.json](./demo/demo-questions.json).
Các câu hỏi xuyên sách chọn từ những câu "hỏi khi đọc tập 2, đáp án ở tập 1" của KG-Series:
đáp án **không có** trong tập 2, nên chỉ trả lời được nếu hệ thống liên kết được với sách đã đọc trước.

## 2. Chuẩn bị

### Một ngày trước

1. **Deploy** backend (Render) và frontend (Vercel) với commit mới nhất.
2. **Biến môi trường trên Render:**

   | Biến | Giá trị | Lý do |
   |---|---|---|
   | `HEFU_API_KEY` | key HeFU | LLM chính |
   | `HEFU_MODEL` | `deepseek-v4-flash` | model cho chat |
   | `HEFU_GRAPH_MODEL` | `deepseek-v3` | model cho trích xuất KG (model có suy luận bị timeout khi trích xuất) |
   | `WORKER_CONCURRENCY` | `1` | mỗi lúc chỉ chạy một job nặng; với 2, server từng ngừng phản hồi khi upload 4 file cùng lúc |
   | `GROQ_MODEL` | `openai/gpt-oss-120b` (hoặc xoá biến) | dự phòng khi HeFU lỗi |

3. **Tài khoản demo** `test@gmail.com`: mở *Sơ đồ tri thức* của sách *CL with GT.pdf*,
   bấm **Trích xuất lại**. Trích xuất trước đây của sách này lỗi ("inconsistent types…
   $2"), lỗi đã được sửa ở bản deploy mới.
4. Tạo workspace **"Demo KG-Series"** trong tài khoản demo (đừng upload sẵn: upload là một phần của demo).
5. Diễn tập toàn bộ kịch bản một lần theo đúng thứ tự dưới đây.

### Ba mươi phút trước khi quay

1. Mở https://digitalbookllm.onrender.com/health. Server free ngủ sau một thời gian không dùng,
   và request đầu tiên có thể mất 30–60 giây để đánh thức. Thấy `{"status":"ok"}` là được.
2. Đăng nhập trước một lần để server nạp sẵn model embedding.
3. Đóng các ứng dụng nặng; dùng Chrome hoặc Edge. Edge có sẵn giọng đọc tiếng Việt cho nút *Đọc to*.

## 3. Kịch bản

Thời lượng ước tính: 12–15 phút. Kịch bản đã được diễn tập tự động 3 lần ở local với cấu hình production; lần cuối đạt 23/23 bước. Các con số trong cột "Đã kiểm chứng" là khoảng giá trị qua các lần chạy. Thời gian trả lời ghi trong bảng là số đo khi diễn tập
với đúng cấu hình production (HeFU + Groq dự phòng). "Chữ đầu tiên" là lúc câu trả lời bắt đầu hiện ra.

### D1. Đăng nhập và thư viện (UC-01, UC-02)

| Thao tác | Kết quả mong đợi |
|---|---|
| Đăng nhập `test@gmail.com` | Vào *Thư viện của bạn* |
| Chọn workspace *Demo KG-Series* | Workspace rỗng: "Chưa có tài liệu nào" |
| (Tuỳ chọn) đổi ngôn ngữ VI/EN và giao diện Sáng/Tối | Giao diện đổi ngay |

### D2. Upload tập 1 và đọc ngay (UC-03, UC-07)

| Thao tác | Kết quả mong đợi | Đã kiểm chứng |
|---|---|---|
| Kéo thả `demo-volume-1.txt` vào *Tải sách lên* | Thẻ sách hiện trạng thái *Đang xử lý* rồi *Sẵn sàng* | Xử lý xong trong khoảng 2 giây, 3 trang |
| Mở sách khi còn *Đang xử lý* | Đọc được ngay, có dải thông báo "Đang phân tích tài liệu…" | — |

**Điểm nhấn khi trình bày:** upload trả về ngay (202), việc xử lý chạy nền qua hàng đợi.

**Chờ KG tập 1 xong** (khoảng 45–60 giây) rồi mới sang D8. Có thể làm D3–D6 trong lúc chờ.

### D3. Hỏi đáp có trích dẫn (UC-08, UC-09)

Chế độ *Đọc & Chat*, gõ vào ô chat:

| Câu hỏi | Kết quả mong đợi | Đã kiểm chứng |
|---|---|---|
| `On which date did the radio program Meet Corliss Archer end?` | "…September 30, 1956 [1]", chip **[1] Trang 1** được làm nổi bật | Đúng, chữ đầu tiên sau khoảng 5 giây |
| Bấm chip **[1]** | Trình đọc nhảy tới trang chứa đoạn được trích | Đúng |

**Điểm nhấn:** chip đậm là đoạn mà câu trả lời **thực sự trích dẫn**; chip mờ là đoạn chỉ được truy xuất
(di chuột vào chip mờ để xem chú thích).

### D4. Hỏi bằng tiếng Việt trên sách tiếng Anh

| Câu hỏi | Kết quả mong đợi | Đã kiểm chứng |
|---|---|---|
| `Shirley Temple từng giữ chức vụ gì trong chính phủ Mỹ?` | Trả lời **bằng tiếng Việt**: đại sứ tại Ghana và Tiệp Khắc, Chief of Protocol (Trưởng ban Lễ tân/Nghi lễ), có [1] | Đúng, chữ đầu tiên sau khoảng 5 giây |

### D5. Chống ảo giác: câu không có đáp án trong sách

| Câu hỏi | Kết quả mong đợi | Đã kiểm chứng |
|---|---|---|
| `Ai là người phát minh ra điện thoại?` | "Tài liệu không cung cấp thông tin…", **không** nêu tên Bell, không có trích dẫn | Đúng |
| `What is the population of Mars in 2024?` | "The document does not provide this information." | Đúng |

**Điểm nhấn:** model có biết đáp án (Alexander Graham Bell) nhưng không nói ra, vì đáp án không có trong sách.
**Tránh** câu hỏi về chính trị hoặc nhân vật chính trị đương thời ở bước này: bộ lọc nội dung của
nhà cung cấp model có thể từ chối (xem mục 5).

### D6. Bôi đen văn bản: đánh dấu, ghi chú, đọc to, hành động nhanh (UC-05, UC-08, UC-12)

Ở trang 1 tập 1, bôi đen câu *"As an adult, she was named United States ambassador to Ghana…"*.

| Thao tác trên popover | Kết quả mong đợi | Đã kiểm chứng |
|---|---|---|
| Chọn màu (vàng/xanh/…) | Đoạn được tô màu, xuất hiện ở tab *Đánh dấu* | Đúng (giao diện + API) |
| *Ghi chú* → nhập → *Lưu* | Ghi chú gắn với đoạn | Đúng qua API; kiểm tra lại trên giao diện khi diễn tập |
| *Đọc to* | Trình duyệt đọc đoạn văn (giọng của trình duyệt) | Server chưa cấu hình TTS riêng nên dùng giọng trình duyệt; **chưa nghe thử**, kiểm tra loa và giọng tiếng Việt khi diễn tập |
| *Hỏi AI* → nút **Dịch sang tiếng Việt** | Bản dịch: "Khi trưởng thành, bà được bổ nhiệm làm đại sứ Hoa Kỳ tại Ghana và Tiệp Khắc…" | Đúng |
| Bôi đen đoạn *Meet Corliss Archer…* → **Tóm tắt đoạn này** | Tóm tắt bằng tiếng Việt | Đúng |
| → **Giải thích khái niệm khó** | Giải thích chương trình radio "Golden Age" bằng tiếng Việt | Đúng |

**Điểm nhấn:** đoạn được bôi đen là *ngữ cảnh cứng* (hard context): luôn được đưa vào prompt,
bất kể kết quả tìm kiếm vector.

### D7. Sơ đồ tri thức của tập 1 (UC-13, UC-14)

| Thao tác | Kết quả mong đợi | Đã kiểm chứng |
|---|---|---|
| Chuyển sang *Sơ đồ tri thức*, phạm vi *Tài liệu này* | Dòng trạng thái "Đã trích xuất N quan hệ", các cụm node có cạnh nối | 34–42 quan hệ, xong sau 40–56 giây |
| Bấm node **Shirley Temple** | Khung nhìn trượt tới node, làm nổi bật các node kề; panel phải liệt kê quan hệ kèm đoạn trích nguyên văn và "Tên sách · Trang N" | Đúng (giao diện, với sách khác; API với sách demo) |
| Bấm vào đoạn trích ở panel | Mở sách đúng trang chứa đoạn nguồn | Panel hiện "Tên sách · Trang N" đúng; thao tác bấm mở trang cần kiểm tra khi diễn tập |

### D8. Upload tập 2 (sách "đọc sau")

| Thao tác | Kết quả mong đợi | Đã kiểm chứng |
|---|---|---|
| Upload `demo-volume-2.txt` (khi KG tập 1 đã xong) | *Sẵn sàng* sau vài giây; KG tập 2 xong sau khoảng 1 phút | Xử lý 2–4 giây, KG 68–76 giây, 23–54 quan hệ |
| Câu trong sách: `When did Alex Ferguson manage Manchester United?` | "1986 to 2013 [1]", trích tập 2 | Đúng |

### D9. Câu hỏi xuyên sách: điểm chính của đề tài

Mở **tập 2**, hỏi các câu dưới đây. Đáp án **không có trong tập 2**: hệ thống phải tìm sang tập 1
(sách đã đọc trước), dùng KG để nối hai thực thể.

| # | Câu hỏi (gõ nguyên văn) | Đáp án | Chuỗi suy luận | Đã kiểm chứng |
|---|---|---|---|---|
| 1 | `What government position was held by the woman who portrayed Corliss Archer in the film Kiss and Tell?` | Chief of Protocol | Kiss and Tell (tập 2) → Shirley Temple → Chief of Protocol (tập 1) | Đúng, trích **[1] tập 2** và **[3] tập 1** |
| 2 | `The arena where the Lewiston Maineiacs played their home games can seat how many people?` | 3,677 chỗ ngồi | Lewiston Maineiacs (tập 2) → Androscoggin Bank Colisée (tập 1) | Đúng |
| 3 | `Where is the company that Sachin Warrier worked for as a software engineer headquartered?` | Mumbai | Sachin Warrier (tập 2) → Tata Consultancy Services (tập 1) | Đúng, trích cả 2 tập |
| 4 | `What is the name of the executive producer of the film that has a score composed by Jerry Goldsmith?` | Ronald Shusett | Alien (soundtrack) (tập 2) → Alien (film) (tập 1) | Đúng |
| 5 | `Robert Suettinger was the national intelligence officer under which former Governor of Arkansas?` | Bill Clinton | Robert Suettinger (tập 2) → Bill Clinton (tập 1) | Đúng |

Nên demo câu 1 (dễ hiểu nhất), giữ 2–5 làm dự phòng.
**Điểm nhấn:** chỉ ra trên các chip trích dẫn rằng câu trả lời dùng cả hai cuốn sách.
Số liệu trên toàn bộ 40 câu: xem mục 6.

### D10. Sơ đồ toàn bộ: kiến thức nối giữa hai cuốn sách

| Thao tác | Kết quả mong đợi | Đã kiểm chứng |
|---|---|---|
| *Sơ đồ tri thức* → phạm vi **Toàn bộ** | Sơ đồ gồm thực thể của cả hai tập | 84–108 node, 57–89 cạnh |
| Bấm **Shirley Temple** | Quan hệ "stars → Kiss and Tell" mang nguồn *demo-volume-2.txt*, nối với node đã có từ tập 1 | Đúng |

### D11. Chat làm giàu KG

| Thao tác | Kết quả mong đợi | Đã kiểm chứng |
|---|---|---|
| Ở tập 2, hỏi `Who composed the score of Alien, and who was the executive producer of the film?` | Jerry Goldsmith [1], Ronald Shusett [3] | Đúng |
| Chờ khoảng 2 phút (các lượt chat được gộp lại rồi mới trích xuất), mở lại *Toàn bộ* | Số cạnh tăng | 57 → 61 cạnh (lần khác 73 → 81) |

### D12. Lịch sử và dọn dẹp (UC-06, UC-10)

| Thao tác | Kết quả mong đợi |
|---|---|
| Tải lại trang sách | Cuộc trò chuyện vẫn còn (lịch sử phiên); đã kiểm chứng qua API |
| (Tuỳ chọn) Xoá một ghi chú, một tài liệu | Biến mất khỏi danh sách |

## 4. Kiểm thử ngoài phần demo (đã chạy ở local, cùng cấu hình production)

| Nhóm | Kết quả |
|---|---|
| Upload 6 định dạng: PDF, PDF scan (OCR), DOCX, EPUB, TXT, MD | Đạt; file `.exe` bị từ chối với mã 415 |
| Phân quyền (IDOR): tài khoản khác đọc hoặc sửa dữ liệu | 11 probe, 0 rò rỉ |
| Hàng đợi: tiến trình bị kill giữa chừng | Job được đưa lại hàng đợi sau khoảng 150 giây; ingest hết lượt thử thì tài liệu chuyển *Lỗi xử lý*, không treo |
| Unit + integration test | 89 test đạt (Postgres thật cho integration) |

## 5. Xử lý sự cố khi demo

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Trang tải rất lâu ở lần đầu | Server free đang ngủ | Mở `/health` trước 30 phút (mục 2) |
| Câu trả lời lâu (thường 5–7 giây, có lúc tới 15 giây) mới bắt đầu hiện | `deepseek-v4-flash` suy luận trước khi trả lời | Bình thường; câu trả lời vẫn stream sau đó |
| Thông báo lỗi chứa "inappropriate content" | Bộ lọc nội dung phía nhà cung cấp model từ chối ngẫu nhiên, kể cả với đoạn văn bình thường | Hệ thống tự đổi model rồi chuyển sang Groq; nếu vẫn lỗi, hỏi lại câu đó lần nữa hoặc dùng câu dự phòng ở D9 |
| Câu trả lời tiếng Anh cho câu hỏi tiếng Việt | Model dự phòng lệch ngôn ngữ | Hệ thống tự hỏi lại tối đa 2 lần; nếu vẫn lệch thì hiện thông báo tiếng Việt và người dùng hỏi lại |
| Sơ đồ báo "Trích xuất sơ đồ thất bại" | Một số đoạn bị từ chối hoặc hết lượt thử | Bấm **Trích xuất lại** |
| Upload mãi không xong | Server quá tải hoặc vừa khởi động lại | Chờ khoảng 2–3 phút (job tự được đưa lại hàng đợi); upload từng file một |

## 6. Số liệu đánh giá để trả lời hội đồng

Chi tiết và cách chạy lại: [backend/eval/ablation/README.md](../backend/eval/ablation/README.md).

**Cách lấy mẫu:** không có mẫu nào được chọn tay hay tự viết; mọi câu hỏi và đáp án lấy từ nhãn của dataset.
- Truy xuất: dùng **toàn bộ** câu của tập test (ViQuAD 306 câu có đáp án, HotpotQA 17 câu).
- KG-Series, KG-Chat: lấy **theo thứ tự trong dataset** với tiêu chí lọc cố định (xem README của từng bộ).
- Sinh câu trả lời trên ViQuAD: **ngẫu nhiên có seed cố định** (seed 42, chạy lại ra cùng mẫu):
  15 trong 306 câu có đáp án và 5 trong 156 câu không có đáp án. Tham số được chọn trên tập *dev* (split train của dataset,
chỉ dùng để chọn tham số, không huấn luyện gì) rồi chạy **một lần** trên tập *test* (split validation).

| Thí nghiệm | Dữ liệu (n) | Kết quả | Lưu ý |
|---|---|---|---|
| Truy xuất trong một sách | HotpotQA test, 17 câu multi-hop, sách 104K ký tự | R@5 = 100% (R@1 94,1%); cả 2 câu bằng chứng trong top-5: 100% | n nhỏ |
| Truy xuất trong một sách | UIT-ViQuAD 2.0 test, 306 câu, 65,6K ký tự | R@5 = 82,7% (trước cải tiến: 24,5%), R@1 = 41,2% | — |
| Ảo giác | ViQuAD test: **5** câu không có đáp án, do người gán nhãn của dataset đánh dấu (`is_impossible`), lấy ngẫu nhiên có seed từ 156 câu | Không RAG: 4/5 vẫn trả lời; có RAG: 1/5 | Rất nhỏ; nên nói "4/5 → 1/5". Bản RAG cũ cũng 1/5, nên đây là tác dụng của RAG nói chung |
| Trích dẫn | HotpotQA, 17 câu | 89,5% đoạn được trích có câu bằng chứng, so với 24,2% đoạn không được trích | — |
| KG xuyên sách | KG-Series, 40 câu, 3 tập | Trả lời đúng: chỉ sách đang mở 5%; RAG tìm sang sách trước nhưng không KG 35%; **có KG 57,5%** (+10/−1 câu, McNemar p = 0,012) | Truy xuất như nhau (95%) có hay không có KG: phần đóng góp của KG là các quan hệ nối đưa vào prompt |
| KG học từ chat | KG-Chat: 40 hội thoại OpenDialKG, 175 thực thể, 137 quan hệ gán nhãn | Thực thể 88,0%, quan hệ 47,4%, so với 82,9% / 23,4% của baseline không dùng LLM (cụm từ viết hoa + đồng xuất hiện) | — |
| Dùng lại node cũ | 7 thực thể gán nhãn đã có sẵn trong đồ thị trước hội thoại | 6/6 thực thể được trích ra đều gộp vào node cũ; thực thể còn lại (*Actor*) không được trích | n rất nhỏ; 4/7 là khái niệm chung (Actor, Fiction, Drama, Fantasy) |

**Giới hạn cần nói rõ:**
- Câu trả lời trong các thí nghiệm trên được sinh bằng qwen2.5:7b chạy local (temperature 0, nhưng
  không hoàn toàn tất định); production dùng deepseek-v4-flash qua HeFU.
- Các tập test nhỏ (5–40 câu): chênh lệch dưới khoảng 10 điểm là nhiễu, trừ khi kiểm định cặp cho kết quả có ý nghĩa.
- Trong quá trình làm đã phát hiện và sửa một số lỗi đo lường của chính mình (đo sai top-k,
  chưa nhận diện câu từ chối bằng tiếng Trung, so khớp tên thực thể quá lỏng).

## 7. Sau buổi demo

- Xoá workspace *Demo KG-Series* nếu cần quay lại từ đầu (xoá từng tài liệu trong workspace).
- Tài khoản benchmark tạo lúc 03:00 ngày 05/10 (`bench_…@digitalbookllm.test`, workspace *Benchmark*,
  4 sách) có thể xoá trong Supabase:
  `DELETE FROM users WHERE email LIKE 'bench\_%@digitalbookllm.test';` (dữ liệu con xoá theo khoá ngoại),
  (mọi bảng con có `ON DELETE CASCADE` trong [schema.sql](../backend/src/db/schema.sql)).
  File gốc trong Supabase Storage không bị xoá theo: xoá thư mục `<workspaceId>/` trong bucket `documents`.
