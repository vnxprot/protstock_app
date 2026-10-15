# Hướng dẫn tín hiệu Prot Stock: Champion, Challenger và Đối chiếu song mã

Tài liệu này mô tả **giao diện và logic đang chạy**. Xem cùng mục **Cài đặt → Hướng dẫn** trong ứng dụng. Tín hiệu chính xử lý dữ liệu cuối ngày (EOD); Radar giao dịch đột biến nghiên cứu nến phút sau phiên. Một tín hiệu chỉ phản ánh nến và dữ liệu đã có ở phiên ghi trên màn hình. Không đọc tín hiệu của phiên cũ như giá hay lệnh trực tiếp của hiện tại.

## 1. Đường đi từ dữ liệu đến quyết định

1. Dữ liệu OHLCV theo mã được thu thập và kiểm tra độ phủ, đơn vị giá, khoảng trống lịch sử và các đứt gãy bất thường. D/W/M lần lượt là nến ngày, tuần, tháng; các đánh giá đa khung chỉ dùng tuần và tháng đã đóng.
2. Champion tính các tín hiệu theo bộ máy/quy tắc đang bật, sau đó công bố **tín hiệu tổng hợp** theo mã, khung và phiên. Bảng gốc thể hiện hành động, điểm đồng thuận, các bộ máy đồng thuận, mã lý do và phiên bản nguồn.
3. Challenger v2 tính **assessment shadow** riêng cho cùng phiên. Mỗi mã có một quyết định tổng hợp và tối đa năm assessment chiến lược: `UPTREND_CORE`, `SIDEWAY_RANGE`, `ADAPTIVE_FUNNEL`, `MACD_EARLY_ZONE`, `DOWNTREND_SPRING`. Quyết định tổng hợp chọn nhánh có hành động mua nghiên cứu đầu tiên theo thứ tự chiến lược; nếu không có thì là `WATCH`. Challenger không tạo giao dịch danh mục.
4. Đối chiếu song mã ghép Champion và Challenger theo **mã + phiên**. Kết quả T+2 chỉ xuất hiện khi tín hiệu đủ tuổi và dùng giả định vào ở Open phiên sau, phí/thuế/trượt giá theo bộ đo lường của hệ thống.

Một mã có thể có nhiều dòng Champion ở các khung khác nhau, nhưng chỉ có một assessment Challenger tổng hợp trên cùng phiên. Dấu `—` là thiếu/không áp dụng/không tính được, không phải số 0.

## 2. Cách dùng ba chế độ và sáu tab

| Chế độ | Ý nghĩa | Nên xem gì trước |
| --- | --- | --- |
| Champion (v1.0) | Tín hiệu tổng hợp được công bố; các tab phễu và phân kỳ là bảng nghiên cứu riêng | Ngày công bố, hành động, khung, lý do, vùng vô hiệu |
| Challenger (v2.0) | Đánh giá thử nghiệm song song; các nhánh có kết quả riêng | Regime, hành động, lý do chặn, quy mô, khoảng cách stop |
| Đối chiếu song mã | Hai bộ máy cạnh nhau cho cùng mã và phiên | Hành động hai bên, Delta Insight, nhánh riêng, nền, ngành, T+ |

### Tín hiệu gốc

**Champion:** bảng/tấm thẻ có mã, ngành, hành động, D/W/M, điểm và nhãn đồng thuận, bộ máy, lý do kỹ thuật, diễn giải “Vì sao?”, ngày và phiên bản. Có thể tìm mã, chọn hành động, lọc khung/bộ máy/ngày, xem lịch sử, đổi bảng/thẻ, chọn 25/50/100 dòng và tải kết quả. Điểm đồng thuận là điểm hội tụ điều kiện; **không phải xác suất có lãi**. `STRONG_ALIGNED` nghĩa là ít nhất ba bộ máy đồng thuận, `HIGH_CONFLUENCE` là hai, `STANDARD` là ít hơn hai theo cách màn hình phân nhóm.

**Challenger:** bảng điểm trên cùng là thống kê nghiên cứu; dưới là quyết định tổng hợp từng mã và hành động từng nhánh. `WATCH` ở nhánh không đồng nghĩa toàn bộ mã xấu: có thể chỉ là chưa có setup, chế độ thị trường không cho phép, thanh khoản thấp, hoặc stop quá xa. Dùng bộ lọc mã, Champion, Challenger, Delta Insight, chiến lược, ngành và xa nền; phân trang 25/50/100.

