# Việc còn lại cần bổ sung thủ công

Danh sách này liệt kê những phần tôi không thể tự hoàn thiện khi dọn lại báo cáo
(chủ yếu là hình ảnh cần vẽ lại, vì tôi không tạo được file ảnh/diagram), để bạn
bổ sung khi có thời gian trước khi nộp.

## 1. Hình ảnh cần vẽ lại (do đã đổi kiến trúc, không còn agentic/LoRA)

| Vị trí dùng trong báo cáo | File ảnh hiện tại | Vấn đề | Cần vẽ gì thay thế |
|---|---|---|---|
| Chương 4, sơ đồ lớp (`fig:class`) | `images/class_diagram.png` | Còn hiển thị `AgentOrchestrator` và `FinetuningService` (đã bỏ khỏi hệ thống) | Đổi tên `AgentOrchestrator` thành `RagQueryService`; xoá `FinetuningService`; thêm các lớp `Workspace`, `Highlight`, `GraphEntity`, `GraphRelation`, `Job`, `LLMRouterService` (`ILLMProvider` giữ nguyên). Xem đặc tả văn bản đầy đủ ở mục 4.4 để vẽ đúng thuộc tính và phương thức. |
| Chương 5, mục Kiến trúc đồ thị tri thức | Chưa có ảnh minh hoạ (ảnh cũ mô tả vòng lặp AI Agent đã bị xoá) | Cần một sơ đồ mới thay thế | Vẽ luồng trích xuất tri thức chạy nền: worker nhận văn bản, gọi LLM trích xuất thực thể/quan hệ có cấu trúc, upsert vào `entities`/`entity_relations`, rồi giao diện truy vấn lân cận để hiển thị đồ thị. |

Các ảnh không còn được báo cáo tham chiếu (do gắn với nội dung Agentic/LoRA đã
gỡ bỏ) đã được xoá khỏi thư mục `images/`: `activity-diagrams/ac-03.png`,
`sequence-diagrams/seq-04.png`, `rag-workflow/rag-agentic-workflow.png`,
`RAG_Agentic_Workflow.png`.

Các thư mục `images/activities/`, `images/sequence/`, `images/usecases/` chứa
ảnh không được báo cáo tham chiếu ở đâu cả, kể cả trước khi tôi chỉnh sửa lần
này. Có vẻ là bản nháp cũ hơn nên tôi không tự xoá; bạn kiểm tra lại xem có
cần giữ không.

## 2. Ảnh chụp màn hình còn thiếu (UI chưa có ảnh minh hoạ)

| Vị trí | Mục đích |
|---|---|
| Chương 4, mục "Thanh công cụ ngữ cảnh nổi" | Ảnh chụp popover 4 nút (Highlight/Note/Speak/Ask AI) khi bôi đen văn bản trong trình đọc. |
| Chương 4, mục "Màn hình khám phá đồ thị tri thức" | Ảnh chụp Graph Mode: canvas mạng lưới nút và cạnh, cùng panel chi tiết bên phải. |

Cả hai tôi đã ghi chú trực tiếp trong file `.tex` tương ứng (in nghiêng, dễ tìm
bằng cách tìm chuỗi "chưa có sẵn trong bộ tài nguyên hình ảnh").

## 3. Biểu đồ Gantt (Phụ lục B)

Biểu đồ hiện có đủ 5 giai đoạn, mốc thời gian theo tháng (02/2026 đến 09/2026)
và 2 milestone (MVP cuối tháng 6, nghiệm thu cuối tháng 9). Phần chưa có: phân
bổ nhân lực/người phụ trách theo từng phân hệ, và mốc theo tuần thay vì theo
tháng. Bổ sung nếu nhóm cần trình bày chi tiết hơn cho hội đồng.

## 4. Nội dung có thể cân nhắc bổ sung thêm (không bắt buộc)

- Ảnh chụp màn hình thực tế của giao diện đã triển khai. Hiện Chương 4 dùng 3
  ảnh sẵn có (thư viện, split-screen, citation) và đã khớp với hệ thống thật,
  nên không cần đổi.
- Số liệu đánh giá RAG với ít nhất một nhà cung cấp LLM thật sự cấu hình.
  Hiện tại Phụ lục A ghi "không áp dụng" cho phần sinh câu trả lời vì môi
  trường đo không có khoá API nào; chạy lại `npm run eval:rag` sau khi cấu
  hình một khoá thật sẽ cho số liệu đầy đủ hơn về độ chính xác câu trả lời.
