# Prot Stock v2.0.1 — 08/10/2026

## Bộ lọc tín hiệu

- Thêm **Radar đà tăng** độc lập với tín hiệu mua Champion và các đánh giá Challenger. Radar có các mốc: đột biến giá và khối lượng (giá tăng ít nhất 4%, volume ít nhất 1,8× TB20, đóng ở 40% trên của biên phiên), breakout ngày qua đỉnh 13 tuần trước đã hoàn thành (volume ít nhất 1,3× TB20), xác nhận tuần (volume tuần ít nhất 1,3× TB13 tuần trước), tiếp diễn và tăng tốc lại (vượt đỉnh năm phiên trước, volume ít nhất 1,3× TB20).
- Các mốc trong một đợt tăng dùng chung `event_id`; việc có setup tuần mới không xóa mốc breakout cũ. Radar ghi ngày phát hiện, ngày breakout, ngày xác nhận tuần, mốc tăng tốc và mức vô hiệu.
- Trạng thái điểm vào được xét riêng. Giá cách stop cấu trúc trên 8% được gắn **quá xa stop**; trạng thái này không tạo lệnh. Khối lượng khớp lệnh không được gọi là tiền mua ròng.
- Phát hiện giá thay đổi tỷ lệ quá lớn chưa kiểm chứng được cách ly dưới nhãn **Cần kiểm tra dữ liệu**.

## Phễu tháng → tuần → ngày

- Một breakout tuần chỉ được xác nhận sau khi nến tuần đóng. Nếu nến ngày cuối tuần đã vượt ngưỡng với khối lượng hợp lệ, phễu ghi trigger ngay ngày đó, không yêu cầu giá hạ xuống rồi vượt lại trong tuần sau.
- Khi setup tuần mới xuất hiện, phễu vẫn giữ trigger đã có của setup cũ còn hiệu lực trong cửa sổ 20 phiên. Version dữ liệu mới là `MTF_FUNNEL_SHADOW_V2`; Challenger adaptive là `MTF_ADAPTIVE_CHALLENGER_V3`. Bản cũ vẫn ở kho lịch sử để đối chiếu.

## Cài đặt, vận hành và giới hạn

- Tab **Phiên bản** liệt kê từ v1.0.0 theo từng khu vực thay đổi.
- Migration `20261008010000_momentum_radar_v201.sql` lưu Radar theo mã, ngày và phiên bản. EOD và Fast Lane tiếp tục cập nhật sau khi migration có hiệu lực. `replay-v201-research.yml` tính lại Radar và phễu từ giá EOD lưu sẵn; không công bố tín hiệu giao dịch hoặc sửa danh mục.
- Dữ liệu EOD và ngưỡng Radar cần được kiểm định trên mẫu có điều chỉnh sự kiện doanh nghiệp và ngoài mẫu trước khi cân nhắc nhập vào quyết định Champion. Trong v2.0.1 Radar vẫn là nghiên cứu.