### WATCH cơ hội

**Champion:** gộp các tín hiệu cùng mã và xếp theo thay đổi mới → rủi ro của mã đang giữ → cơ hội hình thành. Mở hàng để đọc tín hiệu D/W/M và “Vì sao?”. Lọc nhóm ưu tiên và vị thế. `WATCH` chỉ là theo dõi, trong đó lý do có thể biểu thị cơ hội hoặc rủi ro. `EXTENDED (+X%)` cảnh báo giá đi xa hơn 7% so với mốc nền, trigger hoặc stop tham chiếu; X không phải lợi nhuận vị thế. Điểm ngành 0–100 đo sức khỏe ngành trong universe; `GTGD` là tỷ trọng giá trị giao dịch ước tính, không phải tiền mua ròng. `T0`, `T1`, `T2`, `T_READY` là tuổi lô hàng theo phiên và khả năng bán.

**Challenger:** chỉ hiện assessment tổng hợp `WATCH`; lý do và các nhánh giải thích vì sao chưa phát thăm dò. Có cùng bộ lọc và phân trang như bảng Challenger gốc. Chọn một Delta Insight như `CHASE_BLOCKED` để tìm các trường hợp bị chặn theo stop.

### Radar cơ hội

Mỗi hàng tóm tắt diễn biến của một mã trong phiên và đối chiếu tín hiệu Champion/WATCH, phễu và phân kỳ MACD. Mở hàng để xem số liệu và đi đến đúng mã ở bảng liên quan. Khoảng cách stop đạt sơ bộ không phải lệnh mua.

### Giao dịch đột biến

Radar dùng dữ liệu nến phút sau phiên để tìm cụm khối lượng bất thường trong 1–15 phút so với cùng thời điểm ở các phiên đủ dữ liệu trước đó. Xem độ phủ phút, hướng giá và nguồn trong chi tiết sự kiện. Đây là nghiên cứu EOD, không phải báo giá trực tiếp; khối lượng không xác định bên đặt lệnh hay dòng tiền mua ròng. Phiên thiếu dữ liệu phút không được chấm sự kiện.

### Phễu tháng → tuần → ngày

Hai tab phễu là **bảng nghiên cứu song song**: tab Champion hiển thị bộ phễu gốc, không phải tín hiệu Champion đã công bố; tab Challenger hiển thị nhánh `ADAPTIVE_FUNNEL`. Cả hai chỉ dùng tuần và tháng đã đóng. Trình tự là **bối cảnh tháng → setup tuần còn hiệu lực → lần vượt ngưỡng mới trên nến ngày → cổng an toàn Challenger (nếu có) → hành động**. Nhãn giai đoạn mô tả tiến độ cấu trúc, không phải lệnh mua hay trạng thái vị thế.

**Quy tắc tháng dùng chung — MONTHLY_TREND_20261015.** Champion, Radar, Phễu, Challenger và backtest đọc cùng tháng đã đóng, cùng chuỗi giá từ 2021 và dựng trạng thái tuần tự. Cần 23 tháng; thiếu là UNKNOWN, không còn nhánh SMA6. SIDEWAYS là trung tính chưa có hướng bền, không tự chứng minh có nền để mua.

- Vào UP: Close > EMA10 > SMA20, ít nhất 8/12 Close trên EMA10 tương ứng, độ dốc đạt ngưỡng vào. DOWN đối xứng với ít nhất 8/12 Close dưới EMA10. Close bằng EMA không tính cho bên nào.
- Độ dốc: hồi quy log của sáu EMA10 gần nhất, quy đổi exp(3 × hệ số dốc) − 1. σ là độ lệch chuẩn mẫu của 12 lợi suất log tháng. Ngưỡng vào = max(2%; 0,25 × σ × √3).
- Giữ hướng: ít nhất 6/12 tháng đúng phía EMA; EMA10 ≥ SMA20 cho UP (≤ cho DOWN); độ dốc đạt ngưỡng giữ = max(0,5%; 0,10 × σ × √3).
- Thoát khi mất bất kỳ điều kiện giữ, hai tháng liên tiếp đóng sai phía EMA, hoặc Close cách EMA bất lợi quá max(3%; 0,5 × σ). Hướng ngược đủ điều kiện được ưu tiên; còn lại về SIDEWAYS. Chỉ đổi nhãn theo tháng đóng; tuần/ngày xử lý rủi ro giữa tháng.
- Cấu hình nguồn duy nhất: `pipeline/protstock/trend_policy.json`. Chi tiết mã hiển thị kỳ đóng, cửa sổ 12/6 tháng, số tháng trên/dưới EMA, độ dốc, ngưỡng và từng phép kiểm.

