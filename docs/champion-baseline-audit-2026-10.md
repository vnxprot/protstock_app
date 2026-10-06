# Kiểm toán Champion 2025–2026

Kỳ tín hiệu: 2025-01-01 đến 2026-09-30. Dữ liệu: tín hiệu Champion đã lưu và chuỗi giá nghiên cứu KBS được xác minh.

**Trạng thái: CHƯA ĐỦ PHỦ – không dùng làm ground truth**. Mã có giá đạt chuẩn: 270/275; lượt mua D đủ tuổi T+2: 28.

Dải ngày tín hiệu lưu trữ: 2026-09-11 đến 2026-09-30.
Phiên breadth có ít nhất một tín hiệu Champion: 14/432.
Phiên bản Champion trong mẫu: {'legacy': 1528, 'core-rules-v3.0.0': 83} (phiên bản hiện hành: core-rules-v4.0.0).
Universe manifest SHA-256: d01dcbf6cd531c8d5f9c46a58e7f3ccc9a075b90534573f722982e8e2f18340c.

Đây là nghiên cứu theo lượt tín hiệu, không phải lợi suất NAV danh mục. Các lượt có thể trùng mã/ngày; lợi suất 20 phiên là giữ cố định, chưa mô phỏng tái cân bằng danh mục. Đáy OHLC của T+2 là proxy bảo thủ cho buổi sáng, không xác định được giờ xảy ra.

Mã bị loại do giá chưa xác minh: 5.

Lượt tín hiệu bị loại: {'unverified_price': 1}.

## Điểm vào và rủi ro T+

Khoảng cách entry tới pivot/base: đủ bằng chứng 16/28 lượt; trung vị 0.72% và P90 5.21%.
Khoảng cách entry tới invalidation stop: đủ bằng chứng 23/28 lượt; trung vị 8.24% và P90 17.53%.
Tỷ lệ khoảng cách >5% / >8% / >12%: 18.8% / 0.0% / 0.0%
Sụt giảm trong cửa sổ khóa: trung bình -2.76%, xấu nhất -7.03%.
Thắng tại T+2 close sau chi phí: 28.6%.
Bull trap (lãi close ngày mua, lỗ tại T+3): 17.9%.

## Tổn thương theo nhóm bộ máy

- Core: 28 lượt; sụt giảm khóa trung bình -2.76%.
- MACD: 4 lượt; sụt giảm khóa trung bình -3.33%.

## Hiệu suất theo trạng thái VN-Index

| Trạng thái | Lượt đủ T+ | T+ thắng | Lượt đủ 20 phiên | Lợi suất 20 phiên TB | Win rate 20 phiên | Profit factor 20 phiên |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| UP | 25 | 24.0% | 0 | — | — | — |
| SIDEWAYS | 3 | 66.7% | 0 | — | — | — |
| DOWN | 0 | — | 0 | — | — | — |
| UNKNOWN | 0 | — | 0 | — | — | — |

Các ngưỡng Challenger chỉ nên hiệu chỉnh sau khi đủ dữ liệu điều chỉnh giá, cùng tập mẫu cho Champion và Challenger, và một giai đoạn quan sát ngoài mẫu.

## Kiểm tra độ mới dữ liệu và quyết định

- Lượt chạy tại phiên 05/10/2026: **0/275** chuỗi nghiên cứu đáp ứng điều kiện phủ đến phiên đó; tín hiệu Champion lưu trữ có mặt ở **17/435** phiên. Đây là thiếu đồng bộ nghiên cứu đến ngày mới, không phải kết quả thua lỗ của 275 mã.
- Lượt chạy tại mốc 30/09/2026 ở trên: **270/275** mã có chuỗi đạt chuẩn; **28** lượt mua đủ T+2, nhưng **0** lượt đủ 20 phiên. Các thống kê 28 lượt là số liệu mô tả một mẫu ngắn, không đủ để chọn ngưỡng 5%/7%/8% hay kết luận hiệu suất theo pha thị trường.
- Tín hiệu Champion lưu trữ chỉ phủ **14/432** phiên trong kỳ 2025–30/09/2026 và trộn nhãn `legacy` với `core-rules-v3.0.0`; không phải bản replay toàn kỳ của Champion v4 hiện hành. Bước kiểm toán toàn kỳ cần replay trên cùng dữ liệu điều chỉnh giá và phiên bản quy tắc được đóng băng, sau đó đối chiếu ngoài mẫu.

Nguồn kiểm chứng: [audit 30/09](https://github.com/vnxprot/protstock_app/actions/runs/37360205746), [audit 05/10](https://github.com/vnxprot/protstock_app/actions/runs/37359848546). Hai workflow kết thúc trạng thái failure có chủ đích vì cờ `--require-complete` từ chối gắn nhãn đủ phủ cho các mẫu thiếu dữ liệu.
