export type SignalExplanationGroup = {
  title: 'Bối cảnh' | 'Thiết lập' | 'Xác nhận' | 'Bộ lọc & rủi ro'
  items: { code: string; text: string }[]
}

type ReasonDescription = { group: SignalExplanationGroup['title']; text: string }

const exactReasons: Record<string, ReasonDescription> = {
  TREND_UP: { group: 'Bối cảnh', text: 'Xu hướng giá ngắn hạn đang tăng.' },
  TREND_DOWN: { group: 'Bối cảnh', text: 'Xu hướng giá ngắn hạn đang giảm; ưu tiên thận trọng.' },
  TREND_SIDEWAYS: { group: 'Bối cảnh', text: 'Giá đang đi ngang, chưa có xu hướng rõ.' },
  TREND_UNKNOWN: { group: 'Bối cảnh', text: 'Chưa đủ lịch sử để xác định xu hướng.' },
  MONTHLY_BULLISH: { group: 'Bối cảnh', text: 'Xu hướng tháng ủng hộ chiều tăng.' },
  MONTHLY_SIDEWAYS: { group: 'Bối cảnh', text: 'Khung tháng đi ngang; tín hiệu mua cần chọn lọc hơn.' },
  MONTHLY_BEARISH: { group: 'Bối cảnh', text: 'Khung tháng đang giảm, làm giảm chất lượng tín hiệu mua.' },
  WEEKLY_BULLISH_SETUP: { group: 'Bối cảnh', text: 'Khung tuần đang tạo thiết lập tăng hỗ trợ cho điểm kích hoạt ngày.' },
  WEEKLY_BREAKOUT_CONFIRMED: { group: 'Xác nhận', text: 'Khung tuần đã xác nhận vượt vùng cản quan trọng.' },
  VOLUME_CONFIRMED: { group: 'Xác nhận', text: 'Khối lượng xác nhận dòng tiền tham gia.' },
  RSI_OK: { group: 'Xác nhận', text: 'RSI nằm trong vùng phù hợp với thiết lập.' },
  MACD_CONFIRMATION: { group: 'Xác nhận', text: 'MACD xác nhận động lượng theo hướng của setup.' },
  FIB_CONFLUENCE: { group: 'Xác nhận', text: 'Vùng giá trùng mức Fibonacci quan trọng; đây là yếu tố cộng hưởng, không tự tạo lệnh mua.' },
  LIQUIDITY_OK: { group: 'Bộ lọc & rủi ro', text: 'Thanh khoản đạt ngưỡng tối thiểu để giao dịch.' },
  BREADTH_DATA_DEGRADED: { group: 'Bộ lọc & rủi ro', text: 'Dữ liệu thị trường thiếu một phần nhưng vẫn đạt ngưỡng độ phủ để đánh giá.' },
  VNINDEX_CONTEXT_UNAVAILABLE: { group: 'Bộ lọc & rủi ro', text: 'Chưa xác định được xu hướng VN-Index của đúng phiên đánh giá.' },
  MARKET_CONTEXT_DATE_MISMATCH: { group: 'Bộ lọc & rủi ro', text: 'Ngày dữ liệu thị trường không khớp ngày tín hiệu; tạm chặn lệnh mua.' },
  HISTORICAL_PORTFOLIO_UNAVAILABLE: { group: 'Bộ lọc & rủi ro', text: 'Chưa có trạng thái danh mục tại ngày lịch sử này để kiểm tra rủi ro mua.' },
  POSITION_PRICE_UNAVAILABLE: { group: 'Bộ lọc & rủi ro', text: 'Thiếu giá của vị thế đang nắm giữ để tính rủi ro danh mục.' },
  PORTFOLIO_CONTEXT_UNAVAILABLE: { group: 'Bộ lọc & rủi ro', text: 'Chưa đọc được danh mục để kiểm tra rủi ro mua.' },
  WYCKOFF_SPRING: { group: 'Bối cảnh', text: 'Giá rũ xuống dưới hỗ trợ rồi trở lại vùng giao dịch với khối lượng thấp; cần theo dõi xác nhận tiếp.' },
  WYCKOFF_SOS: { group: 'Bối cảnh', text: 'Giá vượt vùng cản với nến và khối lượng mạnh; đây là bối cảnh cầu, không phải lệnh mua độc lập.' },
  WYCKOFF_UTAD: { group: 'Bối cảnh', text: 'Giá vượt cản nhưng bị đẩy trở lại vùng giao dịch; cảnh báo áp lực cung.' },
  WYCKOFF_SOW: { group: 'Bối cảnh', text: 'Giá phá hỗ trợ với nến yếu và khối lượng tăng; cảnh báo áp lực cung.' },
  WYCKOFF_DISTRIBUTION_CONTEXT: { group: 'Bộ lọc & rủi ro', text: 'Sự kiện Wyckoff cho thấy áp lực cung; tạm chặn đề xuất mua mới, không tự động bán vị thế.' },
  IMPULSE_POLE: { group: 'Thiết lập', text: 'Có nhịp tăng đủ mạnh trước vùng tích lũy.' },
  FLAG_CONTROLLED_RETRACE: { group: 'Thiết lập', text: 'Vùng cờ điều chỉnh có kiểm soát và giữ kênh giá gọn.' },
  PENNANT_CONVERGENCE: { group: 'Thiết lập', text: 'Biên trên và dưới của vùng tích lũy hội tụ.' },
  PRIOR_TREND: { group: 'Bối cảnh', text: 'Mẫu hình chỉ được xét khi xu hướng trước đó phù hợp với hướng dự kiến.' },
  THREE_PIVOT_STRUCTURE: { group: 'Thiết lập', text: 'Cấu trúc ba pivot của mẫu hình đã xuất hiện.' },
  HEAD_CLEARANCE: { group: 'Thiết lập', text: 'Đỉnh đầu cao hơn hai vai đủ rõ theo điều kiện mẫu hình.' },
  SLOPING_NECKLINE: { group: 'Thiết lập', text: 'Đường cổ có độ dốc được ghi nhận để đánh giá điểm xác nhận.' },
  NEAR_NECKLINE: { group: 'Thiết lập', text: 'Giá đang gần đường cổ; cần nến đóng cửa xác nhận trước khi kết luận breakout hoặc breakdown.' },
  VNINDEX_DOWNTREND: { group: 'Bộ lọc & rủi ro', text: 'VN-Index đang trong xu hướng giảm, nên bộ lọc chung hạn chế mua mới.' },
  SECTOR_CONCENTRATION_LIMIT: { group: 'Bộ lọc & rủi ro', text: 'Mua thêm sẽ làm tỷ trọng ngành vượt giới hạn rủi ro danh mục.' },
  STOP_INVALIDATED: { group: 'Bộ lọc & rủi ro', text: 'Giá đã vi phạm mức dừng lỗ hoặc ngưỡng vô hiệu của setup.' },
}