**Setup tuần.** Bộ gốc cần tháng UP. Bộ thích ứng nhận UP/SIDEWAYS. Cần 21 tuần cho breakout; độ dốc EMA20 bốn tuần cần 24 tuần.

| Setup | Điều kiện | Ngưỡng ngày | Vô hiệu |
| --- | --- | --- | --- |
| WEEKLY_BREAKOUT_13 | Close > High cao nhất 13 tuần trước, volume ≥1,3× bình quân 13 tuần. Tháng SIDEWAYS còn cần Close > EMA20, EMA20 tăng ≥1%/4 tuần | High cao nhất 13 tuần trước | Low thấp nhất tuần setup và ba tuần trước |
| WEEKLY_PULLBACK_EMA20 | Tháng UP; Low ≤ EMA20 < Close; Close > Open; EMA20 tăng ≥1%/4 tuần | High tuần setup | Low thấp nhất bốn tuần |
| WEEKLY_RANGE_SUPPORT | Chỉ thích ứng; nền 13 tuần trước setup hợp lệ; Low ≤1,02× hỗ trợ tám tuần, Close > hỗ trợ và Open | High ngày trước | Low tuần setup |

Nền tuần hợp lệ: High cao nhất/Low thấp nhất − 1 ≤25%; EMA20 thay đổi bốn tuần trong ±1%; hiệu quả chuyển động Close ≤0,30. Hiệu quả = trị tuyệt đối thay đổi Close đầu-cuối chia tổng trị tuyệt đối các bước Close liên tiếp; giá phẳng có hiệu quả 0. Không dùng nến setup để tự tạo nền tham chiếu của nó.

Setup hết hiệu lực sau 20 phiên giao dịch **sau** ngày setup; một Close sau setup thấp hơn mức vô hiệu sẽ loại setup, bằng mức đó chưa loại. Breakout có thể trigger ngay ngày đóng tuần, hai setup còn lại từ phiên tiếp theo. Cần đủ 20 phiên trước có volume so sánh được; Close trước ≤ ngưỡng, Close hiện tại > ngưỡng. Breakout/pullback cần volume ≥1,3× bình quân 20 phiên trước, hồi hỗ trợ không cần tỷ lệ này. Phễu lưu lần vượt đầu tiên và giữ setup đã kích hoạt còn hiệu lực dù có setup mới chưa kích hoạt.

DAILY_TRIGGER là trigger đúng phiên đang xem, TRIGGERED_EARLIER là trigger cũ; WEEKLY_READY là chờ trigger, MONTHLY_CONTEXT là cổng tháng chặn hoặc chưa có setup hợp lệ. DATA_QUARANTINED là Close không dương hoặc tỷ lệ Close hai ngày ≤0,1 hay ≥10.

Ở ADAPTIVE_FUNNEL chỉ DAILY_TRIGGER mới tạo ứng viên mua. SIDEWAY_RANGE còn cần tháng UP/SIDEWAYS và nền tuần hợp lệ, bên cạnh regime thị trường SIDEWAYS. Bối cảnh tháng của cổ phiếu khác regime thị trường chung. Cổng thanh khoản, xung đột Champion, tham gia lệnh ≤5% thanh khoản và khoảng cách stop ≤8% tiếp tục áp dụng.

**Đợt áp dụng 15/10/2026.** Đọc lại giá đã lưu, cố định manifest 277 mã. Tính lại phiên 15/10 cùng các đầu ra phụ thuộc. Chỉ hồi tính nghiên cứu từ 11/09–15/10; giữ tín hiệu Champion cũ đã công bố. Tính tháng từ lịch sử trước đó để có trạng thái hysteresis đúng. Không tải lại giá, không backtest lợi nhuận, không gửi Telegram. Tác vụ GitHub tự áp migration Supabase, chạy phiên hiện tại rồi chia bốn lô lịch sử; báo cáo được lưu thành artifact để chủ app kiểm tra sau.

