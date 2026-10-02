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
import { compileRuleText, explainRule } from "../lib/ruleDsl";
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
    id: "price",
    tone: "price",
    title: "Điều kiện giá",
    text: "Giá đóng cửa · Vượt đỉnh · 20 phiên",
  },
  {
    id: "volume",
    tone: "volume",
    title: "Khối lượng xác nhận",
    text: "Volume · > · 1.5 × Trung bình 20 phiên",
  },
  {
    id: "indicator",
    tone: "indicator",
    title: "Chỉ báo động lượng",
    text: "RSI 14 · Trong khoảng · 45–70",
  },
  { id: "risk", tone: "risk", title: "Quản trị rủi ro", text: "Stop Loss · 7% từ giá vốn" },
];

function visualInput(conditionIds: string[]) {
  const clauses = [
    conditionIds.includes("price") && "giá đóng cửa vượt đỉnh 20 phiên",
    conditionIds.includes("volume") && "volume lớn hơn 1.5 lần",
    conditionIds.includes("indicator") && "RSI từ 45 đến 70",
    conditionIds.includes("risk") && "cắt lỗ 7%",
  ].filter(Boolean);
  return clauses.length ? `Mua khi ${clauses.join(", ")}` : "";
}

import { compareEngines, engineGuides } from "../lib/engineCatalog";
import { formatDate } from "../lib/date";
const corePackContents: Record<string, string[]> = {
  "Prot Core Engine v0.0": [
    "Research-first: chỉ tạo evidence rõ ràng; mặc định không gửi Telegram",
    "Một cấu trúc chỉ có một mẫu hình chủ đạo để tránh trùng tín hiệu",
    "Confluence chỉ tính bằng chứng độc lập, không cộng điểm khi trùng v2.0",
  ],
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

const classicalModels = [
  { id: "flat_base", label: "Breakout nền phẳng", detail: "Nền chặt, volume co hẹp, breakout xác nhận" },
  { id: "flag_pennant", label: "Cờ tăng / Pennant", detail: "Cột cờ rõ, điều chỉnh nông, breakout có volume" },
  { id: "double_bottom", label: "Hai đáy", detail: "Đảo chiều tăng khi vượt neckline" },
  { id: "double_top", label: "Hai đỉnh", detail: "Cảnh báo giảm tỷ trọng khi thủng neckline" },
  { id: "head_shoulders", label: "Vai đầu vai / Ngược", detail: "Neckline, cấu trúc ba pivot và volume xác nhận" },
  { id: "cup_handle", label: "Cốc tay cầm / Đáy tròn", detail: "Miệng cốc cân đối, tay cầm nông hoặc nền tròn, breakout có volume" },
];
const coreEngineOrder = [
  "Prot Core Engine v0.0",
  "Prot Core Engine v1.0",
  "Prot Core Engine v2.0",
];
const corePackOrder = [
  "Prot Core Pack · Pullback Continuation",
  "Prot Core Pack · Hồi về hỗ trợ (Pullback Continuation, khung Ngày)",
  "Prot Core Pack · VCP Breakout",
  "Prot Core Pack · RSI MACD Divergence",
  "Prot Core Pack · Relative Strength Leader",
  "Prot Core Pack · Wyckoff Context",
  "Prot Core Pack · T+ Pullback",
];
const coreEngineLabels: Record<string, string> = {
  core_ladder_v1: "Prot Core Engine v1.0",
  core_ladder_v2: "Prot Core Engine v2.0",
  classical_patterns_v0: "Prot Core Engine v0.0",
};
const coreEngineNames = new Set(coreEngineOrder);
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
    label: status === "DRAFT" ? "BẢN NHÁP" : "ĐÃ TẮT",
    detail: status === "DRAFT" ? "Kiểm tra trước khi bật" : "Tạm dừng, giữ nguyên cấu hình",
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
  const [visualConditions, setVisualConditions] = useState<string[]>(() => visual.map((item) => item.id));
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [expandedPack, setExpandedPack] = useState<string | null>(null);
  const preview = useMemo(() => {
    try {
      return { dsl: compileRuleText(input), error: "" };
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
          "id,name,input_text,status,kind,pack_version,notification_mode,created_at,rule_versions(id,dsl,version)",
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
    if (saving) return;
    setMessage(""); setFormError("");
    if (!supabase || !preview.dsl) return setFormError("Kết nối dữ liệu và kiểm tra điều kiện trước khi lưu.");
    if (!name.trim()) return setFormError("Nhập tên cho quy tắc.");
    setSaving(true);
    try {
      const { data: rule, error } = await supabase.from("rules")
        .insert({ name: name.trim(), input_text: input, status: "DRAFT", kind: "USER_RULE" }).select("id").single();
      if (error) return setFormError(error.message);
      const { error: versionError } = await supabase.from("rule_versions").insert({
        rule_id: rule.id, version: 1, dsl: preview.dsl, compiled_hash: await sha256(JSON.stringify(preview.dsl)),
      });
      if (versionError) {
        await client.invalidateQueries({ queryKey: ["rules"] });
        return setFormError("Bản nháp chưa có phiên bản hoàn chỉnh và chưa được bật. " + versionError.message);
      }
      setMessage("Đã lưu bản nháp phiên bản 1. Kiểm tra lời giải thích trước khi bật.");
      setToast("Đã lưu bản nháp; chưa chạy trong EOD");
      setTimeout(() => setToast(""), 3000);
      await client.invalidateQueries({ queryKey: ["rules"] });
    } catch {
      setFormError("Chưa lưu được bản nháp. Kiểm tra kết nối rồi thử lại.");
    } finally { setSaving(false); }
  }
  function addChip(chip: string) {
    setInput(
      (value) =>
        `${value.trim().replace(/[,.]$/, "")}, ${chip.charAt(0).toLowerCase() + chip.slice(1)}`,
    );
  }
  function setVisualCondition(id: string) {
    const next = visualConditions.includes(id)
      ? visualConditions.filter((item) => item !== id)
      : [...visualConditions, id];
    setVisualConditions(next);
    setInput(visualInput(next));
  }
  function addSuggestedCondition() {
    const next = visual.find((item) => !visualConditions.includes(item.id));
    if (next) setVisualCondition(next.id);
  }
  async function toggleRule(rule: {
    id: string;
    status: string;
    name: string;
    rule_versions?: unknown[];
  }) {
    if (!supabase) return;
    if (rule.status === "ARCHIVED" || rule.name === "Prot Core Pack · Phân kỳ Dương MACD") return setToast("Quy tắc đã lưu trữ hoặc chỉ dùng nghiên cứu; không thể bật lại từ giao diện.");
    if (rule.status !== "ACTIVE" && !rule.rule_versions?.length) return setToast("Bản nháp thiếu phiên bản hoàn chỉnh; chưa thể bật.");
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
  async function toggleClassicalModel(pack: any, model: string) {
    const version = [...(pack.rule_versions ?? [])].sort((a,b)=>b.version-a.version)[0];
    if (pack.status === "ARCHIVED" || pack.name === "Prot Core Pack · Phân kỳ Dương MACD") return setToast("Core Pack chỉ dùng nghiên cứu hoặc đã lưu trữ; không thay đổi ở đây.");
    if (!supabase || !version) return setToast("Chưa tìm thấy cấu hình v0.0");
    const models = version.dsl?.overrides?.models ?? {};
    const dsl = { ...version.dsl, overrides: { ...(version.dsl?.overrides ?? {}), models: { ...models, [model]: models[model] === false } } };
    const { error } = await supabase.from("rule_versions").insert({
      rule_id: pack.id, version: version.version + 1, dsl, compiled_hash: await sha256(JSON.stringify(dsl)),
    });
    if (error) { client.invalidateQueries({ queryKey: ["rules"] }); return setToast("Chưa lưu được phiên bản mới: " + error.message); }
    const label = classicalModels.find((item) => item.id === model)?.label ?? model;
    setToast(`${label}: ${dsl.overrides.models[model] ? "đã bật" : "đã tắt"}`);
    setTimeout(() => setToast(""), 3000);
    client.invalidateQueries({ queryKey: ["rules"] });
  }
  const corePacks = (rules.data ?? []).filter(
    (rule) => rule.kind === "CORE_PACK" && rule.name !== 'Prot Core Pack · Phân kỳ Dương MACD' && rule.status !== "ARCHIVED",
  );
  const sortedCorePacks = [...corePacks].sort(compareEngines);
  const userRules = (rules.data ?? []).filter(
    (rule) => rule.kind !== "CORE_PACK",
  );
  const latestRunByRule = useMemo(
    () => Object.fromEntries([...(engineRuns.data ?? [])].reverse().map((run: any) => [run.rule_id, run])),
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

      <div className="page-title-row">
        <div>
          <h1>Thiết lập quy tắc</h1>
          <p className="muted">
            Chuyển kỷ luật giao dịch thành điều kiện có thể kiểm chứng.
          </p>
        </div>
        <span className="trend-badge up">
          <CheckCircle2 size={14} /> {preview.dsl ? "Đã hiểu các điều kiện" : "Cần chỉnh điều kiện"}
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
          <GripVertical size={15} /> Khối điều kiện
        </button>
      </div>
      <p className="rule-mode-help">
        {mode === "language"
          ? "Viết bằng các điều kiện hỗ trợ. Phần chưa hiểu sẽ được báo rõ; quy tắc mới luôn được lưu thành bản nháp."
          : "Chọn các khối điều kiện có sẵn. DSL xem trước và nút lưu sẽ cập nhật ngay theo các khối đang dùng."}
      </p>
      {rules.isError && <p className="form-error" role="alert">Chưa tải được quy tắc. Kiểm tra kết nối và thử tải lại.</p>}
      <section className="core-engine-section" aria-label="Bộ máy tín hiệu">
        <div className="core-engine-heading">
          <div>

            <h2>Bộ máy tín hiệu</h2>
            <p>
              Mỗi bộ máy là một nguồn đánh giá độc lập. Nút bật/tắt quyết định bộ máy
              nào được chạy; bộ tổng hợp chỉ phân xử kết quả của các bộ máy đang bật.
            </p>
          </div>
          <span>
            {corePacks.filter((pack) => pack.status === "ACTIVE").length}/
            {corePacks.length} đang bật
          </span>
        </div>
        <div className="core-pack-list">
          {sortedCorePacks.map((pack) => {
            const state = statusCopy(pack.status, pack.kind);
            const expanded = expandedPack === pack.id;
            const guide = engineGuides.find(item => item.name === pack.name);
            const details = guide ? [guide.detail] : corePackContents[pack.name] ?? [pack.input_text];
            const run = latestRunByRule[pack.id] as any;
            const version = [...((pack as any).rule_versions ?? [])].sort((a,b)=>b.version-a.version)[0];
            const modelStates = version?.dsl?.overrides?.models ?? {};
            const isEngine = coreEngineNames.has(pack.name);
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
                    <span className="core-role">
                      {isEngine ? "Nguồn đề xuất · qua bộ lọc chung" : "Pack độc lập · qua bộ lọc chung"}
                    </span>
                    {run ? (
                      <span className="engine-run-summary">
                        <b>{run.evaluated_count}</b> đánh giá · <b>{run.emitted_count}</b> setup ·{" "}
                        <b>{run.contributed_count}</b> đóng góp <i>({formatDate(run.trading_date)})</i>
                      </span>
                    ) : (
                      <span className="engine-run-summary muted">
                        Chưa có lượt chạy được ghi nhận
                      </span>
                    )}
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
                    <span>Thành phần / logic</span>
                    <ul>
                      {details.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                    {pack.name === "Prot Core Engine v0.0" && (
                      <div className="classical-model-list">
                        <span>Mô hình đang tham gia</span>
                        {classicalModels.map((model) => {
                          const enabled = modelStates[model.id] !== false;
                          return <div className="classical-model-row" key={model.id}>
                            <div><strong>{model.label}</strong><small>{model.detail}</small></div>
                            <button type="button" className={`core-toggle ${enabled ? "is-on" : ""}`} role="switch" aria-checked={enabled} aria-label={`${enabled ? "Tắt" : "Bật"} ${model.label}`} onClick={() => toggleClassicalModel(pack, model.id)}><i /></button>
                          </div>;
                        })}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
        {!rules.isLoading && !corePacks.length && (
          <p className="muted">
            Chưa có Core Pack khả dụng. Kiểm tra kết nối hoặc tải lại.
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
                <button
                  type="button"
                  className={`condition-card ${item.tone} ${visualConditions.includes(item.id) ? "selected" : ""}`}
                  aria-pressed={visualConditions.includes(item.id)}
                  onClick={() => setVisualCondition(item.id)}
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
                  <em>{visualConditions.includes(item.id) ? "Đang dùng" : "Thêm"}</em>
                </button>
              ))}
              {visualConditions.length < visual.length && <button type="button" className="secondary-button" onClick={addSuggestedCondition}>
                <Plus size={14} /> Thêm điều kiện gợi ý
              </button>}
            </div>
          )}
          <button disabled={saving || !preview.dsl || !name.trim()}>
            <Sparkles size={15} /> {saving ? "Đang lưu…" : "Lưu bản nháp"}
          </button>
          {(message || formError || preview.error) && (
            <p className={preview.error || formError ? "form-error" : "form-ok"} role={preview.error || formError ? "alert" : "status"}>
              {preview.error || formError || message}
            </p>
          )}
        </form>
        <article className="panel">
          <div className="panel-title">
            <h3>
              <Code2 size={16} /> Bản dịch có kiểm soát
            </h3>
          </div>
          {preview.dsl && <><p>Hành động: {preview.dsl.action === "WATCH" ? "Theo dõi" : preview.dsl.action === "PROBE_BUY" ? "Mua thăm dò" : preview.dsl.action === "EXIT" ? "Thoát vị thế" : "Giảm tỷ trọng"} · Khung {preview.dsl.timeframe}</p><ul className="reason-list">{explainRule(preview.dsl).map((line, index) => <li key={index}>{line}</li>)}</ul></>}
          <details><summary>Chi tiết quy tắc</summary><pre
            className="dsl-preview"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          /></details>
          <p className="muted">
            Tất cả điều kiện cần đồng thời thỏa mãn. Quy tắc đang bật vẫn đi qua kiểm tra dữ liệu và rủi ro chung.
          </p>
        </article>
      </div>
      <article className="panel">
        <div className="panel-title">
          <div>

            <h3>Quy tắc tuỳ chỉnh</h3>
          </div>
          <span>{userRules.length} QUY TẮC</span>
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
            Chưa có quy tắc tuỳ chỉnh. Các bộ máy tín hiệu vẫn hoạt động độc lập.
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
