# Radar dòng tiền

Mở **Thị trường → Radar dòng tiền** để chọn nhóm, sàn và chu kỳ bằng nút. Bấm **Tuỳ chọn**, nhập hoặc chọn **Từ ngày** và **Đến ngày**, rồi bấm **Áp dụng**. Bốn chỉ số tổng hợp tính theo nhóm, sàn và chu kỳ. Ô tìm mã và chế độ xếp hạng áp dụng cho bảng tối đa 20 mã, 10 mã mỗi trang. Cột **SL lệnh** đếm số lần khớp quan sát được trong nhóm đang xem và để trống khi báo cáo không có chỉ số này. Bấm vào mã để xem độ phủ và nguồn. Biểu tượng đồng hồ ở cột **Hành động** mở biểu đồ và số liệu theo phiên của mã trong nhóm đang xem. Khi Radar đang xem một phiên, lịch sử mặc định mở 20 phiên tính đến phiên đó. Top giá và khối lượng nằm dưới **Nhóm ngành → Toàn cảnh**.

| Nhóm | Nguồn và phạm vi |
| --- | --- |
| Top giá và khối lượng | `daily_prices` của các mã đang hoạt động trong Prot Universe. Xếp hạng biến động dùng giá đóng cửa của phiên liền trước và giá cuối kỳ, với đủ phiên và cùng nguồn. |
| Khối ngoại | CafeF theo sàn và phiên. Giá trị, khối lượng, tỷ lệ sở hữu và room theo công bố của nguồn. Room âm được giữ nguyên. |
| Tự doanh | Báo cáo theo mã của HNX cho HNX và UPCoM. CafeF theo mã trong Prot Universe cho HOSE. Dữ liệu thu tự động của nhóm hiện là tổng mua bán. |
| Ba nhóm giá trị khớp | Vietcap cho Prot Universe trên cả ba sàn. Khối lượng khớp lệnh cuối ngày dùng CafeF trước trên HOSE và SSI iBoard trước trên HNX, UPCoM, với nguồn còn lại làm dự phòng khi thiếu số liệu. Radar có Từng lần khớp, Cụm khớp và Định kỳ. Giao dịch thỏa thuận nằm ngoài phạm vi. |

Bảng **Định kỳ** hiển thị giá khớp bình quân theo khối lượng, khối lượng, giá trị và số bản ghi từ băng khớp. Số liệu mở cửa và đóng cửa được lưu riêng từ băng khớp. Phiên cũ chỉ có tổng định kỳ vẫn hiển thị tổng, còn chi tiết từng đợt xuất hiện sau khi nạp lại được băng nguồn.

Trong chế độ Từng lần khớp, ngưỡng áp lên giá × khối lượng của mỗi bản ghi. Chế độ Cụm khớp gộp các bản ghi khớp liên tục liền nhau cùng giây, cùng giá và cùng chiều chủ động rồi mới áp ngưỡng. Chế độ Định kỳ tính riêng ATO/ATC, thuộc nhóm chưa rõ chiều. Mỗi nhóm lưu riêng số lần, khối lượng và giá trị mua, bán và chưa rõ chiều. Giá trị ròng dùng mua chủ động trừ bán chủ động.

Một mã đủ điều kiện xếp hạng và cộng vào thẻ tổng hợp khi mọi phiên áp dụng cho mã trong chu kỳ đã đối soát. Có thể tìm mã chưa đủ phiên để xem độ phủ. Mẫu cũ thiếu kết quả đối soát giữ trạng thái Thiếu băng khớp.

Thị giá là giá đóng cửa phiên cuối kỳ nếu có trong PROT STOCK. Cột Giá nắm giữ hiển thị giá mua bình quân tham chiếu, tính bằng giá trị mua chia cho khối lượng mua. Hiệu suất tham chiếu tính bằng thị giá chia cho giá mua bình quân rồi trừ 1. Phần sở hữu lấy số liệu gần nhất trong kỳ và ghi ngày của số liệu. Nguồn tự động hiện có tỷ lệ sở hữu và room ngoại. Số cổ phiếu sở hữu tuyệt đối và số dư tự doanh đòi hỏi báo cáo vị thế. API lưu báo cáo chấp nhận các trường này khi có dữ liệu.