### Phân kỳ Dương · đường MACD

Champion theo dõi **vùng đáy**: 1/2/3 đoạn tương ứng 2/3/4 vùng. Hai đáy giá của mỗi đoạn cách nhau 5–60 phiên giao dịch; các pivot chỉ gộp thành một vùng khi cách nhau tối đa 5 phiên và chênh Low trong vùng không quá 1%. Giá tạo đáy thấp dần trong khi đáy đường MACD cao dần; ngày đáy giá và MACD có thể lệch. `WATCH_PRICE_CONFIRMATION` chờ giá vượt ngưỡng; `CONFIRMED` là đã vượt; `INVALIDATED` là cấu trúc hỏng; `EXPIRED` hết thời gian theo dõi. Xem ngưỡng vượt, đáy bảo vệ, độ xa ngưỡng, volume breakout và diễn biến theo phiên. Histogram không tham gia quy tắc phân kỳ vùng của Champion. Phần Hướng dẫn ở Cài đặt ghi đầy đủ các ngưỡng và cách xác nhận.

Challenger `MACD_EARLY_ZONE` dùng đáy 1 đã xác nhận và đáy 2 **tạm thời** thấp hơn ít nhất 0,5%, trong khi MACD chuẩn hóa cao hơn ít nhất 0,2 điểm phần trăm. Đáy cách nhau 5–60 phiên; nến xác nhận đóng trên mở cửa, vị trí đóng trong 40% trên của biên nến và histogram vừa chuyển sang dương, tương đương MACD cắt lên Signal. Nhánh này có thể phát `EARLY_PROBE` trước xác nhận giá kiểu Champion. `DOWNTREND_SPRING` là nhánh khác: phiên quét thủng hỗ trợ với volume ít nhất 2 lần, rồi phiên kế tiếp lấy lại nền bằng nến tăng. Trong downtrend, cả hai nhánh còn cần quá bán: RSI14 dưới 25 ở hiện tại/phiên trước hoặc chạm biên Bollinger dưới ở hiện tại/phiên trước.

Ở Challenger có thể lọc mã, chiến lược, hành động, regime, trạng thái quá bán/Bollinger, lý do, xa stop tối đa và chọn 25/50/100 dòng. `EARLY_PROBE` là thăm dò nghiên cứu 30% kích thước lệnh chuẩn. Giá mua giả định sớm nhất là Open phiên kế tiếp; hàng mua ngày T chỉ có thể bán từ chiều T+2.

## 3. Chiến lược và các cổng an toàn Challenger

| Regime | Nhánh ưu tiên và giới hạn |
| --- | --- |
| `UPTREND` | `UPTREND_CORE`: breakout đỉnh 20 phiên có volume ≥ 1,3×, VCP (biên dao động và volume co dần), hoặc pullback EMA20; phễu thích ứng cũng có thể xét |
| `SIDEWAYS` | `SIDEWAY_RANGE`: hồi về hỗ trợ 20 phiên, Pocket Pivot hoặc Spring gần nền; breakout đỉnh 20 phiên bị từ chối. Phễu thích ứng có thể dùng tháng SIDEWAYS và setup hỗ trợ tuần |
| `DOWNTREND` | Mặc định phòng thủ; chỉ MACD đáy 2 hoặc Spring hoảng loạn với điều kiện quá bán. Quy mô nghiên cứu 30%, trần tổng bắt đáy ghi trong bằng chứng là 20% NAV; ứng dụng chưa có sổ lệnh Challenger để cưỡng chế trần thực tế |
| `RECOVERY_FTD` | Nhánh trung hạn có thể trở lại ở quy mô giảm; FTD là quan sát về nỗ lực phục hồi, không chứng minh thị trường đã tạo đáy |
| `UNKNOWN` | Dữ liệu thị trường thiếu/không đủ phủ; không mở rủi ro mới |

Mọi nhánh mua nghiên cứu qua các cổng: Champion cùng mã không đang `EXIT`/`REDUCE`; regime cho phép; thanh khoản bình quân đạt mức tối thiểu; giá trị lệnh dự kiến không vượt 5% thanh khoản bình quân 20 phiên; có stop và giá không dưới stop; khoảng cách giá đóng cửa đến stop không quá 8%. Khi một cổng chặn, hành động đổi thành `WATCH` và `reasons` ghi mã chặn. `PROBE_BUY`, `EARLY_PROBE`, `ADD`, `REDUCE`, `EXIT` là nhãn quyết định/tín hiệu, không tự tạo giao dịch từ màn hình nghiên cứu.

