# Radar dòng tiền

Mở **Thị trường → Radar dòng tiền** để chọn nhóm, sàn và chu kỳ bằng nút. Bấm **Tuỳ chọn**, nhập hoặc chọn **Từ ngày** và **Đến ngày**, rồi bấm **Áp dụng**. Bốn chỉ số tổng hợp tính theo nhóm, sàn và chu kỳ. Ô tìm mã và chế độ xếp hạng áp dụng cho bảng tối đa 20 mã, 10 mã mỗi trang. Cột **SL lệnh** đếm số lần khớp quan sát được trong nhóm đang xem và để trống khi báo cáo không có chỉ số này. Bấm vào mã để xem độ phủ, nguồn và lịch sử giao dịch. Top giá và khối lượng nằm dưới **Nhóm ngành → Toàn cảnh**.

| Nhóm | Nguồn và phạm vi |
| --- | --- |
| Top giá và khối lượng | `daily_prices` của các mã đang hoạt động trong Prot Universe. Xếp hạng biến động dùng giá đóng cửa của phiên liền trước và giá cuối kỳ, với đủ phiên và cùng nguồn. |
| Khối ngoại | CafeF theo sàn và phiên. Giá trị, khối lượng, tỷ lệ sở hữu và room theo công bố của nguồn. Room âm được giữ nguyên. |
| Tự doanh | Báo cáo theo mã của HNX cho HNX và UPCoM. CafeF theo mã trong Prot Universe cho HOSE. Dữ liệu thu tự động của nhóm hiện là tổng mua bán. |
| Ba nhóm giá trị khớp | Vietcap cho Prot Universe trên cả ba sàn. Khoảng giá trị được tính trên từng lần khớp liên tục, theo đồng. Mỗi mã dùng tối đa hai trang từ cuối phiên. Mẫu có khoảng trống theo khối lượng tích lũy được gắn nhãn mẫu giới hạn. Chiều chưa xác định được lưu riêng. |

Thị giá là giá đóng cửa phiên cuối kỳ nếu có trong PROT STOCK. Cột Giá nắm giữ hiển thị giá mua bình quân tham chiếu, tính bằng giá trị mua chia cho khối lượng mua. Hiệu suất tham chiếu tính bằng thị giá chia cho giá mua bình quân rồi trừ 1. Phần sở hữu lấy số liệu gần nhất trong kỳ và ghi ngày của số liệu. Nguồn tự động hiện có tỷ lệ sở hữu và room ngoại. Số cổ phiếu sở hữu tuyệt đối và số dư tự doanh đòi hỏi báo cáo vị thế. API lưu báo cáo chấp nhận các trường này khi có dữ liệu.

## Cập nhật dữ liệu

Workflow **Market Flow Radar** chạy sau khi đẩy migration lên `main`, áp dụng migration rồi nạp năm phiên khối ngoại và tự doanh gần nhất. Lịch thường kỳ chạy 19:20 giờ Việt Nam vào ngày làm việc và làm mới hai phiên. Workflow có thể chạy thủ công cho tối đa 20 phiên một lần và tùy chọn ngày kết thúc. Dữ liệu từng lần khớp chỉ có phiên gần nhất từ nguồn này và được tích lũy từ lúc bật bộ thu thập.

Job dùng `SUPABASE_DB_PASSWORD` để áp migration và `SUPABASE_SERVICE_ROLE_KEY` để ghi. Báo cáo đầy đủ thay thế nguyên tử phạm vi sàn, nhóm, phương thức và phiên. Mẫu theo mã dùng khóa duy nhất để chạy lại. Supabase lưu số tổng hợp và độ phủ. Dữ liệu từng lần khớp chỉ được xử lý trong bộ nhớ của job.