## Cập nhật dữ liệu

Trong sheet lịch sử, **Theo phiên** mở đúng nhóm và phương thức đang chọn. Chọn điểm ngày trên biểu đồ, ngày trong bảng, hoặc tab **Trong phiên** để xem lại dòng tiền theo phút. Biểu đồ trong phiên dùng ba nhóm của phương thức Từng lần khớp liên tục, có chế độ Giá trị, Khối lượng và Mua & Bán.

Lượt thu VCI cuối ngày dùng chung một băng khớp để tổng hợp số cuối phiên và chuỗi phút. Bản xem lại được công bố sau đối soát, lưu nén theo mã và ngày trong bucket riêng tư `market-radar-minute-replay`. Lưu 5 phiên gần nhất, giới hạn 32 KiB mỗi mã mỗi phiên và dừng ghi khi dung lượng dự kiến chạm ngân sách Storage 450 MB của dự án. Các phiên đã có tổng hợp cũ chỉ có thể dựng lại theo phút khi thu lại được băng khớp nguồn.

Có thể chạy `python -m protstock.market_radar_minutes` trong giờ khớp liên tục để thử VCI với HDB, OCB, SHS và BVB. Chương trình đọc trang mới nhất mỗi phút trong 5 lượt, in tuổi của bản ghi cuối, tính liên tục của khối lượng tích lũy trong trang và độ chồng lấp giữa các lượt. Lượt thử chạy đọc dữ liệu nguồn và in kết quả tại chỗ. Biểu đồ production hiện được cập nhật theo lịch cuối ngày.

Workflow **Market Flow Radar** áp dụng migration khi đẩy lên `main` và làm mới năm phiên báo cáo gần nhất. Lịch ngày làm việc thu băng khớp lúc 16:35 giờ Việt Nam. Lượt 19:20 làm mới báo cáo hai phiên, thu bổ sung và đối soát lại băng khớp. Các mốc này là giờ lên lịch GitHub Actions. Sáu nhóm thu chạy song song theo giới hạn của workflow. Bộ thu phân trang về đầu phiên, loại bản ghi trùng theo ID và kiểm tra khối lượng tích lũy. Mỗi nhóm lưu tạm bản tổng hợp theo phiên trong cache của GitHub trước khi đối soát khối lượng cuối ngày. Khi hết ngân sách phân trang, con trỏ dừng hoặc hai nguồn lệch, mã giữ trạng thái chưa đủ cho phiên đó.

Lượt nạp bù báo cáo kiểm tra 50 phiên VNINDEX đã công bố, bỏ qua các phạm vi đã đủ và xử lý từng lô tối đa năm phiên. Tác vụ chỉ bắt đầu lô tiếp theo khi PostgreSQL dưới 440 MB, chừa 10 MB dưới trần 450 MB, và sẽ thử lại theo lịch. Bảng Radar hiển thị số phiên lỗi nguồn theo sàn. Sau lượt thu báo cáo thường kỳ, hệ thống dọn dữ liệu Radar ngoài cửa sổ 50 phiên báo cáo và 20 phiên băng khớp.

Workflow chạy thủ công cho phép làm mới tối đa 20 phiên báo cáo hoặc bật `reports_backfill` để nạp bù trong cửa sổ 50 phiên. Đặt `tape_date` cho một phiên khớp cụ thể. Lần chạy lại với dữ liệu thiếu giữ bản đã đối soát trước đó. Dữ liệu từng lần khớp chỉ được xử lý trong bộ nhớ của job. Supabase lưu số tổng hợp và độ phủ. Báo cáo đầy đủ thay thế nguyên tử phạm vi sàn, nhóm, phương thức và phiên. Mẫu theo mã dùng khóa duy nhất để chạy lại.