## 4. Từ điển cột, mã và công thức

| Trường/nhãn | Ý nghĩa |
| --- | --- |
| `base_price` / Giá nền | Mốc nền hoặc trigger tham chiếu của nhánh; có thể thiếu nếu chưa có candidate |
| `invalidation_price` / Stop | Mức làm vô hiệu giả thuyết; không đồng nghĩa giá bán đã khớp |
| Xa nền | `(Close / base_price − 1) × 100%`; âm khi Close dưới nền |
| Xa stop | `(Close / invalidation_price − 1) × 100%`; trên 8% bị chặn mua nghiên cứu |
| `size_multiplier` / Quy mô | Hệ số so với lệnh chuẩn; 0,3 = 30% lệnh chuẩn, không phải 30% NAV |
| `market_regime` | Chế độ thị trường suy từ VN-Index, độ rộng và dữ liệu phục hồi |
| `reasons` | Mã giải thích setup, thiếu điều kiện hoặc cổng chặn; xem cùng `evidence` và hành động |
| `setup_id` | Dấu định danh của setup; giúp theo dõi cùng cấu trúc qua phiên |
| RSI14 | Chỉ báo sức mạnh tương đối 14 phiên; ngưỡng dưới 25 dùng cho nhánh downtrend |
| BB dưới | Giá thấp chạm/dưới biên Bollinger dưới trong phiên hiện tại hoặc trước đó |
| `ALIGNED` | Hai quyết định cùng hành động hoặc Challenger vào sớm khi Champion đang có nhãn mua |
| `EARLY_LEAD` | Challenger `EARLY_PROBE` khi Champion chưa `PROBE_BUY`/`ADD`; nhãn hiện tại **không đo số phiên dẫn trước** |
| `CHASE_BLOCKED` | Lý do Challenger có mã chặn do stop quá xa/giá dưới stop |
| `SIDEWAY_REJECTED` | Lý do Challenger từ chối breakout trong sideway |
| `DIFFERENT` | Các trường hợp khác chưa thuộc bốn nhãn trên |
| T+2 win rate | Tỷ lệ lượt đủ tuổi có lợi suất ròng dương; `n` là số mẫu |
| Profit factor | Tổng lãi dương / trị tuyệt đối tổng lỗ âm; không tính được khi chưa có lỗ |
| Drawdown khi khóa | Mức sụt giảm quan sát trong giai đoạn không thể bán ngay, theo proxy của bộ đo |
| Chỉ số ghép lượt | Tích `(1 + lợi suất từng lượt)` trừ 1 với quy mô đơn vị; **không phải NAV danh mục** |

## 5. Quy trình đọc một mã

1. Xác nhận **ngày phiên** và độ phủ dữ liệu trong mục Cài đặt → Dữ liệu. Nếu ngày cũ, dữ liệu trống hoặc giai đoạn `DATA_QUARANTINED`, kiểm tra trước khi diễn giải.
2. Mở Champion → Tín hiệu gốc để đọc hành động, khung, bộ máy, đồng thuận và “Vì sao?”. Mở WATCH để xem tín hiệu khác của cùng mã và tuổi lô hàng nếu đang giữ.
3. Mở Challenger cùng mã/phiên, đọc regime → chiến lược → candidate/setup → hành động → mã lý do. `WATCH` phải được đọc cùng lý do; trigger có thể tồn tại nhưng bị cổng rủi ro chặn.
4. Nếu liên quan đa khung hoặc đáy MACD, mở đúng tab để xem giai đoạn, ngày trigger, stop, khoảng cách và tính mới của sự kiện. Lọc một nhóm rồi xem phân trang để tránh bỏ sót mã.
5. Đối chiếu song mã để xem sự khác nhau, ngành, tuổi lô T+ và kết quả T+2. Số mẫu nhỏ hoặc dấu `—` không đủ để kết luận bộ máy nào tốt hơn. Ghi luận điểm và mức vô hiệu trước khi tự quyết định giao dịch.
