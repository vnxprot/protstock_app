# Prot Stock v2.0.2 — 08/10/2026

## Bộ lọc tín hiệu

- Radar cơ hội hiển thị một hàng tóm tắt cho mỗi mã: mốc mới, bằng chứng cùng phiên và khoảng cách đến stop. Số liệu chi tiết và dòng thời gian được mở theo mã.
- Bộ lọc giai đoạn bắt đầu bằng Tất cả. Breakout ngày, xác nhận tuần và tăng tốc lại dựa trên mốc xảy ra trong phiên, kể cả khi một mốc mới hơn thay nhãn giai đoạn cuối cùng. Rủi ro điểm vào và nguồn bằng chứng có bộ lọc riêng.
- Mỗi mã có liên kết đến WATCH Champion, Phễu gốc, Phễu thích ứng Challenger, phân kỳ MACD và biểu đồ. Chỉ dữ liệu có cùng ngày EOD được đối chiếu; nguồn chưa tải được được nêu rõ. Radar không biến sự đồng xuất hiện của các tín hiệu nghiên cứu thành lệnh mua.
- Danh sách ưu tiên tín hiệu Champion đã công bố và mốc mới có khoảng cách stop đạt sơ bộ; sự kiện quá xa stop được xếp sau. Đây là thứ tự đọc thông tin, không phải xếp hạng lợi suất kỳ vọng.

## Phễu tháng → tuần → ngày

- Mỗi hàng chính giữ trên một dòng. Bảng cuộn ngang trên màn hình hẹp và ghim cột Mã.
- Setup tuần có tên dễ đọc; cột Lý do hiển thị tóm tắt ngắn và mở được mã điều kiện đầy đủ.

## Phiên bản và phạm vi

- Cài đặt → Phiên bản bổ sung v2.0.2.
- Không đổi thuật toán EOD, ngưỡng Radar/Phễu, dữ liệu lịch sử, migration hoặc quy tắc giao dịch Champion.