const patternNames: Record<string, string> = {
  ACCUMULATION_BASE: 'nền tích lũy',
  DOUBLE_BOTTOM: 'hai đáy',
  DOUBLE_TOP: 'hai đỉnh',
  TRIANGLE: 'tam giác',
  FLAG: 'cờ giá',
  PENNANT: 'cờ đuôi nheo',
  HEAD_SHOULDERS_TOP: 'Vai–Đầu–Vai giảm',
  INVERSE_HEAD_SHOULDERS: 'Vai–Đầu–Vai ngược',
  FLAT_BASE: 'nền phẳng',
  CUP_HANDLE: 'cốc tay cầm',
  ROUNDING_BOTTOM: 'đáy tròn',
}

function normalized(code: string) {
  return code.replace(/^CORE_V1_/, '').replace(/^V0_/, '')
}

export function describeSignalReason(code: string): ReasonDescription {
  if (exactReasons[code]) return exactReasons[code]
  const reason = normalized(code)
  if (exactReasons[reason]) return exactReasons[reason]
  const pattern = Object.entries(patternNames).find(([name]) => reason.includes(name))
  if (reason.includes('NEAR_') && pattern) return { group: 'Thiết lập', text: `Đang theo dõi ${pattern[1]}; cấu trúc đã xuất hiện nhưng chưa xác nhận hoàn tất.` }
  if (reason.includes('CONFIRMED') && pattern) return { group: 'Xác nhận', text: `Mẫu hình ${pattern[1]} đã được xác nhận theo quy tắc của bộ máy.` }
  if (reason.includes('BREAKOUT') && pattern) return { group: 'Xác nhận', text: `${pattern[1]} có xác nhận vượt vùng kích hoạt.` }
  if (reason.includes('NECKLINE')) return { group: 'Thiết lập', text: 'Giá đang gần đường cổ; cần nến đóng cửa xác nhận trước khi kết luận breakout hoặc breakdown.' }
  if (reason.includes('RSI')) return { group: 'Xác nhận', text: 'RSI được dùng để kiểm tra động lượng và cấu trúc giá.' }
  if (reason.includes('MACD')) return { group: 'Xác nhận', text: 'MACD được dùng để xác nhận động lượng, không tự tạo tín hiệu riêng lẻ.' }
  if (reason.includes('VOLUME')) return { group: 'Xác nhận', text: 'Khối lượng là lớp xác nhận mức độ tham gia của dòng tiền.' }
  if (reason.includes('BREADTH') || reason.includes('DATA_')) return { group: 'Bộ lọc & rủi ro', text: 'Chất lượng dữ liệu hoặc bối cảnh breadth cần được xem xét thận trọng.' }
  if (reason.includes('STOP') || reason.includes('RISK') || reason.includes('BLOCK')) return { group: 'Bộ lọc & rủi ro', text: 'Bộ lọc rủi ro đã tác động đến khả năng mở hoặc duy trì vị thế.' }
  if (reason.includes('WEEKLY') || reason.includes('MONTHLY') || reason.includes('TREND')) return { group: 'Bối cảnh', text: reason.replaceAll('_', ' ').toLowerCase() }
  return { group: 'Thiết lập', text: reason.replaceAll('_', ' ').toLowerCase() }
}

