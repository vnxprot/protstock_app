# ĐẶC TẢ KỸ THUẬT NÂNG CẤP TOÀN DIỆN UI/UX V4.1.0 — PROT STOCK

## 1. MỤC TIÊU VÀ BỐI CẢNH DỰ ÁN
Phiên bản v4.0.0 vừa qua đã hoàn thành việc chuẩn hóa luồng nghiệp vụ cá nhân, tuy nhiên phát sinh một số điểm trừ và lỗi hiển thị nghiêm trọng về mặt UI/UX:
1. **Typography khô cứng**: Ép cứng font hệ thống `Segoe UI` làm giao diện gãy gọn, thô và mang tính văn phòng/kế toán cũ, mất đi nét bo tròn, hiện đại của font `Inter` ở v3.
2. **Móp méo và lệch tâm các control nhỏ**: Do áp đặt luật toàn cục `.app-shell :is(button, input, select) { min-height: 36px / 44px; }`, các nút đặc thù như công tắc Toggle (`.core-toggle` 24px) bị kéo giãn to bất thường, viên bi bên trong trôi dạt lên đỉnh; các nút đóng X (`.watch-stock-remove` 28px) bị kéo dài thành hình chữ nhật đứng.
3. **Card và Block bị cứng và đơn điệu**: Lệnh `backdrop-filter: none` đã triệt tiêu toàn bộ hiệu ứng kính mờ (Glassmorphism), viền phẳng đơn điệu, mất đi chiều sâu 2.5D của ngôn ngữ iOS 26/27 và macOS Golden.
4. **Chữ ở Light Theme bị mờ, khó đọc**: Biến màu `--muted: #4d6658` kết hợp với hơn 110 thuộc tính màu chữ Dark Mode bị sót làm chữ trên nền sáng nhạt nhòa, vi phạm chuẩn độ tương phản WCAG AA (< 3:1).
5. **Mật độ chật chội (Cramped Padding)**: Các card như `metric-card` và `watch-stock` có padding 12px quá chật, các tag dính sát nhau.
6. **Quá tải nhận thức (Cognitive Overload)**: Các trang phân tích định lượng (Analysis, Rule Builder) dồn dập các thông số chuyên sâu (ATR, CLV, OBV, CMF, Price Zones) nhưng thiếu câu tóm lược hành động nhanh cho người dùng.

---

## 2. KẾ HOẠCH TRIỂN KHAI CHI TIẾT (TASK-BY-TASK)

### Task 1: Khôi phục Phông chữ Hiện đại (Typography System)
* **File cần sửa**: `index.html` và `src/v4-design.css`.
* **Mô tả chi tiết**:
  1. Trong `index.html`: Bổ sung preconnect và link nạp 2 phông chữ hàng đầu hiện nay: **`Plus Jakarta Sans`** và **`Inter`**, kèm phông số đơn cách **`JetBrains Mono`** cho bảng tài chính:
     ```html
     <link rel="preconnect" href="https://fonts.googleapis.com" />
     <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
     <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" />
     ```
  2. Trong `src/v4-design.css`: Cập nhật lại token font:
     ```css
     :root {
       --font-ui: 'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
       --font-family: var(--font-ui);
       --font-mono: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
       font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11', 'tnum' 1;
     }
     ```

---

### Task 2: Loại trừ triệt để min-height trên các nút đặc thù
* **File cần sửa**: `src/v4-design.css`.
* **Mô tả chi tiết**:
  Sửa đổi selector ép chiều cao toàn cục tại dòng 18 và dòng 56, loại trừ toàn bộ các nút dạng icon, toggle, avatar, micro-button:
  ```css
  /* Không ép min-height lên các control kích thước cố định */
  .app-shell :is(button:not(.core-toggle):not(.watch-stock-remove):not(.icon-button):not(.collapse-button):not(.symbol-avatar):not(.watch-stock-tiers button)) {
    min-height: 36px;
  }

  @media (max-width: 760px) {
    .app-shell :is(button:not(.core-toggle):not(.watch-stock-remove):not(.icon-button):not(.collapse-button):not(.symbol-avatar):not(.watch-stock-tiers button),
                   input, select, .primary-button, .secondary-button, .text-button) {
      min-height: 44px;
    }
  }
  ```

---

