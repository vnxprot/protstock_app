# Radar dòng tiền

Mở **Thị trường → Radar dòng tiền**. Chọn cả ba sàn hoặc HOSE, HNX, UPCoM. Ngày kết thúc dựa trên lịch phiên VN-Index đã công bố trong PROT STOCK. Bảng xếp hạng có tối đa 20 mã. Mẫu giới hạn, số phiên quan sát và ngày dữ liệu được ghi trên giao diện.

| Nhóm | Nguồn và phạm vi |
| --- | --- |
| Top giá và khối lượng | `daily_prices` của các mã đang hoạt động trong Prot Universe. Xếp hạng biến động dùng giá đóng cửa của phiên liền trước và giá cuối kỳ, với đủ phiên và cùng nguồn. |
| Khối ngoại | CafeF theo sàn và phiên. Giá trị, khối lượng, tỷ lệ sở hữu và room theo công bố của nguồn. Room âm được giữ nguyên. |
| Tự doanh | Báo cáo theo mã của HNX cho HNX và UPCoM. CafeF theo mã trong Prot Universe cho HOSE. Dữ liệu thu tự động của nhóm hiện là tổng mua bán. |
| Ba nhóm giá trị khớp | Vietcap cho Prot Universe trên cả ba sàn. Khoảng giá trị được tính trên từng lần khớp liên tục, theo đồng. Mỗi mã dùng tối đa hai trang từ cuối phiên. Mẫu có khoảng trống theo khối lượng tích lũy được gắn nhãn mẫu giới hạn. Chiều chưa xác định được lưu riêng. |

Giá mua bình quân dùng giá trị mua chia cho khối lượng mua. Tỷ lệ ròng trên thanh khoản chỉ tính khi có thanh khoản cùng phương thức giao dịch cho toàn bộ các phiên có giá trị mua/bán trong hàng. Bảng sở hữu lấy số liệu gần nhất trong kỳ và ghi ngày của số liệu. Nguồn tự động hiện có tỷ lệ sở hữu và room ngoại. Số cổ phiếu sở hữu tuyệt đối và số dư tự doanh đòi hỏi báo cáo vị thế. API lưu báo cáo chấp nhận các trường này khi có dữ liệu.

## Cập nhật dữ liệu

Workflow **Market Flow Radar** chạy sau khi đẩy migration lên `main`, áp dụng migration rồi nạp năm phiên khối ngoại và tự doanh gần nhất. Lịch thường kỳ chạy 19:20 giờ Việt Nam vào ngày làm việc và làm mới hai phiên. Workflow có thể chạy thủ công cho tối đa 20 phiên một lần và tùy chọn ngày kết thúc. Dữ liệu từng lần khớp chỉ có phiên gần nhất từ nguồn này và được tích lũy từ lúc bật bộ thu thập.

Job dùng `SUPABASE_DB_PASSWORD` để áp migration và `SUPABASE_SERVICE_ROLE_KEY` để ghi. Báo cáo đầy đủ thay thế nguyên tử phạm vi sàn, nhóm, phương thức và phiên. Mẫu theo mã dùng khóa duy nhất để chạy lại. Supabase lưu số tổng hợp và độ phủ. Dữ liệu từng lần khớp chỉ được xử lý trong bộ nhớ của job.