export function signalReasonSummary(reasons: string[]) {
  const texts = reasons.map(describeSignalReason).map(item => item.text)
  return texts.slice(0, 2).join(' ') || 'Tín hiệu EOD tổng hợp từ các bộ máy đang bật.'
}

export function explainSignal(action: string, reasons: string[]) {
  const actionText: Record<string, string> = {
    PROBE_BUY: 'Ứng viên mua thăm dò: chỉ phù hợp khi chấp nhận rủi ro theo stop và quy mô nhỏ.',
    ADD: 'Có thể thêm vị thế khi điều kiện xác nhận còn hiệu lực và danh mục cho phép.',
    REDUCE: 'Ưu tiên giảm một phần vị thế để hạ rủi ro.',
    EXIT: 'Setup hoặc mức dừng lỗ đã bị vô hiệu; ưu tiên đóng vị thế.',
    WATCH: 'Chưa có lệnh mua/bán mới; hệ thống giữ mã trong danh sách theo dõi.',
  }
  const groups: SignalExplanationGroup[] = ['Bối cảnh', 'Thiết lập', 'Xác nhận', 'Bộ lọc & rủi ro'].map(title => ({
    title: title as SignalExplanationGroup['title'],
    items: reasons.filter(code => describeSignalReason(code).group === title).map(code => ({ code, text: describeSignalReason(code).text })),
  })).filter(group => group.items.length)
  return { actionText: actionText[action] ?? 'Tín hiệu được tổng hợp từ các điều kiện EOD.', groups }
}