### Task 3: Tinh chỉnh Switch Toggle & Nút đóng X chuẩn iOS / macOS
* **File cần sửa**: `src/styles.css`, `src/watchlist-page.css`, `src/ui-polish.css`.
* **Mô tả chi tiết**:
  1. Cấu trúc lại `.core-toggle`: Cố định tỷ lệ 44px x 26px, căn giữa trục dọc hoàn hảo, chuyển động viên bi bằng `transform: translateX` với gia tốc đàn hồi nảy nhẹ:
     ```css
     .core-toggle {
       position: relative;
       width: 44px !important;
       height: 26px !important;
       min-height: 26px !important;
       max-height: 26px !important;
       border-radius: 999px;
       background: #1c2b23;
       border: 1px solid #334e3d;
       padding: 0;
       cursor: pointer;
       transition: background-color 0.2s ease, border-color 0.2s ease;
       flex-shrink: 0;
       display: inline-flex;
       align-items: center;
     }
     .core-toggle i {
       position: absolute;
       top: 2px !important;
       left: 2px !important;
       width: 20px !important;
       height: 20px !important;
       border-radius: 50%;
       background: #8fa699;
       box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
       transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.2s ease;
     }
     .core-toggle.is-on {
       background: #d7ff52 !important;
       border-color: #b6df42 !important;
     }
     .core-toggle.is-on i {
       transform: translateX(18px) !important;
       left: 2px !important;
       background: #0b1710 !important;
     }
     ```
  2. Cấu trúc lại nút đóng `.watch-stock-remove`:
     ```css
     .watch-stock-remove {
       display: grid !important;
       place-items: center !important;
       width: 28px !important;
       height: 28px !important;
       min-height: 28px !important;
       max-height: 28px !important;
       padding: 0 !important;
       border-radius: 8px;
       border: 1px solid rgba(255, 255, 255, 0.16);
       background: rgba(255, 255, 255, 0.06);
       color: var(--muted);
       cursor: pointer;
       transition: all 0.16s ease;
     }
     .watch-stock-remove:hover {
       color: #fff;
       background: #a82e38;
       border-color: #d14954;
     }
     ```

---

### Task 4: Khôi phục Kính mờ (Spatial Glassmorphism) & Chiều sâu 2.5D
* **File cần sửa**: `src/v4-design.css` và `src/ui-polish.css`.
* **Mô tả chi tiết**:
  1. Xóa bỏ dòng `.app-shell :is(.panel,.metric-card,.overview-kpi) { backdrop-filter: none; }` trong `src/v4-design.css`.
  2. Bổ sung hiệu ứng viền sáng phản quang mép kính (specular top highlight) và đổ bóng phân tầng:
     ```css
     .app-shell :is(.panel, .overview-kpi, .core-engine-section, .auth-card) {
       backdrop-filter: blur(16px) saturate(180%);
       -webkit-backdrop-filter: blur(16px) saturate(180%);
       background: color-mix(in srgb, var(--surface) 88%, transparent);
       border: 1px solid var(--line);
       border-radius: 18px;
       box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.28), inset 0 1px 0 0 rgba(255, 255, 255, 0.1);
     }

     .app-shell :is(.metric-card, .watch-stock, .core-pack-card) {
       backdrop-filter: blur(12px);
       -webkit-backdrop-filter: blur(12px);
       background: color-mix(in srgb, var(--surface-2) 90%, transparent);
       border: 1px solid var(--line);
       border-radius: 14px;
       box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15), inset 0 1px 0 0 rgba(255, 255, 255, 0.05);
       transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.2s ease, box-shadow 0.2s ease;
     }

     .app-shell :is(.metric-card, .watch-stock, .core-pack-card):hover {
       border-color: var(--line-bright);
       transform: translateY(-2px);
       box-shadow: 0 8px 20px -2px rgba(0, 0, 0, 0.3), inset 0 1px 0 0 rgba(255, 255, 255, 0.12);
     }
     ```

---

### Task 5: Đại tu Độ tương phản & Màu sắc Light Theme (WCAG AAA)
* **File cần sửa**: `src/light-theme.css`.
* **Mô tả chi tiết**:
  1. Điều chỉnh Color Tokens cho Light Theme:
     ```css
     :root[data-theme="light"] {
       color-scheme: light;
       --bg: #f4f7f5;
       --surface: #ffffff;
       --surface-2: #eaf1ec;
       --surface-3: #dee9e1;
       --line: #cadad0;
       --line-bright: #9ebbb0;
       --text: #0d1f17;         /* Tương phản 14.8:1 trên nền trắng */
       --muted: #244333;        /* Tương phản 6.8:1 - cực kỳ sắc sảo, chống mờ */
       --lime: #3a5c00;
       --mint: #066944;
       --red: #a81c33;
       --amber: #754e00;
       --elevation-1: 0 2px 6px rgba(13, 31, 23, 0.06), 0 1px 2px rgba(13, 31, 23, 0.04);
       --elevation-2: 0 8px 24px -4px rgba(13, 31, 23, 0.09), 0 2px 6px rgba(13, 31, 23, 0.04);
       --elevation-3: 0 16px 40px -8px rgba(13, 31, 23, 0.14);
     }
     ```
  2. Bổ sung rule áp chế triệt để các mã màu chữ Dark Mode bị sót:
     ```css
     html[data-theme="light"] :is(.muted, .eyebrow, small, time, .zone-meta, .metric-card > span, .pattern-row small, .stock-heading p, .event-row span, .event-row small, .sidebar-note small) {
       color: var(--muted) !important;
       font-weight: 500;
     }

     html[data-theme="light"] :is(strong, b, h1, h2, h3, h4, .brand, .brand-copy) {
       color: var(--text) !important;
     }

     html[data-theme="light"] .core-toggle:not(.is-on) {
       background: #cbdcd1 !important;
       border-color: #a4bea9 !important;
     }
     html[data-theme="light"] .core-toggle:not(.is-on) i {
       background: #ffffff !important;
     }
     ```

