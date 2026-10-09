export type GuideStatus = 'Công bố' | 'Nghiên cứu' | 'Cá nhân' | 'Giới hạn'
export type GuideTopic = {
  id: string
  category: string
  title: string
  summary: string
  details: string[]
  status?: GuideStatus
  route?: string
  routeLabel?: string
  aliases?: string[]
}
export type GuideTerm = {
  id: string
  group: string
  subgroup: string
  label: string
  meaning: string
  reading: string
  status?: GuideStatus
  aliases?: string[]
  route?: string
}

export const guideTopics: GuideTopic[] = [
  { id: 'philosophy', category: 'Tổng quan', title: 'Prot Stock dùng để làm gì?', summary: 'Một bàn làm việc cá nhân để quan sát thị trường, hình thành luận điểm và xem lại quyết định.', details: [
    'Hệ thống đi từ dữ liệu có ngày và nguồn, qua kiểm tra chất lượng, phân tích kỹ thuật, quy tắc và cổng rủi ro. Tín hiệu là một giả thuyết có điều kiện; người dùng vẫn quyết định và ghi lại lý do của mình.',
    'Ba nguyên tắc: chỉ đánh giá trên dữ liệu đủ điều kiện; nêu được lý do và mức vô hiệu; giữ bằng chứng tại thời điểm quyết định để có thể kiểm tra lại.'
  ], status: 'Công bố', route: 'today', routeLabel: 'Mở Tổng quan', aliases: ['triết lý', 'hệ thống'] },
  { id: 'workflow', category: 'Tổng quan', title: 'Quy trình đọc một mã', summary: 'Kiểm tra phiên → thị trường → mã → mức vô hiệu → quyết định → nhật ký.', details: [
    'Trước tiên xem ngày phiên và độ phủ dữ liệu. Sau đó xem bối cảnh thị trường, tìm mã trong Watchlist hoặc Bộ lọc tín hiệu, mở Phân tích mã để đọc mẫu hình, vùng giá, thanh khoản và mức vô hiệu.',
    'Nếu cần hành động, ghi luận điểm, điều kiện sai và mức rủi ro. Nhật ký lưu quyết định cùng bằng chứng của thời điểm đó; sau này đối chiếu với kết quả và kiểm thử.'
  ], status: 'Cá nhân', route: 'analysis', routeLabel: 'Mở Phân tích mã' },
  { id: 'data-source', category: 'Dữ liệu', title: 'Nguồn, đơn vị và thời điểm dữ liệu', summary: 'Giá và khối lượng có phiên, nguồn và thời điểm thu thập; không được đọc như báo giá trực tiếp.', details: [
    'Nguồn giá EOD hiện tại là KBS. Giá cổ phiếu chuẩn trong pipeline được lưu theo nghìn VND/cổ phiếu; giao diện quy đổi và ghi rõ đơn vị khi hiển thị. Vốn, giá vốn và báo cáo danh mục dùng VND.',
    'D/W/M lần lượt là nến ngày, tuần, tháng. Quyết định từ W/M chỉ dùng kỳ đã đóng. Nến đang hình thành có thể xuất hiện trên biểu đồ nhưng không được coi là xác nhận chính thức.'
  ], status: 'Công bố', route: 'settings?tab=data', routeLabel: 'Xem trạng thái dữ liệu', aliases: ['KBS', 'OHLCV', 'EOD'] },
  { id: 'data-health', category: 'Dữ liệu', title: 'Độ phủ và trạng thái công bố', summary: 'Một phiên có thể COMPLETE, PARTIAL hoặc chưa được chứng nhận.', details: [
    'Mục Dữ liệu cho biết phiên tín hiệu mới nhất, số mã có snapshot, job EOD và mã còn thiếu. COMPLETE nghĩa là đủ độ phủ theo kiểm tra công bố; PARTIAL báo còn thiếu. Dấu “—” nghĩa là chưa có hoặc chưa tính được, không phải số 0.',
    'Giờ chạy dự kiến không phải cam kết giờ dữ liệu sẵn sàng. Nguồn và hàng đợi xử lý có thể làm chậm; hãy dùng ngày phiên và trạng thái hiển thị thay cho giờ đồng hồ.'
  ], status: 'Công bố', route: 'settings?tab=data', routeLabel: 'Xem mục Dữ liệu', aliases: ['COMPLETE', 'PARTIAL', 'độ trễ'] },
  { id: 'data-limits', category: 'Dữ liệu', title: 'Các giới hạn của dữ liệu lịch sử', summary: 'Sự kiện doanh nghiệp và phân ngành theo thời điểm chưa được bao phủ đầy đủ.', details: [
    'Chia tách, cổ tức, quyền mua và các thay đổi cơ sở giá có thể ảnh hưởng đồ thị, replay và kiểm thử. Một chuỗi giá đứt gãy chưa xác minh có thể bị cách ly; không coi kết quả nghiên cứu đó là đã kiểm chứng.',
    'Thống kê ngành lịch sử hiện có thể dựa trên phân loại ngành đang lưu, không phải lịch sử phân loại đúng từng ngày. Những giới hạn này cần đi cùng bảng kết quả, không ẩn ở cuối tài liệu.'
  ], status: 'Giới hạn', route: 'settings?tab=data', routeLabel: 'Xem mục Dữ liệu', aliases: ['corporate action', 'giá điều chỉnh', 'quarantine'] },
  { id: 'minute-data', category: 'Dữ liệu', title: 'Giao dịch đột biến từ nến phút', summary: 'Radar phân tích cụm khối lượng 1–15 phút sau phiên, không phải bảng giá thời gian thực.', details: [
    'Sự kiện được so với cùng khoảng phút của các phiên đủ dữ liệu trước đó. Giao diện hiển thị độ phủ nến phút, nguồn và diễn biến giá quan sát được; dữ liệu phút chi tiết có thể hết thời hạn lưu trong khi bản ghi sự kiện còn tồn tại.',
    'Khối lượng bất thường không xác định danh tính người mua/bán hoặc dòng tiền ròng. Phiên có dữ liệu phút thiếu không được chấm sự kiện.'
  ], status: 'Nghiên cứu', route: 'screener?tab=spikes', routeLabel: 'Mở Giao dịch đột biến', aliases: ['intraday', 'spike', 'nến 1 phút'] },
  { id: 'signal-path', category: 'Tín hiệu', title: 'Một tín hiệu được tạo ra thế nào?', summary: 'Mẫu hình và engine tạo ứng viên; cổng dữ liệu, thị trường và rủi ro quyết định nhãn cuối.', details: [
    'Pipeline tính D/W/M và chỉ báo từ dữ liệu đã đóng, nhận diện mẫu hình và vùng giá, chạy các Core Engine/Pack rồi tổng hợp theo mã, ngày và khung. Nhiều nguồn cùng đồng thuận không nhất thiết là nhiều bằng chứng độc lập.',
    'Mua mới có thể bị hạ WATCH vì dữ liệu cũ/thiếu, thị trường xấu, thanh khoản, stop không hợp lệ hoặc giới hạn danh mục. EXIT khi thủng stop không bị cổng mua mới chặn. Luôn mở lý do và bằng chứng trước khi đọc hành động.'
  ], status: 'Công bố', route: 'screener', routeLabel: 'Mở Bộ lọc tín hiệu', aliases: ['engine', 'policy', 'signal'] },
  { id: 'champion-challenger', category: 'Tín hiệu', title: 'Champion, Challenger và Đối chiếu', summary: 'Champion là tín hiệu công bố; Challenger là đánh giá shadow để nghiên cứu.', details: [
    'Champion tổng hợp các engine và áp dụng cổng chung. Challenger chạy song song theo các nhánh chiến lược, ghi WATCH hoặc ứng viên thăm dò cùng lý do; đánh giá này không tự tạo giao dịch danh mục.',
    'Đối chiếu đặt cùng mã, cùng phiên cạnh nhau. Nhãn ALIGNED hay EARLY_LEAD chỉ mô tả quan hệ giữa hai kết quả; bảng điểm T+2 chỉ dùng mẫu đã đủ tuổi và giả định chi phí, không chứng minh một bộ máy tốt hơn khi mẫu ít.'
  ], status: 'Nghiên cứu', route: 'screener', routeLabel: 'Mở Đối chiếu', aliases: ['shadow', 'dual engine'] },
  { id: 'screener-tabs', category: 'Tín hiệu', title: 'Sáu bảng trong Bộ lọc tín hiệu', summary: 'Tín hiệu gốc, WATCH, Radar, Giao dịch đột biến, Phễu và Phân kỳ MACD.', details: [
    'Tín hiệu gốc là hành động và lý do. WATCH giúp tìm cơ hội chờ hoặc điều kiện chặn. Radar cơ hội gộp diễn biến của một mã trong một phiên. Giao dịch đột biến nghiên cứu cụm nến phút sau phiên.',
    'Phễu tháng → tuần → ngày theo dõi bối cảnh, setup và trigger. Phân kỳ Dương · đường MACD theo dõi vùng đáy, xác nhận, vô hiệu và hết hạn. Đọc ngày phiên và nhãn nghiên cứu trước khi so các bảng.'
  ], status: 'Công bố', route: 'screener', routeLabel: 'Mở Bộ lọc tín hiệu', aliases: ['tab', 'radar', 'watch'] },
  { id: 'strategy', category: 'Chiến lược', title: 'Chiến lược, setup và trigger', summary: 'Chiến lược mô tả điều kiện; setup đang hình thành chưa phải điểm mua.', details: [
    'Core Engine và Core Pack có nhánh mẫu hình, xu hướng, pullback, VCP, phân kỳ, sức mạnh tương đối và bối cảnh Wyckoff. Phễu nghiên cứu đọc tháng → setup tuần → trigger ngày; chỉ khi qua các cổng an toàn mới có ứng viên hành động.',
    'Các ngưỡng và thời hạn phụ thuộc từng quy tắc/phiên bản. Mở mục chuyên sâu để xem điều kiện cụ thể; không áp một ngưỡng của nhánh này sang nhánh khác.'
  ], status: 'Công bố', route: 'rules', routeLabel: 'Mở Thiết lập quy tắc', aliases: ['setup', 'trigger', 'VCP', 'pullback'] },
  { id: 'personal-workspace', category: 'Quyết định', title: 'Watchlist, luận điểm và nhật ký', summary: 'Tín hiệu hệ thống và quyết định đầu tư cá nhân là hai lớp riêng.', details: [
    'Watchlist giữ mã đang theo dõi và kế hoạch giá. Luận điểm ghi lý do, chất xúc tác, điều kiện vô hiệu và rủi ro; phiên bản cũ được giữ khi cập nhật. Nhật ký lưu quyết định cùng bằng chứng và phiên bản luận điểm tại thời điểm ghi.',
    'Danh mục phản ánh giao dịch/vốn đã nhập, không được hệ thống tự suy ra từ WATCH hoặc nghiên cứu Challenger. Các màn hình cá nhân chỉ hiện theo quyền tài khoản.'
  ], status: 'Cá nhân', route: 'watchlist', routeLabel: 'Mở Watchlist' },
  { id: 'evaluation', category: 'Quyết định', title: 'Kiểm thử và đánh giá kết quả', summary: 'Kết quả giả định giúp xem lại quy tắc, không phải lợi nhuận giao dịch đã thực hiện.', details: [
    'Kiểm thử dùng dữ liệu lịch sử với phần khởi động chỉ báo và giả định khớp mở cửa phiên kế tiếp. Kết quả theo mốc 5/10/20 phiên đo biến động giá từ đóng cửa ngày tín hiệu; kết quả giao dịch còn chịu phí, thuế, trượt giá, thanh khoản và giới hạn T+.',
    'Nhãn REDUCE/EXIT cần đọc như diễn biến sau cảnh báo. Một con số lợi suất dương ở các nhãn này không tự biến cảnh báo thành giao dịch thắng.'
  ], status: 'Giới hạn', route: 'backtest', routeLabel: 'Mở Kiểm thử lịch sử', aliases: ['backtest', 'outcome', 'T+2'] },
]