Bật `tape_history` để kiểm tra mẫu OCB, SHS và BVB và nạp các phiên băng khớp còn thiếu trong 20 phiên gần nhất bằng DNSE LightSpeed. Cần các GitHub Secrets `DNSE_API_KEY`, `DNSE_API_SECRET` và biến `RADAR_DNSE_APPROVED=true` sau khi xác nhận nguồn không phát sinh phí và cho phép phạm vi sử dụng trong PROT STOCK. Bộ thu đọc bảng G1 và G4, duyệt tất cả trang, kiểm tra chuỗi khối lượng tích lũy và đối soát khối lượng cuối ngày bằng nguồn độc lập. Cụm khớp không gộp chéo hai bảng G1/G4. Bộ nạp bỏ qua phiên đã đủ ba phương thức, phiên không đối soát được và lô vượt ngân sách.

Có thể nạp bản xuất được phép sử dụng bằng `python -m protstock.market_radar_history --csv-directory <directory>`. Mỗi tập tin `YYYY-MM-DD.csv` hoặc `YYYY-MM-DD.csv.gz` chứa `exchange,symbol,board,timestamp,price_vnd,quantity,cumulative_volume,side`. Dùng `G1` hoặc `G4`, thời gian ISO 8601 kèm múi giờ, khối lượng cổ phiếu và chiều `BUY`, `SELL`, `UNSPECIFIED`, `ATO` hoặc `ATC`. Bản nhập dùng cùng bộ đối soát với API. Tệp nguồn ở bên ngoài repo.

## Kiểm tra SSI FastConnect

Cài phần phụ thuộc `pip install -e '.[ssi]'`. Dùng biến môi trường cục bộ `SSI_API_KEY`, `SSI_API_SECRET` và `SSI_CLIENT_ID` nếu SSI cấp Client ID. Dùng khóa Production chỉ đọc Market Data.

Chạy `python -m protstock.market_radar_ssi --reference-date 2026-11-16 --stream-seconds 60` trong phiên để kiểm tra HDB, SHS và BVB. Chương trình đọc tổng khớp và giao dịch khối ngoại của ngày tham chiếu qua REST, sau đó phân nhóm mẫu WebSocket và in khối lượng tích lũy để đánh giá độ phủ. Bỏ `--stream-seconds` để chỉ đọc REST. Bộ kiểm tra không cập nhật dữ liệu production. Phiên mẫu bắt đầu giữa giờ giao dịch có thể thiếu các giao dịch trước thời điểm kết nối.

Chạy `python -m protstock.market_radar_ssi_live --directory <local-directory>` từ 08:45 trên Windows để thu thử ba mã vào SQLite cục bộ. Sau khi xác minh phạm vi sử dụng, pilot và dung lượng, thêm `--publish` cùng `RADAR_SSI_APPROVED=true`; tùy chọn `--universe` dùng toàn bộ Prot Universe. Biến Supabase của tác vụ ghi chỉ dùng ở bộ thu, không ở frontend. `--watch` chọn tối đa 24 mã có biểu đồ phút, mặc định HDB, SHS, BVB.

Bộ thu chỉ cập nhật một file nén mỗi sàn trong Storage mỗi phút. Lúc 15:15, nó gửi bản chốt tổng hợp để job cuối ngày có thể đối soát với khối lượng khớp. Job cuối ngày mặc định dùng Vietcap. Sau khi hoàn tất kiểm tra SSI, có thể đặt biến GitHub `RADAR_SSI_EOD=true` để ưu tiên bản SSI đã đối soát. Bản SSI đã xác minh được giữ khi Vietcap chạy lại. Khớp lẻ cần được kiểm chứng với phạm vi tổng SSI; mã sai khối lượng hoặc thiếu chuỗi không được công bố từ SSI. Dữ liệu sống dưới 400 MB PostgreSQL và trần Storage 450 MB. Dữ liệu tick nằm trong các file SQLite từng phiên trên máy thu, hết hạn sau 7 ngày. Không chọn thư mục đồng bộ công khai.
