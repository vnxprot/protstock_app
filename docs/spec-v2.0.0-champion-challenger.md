# ĐẶC TẢ KỸ THUẬT TOÀN DIỆN: PROT STOCK v2.0.0
## KIẾN TRÚC SONG MÃ CHAMPION – CHALLENGER (SHADOW MODE / A-B TESTING)
### TÍCH HỢP ĐẦY ĐỦ LỘ TRÌNH 4 BƯỚC ĐỊNH LƯỢNG

- **Mã định danh:** `SPEC-PROTSTOCK-V2.0.0-FULL`
- **Phiên bản:** `2.0.0-RELEASE-CANDIDATE`
- **Ngày hoàn thiện:** `2026-10-06`
- **Trạng thái:** `Đặc tả kỹ thuật đầy đủ (Complete Technical Specification)`
- **Phạm vi triển khai:** Backend Pipeline (Python), Data Contracts (Supabase/Postgres), Frontend Web/PWA (TypeScript/React), Testing Suites.

---

## MỤC LỤC
1. [Tổng quan Kiến trúc & Nguyên tắc Vận hành v2.0.0](#1-tổng-quan-kiến-trúc--nguyên-tắc-vận-hành-v200)
2. [Bước 1: Chuẩn hóa Bộ máy Backtest & Ràng buộc T+](#2-bước-1-chuẩn-hóa-bộ-máy-backtest--ràng-buộc-t)
3. [Bước 2: Đo lường Định lượng & Kiểm toán Hiện trạng Champion](#3-bước-2-đo-lường-định-lượng--kiểm-toán-hiện-trạng-champion)
4. [Bước 3: Nâng cấp Công cụ Hỗ trợ Quyết định & UI Triage / Watch](#4-bước-3-nâng-cấp-công-cụ-hỗ-trợ-quyết-định--ui-triage--watch)
5. [Bước 4: Bộ máy Challenger v2 & Màn hình Đối chiếu A/B Testing](#5-bước-4-bộ-máy-challenger-v2--màn-hình-đối-chiếu-ab-testing)
6. [Thiết kế Cơ sở Dữ liệu & Schema Revisions](#6-thiết-kế-cơ-sở-dữ-liệu--schema-revisions)
7. [Ma trận Kiểm thử & Tiêu chuẩn Nghiệm thu Toàn diện](#7-ma-trận-kiểm-thử--tiêu-chuẩn-nghiệm-thu-toàn-diện)

---

## 1. TỔNG QUAN KIẾN TRÚC & NGUYÊN TẮC VẬN HÀNH v2.0.0

### 1.1. Sơ đồ Kiến trúc Toàn diện (End-to-End Architecture)
Hệ thống vận hành theo nguyên tắc: **Chung dữ liệu đầu vào EOD – Tách đôi luồng xử lý định lượng – Lưu trữ phân tách phiên bản – Tích hợp hiển thị đối chiếu A/B trên giao diện.**

```
                                  DỮ LIỆU ĐẦU VÀO EOD BATCH
                         (OHLCV theo universe hiện hành, VN-Index, Breadth)
                                            │
                     ┌──────────────────────┴──────────────────────┐
                     ▼                                             ▼
        ┌─────────────────────────┐                   ┌─────────────────────────┐
        │     LUỒNG CHAMPION      │                   │    LUỒNG CHALLENGER     │
        │      (v1.0 BASELINE)    │                   │     (v2.0 SHADOW)       │
        ├─────────────────────────┤                   ├─────────────────────────┤
        │ • Bộ lọc an toàn chuẩn  │                   │ • Early Entry MACD/Zone │
        │ • Consolidated Engine   │                   │ • Dynamic Liquidity Tier│
        │ • Giữ nguyên logic cũ   │                   │ • Lọc xa nền (>7%)      │
        │ • Ra quyết định thật    │                   │ • Thích ứng pha Sideway │
        └────────────┬────────────┘                   └────────────┬────────────┘
                     │                                             │
                     ▼                                             ▼
        ┌─────────────────────────┐                   ┌─────────────────────────┐
        │  signals / evaluations  │                   │  challenger_assessments │
        │ (version: 'core-v1.0')  │                   │(version: 'challenger-v2')│
        └────────────┬────────────┘                   └────────────┬────────────┘
                     │                                             │
                     └──────────────────────┬──────────────────────┘
                                            ▼
                      ┌───────────────────────────────────────────┐
                      │        GIAO DIỆN SCREENER & WATCHLIST     │
                      ├───────────────────────────────────────────┤
                      │ • Thẻ trạng thái lô hàng T+0, T+1, T_READY│
                      │ • Điểm ngành (Sector Health & Flow Share) │
                      │ • Nút gạt chế độ: Champion | Challenger  │
                      │ • Head-to-Head Split View (Đối chiếu A/B) │
                      │ • Bảng điểm định lượng (Battle Scorecard) │
                      └───────────────────────────────────────────┘
```

### 1.2. Ranh giới Sản phẩm (Product Boundary Invariants)
* **Chỉ xử lý cuối ngày (EOD batch processing):** Không tạo kết nối websocket hay streaming dữ liệu intraday trong phiên. Giữ vững hạ tầng GitHub Actions + Supabase + Vercel.
* **Không làm ô nhiễm dữ liệu thật:** Mọi tín hiệu của Challenger ở trạng thái Shadow; không tự ý tạo giao dịch hay điều chỉnh danh mục thực tế của người dùng.

---

## 2. BƯỚC 1: CHUẨN HÓA BỘ MÁY BACKTEST & RÀNG BUỘC T+

### 2.1. File mục tiêu
* [`pipeline/protstock/backtest.py`](file:///D:/CODE/P_projects/protstock_app/pipeline/protstock/backtest.py)
* [`tests/test_backtest.py`](file:///D:/CODE/P_projects/protstock_app/tests/test_backtest.py)

### 2.2. Logic Ràng buộc Thanh toán T+2.5 Chuẩn Việt Nam (`settlement_model: "T_PLUS_VIETNAM"`)
Theo quy chế VSDC hiện hành (áp dụng từ 29/08/2022), chu kỳ thanh toán là **T+1.5 (thường gọi là T+2.5)**:
1. **Dòng thời gian sở hữu & khả dụng:**
   * **Ngày $T$ (Khớp mua, ví dụ Thứ 2):** Khớp lệnh (Open hoặc trong phiên). Trạng thái `T0_LOCKED`. Hoàn toàn không thể bán.
   * **Ngày $T+1$ (Thứ 3):** Cổ phiếu đang bù trừ thanh toán. Trạng thái `T1_LOCKED`. Hoàn toàn không thể bán.
   * **Ngày $T+2$ (Thứ 4 - Phiên T+2.5):**
     * *Buổi sáng (09h00 - 11h30):* Cổ phiếu chưa về tài khoản. Vẫn bị khóa bán.
     * *Buổi trưa (11h30 - 12h00):* VSDC hoàn tất phân bổ cổ phiếu vào tài khoản nhà đầu tư.
     * *Buổi chiều (13h00 - 14h45):* **CỔ PHIẾU ĐÃ CHÍNH THỨC KHẢ DỤNG ĐỂ BÁN!** Nhà đầu tư có toàn quyền bán trong phiên khớp lệnh liên tục hoặc phiên ATC đóng cửa.
   * **Ngày $T+3$ (Thứ 5):** Khả dụng bán toàn thời gian (từ phiên ATO sáng).

2. **Cơ chế Khớp lệnh & Xử lý Vi phạm trong Backtest EOD:**
   * **Thời gian kẹp hàng thực sự (Locked Risk Window):** Chỉ kéo dài từ phiên $T$ đến hết sáng $T+2$ (tương đương 1.5 phiên giao dịch).
   * **Xử lý vi phạm Stop-loss trong thời gian kẹp:**
     * Nếu giá đóng cửa ngày $T$ hoặc $T+1$ xuyên thủng Stop-loss / Invalidation: Hệ thống **BỊ KẸP CỨNG**, không thể bán. Ghi nhận vi phạm `LOCKED_STOP_BREACH`.
     * **Thời điểm bán giải chấp sớm nhất:** Chính là **phiên chiều ngày $T+2$ (khớp tại giá Close/ATC ngày $T+2$)** vì lúc này hàng đã về tài khoản! Hoặc nếu mô hình EOD ra tín hiệu sau 15h00 ngày $T+2$, lệnh bán tiêu chuẩn sẽ khớp tại **$T+3$ Open**.
   * **Tùy chọn Khớp lệnh khi Hàng về (`settlement_exit_timing`):**
     * `T2_CLOSE`: Cho phép bán khẩn cấp/cắt lỗ ngay tại giá Close (ATC) chiều $T+2$ khi hàng vừa về.
     * `NEXT_OPEN`: Bán tại phiên Open sáng $T+3$ (sau khi tín hiệu EOD chiều $T+2$ được tính toán).

3. **Cập nhật `BacktestAssumptions`:**
   ```python
   @dataclass(frozen=True)
   class BacktestAssumptions:
       initial_capital: float = 100_000_000
       fee_rate: float = 0.0015             # 0.15% phí giao dịch mua/bán
       sell_tax_rate: float = 0.001         # 0.10% thuế TNCN khi bán
       slippage_rate: float = 0.001         # 0.10% trượt giá
       stop_loss_pct: float = 0.07          # 7% stop loss mặc định
       trailing_stop_pct: float = 0.10      # 10% trailing stop
       time_stop_bars: int = 20             # 20 phiên nắm giữ tối đa
       risk_pct: float = 1.0                # 1% NAV risk per trade
       lot_size: int = 100                  # Lô chẵn 100 CP
       max_sector_weight_pct: float = 30.0  # Tối đa 30% NAV/ngành
       settlement_days: float = 2.0         # Chu kỳ T+2.5 (hàng về chiều T+2)
       settlement_model: str = "T_PLUS_VIETNAM" # hoặc "NOT_MODELLED" để đối chứng
   ```

4. **Chỉ số rủi ro kẹp hàng bổ sung vào `metrics`:**
   * `t_plus_win_rate`: Tỷ lệ % lệnh có lãi tại thời điểm hàng vừa khả dụng bán (tính theo giá Close chiều $T+2$).
   * `locked_drawdown_max`: Mức sụt giảm tài sản lớn nhất xảy ra trong giai đoạn kẹp hàng (từ ngày mua $T$ đến hết sáng $T+2$).
   * `locked_stop_breach_count`: Số lệnh bị thủng mức cắt lỗ trong khi chưa đủ điều kiện bán (ngày $T$ hoặc $T+1$).


---

## 3. BƯỚC 2: ĐO LƯỜNG ĐỊNH LƯỢNG & KIỂM TOÁN HIỆN TRẠNG CHAMPION

### 3.1. File mục tiêu
* Tạo module kiểm toán: `pipeline/protstock/audit_champion_baseline.py`
* Tài liệu kết quả: `docs/champion-baseline-audit-2026-10.md`

### 3.2. Nội dung kiểm toán thực nghiệm
Chạy hồi cứu toàn bộ universe hiện hành (275 mã tại ngày 06/10/2026) từ `01/01/2025` đến phiên EOD mới nhất có dữ liệu xác minh, với bộ đo lường T+ đã chuẩn hóa ở Bước 1. Số mã được lấy từ manifest và Supabase tại thời điểm chạy, không cố định ở 272:
1. **Đo độ trễ điểm vào (Entry Lag Distribution):**
   * Tính khoảng cách $\% = (Price_{entry} - Price_{pivot}) / Price_{pivot}$ so với nền giá hoặc điểm breakout ban đầu.
   * Thống kê tỷ lệ các lệnh mua được kích hoạt khi giá đã tăng $> 5\%$, $> 8\%$, $> 12\%$ so với nền.
2. **Đo mức độ tổn thương trong chu kỳ T+:**
   * Thống kê `locked_drawdown_max` trung bình của các lệnh mua `core_ladder_v2` và `macd_bullish_divergence_v4`.
   * Tỷ lệ các lệnh dính bull-trap (có lãi ngày T nhưng lỗ khi hàng về ngày T+3).
3. **Phân rã hiệu suất theo Market Regime (VN-Index):**
   * Lợi suất, Win-rate, Profit Factor chia theo 3 trạng thái của VN-Index:
     * Khi VN-Index `UPTREND`
     * Khi VN-Index `SIDEWAYS`
     * Khi VN-Index `DOWNTREND`
   * Báo cáo này đóng vai trò là "Ground Truth" để thiết lập các ngưỡng kích hoạt của Challenger V2.

---

## 4. BƯỚC 3: NÂNG CẤP CÔNG CỤ HỖ TRỢ QUYẾT ĐỊNH & UI TRIAGE / WATCH

### 4.1. File mục tiêu
* [`src/lib/signalTriage.ts`](file:///D:/CODE/P_projects/protstock_app/src/lib/signalTriage.ts)
* [`src/components/SignalTriageTable.tsx`](file:///D:/CODE/P_projects/protstock_app/src/components/SignalTriageTable.tsx)
* [`pipeline/protstock/signal_policy.py`](file:///D:/CODE/P_projects/protstock_app/pipeline/protstock/signal_policy.py)
* [`pipeline/protstock/market_regime.py`](file:///D:/CODE/P_projects/protstock_app/pipeline/protstock/market_regime.py)

### 4.2. Chi tiết Tính năng
1. **Thanh khoản theo Quy mô Lệnh (Dynamic Liquidity Gate):**
   * Trong [`signal_policy.py`](file:///D:/CODE/P_projects/protstock_app/pipeline/protstock/signal_policy.py), thay thế hoặc bổ sung ngưỡng cứng `MIN_AVERAGE_TURNOVER_VND = 300_000_000`:
   * Tính `order_participation_rate = target_order_value / average_turnover_20`.
   * Nếu `order_participation_rate > 0.05` (lệnh chiếm $> 5\%$ thanh khoản trung bình phiên) hoặc turnover $< 1.000.000.000$ VND đối với tài khoản size lớn: gắn cờ cảnh báo `HIGH_PARTICIPATION_RISK`.
2. **Hiển thị Tuổi Lô Hàng Danh mục (Lot Vintage / Settlement Age):**
   * Trên Tab Watch (Signal Triage) và Portfolio, với các mã đang nắm giữ:
     * `T0`: Vừa mua trong ngày hôm nay.
     * `T1`: Đã qua 1 đêm, còn 1 phiên chờ hàng về.
     * `T2`: Hàng về phiên chiều.
     * `T_READY`: Cổ phiếu đã khả dụng bán hoàn toàn.
3. **Cảnh báo Giá Đi Xa Nền (`BASE_EXTENSION_WARNING`):**
   * Đo khoảng cách từ giá đóng cửa hiện tại tới điểm pivot/invalidation price:
     $$\Delta_{base} = \frac{\text{Close} - \text{Base Price}}{\text{Base Price}} \times 100\%$$
   * Nếu $\Delta_{base} > 7.0\%$, hiển thị huy hiệu cảnh báo `EXTENDED (+X%)` màu hổ phách/cam để ngăn chặn việc mua đuổi giá.
4. **Tích hợp Sức mạnh Ngành (Sector Breadth & Flow Momentum) vào Xếp hạng Triage:**
   * [`src/lib/signalTriage.ts`](file:///D:/CODE/P_projects/protstock_app/src/lib/signalTriage.ts) nhận thêm dữ liệu `market_health_score` và `turnover_share_pct` của từng ngành từ `market_regime.py`.
   * Thêm điểm thưởng (Bonus Priority Score) cho các mã thuộc nhóm ngành đang dẫn dắt thị trường (Top 3 ngành có điểm sức khỏe cao nhất và dòng tiền vào ròng).

---

## 5. BƯỚC 4: BỘ MÁY CHALLENGER v2 & MÀN HÌNH ĐỐI CHIẾU A/B TESTING

### 5.1. File mục tiêu
* Backend: [`pipeline/protstock/engines.py`](file:///D:/CODE/P_projects/protstock_app/pipeline/protstock/engines.py), [`pipeline/protstock/eod.py`](file:///D:/CODE/P_projects/protstock_app/pipeline/protstock/eod.py), [`pipeline/protstock/challenger_engine.py`](file:///D:/CODE/P_projects/protstock_app/pipeline/protstock/challenger_engine.py).
* Frontend: [`src/components/SignalFunnelPanel.tsx`](file:///D:/CODE/P_projects/protstock_app/src/components/SignalFunnelPanel.tsx), [`src/components/DualEngineComparePanel.tsx`](file:///D:/CODE/P_projects/protstock_app/src/components/DualEngineComparePanel.tsx), [`src/components/ScreenerPage.tsx`](file:///D:/CODE/P_projects/protstock_app/src/components/ScreenerPage.tsx).

### 5.2. Thuật toán của Engine Challenger V2 (Shadow Engine)
Challenger V2 tập trung giải quyết các điểm nghẽn đã đo được ở Bước 2:
1. **Tách biệt Tầng Nhận diện & Tầng Vào lệnh sớm (Early MACD Zone):**
   * Khi [`macd_divergence_zones.py`](file:///D:/CODE/P_projects/protstock_app/pipeline/protstock/macd_divergence_zones.py) đánh dấu `CONFIRMED` (giá vượt viền cổ/trigger), Challenger cho phép phát tín hiệu thăm dò `EARLY_PROBE` ngay cả khi `breakout_volume_ratio20` chưa đạt ngưỡng trần (thay vì chờ volume bùng nổ đẩy giá tăng thêm $5-7\%$).
   * Tín hiệu này gắn tag `risk_tier: "SPECULATIVE"` và giới hạn quy mô vị thế ở mức $30\%$ sizing bình thường.
2. **Bộ lọc Thích ứng Pha Thị trường (Adaptive Sideway Filter):**
   * Khi VN-Index ở trạng thái `SIDEWAYS`:
     * Tự động loại bỏ các tín hiệu Breakout vượt đỉnh 20 phiên (vì tỷ lệ thất bại cao đã chứng minh ở Bước 2).
     * Ưu tiên các tín hiệu mua tại hỗ trợ / biên dưới Wyckoff Accumulation hoặc Spring.
3. **Bộ chặn Cứng Xa Nền (Base Distance Hard Gate):**
   * Từ chối toàn bộ lệnh mua mới nếu khoảng cách tới `invalidation_price` $> 8.0\%$.

### 5.3. Giao diện Đối chiếu Song song (Head-to-Head A/B Dashboard)
1. **Thanh điều hướng Switcher:**
   * `[ 🛡️ Champion (v1.0) ]`: Chế độ sản xuất an toàn mặc định.
   * `[ ⚡ Challenger (v2.0) ]`: Chế độ xem các cơ hội của engine nâng cấp.
   * `[ ⚔️ Đối chiếu Song mã (Split View) ]`: Màn hình so sánh trực tiếp.
2. **Cấu trúc Bảng Đối chiếu Split-View:**
   * Cột hiển thị: `Mã CP`, `Tín hiệu Champion`, `Tín hiệu Challenger`, `Độ lệch (Delta Insight)`, `Khoảng cách Nền`, `Sức mạnh Ngành`, `Trạng thái T+`.
   * Gắn nhãn Insight:
     * `ALIGNED`: Cả hai engine cùng đồng thuận báo mua.
     * `EARLY_LEAD`: Challenger phát hiện sớm hơn trước $N$ phiên.
     * `CHASE_BLOCKED`: Challenger chặn mua do Champion mua quá xa nền.
     * `SIDEWAY_REJECTED`: Challenger loại bỏ bẫy breakout khi thị trường đi ngang.
3. **Bảng điểm Định lượng Đối đầu (Battle Scorecard):**
   * Tự động tính toán và hiển thị widget so sánh định lượng:
     $$\text{Win Rate @ } T+3 \quad \vert \quad \text{Locked Drawdown} \quad \vert \quad \text{Profit Factor} \quad \vert \quad \text{Alpha Chênh lệch}$$

---

## 6. THIẾT KẾ CƠ SỞ DỮ LIỆU & SCHEMA REVISIONS

### 6.1. Bảng lưu trữ Tín hiệu Challenger (`challenger_signal_assessments`)
Để cách ly hoàn toàn dữ liệu với Champion, tạo migration lưu trữ riêng:
```sql
CREATE TABLE IF NOT EXISTS challenger_signal_assessments (
    id BIGSERIAL PRIMARY KEY,
    symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    trading_date DATE NOT NULL,
    engine_version VARCHAR(32) NOT NULL DEFAULT 'v2.0-challenger',
    action VARCHAR(16) NOT NULL, -- PROBE_BUY, WATCH, EXIT
    reasons TEXT[] NOT NULL DEFAULT '{}',
    base_price NUMERIC(12, 2),
    distance_to_base_pct NUMERIC(6, 2),
    invalidation_price NUMERIC(12, 2),
    confidence_score NUMERIC(5, 2),
    evidence JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_challenger_signal UNIQUE (symbol_id, trading_date, engine_version)
);

CREATE INDEX IF NOT EXISTS idx_challenger_date_action ON challenger_signal_assessments (trading_date, action);
```

---

## 7. MA TRẬN KIỂM THỬ & TIÊU CHUẨN NGHIỆM THU TOÀN DIỆN

### 7.1. Bộ Kiểm thử Tự động (Automated Test Matrix)
1. **Python Unit & Regression Tests:**
   * `tests/test_backtest.py`:
     * Test case: Cổ phiếu mua ngày $T$ bị breach stop ở $T+1 \rightarrow$ không thể bán trước $T+3$ Open.
     * Test case: Tính toán chính xác `locked_drawdown_max` trong chu kỳ kẹp.
     * Test case: Khớp đúng thuế $0.1\%$, phí $0.15\%$ và trượt giá $0.1\%$.
   * `tests/test_challenger_engine.py`:
     * Test case: Tín hiệu Early MACD sinh ra đúng khi giá đóng cửa break trigger.
     * Test case: Tín hiệu Breakout bị từ chối khi thị trường Sideway và giá đã cách nền $> 7\%$.
2. **Frontend TypeScript & Vitest/Node Tests:**
   * `npm run build`: Không có bất kỳ lỗi TypeScript nào (`tsc --noEmit`).
   * `npm run test:signals`: Xác nhận thuật toán phân nhóm tín hiệu Triage hiển thị đúng nhãn T+ và cảnh báo xa nền.
3. **Data & Pipeline Integrity:**
   * Toàn bộ pipeline EOD chạy hoàn tất không sinh cảnh báo `CRASH` hay xung đột schema.
   * Dữ liệu Champion trong bảng `signals` giữ nguyên tính toàn vẹn 100%.

---
*(Hết tài liệu đặc tả - Prot Stock Engineering Team)*