export const guideTerms: GuideTerm[] = [
  { id:'universe',group:'Dữ liệu',subgroup:'Phạm vi',label:'Universe',meaning:'Danh sách mã đang được hệ thống theo dõi và xử lý.',reading:'Độ phủ EOD được so với các mã đang hoạt động, không phải toàn bộ thị trường.',route:'universe',aliases:['danh sách cổ phiếu'] },
  { id:'eod',group:'Dữ liệu',subgroup:'Thời gian',label:'EOD',meaning:'Dữ liệu sau phiên giao dịch.',reading:'Kiểm tra ngày phiên và thời điểm công bố trước khi đọc tín hiệu.',aliases:['end of day','cuối ngày'] },
  { id:'ohlcv',group:'Dữ liệu',subgroup:'Nguồn & đơn vị',label:'OHLCV',meaning:'Giá mở, cao, thấp, đóng và khối lượng.',reading:'Dữ liệu nền để tính nến, chỉ báo và mẫu hình; mỗi bản ghi gắn ngày và nguồn.',aliases:['giá khối lượng'] },
  { id:'kbs',group:'Dữ liệu',subgroup:'Nguồn & đơn vị',label:'KBS',meaning:'Nguồn giá hiện dùng cho xử lý EOD và nghiên cứu giá.',reading:'Nguồn dữ liệu không chứng minh mọi sự kiện doanh nghiệp đã được điều chỉnh đầy đủ.' },
  { id:'dwm',group:'Dữ liệu',subgroup:'Thời gian',label:'D / W / M',meaning:'Khung ngày, tuần và tháng.',reading:'Quyết định W/M chỉ dùng kỳ đã đóng; kỳ đang hình thành chỉ để quan sát.',aliases:['đa khung','timeframe'] },
  { id:'coverage',group:'Dữ liệu',subgroup:'Chất lượng',label:'Độ phủ',meaning:'Tỷ lệ mã có dữ liệu đúng phiên và đủ điều kiện tính.',reading:'Đọc cùng mẫu số và ngày phiên; độ phủ thấp làm giảm độ tin cậy của bảng tổng hợp.',aliases:['coverage'] },
  { id:'complete',group:'Dữ liệu',subgroup:'Chất lượng',label:'COMPLETE / PARTIAL',meaning:'Trạng thái công bố đủ hoặc còn thiếu dữ liệu.',reading:'PARTIAL không được hiểu là thị trường không có tín hiệu; có thể có mã chưa xử lý.' },
  { id:'dash',group:'Dữ liệu',subgroup:'Chất lượng',label:'Dấu “—”',meaning:'Chưa có hoặc chưa tính được giá trị.',reading:'Không diễn giải dấu này thành số 0 hoặc tín hiệu trung tính.' },
  { id:'quarantine',group:'Dữ liệu',subgroup:'Chất lượng',label:'DATA_QUARANTINED',meaning:'Chuỗi giá có đứt gãy lớn chưa xác minh.',reading:'Kết quả nghiên cứu dùng chuỗi này bị chặn cho tới khi kiểm tra cơ sở giá.',status:'Giới hạn',aliases:['cách ly dữ liệu'] },
  { id:'minute',group:'Dữ liệu',subgroup:'Thời gian',label:'Nến phút',meaning:'Bản ghi giá và khối lượng theo phút dùng cho Radar đột biến.',reading:'Được nghiên cứu sau phiên; độ phủ có thể khác dữ liệu EOD.',status:'Nghiên cứu',aliases:['intraday','1m'] },
  { id:'breadth',group:'Thị trường',subgroup:'Bối cảnh',label:'Breadth',meaning:'Độ rộng thị trường theo số mã tăng/giảm hoặc ở trên đường trung bình.',reading:'Luôn xem số mã quan sát và độ phủ; không phải dự báo chắc chắn.',aliases:['độ rộng thị trường'] },
  { id:'market-health',group:'Thị trường',subgroup:'Bối cảnh',label:'Market Health',meaning:'Điểm tổng hợp điều kiện của thị trường.',reading:'Điểm là thước đo trạng thái, không phải xác suất thị trường tăng.',route:'market' },
  { id:'regime',group:'Thị trường',subgroup:'Bối cảnh',label:'Regime',meaning:'Chế độ thị trường dùng trong nghiên cứu Challenger.',reading:'UPTREND, SIDEWAYS, DOWNTREND, RECOVERY_FTD hoặc UNKNOWN; khác bối cảnh tháng của từng cổ phiếu.',status:'Nghiên cứu' },
  { id:'sector-score',group:'Thị trường',subgroup:'Ngành',label:'Điểm sức khỏe ngành',meaning:'Điểm từ độ rộng và diễn biến giá của các mã trong ngành.',reading:'Xem cỡ mẫu và độ phủ; không phải tiền ròng chảy vào ngành.',aliases:['sector health'] },
  { id:'ema',group:'Phân tích kỹ thuật',subgroup:'Xu hướng',label:'EMA / SMA',meaning:'Đường trung bình động có trọng số mũ / trung bình đơn giản.',reading:'Kỳ tính và khung thời gian quyết định ý nghĩa của đường.',aliases:['đường trung bình','MA'] },
  { id:'rsi',group:'Phân tích kỹ thuật',subgroup:'Động lượng',label:'RSI',meaning:'Chỉ báo động lượng theo biến động giá gần đây.',reading:'RSI quá mua hoặc quá bán là bối cảnh, không tự phát lệnh.' },
  { id:'macd',group:'Phân tích kỹ thuật',subgroup:'Động lượng',label:'MACD',meaning:'Chênh lệch hai EMA cùng đường tín hiệu và histogram.',reading:'Phân biệt giao cắt MACD/Signal với xác nhận phân kỳ vùng đáy.' },
  { id:'atr',group:'Phân tích kỹ thuật',subgroup:'Rủi ro',label:'ATR',meaning:'Thước đo biên độ biến động trung bình.',reading:'Một số quy tắc dùng ATR làm đệm stop; ATR không phải mức lỗ cố định.' },
  { id:'prot-flow',group:'Phân tích kỹ thuật',subgroup:'Giá & khối lượng',label:'Prot Flow',meaning:'Thước đo áp lực giá–khối lượng.',reading:'Không xác định người mua/bán hay dòng tiền mua ròng.',aliases:['flow','dòng tiền'] },
  { id:'fib',group:'Phân tích kỹ thuật',subgroup:'Vùng giá',label:'Fibonacci',meaning:'Các mốc hồi quy tham khảo khi đánh giá vùng giá.',reading:'Vùng trùng với bằng chứng khác có thể tăng bối cảnh; không tự tạo lệnh mua.',aliases:['Fib'] },
  { id:'stop',group:'Phân tích kỹ thuật',subgroup:'Rủi ro',label:'Stop / mức vô hiệu',meaning:'Mức giá làm giả thuyết setup không còn đúng.',reading:'Xem cơ sở đặt stop và khoảng cách từ giá hiện tại; stop không bảo đảm giá khớp.' },
  { id:'distance-stop',group:'Phân tích kỹ thuật',subgroup:'Rủi ro',label:'Xa stop',meaning:'(Giá đóng cửa / stop − 1) × 100%.',reading:'Khác với xa nền. Challenger chặn điểm mua nghiên cứu khi xa stop trên 8% hoặc giá dưới stop.',status:'Nghiên cứu',aliases:['distance to stop'] },
  { id:'distance-base',group:'Phân tích kỹ thuật',subgroup:'Vùng giá',label:'Xa nền',meaning:'(Giá đóng cửa / giá nền − 1) × 100%.',reading:'Mốc nền là tham chiếu setup, không phải giá vốn hay lợi nhuận của người dùng.' },
  { id:'vcp',group:'Mẫu hình & chiến lược',subgroup:'Core Pack',label:'VCP Breakout',meaning:'Mô hình co hẹp biên độ và khối lượng trước khi vượt đỉnh.',reading:'Core Pack dùng quy tắc định lượng cụ thể; một hình dạng giống VCP trên chart chưa đủ để mua.' },
  { id:'pullback',group:'Mẫu hình & chiến lược',subgroup:'Core Pack',label:'Pullback',meaning:'Nhịp hồi về vùng hỗ trợ trong xu hướng.',reading:'Đọc hướng xu hướng, volume hồi, nến kích hoạt và stop; khác breakout bùng nổ.' },
  { id:'wyckoff',group:'Mẫu hình & chiến lược',subgroup:'Bối cảnh',label:'Wyckoff Spring / SOS / UTAD / SOW',meaning:'Nhãn sự kiện cung–cầu tích lũy hoặc phân phối.',reading:'Core Pack Wyckoff bổ sung bối cảnh; không tự tạo BUY.',aliases:['spring','SOS','UTAD','SOW'] },
  { id:'funnel',group:'Mẫu hình & chiến lược',subgroup:'Phễu đa khung',label:'Phễu tháng → tuần → ngày',meaning:'Tháng cho bối cảnh, tuần cho setup, ngày cho trigger.',reading:'Nhãn giai đoạn cho biết tiến độ nghiên cứu, chưa phải lệnh mua.',status:'Nghiên cứu',aliases:['MTF','multi-timeframe'] },
  { id:'setup',group:'Mẫu hình & chiến lược',subgroup:'Phễu đa khung',label:'Setup',meaning:'Cấu trúc đang đủ điều kiện chờ kích hoạt.',reading:'Có setup không đồng nghĩa đã vượt ngưỡng ngày hoặc qua cổng an toàn.' },
  { id:'trigger',group:'Mẫu hình & chiến lược',subgroup:'Phễu đa khung',label:'Trigger',meaning:'Sự kiện giá vượt ngưỡng theo quy tắc của setup.',reading:'Ngày trigger là ngày phát sinh lần vượt, không phải ngày mở vị thế.' },
  { id:'core-engine',group:'Mẫu hình & chiến lược',subgroup:'Champion',label:'Core Engine / Core Pack',meaning:'Các nguồn điều kiện tạo đề xuất Champion.',reading:'Nhiều nguồn bật cùng lúc không nhất thiết là bằng chứng độc lập.',status:'Công bố' },
  { id:'challenger',group:'Mẫu hình & chiến lược',subgroup:'Challenger',label:'Challenger',meaning:'Bộ đánh giá chạy song song để nghiên cứu chiến lược.',reading:'Kết quả shadow không tự ghi giao dịch danh mục.',status:'Nghiên cứu',aliases:['shadow'] },
  { id:'macd-zone',group:'Mẫu hình & chiến lược',subgroup:'Challenger',label:'MACD_EARLY_ZONE',meaning:'Nhánh tìm vùng đáy thứ hai và tín hiệu thăm dò sớm.',reading:'EARLY_PROBE là giả thuyết nghiên cứu, không phải tín hiệu Champion.',status:'Nghiên cứu' },
  { id:'watch',group:'Tín hiệu & kiểm soát',subgroup:'Hành động',label:'WATCH',meaning:'Theo dõi, chờ xác nhận hoặc bị điều kiện chặn.',reading:'Mở mã lý do và bằng chứng; WATCH không phải khuyến nghị mua.' },
  { id:'probe',group:'Tín hiệu & kiểm soát',subgroup:'Hành động',label:'PROBE_BUY / ADD',meaning:'Ứng viên thăm dò / tăng vị thế sau khi qua quy tắc áp dụng.',reading:'Kiểm tra ngày phiên, stop, thanh khoản và quy mô cá nhân trước quyết định.' },
  { id:'exit',group:'Tín hiệu & kiểm soát',subgroup:'Hành động',label:'REDUCE / EXIT',meaning:'Ứng viên giảm hoặc thoát vị thế.',reading:'Đọc theo vị thế thực; kết quả giá dương sau cảnh báo không có nghĩa là giao dịch thắng.' },
  { id:'score',group:'Tín hiệu & kiểm soát',subgroup:'Điểm & lý do',label:'Điểm đồng thuận',meaning:'Mức hội tụ điều kiện của các nguồn tín hiệu trên thang 0–100.',reading:'70/90/98 không phải xác suất thắng tương ứng.',aliases:['confidence','điểm 90'] },
  { id:'market-gate',group:'Tín hiệu & kiểm soát',subgroup:'Cổng rủi ro',label:'Market Gate',meaning:'Điều kiện bối cảnh thị trường cho mua mới.',reading:'Độ phủ thấp hoặc risk-off có thể hạ ứng viên mua thành WATCH.' },
  { id:'liquidity',group:'Tín hiệu & kiểm soát',subgroup:'Cổng rủi ro',label:'Thanh khoản',meaning:'Giá trị giao dịch đủ để xem xét một ứng viên theo quy tắc.',reading:'Không suy từ khối lượng cổ phiếu sang VND nếu chưa nhân đúng đơn vị giá.' },
  { id:'tplus',group:'Quản lý & đánh giá',subgroup:'Giao dịch',label:'T0 / T1 / T2 / T_READY',meaning:'Tuổi của lô hàng theo phiên giao dịch.',reading:'Thể hiện khả năng bán của lô, không phải tín hiệu nên bán.',aliases:['T+2'] },
  { id:'nav',group:'Quản lý & đánh giá',subgroup:'Danh mục',label:'NAV',meaning:'Giá trị tài sản ròng của danh mục.',reading:'Tách tiền nạp/rút khỏi lợi nhuận đầu tư khi xem lịch sử.' },
  { id:'drawdown',group:'Quản lý & đánh giá',subgroup:'Kết quả',label:'Drawdown',meaning:'Mức giảm từ đỉnh trong giai đoạn quan sát.',reading:'Cần đọc cùng kỳ đo, số mẫu và giả định giá khớp.' },
  { id:'profit-factor',group:'Quản lý & đánh giá',subgroup:'Kết quả',label:'Profit factor',meaning:'Tổng lãi chia tổng lỗ tuyệt đối trong mẫu đủ điều kiện.',reading:'Nếu thiếu mẫu hoặc mẫu quá nhỏ, không suy ra hiệu quả ổn định.' },
  { id:'next-open',group:'Quản lý & đánh giá',subgroup:'Kiểm thử',label:'Khớp mở cửa phiên kế tiếp',meaning:'Giả định thực hiện lệnh của kiểm thử sau tín hiệu EOD.',reading:'Khác giá đóng cửa dùng làm mốc đo một số thống kê tín hiệu.',aliases:['next-session open'] },
]

export function normalizeGuideText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim()
}
