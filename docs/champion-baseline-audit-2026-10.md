# Kiểm toán Champion 2025–2026

**Trạng thái: CHƯA CHẠY TRÊN DỮ LIỆU LỊCH SỬ ĐÃ XÁC MINH.** Manifest hiện tại `data/universe.csv` có 275 mã duy nhất và đều đang hoạt động. Workspace chưa có bản xuất chuỗi giá nghiên cứu tương ứng hoặc cấu hình đọc dữ liệu lịch sử cho pipeline. Vì vậy chưa có số liệu thực nghiệm; không suy diễn hoặc điền số giả.

## Phạm vi và cách đo đã triển khai

Module `protstock.audit_champion_baseline` nhận bản xuất JSON gồm `symbols`, `bars`, `price_status`, `breadth`, `champion_signals`, `raw_signals`, hoặc đọc các bảng tương ứng qua cấu hình Supabase của pipeline. Module chỉ đọc nguồn và ghi tệp báo cáo này. Nó kiểm tra trạng thái giá nghiên cứu `MATCHED`, phiên bản nguồn KBS, khoảng phủ ngày và chất lượng từng thanh giá trước khi đưa một mã vào mẫu.

Với mỗi lượt Champion mua khung D đã lưu, module lấy giá Open phiên kế tiếp có trượt giá 0,1%, phí mua 0,15%, đo khoảng cách tới pivot và stop trong bằng chứng tín hiệu, rồi tính lãi/lỗ khi có thể bán ở Close T+2 sau phí bán 0,15% và thuế bán 0,1%. Đáy ngày T+2 chỉ là **proxy bảo thủ** cho buổi sáng T+2 vì OHLC EOD không cho biết thời điểm xảy ra đáy. Module còn đo lợi suất nắm giữ cố định 20 phiên, bull trap T+3 và phân nhóm theo trạng thái VN-Index.

Đây là nghiên cứu **theo lượt tín hiệu**, chưa phải backtest NAV của một danh mục với phân bổ vốn và tái cân bằng. Báo cáo kiểm tra danh sách active trong cơ sở dữ liệu khớp manifest, mọi mã trong mẫu có giá đạt chuẩn, không thiếu lượt mua cần đo, và dải tín hiệu lịch sử phủ kỳ nghiên cứu. Mẫu số không được cố định ở 272; số liệu thiếu sẽ được nêu rõ, không được dùng để hiệu chỉnh ngưỡng.

## Điều kiện để hoàn tất bước 2

Cung cấp bản xuất lịch sử đã xác minh hoặc cấu hình Supabase có quyền **đọc** các bảng trên; không cần gửi khóa bí mật trong chat. Sau đó chạy module với `--snapshot <đường dẫn JSON>` hoặc dùng cấu hình đọc của pipeline. Đầu ra này sẽ thay thế báo cáo trạng thái bằng bảng số liệu thực và cho phép hiệu chỉnh Challenger từ ground truth.

Các ngưỡng Challenger 5% tham gia lệnh, 7% cảnh báo và 8% chặn hiện là **giả thuyết theo đặc tả**, chưa được xác nhận bằng hồi cứu universe 275 mã. Scorecard A/B chỉ hiển thị các lượt shadow phát sinh và đủ tuổi sau khi triển khai; chưa có kết quả lịch sử để khẳng định Challenger tốt hơn Champion.
