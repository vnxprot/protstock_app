# Nhật ký quyết định

Triển khai ba phần trong cùng trang: Dòng thời gian, Vòng giao dịch, Hiệu quả. Nội dung hướng dẫn dùng chung ở `src/lib/journalGuide.ts`, đăng ký vào GuideHub trong Cài đặt, đường dẫn `#settings?guide=journal`.

## Dữ liệu và tương thích

- Migration `20261016010000_journal_decision_workspace.sql` chỉ bổ sung trường; giữ nguyên các ghi chép, evidence và liên kết tự động từ Danh mục.
- `workflow` giữ nguồn, một chiến lược chính, phiên bản, vai trò, checklist, kế hoạch và tiêu chí quan sát. Trigger khóa các trường lịch sử sau lần phân loại đầu, chỉ cho cập nhật trạng thái, tuân thủ, tâm lý và ghi chú.
- `linked_transaction_id` gắn quyết định chủ động với một giao dịch; unique index không cho đếm trùng liên kết. `transaction_id` cũ vẫn là liên kết bản ghi tự động. `linked_cycle_id` gắn các quan sát/tổng kết với giao dịch mua mở vòng.
- Guard kiểm tra cùng người dùng, mã, chiều, ngày giao dịch và vòng. Vòng được dựng từ sổ, tách theo danh mục + mã; dùng ngày, created_at, id để sắp thứ tự. Hủy liên kết do xóa giao dịch sẽ đánh dấu quyết định Hủy.
- Phân loại bổ sung vào ghi chép cũ hoặc ghi sau một giao dịch có sẵn được đánh dấu hồi cứu. Không tự gán chiến lược cho dữ liệu cũ; R không dùng stop bổ sung sau giao dịch.

## Tính kết quả

- Giá vốn bình quân gia quyền, dùng chung `portfolioCosts.ts` và cấu hình theo danh mục/ngày. Số tiền phí/thuế thực ưu tiên mức ước tính.
- Mỗi vòng đóng hợp lệ là một mẫu; giữ nguyên tất cả giao dịch trong vòng khi lọc cohort entry. Bán từng phần không tăng mẫu. Nguồn chiến lược entry và exit tách riêng.
- R cần stop được ghi trước mọi lần mua, denominator là tổng rủi ro từng lần vào, không phải mức phơi nhiễm cực đại đồng thời.
- Tỷ lệ thắng, Wilson 95%, kỳ vọng VND/vòng, profit factor, R và số mẫu R. Các nhóm bằng chứng có thể trùng nhau; không cộng tổng các nhóm. Nhãn ít mẫu dưới 30 không phải kiểm định đủ mẫu.
- Quan sát sau quyết định dùng RPC owner-only `journal_forward_results()`, không chạy backtest hoặc đặt lệnh. Máy chủ khóa baseline, cơ sở/revision giá, ngày bắt đầu và tiêu chí 5/10/20 phiên. Cần đủ từng phiên lịch VNINDEX, giá hợp lệ và cùng cơ sở; nếu không, kết quả bị loại khỏi đạt/trượt và hiển thị lý do.
- Forward observations là biến động Close, không phải P&L. Chỉ gồm quyết định đã đăng ký. Mất mạng bắt đầu cửa sổ ở ngày máy chủ nhận đồng bộ. Ghi chép trùng cửa sổ không phải mẫu độc lập.

## Giao diện

Dùng shared buttons, SoftSelect, tabs, action pills, ResearchPagination, modal focus/scroll lock và tokens trong `design-system.css`. Dòng thời gian gọn theo ngày; bảng chi tiết bên phải desktop, toàn màn hình mobile. Liên kết từ Signals/WATCH, Radar, Phễu gốc/Challenger, MACD gốc/Challenger, Phân tích mã và luận điểm tuân theo quyền Nhật ký hiện có.

## Triển khai

Kiểm tra build, tests Nhật ký/sổ giao dịch/tín hiệu và migration smoke cục bộ. Push `main` kích hoạt Vercel theo tích hợp Git hiện có. Dispatch workflow `database.yml` mode `deploy` để áp migration Supabase. Không kích hoạt backtest, EOD, Telegram hoặc làm lại dữ liệu thị trường cho thay đổi này; không theo dõi các action sau khi dispatch theo yêu cầu người dùng.
