# Kiểm toán Champion 2025–2026

Kỳ tín hiệu: 2025-01-01 đến 2026-10-05. Dữ liệu: tín hiệu Champion đã lưu và chuỗi giá nghiên cứu KBS được xác minh.

**Trạng thái: CHƯA ĐỦ PHỦ – không dùng làm ground truth**. Mã có giá đạt chuẩn: 274/275; lượt mua D đủ tuổi T+2: 29.

Dải ngày tín hiệu lưu trữ: 2026-09-11 đến 2026-10-05.
Phiên breadth có ít nhất một tín hiệu Champion: 17/435.
Phiên bản Champion trong mẫu: {'core-rules-v3.0.0': 105, 'core-rules-v4.0.0': 52, 'legacy': 1528} (phiên bản hiện hành: core-rules-v4.0.0).
Universe manifest SHA-256: d01dcbf6cd531c8d5f9c46a58e7f3ccc9a075b90534573f722982e8e2f18340c.

Đây là nghiên cứu theo lượt tín hiệu, không phải lợi suất NAV danh mục. Các lượt có thể trùng mã/ngày; lợi suất 20 phiên là giữ cố định, chưa mô phỏng tái cân bằng danh mục. Đáy OHLC của T+2 là proxy bảo thủ cho buổi sáng, không xác định được giờ xảy ra.

Mã bị loại do giá chưa xác minh: 1 (STK).

## Điểm vào và rủi ro T+

Khoảng cách entry tới pivot/base: đủ bằng chứng 16/29 lượt; trung vị 0.72% và P90 5.21%.
Khoảng cách entry tới invalidation stop: đủ bằng chứng 23/29 lượt; trung vị 8.24% và P90 17.53%.
Tỷ lệ khoảng cách >5% / >8% / >12%: 18.8% / 0.0% / 0.0%
Sụt giảm trong cửa sổ khóa: trung bình -2.69%, xấu nhất -7.03%.
Thắng tại T+2 close sau chi phí: 27.6%.
Bull trap (lãi close ngày mua, lỗ tại T+3): 17.2%.

## Tổn thương theo nhóm bộ máy

- Core: 29 lượt; sụt giảm khóa trung bình -2.69%.
- MACD: 5 lượt; sụt giảm khóa trung bình -2.85%.

## Hiệu suất theo trạng thái VN-Index

| Trạng thái | Lượt đủ T+ | T+ thắng | Lượt đủ 20 phiên | Lợi suất 20 phiên TB | Win rate 20 phiên | Profit factor 20 phiên |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| UP | 26 | 23.1% | 0 | — | — | — |
| SIDEWAYS | 3 | 66.7% | 0 | — | — | — |
| DOWN | 0 | — | 0 | — | — | — |
| UNKNOWN | 0 | — | 0 | — | — | — |

Các ngưỡng Challenger chỉ nên hiệu chỉnh sau khi đủ dữ liệu điều chỉnh giá, cùng tập mẫu cho Champion và Challenger, và một giai đoạn quan sát ngoài mẫu.

## Phạm vi và quyết định kiểm toán

- [Đồng bộ KBS đến 05/10](https://github.com/vnxprot/protstock_app/actions/runs/37403479262) xử lý đủ 275 mã, 116.383 thanh giá; 274 mã `MATCHED`, 1 mã `INCOMPLETE` (STK có một ngày giá lưu trữ không khớp nguồn). Audit chỉ nhận 274 mã đạt điều kiện. Mã GVT thuộc nhóm có chuỗi nghiên cứu khớp, nhưng thiếu giá EOD sản xuất ngày 05/10 nên vắng trong lượt shadow cùng ngày.
- [Audit 05/10](https://github.com/vnxprot/protstock_app/actions/runs/37406361313) ghi nhận 29 lượt mua D đủ T+2, trong đó 16 lượt có pivot/base và 23 lượt có stop để đo khoảng cách. Không suy diễn các tỷ lệ này sang toàn bộ universe hoặc từ 2025.
- Không có bản lưu tín hiệu Champion trước 11/09/2026. Các tín hiệu hiện có chỉ phủ 17/435 phiên breadth và trộn `legacy`, v3, v4. Không thể xác nhận hiệu suất thực tế của Champion từ đầu 2025; tái chạy quy tắc hiện nay trên giá quá khứ sẽ là nghiên cứu giả lập riêng, không phải lịch sử tín hiệu đã phát hành.
- Không có lượt đủ 20 phiên để tính lợi suất, win rate hay profit factor theo pha VN-Index. Mẫu SIDEWAYS chỉ có 3 lượt T+; chưa có bằng chứng định lượng để hiệu chỉnh các ngưỡng 5%/7%/8% hoặc khẳng định lợi thế của Challenger. Workflow audit kết thúc với exit code 2 theo `--require-complete`, nhằm từ chối nhãn “đủ phủ”, dù báo cáo đã được lưu thành artifact.

## Tình trạng triển khai Challenger

- [Migration production](https://github.com/vnxprot/protstock_app/actions/runs/37360022878) tạo hai bảng shadow độc lập, không sửa dữ liệu danh mục Champion.
- [Lượt shadow 05/10](https://github.com/vnxprot/protstock_app/actions/runs/37403261265) xử lý **274/275** mã và ghi 274 assessment riêng. GVT thiếu giá EOD cùng phiên nên được bỏ qua. Chưa có outcome T+2 trưởng thành (`dual_engine_tplus_matured=0`); bảng điểm A/B để trống cho đến khi có mẫu thực.
- Web production hiển thị ba chế độ Champion, Challenger, Đối chiếu; cột ngành lấy điểm sức khỏe và tỷ trọng giao dịch từ breadth của cùng phiên. Challenger chỉ đọc dữ liệu EOD và không đặt lệnh vào danh mục.
