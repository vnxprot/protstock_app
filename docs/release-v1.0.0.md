# Prot Stock v1.0.0

SSI FastConnect là nguồn ưu tiên cho dữ liệu thị trường có đủ phạm vi. Phiên bản ứng dụng xuất hiện trong Cài đặt, Hướng dẫn, lịch sử phiên bản, tên trang và PWA. Mã phiên bản thuật toán và quy tắc dùng để đọc lịch sử tiếp tục theo phiên đã công bố.

## GitHub Actions và dữ liệu cuối ngày

- Đặt `SSI_API_KEY` và `SSI_API_SECRET` trong GitHub Actions Secrets. Dùng khóa Production chỉ đọc Market Data. Cấp quyền lấy nến, danh sách mã, tổng hợp giao dịch và tệp Parquet. Fast Lane và Radar dùng nguồn dự phòng khi khóa chưa sẵn sàng.
- Workflow **Sync SSI universe history** công bố tối đa 30 mã mỗi lượt. Fast Lane mặc định xét thêm tối đa 12 mã mỗi phiên. Đặt `SSI_PRICE_BATCH` từ 1 đến 30 để điều chỉnh hai tác vụ. Giá trị 0 tạm dừng chuyển mã mới. Những mã đã chuyển tiếp tục dùng SSI theo cả chuỗi.
- **Sync SSI universe history** thu OHLCV ngày từ 01/01/2021 cho Prot Universe và VNINDEX, đồng thời thu báo cáo mua/bán khối ngoại từ 11/09/2026 theo mã. Mỗi mã dùng một bản nén riêng tư trong `database-archives/ssi-history/v1/`. Workflow có thể thu và cập nhật bản nén khi PostgreSQL đang trên ngưỡng vận hành. Fast Lane đọc bản nén và nối dữ liệu mới từ SSI khi phần trùng khớp.
- Việc ghi bổ sung báo cáo khối ngoại lịch sử áp dụng trong cửa sổ 50 phiên. **Rebuild consolidated signals** theo khoảng ngày mặc định tạm hoãn. Chỉ bật lại bằng `PROTSTOCK_ALLOW_RANGE_REBUILD=true`. Tính mới Challenger và Đối chiếu Song mã tạm dừng. Đặt `PROTSTOCK_CHALLENGER_ENABLED=true` khi cần bật lại.
- Giá cổ phiếu được nạp từ 01/01/2021 hoặc phiên đầu của mã. Chuỗi SSI phải phủ các phiên đang lưu và nhất quán về đơn vị giá, pha điều chỉnh và nến mới nhất. Hệ thống kiểm tra nhanh trên các ngày trùng nhau ngay lúc nhập. Đợt chuyển lưu bản giá cũ trong bucket riêng tư `database-archives` dưới tiền tố `ssi-cutover/`, đọc lại và xác minh SHA-256 trước khi ghi.
- VNINDEX chuyển cửa sổ tính toán từ 2021 khi có chuỗi SSI đủ. Lịch sử chỉ số trước cửa sổ vẫn phục vụ biểu đồ. Fast Lane ghi trạng thái và tín hiệu ở phiên chuyển. Lịch sử công bố, đối chiếu và giả lập theo từng phiên cũ có phiên bản riêng.
- Radar ưu tiên SSI cho giao dịch khối ngoại và ứng viên băng khớp đủ phiên. Vietcap là nguồn phụ theo mã và phiên. Tự doanh dùng luồng báo cáo hiện hành. Các trường sở hữu ngoài phạm vi SSI được giữ từ báo cáo. CANSLIM lấy giá từ chuỗi chuẩn SSI của mã đã chuyển và tiếp tục dùng BCTC VCI.

## Máy thu SSI trong phiên

Workflow **SSI Radar live** chạy trên GitHub Actions vào ngày thường và không cần bật máy cá nhân. Hai job chia phiên tại giờ nghỉ trưa, truyền bản ghi SQLite mã hóa với thời hạn một ngày và công bố bản cập nhật 15 phút một lần. Khi khởi chạy giữa phiên, bản live có thể thiếu giao dịch trước lúc kết nối. Radar chỉ dùng băng SSI cuối ngày cho mã có dữ liệu đủ để đối chiếu.

Máy Windows hoặc máy thu đang dùng chạy `python -m protstock.market_radar_ssi_live --directory <thu-muc-rieng> --universe --publish` từ 08:45 đến 15:15 trong ngày giao dịch. Máy thu cần key SSI, cấu hình Supabase phía máy chủ và `RADAR_SSI_APPROVED=true`. Bộ thu giữ SQLite tại chỗ, công bố mỗi 15 phút và chuyển bản chốt sang GitHub Actions. Máy thu có thể tắt ngoài khung giờ này. Khi máy thu vắng, phiên cuối ngày vẫn thử băng Vietcap.

## Dung lượng và khôi phục

Trong đợt ưu tiên chuyển OHLCV, đặt biến Actions `PROTSTOCK_PRICE_CUTOVER=true`. Fast Lane nạp giá ngày và VNINDEX. Rebuild, backtest, đánh giá kết quả, Radar lịch sử và các tác vụ tính bổ sung sẽ chờ đến khi đặt lại biến thành `false`. Workflow đồng bộ SSI tải OHLCV trong Storage rồi công bố từng lô theo dung lượng còn lại. Khi cần, có thể thu hồi dung lượng bằng chế độ `reclaim-history`. Nến VNINDEX 23/08/2021 được giữ từ Vietcap với dấu vết nguồn riêng nếu phản hồi SSI sai và bản Vietcap vượt qua kiểm tra.

Các tác vụ ghi dữ liệu SSI tạm dừng ở ngưỡng vận hành 480 MB PostgreSQL, chừa 20 MB dưới hạn mức miễn phí. Giữ bản xem lại 5 phiên trong Storage, báo cáo Radar theo cửa sổ 50 phiên và các nhóm băng khớp theo cửa sổ 20 phiên. Kho lưu riêng tư dùng ngân sách 450 MB toàn dự án. Lưu tick gốc trên máy thu trong 7 ngày.

Khi cần dừng đợt chuyển, đặt `SSI_PRICE_BATCH=0`. Khôi phục một mã bằng bản nén đã xác minh trong `ssi-cutover/daily_prices/<symbol_id>/` rồi chạy Fast Lane cho phiên đang phục vụ. Phần VNINDEX dùng thư mục `ssi-cutover/market_index_prices/`. Cờ `RADAR_SSI_EOD=false` dừng tiếp nhận ứng viên SSI mới.
