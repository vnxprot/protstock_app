import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownAZ, Download, Filter, Search } from "lucide-react";
import { supabase } from "../lib/supabase";
export function ScreenerPage({ authenticated }: { authenticated: boolean }) {
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("ALL");
  const [minScore, setMinScore] = useState(0);
  const [descending, setDescending] = useState(true);
  const signals = useQuery({
    queryKey: ["signals"],
    enabled: authenticated && Boolean(supabase),
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("signals")
        .select(
          "id,as_of_date,timeframe,action,score,reasons,symbols(symbol,sector),rule_versions(rules(name))",
        )
        .order("as_of_date", { ascending: false })
        .order("score", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
  const source = (signals.data ?? []) as any[];
  const rows = useMemo(
    () =>
      source
        .filter(
          (item) =>
            (!query ||
              item.symbols?.symbol
                .toLowerCase()
                .includes(query.toLowerCase())) &&
            (action === "ALL" || item.action === action) &&
            item.score >= minScore,
        )
        .sort((a, b) => (b.score - a.score) * (descending ? 1 : -1)),
    [source, query, action, minScore, descending],
  );
  function exportCsv() {
    const csv = [
      "Mã,Hành động,Khung,Điểm,Ngày,Rule",
      ...rows.map((x) =>
        [
          x.symbols?.symbol,
          x.action,
          x.timeframe,
          x.score,
          x.as_of_date,
          x.rule_versions?.rules?.name,
        ].join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob(["\ufeff" + csv], { type: "text/csv" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "protstock-signals.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="workspace-page">
      <span className="eyebrow">SCREENER · EOD SIGNALS</span>
      <div className="page-title-row">
        <div>
          <h1>Bộ lọc tín hiệu</h1>
          <p className="muted">
          Thu hẹp 202 mã thành danh sách hành động sau phiên.
          </p>
        </div>
        <button className="secondary-button export-button" onClick={exportCsv}>
          <Download size={15} /> Xuất CSV
        </button>
      </div>
      <div className="filter-bar">
        <label>
          <Search size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm mã…"
          />
        </label>
        <label>
          <Filter size={15} />
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="ALL">Mọi hành động</option>
            {["PROBE_BUY", "ADD", "WATCH", "REDUCE", "EXIT"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Điểm ≥{" "}
          <input
            type="number"
            min="0"
            max="100"
            value={minScore}
            onChange={(e) => setMinScore(+e.target.value)}
          />
        </label>
        <button onClick={() => setDescending((v) => !v)}>
          <ArrowDownAZ size={15} /> Điểm{" "}
          {descending ? "cao → thấp" : "thấp → cao"}
        </button>
      </div>
      <article className="panel">
        <div className="panel-title">
          <h3>Kết quả rule đang bật</h3>
          <span>{rows.length} TÍN HIỆU</span>
        </div>
        <div className="data-table screener-table">
          <div className="table-head">
            <span>Mã</span>
            <span>Hành động</span>
            <span>Khung</span>
            <span>Điểm</span>
            <span>Lý do</span>
            <span>Ngày</span>
          </div>
          {rows.map((signal) => (
            <a
              href="#analysis"
              className="position-row"
              key={signal.id}
              onClick={() =>
                localStorage.setItem("protstock-symbol", signal.symbols?.symbol)
              }
            >
              <strong>
                {signal.symbols?.symbol}
                <small>{signal.symbols?.sector}</small>
              </strong>
              <span className="action-pill">{signal.action}</span>
              <span>{signal.timeframe}</span>
              <b>{signal.score}</b>
              <span>
                {signal.reasons?.join(" · ") ||
                  signal.rule_versions?.rules?.name}
              </span>
              <span>{signal.as_of_date}</span>
            </a>
          ))}
        </div>
        {!rows.length && (
          <p className="muted">Không có tín hiệu khớp bộ lọc hiện tại.</p>
        )}
      </article>
    </section>
  );
}
