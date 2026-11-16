# Radar dòng tiền

Mở **Thị trường → Radar dòng tiền** để chọn nhóm, sàn và chu kỳ bằng nút. Bấm **Tuỳ chọn**, nhập hoặc chọn **Từ ngày** và **Đến ngày**, rồi bấm **Áp dụng**. Bốn chỉ số tổng hợp tính theo nhóm, sàn và chu kỳ. Ô tìm mã và chế độ xếp hạng áp dụng cho bảng tối đa 20 mã, 10 mã mỗi trang. Cột **SL lệnh** đếm số lần khớp quan sát được trong nhóm đang xem và để trống khi báo cáo không có chỉ số này. Bấm vào mã để xem độ phủ, nguồn và lịch sử giao dịch. Top giá và khối lượng nằm dưới **Nhóm ngành → Toàn cảnh**.

| Nhóm | Nguồn và phạm vi |
| --- | --- |
| Top giá và khối lượng | `daily_prices` của các mã đang hoạt động trong Prot Universe. Xếp hạng biến động dùng giá đóng cửa của phiên liền trước và giá cuối kỳ, với đủ phiên và cùng nguồn. |
| Khối ngoại | CafeF theo sàn và phiên. Giá trị, khối lượng, tỷ lệ sở hữu và room theo công bố của nguồn. Room âm được giữ nguyên. |
| Tự doanh | Báo cáo theo mã của HNX cho HNX và UPCoM. CafeF theo mã trong Prot Universe cho HOSE. Dữ liệu thu tự động của nhóm hiện là tổng mua bán. |
| Ba nhóm giá trị khớp | Vietcap cho Prot Universe trên cả ba sàn, đối soát với khối lượng khớp lệnh cuối ngày của CafeF. Radar có Từng lần khớp, Cụm khớp và Định kỳ. Giao dịch thỏa thuận nằm ngoài phạm vi. |

Bảng **Định kỳ** hiển thị giá khớp bình quân theo khối lượng, khối lượng, giá trị và số bản ghi Vietcap. Số liệu mở cửa và đóng cửa được lưu riêng từ băng khớp. Phiên cũ chỉ có tổng định kỳ vẫn hiển thị tổng, còn chi tiết từng đợt xuất hiện sau khi nạp lại được băng nguồn.

Trong chế độ Từng lần khớp, ngưỡng áp lên giá × khối lượng của mỗi bản ghi. Chế độ Cụm khớp gộp các bản ghi khớp liên tục liền nhau cùng giây, cùng giá và cùng chiều chủ động rồi mới áp ngưỡng. Chế độ Định kỳ tính riêng ATO/ATC, thuộc nhóm chưa rõ chiều. Mỗi nhóm lưu riêng số lần, khối lượng và giá trị mua, bán và chưa rõ chiều. Giá trị ròng dùng mua chủ động trừ bán chủ động.

Một mã đủ điều kiện xếp hạng và cộng vào thẻ tổng hợp khi mọi phiên áp dụng cho mã trong chu kỳ đã đối soát. Có thể tìm mã chưa đủ phiên để xem độ phủ. Mẫu cũ thiếu kết quả đối soát giữ trạng thái Thiếu băng khớp.

Thị giá là giá đóng cửa phiên cuối kỳ nếu có trong PROT STOCK. Cột Giá nắm giữ hiển thị giá mua bình quân tham chiếu, tính bằng giá trị mua chia cho khối lượng mua. Hiệu suất tham chiếu tính bằng thị giá chia cho giá mua bình quân rồi trừ 1. Phần sở hữu lấy số liệu gần nhất trong kỳ và ghi ngày của số liệu. Nguồn tự động hiện có tỷ lệ sở hữu và room ngoại. Số cổ phiếu sở hữu tuyệt đối và số dư tự doanh đòi hỏi báo cáo vị thế. API lưu báo cáo chấp nhận các trường này khi có dữ liệu.

## Cập nhật dữ liệu

Workflow **Market Flow Radar** chạy sau khi đẩy migration lên `main`, áp dụng migration rồi nạp năm phiên khối ngoại và tự doanh gần nhất. Lịch thường kỳ chạy 19:20 giờ Việt Nam vào ngày làm việc và làm mới hai phiên. Sáu nhóm thu băng khớp xử lý phiên đã chốt. Bộ thu phân trang về đầu phiên, loại bản ghi trùng theo ID, kiểm tra khối lượng tích lũy rồi so với khối lượng khớp cuối ngày. Khi hết ngân sách phân trang, con trỏ dừng hoặc hai nguồn lệch, mã giữ trạng thái chưa đủ cho phiên đó.

Workflow chạy thủ công cho tối đa 20 phiên báo cáo khối ngoại và tự doanh một lần. Đặt `tape_date` để thử phục hồi một phiên khớp cụ thể khi Vietcap còn trả băng của ngày đó. Lần chạy lại với dữ liệu thiếu giữ bản đã đối soát trước đó. Các bản ghi khớp nguyên gốc chỉ tồn tại trong bộ nhớ của tác vụ.

Job dùng `SUPABASE_DB_PASSWORD` để áp migration và `SUPABASE_SERVICE_ROLE_KEY` để ghi. Báo cáo đầy đủ thay thế nguyên tử phạm vi sàn, nhóm, phương thức và phiên. Mẫu theo mã dùng khóa duy nhất để chạy lại. Supabase lưu số tổng hợp và độ phủ. Dữ liệu từng lần khớp chỉ được xử lý trong bộ nhớ của job.
