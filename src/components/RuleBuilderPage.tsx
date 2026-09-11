import { FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Code2,
  GripVertical,
  MessageSquareText,
  Plus,
  Sparkles,
} from "lucide-react";
import { supabase } from "../lib/supabase";
type Condition = Record<string, string | number>;
function compileText(input: string) {
  const text = input.toLowerCase().replace(",", ".");
  const all: Condition[] = [];
  const breakout = text.match(/(?:vượt đỉnh|breakout)\s+(\d+)/);
  const volume = text.match(
    /(?:volume|khối lượng)\s+(?:lớn hơn|>)\s+(\d+(?:\.\d+)?)\s*lần/,
  );
  const rsi = text.match(
    /rsi(?:\s*14)?\s*(?:từ|trong khoảng)\s*(\d+(?:\.\d+)?)\s*(?:đến|-)\s*(\d+(?:\.\d+)?)/,
  );
  if (breakout)
    all.push({ metric: "close", op: "breakout_high", lookback: +breakout[1] });
  if (volume)
    all.push({ metric: "volume_ratio20", op: ">", value: +volume[1] });
  if (/ma\s*20\s*>\s*ma\s*50\s*>\s*ma\s*200/.test(text))
    all.push({ metric: "ma_stack", op: "bullish" });
  if (rsi)
    all.push({ metric: "rsi14", op: "between", min: +rsi[1], max: +rsi[2] });
  const stop = text.match(/(?:stop-loss|cắt lỗ)\s*(\d+(?:\.\d+)?)\s*%/);
  if (stop)
    all.push({ metric: "return_from_entry", op: "<=", value: -+stop[1] / 100 });
  if (!all.length)
    throw new Error(
      "Chưa nhận ra điều kiện. Dùng breakout, volume, MA, RSI hoặc stop-loss.",
    );
  return {
    version: 1,
    action: /stop-loss|cắt lỗ/.test(text)
      ? "EXIT"
      : /bán|thoát/.test(text)
        ? "REDUCE"
        : "PROBE_BUY",
    timeframe: text.includes("tuần") ? "W" : text.includes("tháng") ? "M" : "D",
    all,
  };
}
async function sha256(value: string) {
  const data = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(data))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
const chips = [
  "Breakout đỉnh 20 phiên",
  "Volume > 1.5 lần",
  "MA20 > MA50 > MA200",
  "RSI từ 45 đến 70",
  "Cắt lỗ 7%",
];
const visual = [
  {
    tone: "price",
    title: "Điều kiện giá",
    text: "Giá đóng cửa · Vượt đỉnh · 20 phiên",
  },
  {
    tone: "volume",
    title: "Khối lượng xác nhận",
    text: "Volume · > · 1.5 × Trung bình 20 phiên",
  },
  {
    tone: "indicator",
    title: "Chỉ báo động lượng",
    text: "RSI 14 · Trong khoảng · 45–70",
  },
  { tone: "risk", title: "Quản trị rủi ro", text: "Stop Loss · 7% từ giá vốn" },
];

const corePackContents: Record<string, string[]> = {
  "Prot Core Engine v1.0": [
    "Mua nền tích lũy xác nhận · volume > 1,5× · RSI 40–75",
    "Mua hai đáy xác nhận · volume > 1,3× · RSI 40–75",
    "Theo dõi tam giác tăng khi setup sẵn sàng",
    "Giảm tỷ trọng khi hai đỉnh bearish xác nhận",
  ],
  "Prot Core Engine v2.0": [
    "Ladder ưu tiên: EXIT → REDUCE → ADD / PROBE BUY → WATCH",
    "Gates: đa khung D/W/M, market regime và tập trung ngành",
    "Mẫu hình, volume, thanh khoản, RSI, MA-stack và Relative Strength",
  ],
  "Prot Core Pack · Hồi về hỗ trợ (Pullback Continuation, khung Ngày)": [
    "Xu hướng: mã đang tăng trên khung Ngày (trend_state = UP tính từ các đường MA của chính mã)",
    "Vùng hồi: giá đóng cửa Ngày nằm trong ±2% quanh EMA20 (Ngày) hoặc ±3% quanh SMA50 (Ngày)",
    "Nến kích hoạt: nến Ngày gần nhất đóng cửa xanh, kèm nến đảo chiều tăng (nhấn chìm/pin bar) hoặc khối lượng Ngày ≥ trung bình 20 phiên — không cần đột biến như mẫu hình breakout khác",
    "Dừng lỗ tham khảo: SMA50 (Ngày) trừ 3% — giá đóng cửa xuống dưới mức này coi như setup thất bại",
  ],
};