---

### Task 6: Tối ưu Khoảng cách (8-pt Rhythm) & Hiệu ứng đàn hồi Xúc giác
* **File cần sửa**: `src/ui-polish.css`.
* **Mô tả chi tiết**:
  1. Nới rộng khoảng thở cho các card bị bí:
     ```css
     .metric-card {
       padding: 16px 18px !important;
       gap: 8px;
     }
     .watch-stock {
       padding: 16px !important;
       gap: 10px !important;
     }
     ```
  2. Bổ sung hiệu ứng lún nút xúc giác khi nhấn (Haptic Spring Press Feedback):
     ```css
     .app-shell :is(.primary-button, .secondary-button, .icon-button, .watch-stock, .theme-toggle, .screener-toolbar-chips button, .timeframe-tabs button):active {
       transform: scale(0.975);
       transition: transform 0.08s cubic-bezier(0.34, 1.56, 0.64, 1);
     }
     ```

---

### Task 7: Giảm tải nhận thức — Thêm Executive Takeaway Banner
* **File cần sửa**: `src/components/AnalysisPage.tsx`.
* **Mô tả chi tiết**:
  1. Viết một hàm helper thuần túy sinh câu tóm tắt hành động tiếng Việt dựa vào `snapshot`:
     ```tsx
     function generateExecutiveSummary(snapshot: any): string {
       if (!snapshot) return 'Đang cập nhật đánh giá tổng hợp sau phiên...'
       const trend = snapshot.trend_state === 'UP' ? 'Xu hướng tăng duy trì tốt' : snapshot.trend_state === 'DOWN' ? 'Xu hướng điều chỉnh giảm' : 'Trạng thái đi ngang tích lũy'
       const flow = snapshot.cmf20 > 0.05 ? 'dòng tiền vào chủ động chiếm ưu thế' : snapshot.cmf20 < -0.05 ? 'áp lực cung ngắn hạn còn cao' : 'dòng tiền ở mức cân bằng'
       return `${trend}; ${flow}. Khuyến nghị bám sát các mốc hỗ trợ - kháng cự để tối ưu điểm mở vị thế.`
     }
     ```
  2. Render banner tóm lược ngay phía trên `.metric-grid`:
     ```tsx
     <div className="analysis-executive-takeaway">
       <span className="takeaway-tag">💡 Tóm lược nhanh</span>
       <p>{generateExecutiveSummary(snapshot)}</p>
     </div>
     ```
  3. Thêm style cho banner trong `src/styles.css` (hoặc `src/ui-polish.css`):
     ```css
     .analysis-executive-takeaway {
       display: flex;
       align-items: center;
       gap: 12px;
       margin-bottom: 14px;
       padding: 12px 16px;
       border-radius: 12px;
       background: color-mix(in srgb, var(--mint) 10%, transparent);
       border: 1px solid color-mix(in srgb, var(--mint) 30%, transparent);
       color: var(--text);
       font-size: 13px;
       line-height: 1.5;
     }
     .takeaway-tag {
       flex-shrink: 0;
       font-weight: 700;
       color: var(--mint);
       font-size: 12px;
     }
     .analysis-executive-takeaway p {
       margin: 0;
     }
     ```

---

## 3. TIÊU CHÍ NGHIỆM THU (ACCEPTANCE CRITERIA)
1. **Kiểm tra biên dịch**: Chạy `npm run build` không xuất hiện bất kỳ cảnh báo hoặc lỗi TypeScript/Vite nào.
2. **Kiểm tra trực quan Switch & Buttons**:
   - Nút gạt `.core-toggle` có kích thước chuẩn `44x26px`, hình viên nhộng hoàn hảo, viên bi `i` nằm chính xác ở giữa trục dọc cả khi BẬT lẫn TẮT.
   - Nút X `.watch-stock-remove` luôn là hình vuông chuẩn `28x28px`.
3. **Kiểm tra Typography**: Font chữ hiển thị mềm mại, bo tròn (`Plus Jakarta Sans` / `Inter`), không còn font `Segoe UI` thô cứng trên Windows.
4. **Kiểm tra Light Theme**: Toàn bộ chữ phụ, nhãn, ngày tháng, thông số đọc rõ nét trên nền sáng, không còn cảm giác bị phủ sương mờ.
5. **Hiệu ứng & Chiều sâu**: Các khối panel có kính mờ sang trọng, viền sáng mép trên tinh tế theo phong cách Apple/macOS hiện đại.
