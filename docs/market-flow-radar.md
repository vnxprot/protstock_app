# Radar dòng tiền

Mở **Thị trường → Radar dòng tiền** để chọn nhóm, sàn và chu kỳ bằng nút. Bấm **Tuỳ chọn**, nhập hoặc chọn **Từ ngày** và **Đến ngày**, rồi bấm **Áp dụng**. Bốn chỉ số tổng hợp tính theo nhóm, sàn và chu kỳ. Ô tìm mã và chế độ xếp hạng áp dụng cho bảng tối đa 20 mã, 10 mã mỗi trang. Cột **SL lệnh** đếm số lần khớp quan sát được trong nhóm đang xem và để trống khi báo cáo không có chỉ số này. Bấm vào mã để xem độ phủ và nguồn. Biểu tượng đồng hồ ở cột **Hành động** mở biểu đồ và số liệu theo phiên của mã trong nhóm đang xem. Khi Radar đang xem một phiên, lịch sử mặc định mở 20 phiên tính đến phiên đó. Top giá và khối lượng nằm dưới **Nhóm ngành → Toàn cảnh**.

| Nhóm | Nguồn và phạm vi |
| --- | --- |
| Top giá và khối lượng | `daily_prices` của các mã đang hoạt động trong Prot Universe. Xếp hạng biến động dùng giá đóng cửa của phiên liền trước và giá cuối kỳ, với đủ phiên và cùng nguồn. |
| Khối ngoại | CafeF theo sàn và phiên. Giá trị, khối lượng, tỷ lệ sở hữu và room theo công bố của nguồn. Room âm được giữ nguyên. |
| Tự doanh | Báo cáo theo mã của HNX cho HNX và UPCoM. CafeF theo mã trong Prot Universe cho HOSE. Dữ liệu thu tự động của nhóm hiện là tổng mua bán. |
| Ba nhóm giá trị khớp | Vietcap cho Prot Universe trên cả ba sàn. Khối lượng khớp lệnh cuối ngày dùng CafeF trước trên HOSE và SSI iBoard trước trên HNX, UPCoM, với nguồn còn lại làm dự phòng khi thiếu số liệu. Radar có Từng lần khớp, Cụm khớp và Định kỳ. Giao dịch thỏa thuận nằm ngoài phạm vi. |

Bảng **Định kỳ** hiển thị giá khớp bình quân theo khối lượng, khối lượng, giá trị và số bản ghi Vietcap. Số liệu mở cửa và đóng cửa được lưu riêng từ băng khớp. Phiên cũ chỉ có tổng định kỳ vẫn hiển thị tổng, còn chi tiết từng đợt xuất hiện sau khi nạp lại được băng nguồn.

Trong chế độ Từng lần khớp, ngưỡng áp lên giá × khối lượng của mỗi bản ghi. Chế độ Cụm khớp gộp các bản ghi khớp liên tục liền nhau cùng giây, cùng giá và cùng chiều chủ động rồi mới áp ngưỡng. Chế độ Định kỳ tính riêng ATO/ATC, thuộc nhóm chưa rõ chiều. Mỗi nhóm lưu riêng số lần, khối lượng và giá trị mua, bán và chưa rõ chiều. Giá trị ròng dùng mua chủ động trừ bán chủ động.

Một mã đủ điều kiện xếp hạng và cộng vào thẻ tổng hợp khi mọi phiên áp dụng cho mã trong chu kỳ đã đối soát. Có thể tìm mã chưa đủ phiên để xem độ phủ. Mẫu cũ thiếu kết quả đối soát giữ trạng thái Thiếu băng khớp.

Thị giá là giá đóng cửa phiên cuối kỳ nếu có trong PROT STOCK. Cột Giá nắm giữ hiển thị giá mua bình quân tham chiếu, tính bằng giá trị mua chia cho khối lượng mua. Hiệu suất tham chiếu tính bằng thị giá chia cho giá mua bình quân rồi trừ 1. Phần sở hữu lấy số liệu gần nhất trong kỳ và ghi ngày của số liệu. Nguồn tự động hiện có tỷ lệ sở hữu và room ngoại. Số cổ phiếu sở hữu tuyệt đối và số dư tự doanh đòi hỏi báo cáo vị thế. API lưu báo cáo chấp nhận các trường này khi có dữ liệu.

## Cập nhật dữ liệu

Workflow **Market Flow Radar** áp dụng migration khi đẩy lên `main` và làm mới năm phiên báo cáo gần nhất. Lịch ngày làm việc thu băng khớp lúc 16:35 giờ Việt Nam. Lượt 19:20 làm mới báo cáo hai phiên, thu bổ sung và đối soát lại băng khớp. Các mốc này là giờ lên lịch GitHub Actions. Sáu nhóm thu chạy song song theo giới hạn của workflow. Bộ thu phân trang về đầu phiên, loại bản ghi trùng theo ID và kiểm tra khối lượng tích lũy. Mỗi nhóm lưu tạm bản tổng hợp theo phiên trong cache của GitHub trước khi đối soát khối lượng cuối ngày. Khi hết ngân sách phân trang, con trỏ dừng hoặc hai nguồn lệch, mã giữ trạng thái chưa đủ cho phiên đó.

Lượt nạp bù báo cáo kiểm tra 50 phiên VNINDEX đã công bố, bỏ qua các phạm vi đã đủ và xử lý từng lô tối đa năm phiên. Tác vụ chỉ bắt đầu lô tiếp theo khi PostgreSQL còn dưới 450 MB và sẽ thử lại theo lịch. Bảng Radar hiển thị số phiên lỗi nguồn theo sàn. Sau lượt thu báo cáo thường kỳ, hệ thống dọn dữ liệu Radar ngoài cửa sổ 50 phiên báo cáo và 20 phiên băng khớp. Băng khớp lịch sử chỉ có thể phục hồi nếu Vietcap còn trả dữ liệu đúng ngày hoặc đã có bản tổng hợp tạm hợp lệ.

Workflow chạy thủ công cho phép làm mới tối đa 20 phiên báo cáo hoặc bật `reports_backfill` để nạp bù trong cửa sổ 50 phiên. Đặt `tape_date` cho một phiên khớp cụ thể. Lần chạy lại với dữ liệu thiếu giữ bản đã đối soát trước đó. Dữ liệu từng lần khớp chỉ được xử lý trong bộ nhớ của job. Supabase lưu số tổng hợp và độ phủ. Báo cáo đầy đủ thay thế nguyên tử phạm vi sàn, nhóm, phương thức và phiên. Mẫu theo mã dùng khóa duy nhất để chạy lại.
