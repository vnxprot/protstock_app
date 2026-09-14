export const engineOrder = [
  'Prot Core Engine v0.0', 'Prot Core Engine v1.0', 'Prot Core Engine v2.0',
  'Prot Core Pack · Pullback Continuation', 'Prot Core Pack · VCP Breakout',
  'Prot Core Pack · Phân kỳ RSI + xác nhận MACD', 'Prot Core Pack · RSI MACD Divergence',
  'Prot Core Pack · Relative Strength Leader',
]
export function compareEngines(a: {name: string}, b: {name: string}) {
  const rank = (name: string) => { const index = engineOrder.indexOf(name); return index < 0 ? 999 : index }
  return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, 'vi')
}
export const engineGuides = [
  {name: 'Prot Core Engine v0.0', detail: 'Năm nhóm: nền phẳng, cờ tăng/pennant, hai đáy, hai đỉnh, vai đầu vai/ngược. Chọn bằng chứng cấu trúc mạnh nhất, chấm chất lượng; không cộng nhiều phiếu cho cùng một cấu trúc. Ngưỡng 75; hai đáy và vai đầu vai ngược cần 80. Tín hiệu mua còn phải qua điều kiện core và bộ lọc chung.'},
  {name: 'Prot Core Engine v1.0', detail: 'Bốn nhánh độc lập, không cần thỏa cả bốn: nền tích lũy xác nhận + volume >1,5 lần; hai đáy + volume >1,3 lần; RSI 40–75 cho hai nhánh mua; tam giác tăng READY để theo dõi; hai đỉnh xác nhận cảnh báo giảm. Giữ thuật toán gốc để đối chiếu; kết luận cuối vẫn chịu bộ lọc chung.'},
  {name: 'Prot Core Engine v2.0', detail: 'Ngày: ưu tiên EXIT → REDUCE → ADD/PROBE_BUY → WATCH; chất lượng mẫu hình 70 (65 khi MA-stack/RS hỗ trợ), volume ≥1,3 lần, RSI <75, thanh khoản và MTF. Tuần: breakout đỉnh 13 tuần với volume ≥1,3 lần trung bình 13 tuần hoặc setup hồi EMA20. Tháng: chuyển trạng thái theo EMA10/SMA20, chỉ cảnh báo xu hướng; không tự mua vì tháng tăng.'},
  {name: 'Prot Core Pack · Pullback Continuation', detail: 'Tháng và tuần tăng; nến ngày xanh chạm EMA20 hoặc SMA50; volume dưới trung bình 20 phiên. Đây là setup hồi trong xu hướng, không phải breakout đòi volume bùng nổ. Fib trùng vùng chỉ bổ sung bằng chứng, không tự phát mua.'},
  {name: 'Prot Core Pack · VCP Breakout', detail: 'Ba đoạn 10 phiên có biên độ giá thu hẹp dần; volume ba phiên trước dưới 70% mức nền; đóng cửa vượt đỉnh 10 phiên và volume >1,5 lần. Đây là mô hình co hẹp định lượng đơn giản, không phải nhận diện VCP tùy ý.'},
  {name: 'Prot Core Pack · Phân kỳ RSI + xác nhận MACD', detail: 'Hai đáy đã xác nhận (hai nến phía sau): giá tạo đáy thấp hơn, RSI cao hơn, gần hỗ trợ mạnh. MACD cắt lên Signal sau khi setup được xác nhận; tiếp theo giá vượt đỉnh hồi cố định giữa hai đáy. Trong tối đa 20 phiên: chờ MACD/giá → WATCH; đủ → đề xuất mua; thủng đáy → hủy. Không cần MACD vượt 0. Bản cũ v1.0 được giữ trong lịch sử.'},
  {name: 'Prot Core Pack · Relative Strength Leader', detail: 'Xu hướng cổ phiếu tăng, hiệu suất vượt VN-Index hơn 5 điểm phần trăm trong tối đa 63 phiên; chỉ số đang đi ngang/giảm. Tìm mã khỏe tương đối, không đảm bảo điểm mua. Bộ lọc chung vẫn có thể chặn mua khi thị trường xấu.'},
]