function statusCopy(status: string, kind: string) {
  if (status === "ACTIVE")
    return { label: "ĐANG BẬT", detail: "Được chạy trong EOD", tone: "on" };
  if (status === "ARCHIVED" && kind === "CORE_PACK")
    return {
      label: "CHƯA KÍCH HOẠT",
      detail: "Có sẵn nhưng chưa tham gia EOD",
      tone: "off",
    };
  if (status === "ARCHIVED")
    return {
      label: "LƯU TRỮ",
      detail: "Chỉ giữ lịch sử, không chạy",
      tone: "archived",
    };
  return {
    label: "ĐÃ TẮT",
    detail: "Tạm dừng, giữ nguyên cấu hình",
    tone: "off",
  };
}

export function RuleBuilderPage({ authenticated }: { authenticated: boolean }) {
  const client = useQueryClient();
  const [name, setName] = useState("Breakout có xác nhận");
  const [input, setInput] = useState(
    "Mua khi giá đóng cửa vượt đỉnh 20 phiên, volume lớn hơn 1.5 lần, MA20 > MA50 > MA200 và RSI từ 45 đến 70",
  );
  const [mode, setMode] = useState<"language" | "visual">("language");
  const [message, setMessage] = useState("");
  const [toast, setToast] = useState("");
  const [expandedPack, setExpandedPack] = useState<string | null>(null);
  const preview = useMemo(() => {
    try {
      return { dsl: compileText(input), error: "" };
    } catch (error) {
      return { dsl: null, error: (error as Error).message };
    }
  }, [input]);
  const rules = useQuery({
    queryKey: ["rules"],
    enabled: authenticated && Boolean(supabase),
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("rules")
        .select(
          "id,name,input_text,status,kind,pack_version,notification_mode,created_at",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const engineRuns = useQuery({
    queryKey: ["engine-run-summaries"],
    enabled: authenticated && Boolean(supabase),
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("engine_run_summaries")
        .select("rule_id,evaluated_count,emitted_count,contributed_count,trading_date,created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    if (!supabase || !preview.dsl) {
      setToast("Kết nối Supabase để lưu rule");
      setTimeout(() => setToast(""), 2500);
      return;
    }
    const { data: rule, error } = await supabase
      .from("rules")
      .insert({ name, input_text: input, status: "ACTIVE", kind: "USER_RULE" })
      .select("id")
      .single();
    if (error) return setMessage(error.message);
    const canonical = JSON.stringify(preview.dsl);
    const { error: versionError } = await supabase
      .from("rule_versions")
      .insert({
        rule_id: rule.id,
        version: 1,
        dsl: preview.dsl,
        compiled_hash: await sha256(canonical),
      });
    if (versionError) return setMessage(versionError.message);
    setMessage("Đã lưu rule version 1.");
    setToast("Rule đã được lưu và kích hoạt");
    setTimeout(() => setToast(""), 3000);
    client.invalidateQueries({ queryKey: ["rules"] });
  }
  function addChip(chip: string) {
    setInput(
      (value) =>
        `${value.trim().replace(/[,.]$/, "")}, ${chip.charAt(0).toLowerCase() + chip.slice(1)}`,
    );
  }
  async function toggleRule(rule: {
    id: string;
    status: string;
    name: string;
  }) {
    if (!supabase) return;
    const status = rule.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    const { error } = await supabase
      .from("rules")
      .update({ status })
      .eq("id", rule.id);
    if (error) return setToast(error.message);
    setToast(`${rule.name}: ${status === "ACTIVE" ? "đã bật" : "đã tắt"}`);
    setTimeout(() => setToast(""), 3000);
    client.invalidateQueries({ queryKey: ["rules"] });
  }
  const corePacks = (rules.data ?? []).filter(
    (rule) => rule.kind === "CORE_PACK",
  );
  const userRules = (rules.data ?? []).filter(
    (rule) => rule.kind !== "CORE_PACK",
  );
  const latestRunByRule = useMemo(
    () => Object.fromEntries((engineRuns.data ?? []).map((run: any) => [run.rule_id, run])),
    [engineRuns.data],
  );
  const highlighted = preview.dsl
    ? JSON.stringify(preview.dsl, null, 2)
        .replace(/("[^"]+")(?=\s*:)/g, '<span class="dsl-key">$1</span>')
        .replace(/:\s*("[^"]+")/g, ': <span class="dsl-string">$1</span>')
        .replace(
          /:\s*(-?\d+(?:\.\d+)?)/g,
          ': <span class="dsl-number">$1</span>',
        )
    : "—";
  return (
    <section className="workspace-page">
      <span className="eyebrow">RULE ENGINE · VERSIONED DSL</span>
      <div className="page-title-row">
        <div>
          <h1>Rule Studio</h1>
          <p className="muted">
            Chuyển kỷ luật giao dịch thành điều kiện có thể kiểm chứng.
          </p>
        </div>
        <span className="trend-badge up">
          <CheckCircle2 size={14} /> DSL hợp lệ
        </span>
      </div>
      <div className="rule-mode-tabs">
        <button
          className={mode === "language" ? "active" : ""}
          onClick={() => setMode("language")}
        >
          <MessageSquareText size={15} /> Ngôn ngữ tự nhiên
        </button>
        <button
          className={mode === "visual" ? "active" : ""}
          onClick={() => setMode("visual")}
        >
          <GripVertical size={15} /> Visual blocks
        </button>
      </div>
      <section className="core-engine-section" aria-label="Core Engines">
        <div className="core-engine-heading">
          <div>
            <span className="eyebrow">CÁC NGUỒN TÍN HIỆU</span>
            <h2>Core Engines</h2>
            <p>
              Mỗi engine là một nguồn đánh giá độc lập. Toggle quyết định engine
              nào được chạy; resolver chỉ phân xử kết quả của các engine đang bật.
            </p>
          </div>
          <span>
            {corePacks.filter((pack) => pack.status === "ACTIVE").length}/
            {corePacks.length} ĐANG BẬT
          </span>
        </div>
        <div className="core-pack-list">
          {corePacks.map((pack) => {
            const state = statusCopy(pack.status, pack.kind);
            const expanded = expandedPack === pack.id;
            const details = corePackContents[pack.name] ?? [pack.input_text];
            const run = latestRunByRule[pack.id] as any;
            return (
              <article className={`core-pack-card ${state.tone}`} key={pack.id}>
                <div className="core-pack-main">
                  <button
                    type="button"
                    className={`core-toggle ${pack.status === "ACTIVE" ? "is-on" : ""}`}
                    role="switch"
                    aria-checked={pack.status === "ACTIVE"}
                    aria-label={`${pack.status === "ACTIVE" ? "Tắt" : "Bật"} ${pack.name}`}
                    onClick={() => toggleRule(pack)}
                  >
                    <i />
                  </button>
                  <div className="core-pack-copy">
                    <div>
                      <strong>{pack.name}</strong>
                      <em>{pack.pack_version}</em>
                    </div>
                    <small>{state.detail}</small>
                    <span className="engine-run-summary">{run ? `Lần ${run.trading_date}: đánh giá ${run.evaluated_count} · setup ${run.emitted_count} · đóng góp ${run.contributed_count}` : "Chưa có lượt chạy theo cơ chế toggle mới"}</span>
                  </div>
                  <span className={`core-status ${state.tone}`}>
                    {state.label}
                  </span>
                  <button
                    type="button"
                    className="core-expand"
                    aria-expanded={expanded}
                    onClick={() => setExpandedPack(expanded ? null : pack.id)}
                  >
                    {expanded ? "Thu gọn −" : "Xem logic +"}
                  </button>
                </div>
                {expanded && (
                  <div className="core-pack-details">
                    <span>THÀNH PHẦN / LOGIC</span>
                    <ul>
                      {details.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            );
          })}
        </div>
        {!rules.isLoading && !corePacks.length && (
          <p className="muted">
            Core Pack sẽ xuất hiện sau khi migration Tier 4 được áp dụng.
          </p>
        )}
      </section>
      <div className="analysis-columns">
        <form className="panel rule-form" onSubmit={save}>
          <label>
            Tên rule
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {mode === "language" ? (
            <>
              <label>
                Mô tả bằng lời
                <textarea
                  rows={8}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                />
              </label>
              <div className="prompt-chips">
                {chips.map((chip) => (
                  <button
                    type="button"
                    key={chip}
                    onClick={() => addChip(chip)}
                  >
                    <Plus size={12} /> {chip}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="visual-builder">
              {visual.map((item, index) => (
                <div
                  className={`condition-card ${item.tone}`}
                  draggable
                  key={item.title}
                >
                  <span>
                    <GripVertical size={17} />
                  </span>
                  <div>
                    <strong>
                      {index + 1}. {item.title}
                    </strong>
                    <small>{item.text}</small>
                  </div>
                </div>
              ))}
              <button type="button" className="secondary-button">
                <Plus size={14} /> Thêm điều kiện
              </button>
            </div>
          )}
          <button disabled={!preview.dsl}>
            <Sparkles size={15} /> Lưu và kích hoạt
          </button>
          {(message || preview.error) && (
            <p className={preview.error ? "form-error" : "form-ok"}>
              {preview.error || message}
            </p>
          )}
        </form>
        <article className="panel">
          <div className="panel-title">
            <h3>
              <Code2 size={16} /> Bản dịch có kiểm soát
            </h3>
            <span>DSL V1</span>
          </div>
          <pre
            className="dsl-preview"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
          <p className="muted">
            Engine chỉ chạy DSL đã kiểm tra, không thực thi code do AI tạo.
          </p>
        </article>
      </div>
      <article className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">LỚP BỔ SUNG</span>
            <h3>Rule Studio · Rules phụ</h3>
          </div>
          <span>{userRules.length} RULE</span>
        </div>
        <p className="muted">
          Các rule này ghi nhận điều kiện riêng của Prot; chúng không thay thế
          thứ tự ưu tiên hoặc risk gate của Core Engine.
        </p>
        {userRules.map((rule) => {
          const state = statusCopy(rule.status, rule.kind);
          return (
            <div className="rule-row" key={rule.id}>
              <div>
                <strong>{rule.name}</strong>
                <small>{rule.input_text}</small>
              </div>
              <div className="rule-row-actions">
                <span className={`rule-status ${state.tone}`}>
                  {state.label}
                </span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => toggleRule(rule)}
                >
                  {rule.status === "ACTIVE" ? "Tắt" : "Bật"}
                </button>
              </div>
            </div>
          );
        })}
        {!rules.isLoading && !userRules.length && (
          <p className="muted">
            Chưa có Rule Studio bổ sung. Core Engine vẫn hoạt động độc lập.
          </p>
        )}
      </article>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </section>
  );
}
