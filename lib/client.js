// dsh-token-usage — browser half.
//
// Client plugin for the DeepSeek Harness web GUI with two surfaces:
//   1. A compact per-session token pill in the session header utilities row
//      (`conversation.session.header.utilities`) with a click-to-open
//      breakdown, driven by the `tokenUsage` / `contextPressure` /
//      `contextBreakdown` / `sessionStats` session projections pushed to the
//      browser as `session/projection` frames (produced by
//      @deepseek-ai/dsh-token-meter and @deepseek-ai/dsh-session-stats).
//   2. A global consumption panel (`sidebar.footer.action`) showing daily
//      totals and per-model breakdowns, fetched from the host half's
//      GET /api/token-stats (lib/index.js scans the session logs).
//
// This file is served as a classic script at /plugins/dsh-token-usage/client.js
// and registers its factory through window.__ModuleLoader__.load(). The
// factory may only require the platform seed words (react, react/jsx-runtime,
// @deepseek-ai/cordis, ...) plus whatever the `dsh.client.inject` edges have
// registered — here we only need react.
window.__ModuleLoader__.load({
  id: "dsh-token-usage",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");
    var jsxRuntime = require("react/jsx-runtime");
    var jsx = jsxRuntime.jsx;
    var jsxs = jsxRuntime.jsxs;

    // ── styles ─────────────────────────────────────────────────────────────
    // Injected like the shipped bundles: a <style> tag claimed by this plugin
    // (data-plugin / data-plugin-css), themed through the DSW CSS variables.
    var css =
      ".tu_badge{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;" +
      "border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;" +
      "color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family);font-size:12px;" +
      "line-height:26px;white-space:nowrap;cursor:pointer;transition:background .12s,color .12s}" +
      ".tu_badge:hover,.tu_badge:focus-visible{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}" +
      ".tu_badge:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}" +
      ".tu_seg{display:inline-flex;align-items:baseline;gap:3px}" +
      ".tu_segLabel{color:var(--dsw-alias-label-tertiary);font-size:11px}" +
      ".tu_segValue{color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono);font-size:12px;font-variant-numeric:tabular-nums}" +
      ".tu_sep{color:var(--dsw-alias-label-dimmed);font-size:11px}" +
      ".tu_root{position:relative}" +
      ".tu_panel{position:absolute;top:calc(100% + 6px);right:0;z-index:100;box-sizing:border-box;" +
      "width:min(340px,calc(100vw - 32px));background:var(--dsw-specific-menu);" +
      "border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:var(--dsw-shadow-lv3);" +
      "padding:12px 14px;display:flex;flex-direction:column;gap:12px}" +
      ".tu_group{display:flex;flex-direction:column;gap:2px}" +
      ".tu_groupTitle{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;letter-spacing:.04em;text-transform:uppercase}" +
      ".tu_row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:12px;line-height:20px}" +
      ".tu_rowLabel{color:var(--dsw-alias-label-secondary)}" +
      ".tu_rowValue{color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono);font-variant-numeric:tabular-nums}" +
      ".tu_meter{height:4px;border-radius:999px;background:var(--dsw-alias-fill-l2);overflow:hidden}" +
      ".tu_meterFill{height:100%;border-radius:999px;background:var(--dsw-alias-label-secondary)}" +
      ".tu_meterFillHigh{background:#e5484d}" +
      ".tu_hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}" +
      ".tu_sideAction{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:10px;" +
      "color:var(--dsw-alias-label-secondary);cursor:pointer;background:transparent;border:0;flex:none}" +
      ".tu_sideAction:hover,.tu_sideAction:focus-visible{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}" +
      ".tu_sideActionWide{width:100%;justify-content:flex-start;gap:8px;padding:0 12px}" +
      ".tu_sideLabel{font-size:13px;line-height:20px}" +
      ".tu_overlay{position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.45)}" +
      ".tu_card{box-sizing:border-box;width:min(1040px,100%);max-height:min(86vh,760px);overflow:auto;display:flex;" +
      "flex-direction:column;gap:16px;background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-l2);" +
      "border-radius:16px;box-shadow:var(--dsw-shadow-lv3);padding:20px 24px}" +
      ".tu_cardHeader{display:flex;align-items:center;gap:10px}" +
      ".tu_cardTitle{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:22px;flex:1}" +
      ".tu_cardMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}" +
      ".tu_iconBtn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;" +
      "color:var(--dsw-alias-label-secondary);cursor:pointer;background:transparent;border:1px solid transparent;font-size:15px;line-height:1}" +
      ".tu_iconBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}" +
      ".tu_cards{display:flex;flex-wrap:wrap;gap:10px}" +
      ".tu_cardStat{flex:1;min-width:110px;display:flex;flex-direction:column;gap:2px;background:var(--dsw-alias-fill-l2);border-radius:10px;padding:10px 12px}" +
      ".tu_cardStatLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}" +
      ".tu_cardStatValue{color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono);font-size:17px;line-height:24px;font-variant-numeric:tabular-nums}" +
      ".tu_section{display:flex;flex-direction:column;gap:8px}" +
      ".tu_sectionTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px}" +
      ".tu_chart{display:flex;align-items:flex-end;gap:3px;height:120px}" +
      ".tu_bar{flex:1;min-width:2px;border-radius:3px 3px 0 0;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 60%,transparent);cursor:pointer;position:relative}" +
      ".tu_bar:hover{background:var(--dsw-alias-label-secondary)}" +
      ".tu_barToday{background:var(--dsw-alias-label-secondary)}" +
      ".tu_barEmpty{background:var(--dsw-alias-fill-l2);cursor:default}" +
      ".tu_chartX{display:flex;gap:3px;font-size:10px;color:var(--dsw-alias-label-tertiary);line-height:14px}" +
      ".tu_chartX span{flex:1;text-align:center;white-space:nowrap;overflow:hidden}" +
      ".tu_sectionTitleRow{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".tu_rangeWrap{display:flex;align-items:center;gap:6px}" +
      ".tu_dateInput{box-sizing:border-box;height:26px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;" +
      "background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:26px;font-family:var(--dsw-font-mono)}" +
      ".tu_dateInput:focus-visible{outline:1px solid var(--dsw-alias-label-secondary)}" +
      ".tu_rangeSep{color:var(--dsw-alias-label-tertiary);font-size:12px}" +
      ".tu_rangeReset{height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;" +
      "color:var(--dsw-alias-label-secondary);font-size:12px;line-height:26px;cursor:pointer}" +
      ".tu_rangeReset:hover,.tu_rangeReset:focus-visible{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}" +
      ".tu_table{display:flex;flex-direction:column;gap:2px}" +
      ".tu_tableHead{display:flex;align-items:center;gap:10px;font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:18px;padding:0 8px}" +
      ".tu_tableRow{display:flex;align-items:center;gap:10px;font-size:12px;line-height:22px;padding:2px 8px;border-radius:8px}" +
      ".tu_tableRow:hover{background:var(--dsw-alias-fill-l2)}" +
      ".tu_colModel{flex:2.2;min-width:0;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono);font-size:11px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}" +
      ".tu_colNum{flex:1;min-width:52px;text-align:right;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-mono);font-variant-numeric:tabular-nums}" +
      ".tu_colShare{flex:1.2;min-width:80px;display:flex;align-items:center;gap:6px}" +
      ".tu_colShareBar{flex:1;height:4px;border-radius:999px;background:var(--dsw-alias-fill-l2);overflow:hidden}" +
      ".tu_colShareFill{height:100%;border-radius:999px;background:var(--dsw-alias-label-secondary)}" +
      ".tu_colShareText{color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums;min-width:36px;text-align:right}" +
      ".tu_colModels{flex:2.6;min-width:0;color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}" +
      ".tu_status{display:flex;align-items:center;justify-content:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;padding:32px 0}" +
      ".tu_spinner{width:14px;height:14px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-secondary);animation:tu_spin .8s linear infinite}" +
      ".tu_error{color:#e5484d}" +
      ".tu_footer{display:flex;align-items:center;justify-content:flex-end;gap:8px}" +
      ".tu_barOpen{box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-label-secondary) 45%,transparent)}" +
      ".tu_dayGroup{display:flex;flex-direction:column}" +
      ".tu_dayRowBtn{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;font:inherit;color:inherit;text-align:left;background:transparent;border:0;border-radius:8px;padding:2px 8px;cursor:pointer}" +
      ".tu_dayRowBtn:hover{background:var(--dsw-alias-fill-l2)}" +
      ".tu_colDay{flex:2.2;min-width:0;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono);font-size:11px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}" +
      ".tu_colChevron{flex:none;width:16px;color:var(--dsw-alias-label-tertiary);font-size:10px;text-align:center}" +
      ".tu_dayModels{display:flex;flex-direction:column;gap:2px;margin:2px 0 4px 18px;padding:6px 8px 6px 12px;" +
      "border-left:2px solid var(--dsw-alias-border-l2);border-radius:0 10px 10px 0;background:var(--dsw-alias-bg-layer-1)}" +
      ".tu_hintMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}" +
      ".tu_hourBlock{display:flex;flex-direction:column;gap:4px;margin-top:8px;padding:10px 12px;" +
      "border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}" +
      ".tu_hourTitle{color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600;line-height:18px}" +
      ".tu_hourChart{display:flex;align-items:flex-end;gap:2px;height:84px}" +
      ".tu_hbar{flex:1;min-width:2px;border-radius:2px 2px 0 0;cursor:pointer;position:relative;" +
      "background:color-mix(in srgb,var(--dsw-alias-label-secondary) 50%,transparent)}" +
      ".tu_hbar:not(.tu_barEmpty):hover{background:var(--dsw-alias-label-secondary)}" +
      ".tu_modelsToggle{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;font:inherit;color:inherit;text-align:left;" +
      "background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 12px;cursor:pointer}" +
      ".tu_modelsToggle:hover{background:var(--dsw-alias-interactive-bg-hover)}" +
      ".tu_modelsToggleTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px}" +
      ".tu_modelsToggleSummary{flex:1;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      "@keyframes tu_spin{to{transform:rotate(360deg)}}";
    var tagId = "dsh-token-usage/token-usage.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-token-usage";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }
    var styles = {
      badge: "tu_badge",
      seg: "tu_seg",
      segLabel: "tu_segLabel",
      segValue: "tu_segValue",
      sep: "tu_sep",
      root: "tu_root",
      panel: "tu_panel",
      group: "tu_group",
      groupTitle: "tu_groupTitle",
      row: "tu_row",
      rowLabel: "tu_rowLabel",
      rowValue: "tu_rowValue",
      meter: "tu_meter",
      meterFill: "tu_meterFill",
      meterFillHigh: "tu_meterFillHigh",
      hint: "tu_hint",
      sideAction: "tu_sideAction",
      sideActionWide: "tu_sideActionWide",
      sideLabel: "tu_sideLabel",
      overlay: "tu_overlay",
      card: "tu_card",
      cardHeader: "tu_cardHeader",
      cardTitle: "tu_cardTitle",
      cardMeta: "tu_cardMeta",
      iconBtn: "tu_iconBtn",
      cards: "tu_cards",
      cardStat: "tu_cardStat",
      cardStatLabel: "tu_cardStatLabel",
      cardStatValue: "tu_cardStatValue",
      section: "tu_section",
      sectionTitle: "tu_sectionTitle",
      chart: "tu_chart",
      bar: "tu_bar",
      barToday: "tu_barToday",
      barEmpty: "tu_barEmpty",
      chartX: "tu_chartX",
      sectionTitleRow: "tu_sectionTitleRow",
      rangeWrap: "tu_rangeWrap",
      dateInput: "tu_dateInput",
      rangeSep: "tu_rangeSep",
      rangeReset: "tu_rangeReset",
      table: "tu_table",
      tableHead: "tu_tableHead",
      tableRow: "tu_tableRow",
      colModel: "tu_colModel",
      colNum: "tu_colNum",
      colShare: "tu_colShare",
      colShareBar: "tu_colShareBar",
      colShareFill: "tu_colShareFill",
      colShareText: "tu_colShareText",
      colModels: "tu_colModels",
      status: "tu_status",
      spinner: "tu_spinner",
      error: "tu_error",
      footer: "tu_footer",
      barOpen: "tu_barOpen",
      dayGroup: "tu_dayGroup",
      dayRowBtn: "tu_dayRowBtn",
      colDay: "tu_colDay",
      colChevron: "tu_colChevron",
      dayModels: "tu_dayModels",
      hintMeta: "tu_hintMeta",
      hourBlock: "tu_hourBlock",
      hourTitle: "tu_hourTitle",
      hourChart: "tu_hourChart",
      hbar: "tu_hbar",
      modelsToggle: "tu_modelsToggle",
      modelsToggleTitle: "tu_modelsToggleTitle",
      modelsToggleSummary: "tu_modelsToggleSummary"
    };

    // ── formatting helpers ─────────────────────────────────────────────────
    /** "—" for anything that is not a finite number. */
    function num(value) {
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    }
    /** Full thousands-separated rendering. */
    function formatNumber(value) {
      var n = num(value);
      return n === null ? "—" : n.toLocaleString();
    }
    /** Compact 1.2k / 3.4M rendering for the badge. */
    function formatCompact(value) {
      var n = num(value);
      if (n === null) return "—";
      if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
      if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
      return String(n);
    }
    /** Wall time as "2h 5m" / "3m 12s" / "45s". */
    function formatMs(ms) {
      var n = num(ms);
      if (n === null) return "—";
      var total = Math.max(0, Math.floor(n / 1000));
      var seconds = total % 60;
      var minutes = Math.floor(total / 60) % 60;
      var hours = Math.floor(total / 3600);
      if (hours > 0) return hours + "h " + minutes + "m";
      if (minutes > 0) return minutes + "m " + seconds + "s";
      return seconds + "s";
    }
    /** Context occupancy percent (0-100), or null when unknown. */
    function contextPercent(pressure) {
      if (typeof pressure !== "object" || pressure === null) return null;
      var windowSize = num(pressure.contextWindow);
      var used = num(pressure.projectedTokens ?? pressure.pressureTokens);
      if (windowSize === null || windowSize <= 0 || used === null) return null;
      return Math.min(100, (used / windowSize) * 100);
    }
    /** Prompt-side provider tokens: uncached + cache read + cache write. */
    function promptTokens(usage) {
      if (typeof usage !== "object" || usage === null) return 0;
      return (num(usage.uncachedInputTokens) ?? 0) + (num(usage.cacheReadTokens) ?? 0) + (num(usage.cacheWriteTokens) ?? 0);
    }
    function outputTokensOf(usage) {
      return typeof usage === "object" && usage !== null ? num(usage.outputTokens) : null;
    }
    function totalTokens(usage) {
      return promptTokens(usage) + (outputTokensOf(usage) ?? 0);
    }
    /** Average first-token latency over the steps that reported one. */
    function averageTtft(stats) {
      var total = num(stats && stats.ttftMs);
      var steps = num(stats && stats.ttftSteps);
      if (total === null || steps === null || steps <= 0) return null;
      return total / steps;
    }
    /** One labeled row: label on the left, mono value on the right. */
    function Row({ label, value, title }) {
      return jsxs("div", {
        className: styles.row,
        children: [
          jsx("span", { className: styles.rowLabel, children: label }),
          jsx("span", {
            className: styles.rowValue,
            ...title === void 0 ? {} : { title },
            children: value
          })
        ]
      });
    }

    // ── the header pill ────────────────────────────────────────────────────
    /**
     * Compact per-session token readout in the session header utilities row.
     * Renders the provider token totals (in/out) plus the context occupancy
     * percent; clicking opens the full breakdown panel. Everything comes from
     * the framework session kit (sessionId, useProjection, t), so the plugin
     * keeps no mutable state of its own.
     */
    function TokenUsageBadge(props) {
      var sessionId = props.sessionId;
      var useProjection = props.useProjection;
      var t = props.t;
      var tokenUsage = useProjection("tokenUsage");
      var contextPressure = useProjection("contextPressure");
      var contextBreakdown = useProjection("contextBreakdown");
      var sessionStats = useProjection("sessionStats");
      var openState = React.useState(false);
      var open = openState[0];
      var setOpen = openState[1];
      var rootRef = React.useRef(null);
      var hasData = tokenUsage !== void 0 || contextPressure !== void 0 || contextBreakdown !== void 0 || sessionStats !== void 0;

      React.useEffect(function () {
        if (!open) return;
        var closeOutside = function (event) {
          if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
        };
        var closeEscape = function (event) {
          if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("pointerdown", closeOutside);
        document.addEventListener("keydown", closeEscape);
        return function () {
          document.removeEventListener("pointerdown", closeOutside);
          document.removeEventListener("keydown", closeEscape);
        };
      }, [open]);

      var input = promptTokens(tokenUsage);
      var output = outputTokensOf(tokenUsage);
      var total = totalTokens(tokenUsage);
      var pct = contextPercent(contextPressure);
      var windowSize = typeof contextPressure === "object" && contextPressure !== null ? num(contextPressure.contextWindow) : null;
      var usedTokens = typeof contextPressure === "object" && contextPressure !== null ? num(contextPressure.projectedTokens ?? contextPressure.pressureTokens) : null;
      var breakdownTotal = (function () {
        if (typeof contextBreakdown !== "object" || contextBreakdown === null) return null;
        var sys = num(contextBreakdown.systemTokens) ?? 0;
        var tools = num(contextBreakdown.toolsTokens) ?? 0;
        var msgs = num(contextBreakdown.messageTokens) ?? 0;
        return sys + tools + msgs;
      })();

      var badgeLabel = hasData
        ? t("badge.summary", {
            input: formatCompact(input),
            output: output === null ? "—" : formatCompact(output),
            pct: pct === null ? "—" : Math.round(pct) + "%"
          })
        : t("badge.empty");

      var badgeSegments = hasData ? [
        jsx("span", {
          className: styles.seg,
          children: [
            jsx("span", { className: styles.segLabel, children: t("seg.input") }),
            jsx("span", { className: styles.segValue, children: formatCompact(input) })
          ]
        }),
        jsx("span", { className: styles.sep, children: "·" }),
        jsx("span", {
          className: styles.seg,
          children: [
            jsx("span", { className: styles.segLabel, children: t("seg.output") }),
            jsx("span", { className: styles.segValue, children: output === null ? "—" : formatCompact(output) })
          ]
        }),
        jsx("span", { className: styles.sep, children: "·" }),
        jsx("span", {
          className: styles.seg,
          children: [
            jsx("span", { className: styles.segLabel, children: t("seg.context") }),
            jsx("span", { className: styles.segValue, children: pct === null ? "—" : Math.round(pct) + "%" })
          ]
        })
      ] : t("badge.empty");

      return jsxs("div", {
        ref: rootRef,
        className: styles.root,
        children: [
          jsxs("button", {
            type: "button",
            className: styles.badge,
            "aria-expanded": open,
            "aria-haspopup": "true",
            "aria-label": t("badge.aria"),
            title: t("badge.title"),
            onClick: function () {
              setOpen(function (current) { return !current; });
            },
            children: badgeSegments
          }),
          open ? jsxs("div", {
            className: styles.panel,
            role: "dialog",
            "aria-label": t("panel.aria"),
            children: [
              !hasData ? jsx("div", { className: styles.hint, children: t("panel.empty") }) : jsxs(React.Fragment, {
                children: [
                  jsxs("div", {
                    className: styles.group,
                    children: [
                      jsx("div", { className: styles.groupTitle, children: t("group.usage") }),
                      jsx(Row, { label: t("row.input.uncached"), value: formatNumber(tokenUsage && tokenUsage.uncachedInputTokens) }),
                      jsx(Row, { label: t("row.input.cacheRead"), value: formatNumber(tokenUsage && tokenUsage.cacheReadTokens) }),
                      jsx(Row, { label: t("row.input.cacheWrite"), value: formatNumber(tokenUsage && tokenUsage.cacheWriteTokens) }),
                      jsx(Row, { label: t("row.output"), value: formatNumber(output) }),
                      jsx(Row, { label: t("row.total"), value: formatNumber(total), title: badgeLabel })
                    ]
                  }),
                  jsxs("div", {
                    className: styles.group,
                    children: [
                      jsx("div", { className: styles.groupTitle, children: t("group.breakdown") }),
                      jsx(Row, { label: t("row.system"), value: formatNumber(contextBreakdown && contextBreakdown.systemTokens) }),
                      jsx(Row, { label: t("row.tools"), value: formatNumber(contextBreakdown && contextBreakdown.toolsTokens) }),
                      jsx(Row, { label: t("row.messages"), value: formatNumber(contextBreakdown && contextBreakdown.messageTokens) }),
                      jsx(Row, { label: t("row.total"), value: formatNumber(breakdownTotal) })
                    ]
                  }),
                  jsxs("div", {
                    className: styles.group,
                    children: [
                      jsx("div", { className: styles.groupTitle, children: t("group.pressure") }),
                      jsx(Row, { label: t("row.window"), value: windowSize === null ? "—" : formatNumber(windowSize) }),
                      jsx(Row, { label: t("row.pressure"), value: formatNumber(usedTokens) }),
                      jsx(Row, {
                        label: t("row.occupancy"),
                        value: pct === null ? "—" : pct.toFixed(1) + "%",
                        title: usedTokens === null || windowSize === null ? void 0 : t("row.occupancy.detail", { used: formatNumber(usedTokens), window: formatNumber(windowSize) })
                      }),
                      pct === null ? null : jsx("div", {
                        className: styles.meter,
                        children: jsx("div", {
                          className: styles.meterFill + (pct >= 85 ? " " + styles.meterFillHigh : ""),
                          style: { width: Math.max(2, pct) + "%" }
                        })
                      })
                    ]
                  }),
                  jsxs("div", {
                    className: styles.group,
                    children: [
                      jsx("div", { className: styles.groupTitle, children: t("group.stats") }),
                      jsx(Row, { label: t("row.turns"), value: formatNumber(sessionStats && sessionStats.turns) }),
                      jsx(Row, { label: t("row.steps"), value: formatNumber(sessionStats && sessionStats.steps) }),
                      jsx(Row, { label: t("row.llmTime"), value: formatMs(sessionStats && sessionStats.llmMs) }),
                      jsx(Row, { label: t("row.toolTime"), value: formatMs(sessionStats && sessionStats.toolMs) }),
                      jsx(Row, { label: t("row.ttft"), value: formatMs(averageTtft(sessionStats)) }),
                      jsx(Row, { label: t("row.decodeTokens"), value: formatNumber(sessionStats && sessionStats.decodeTokens) })
                    ]
                  })
                ]
              })
            ]
          }) : null
        ]
      });
    }

    // ── global stats panel ─────────────────────────────────────────────────
    /** Auto-refresh interval while the panel is open. */
    var REFRESH_MS = 60_000;
    /** Days shown in the bar chart and the "last N days" sums. */
    var CHART_DAYS = 30;

    /** Local calendar day key "YYYY-MM-DD" for a Date. */
    function localDayKey(d) {
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, "0");
      var day = String(d.getDate()).padStart(2, "0");
      return y + "-" + m + "-" + day;
    }
    /** Local calendar day key `offsetDays` away from today (0 = today, negative = past). */
    function dayKeyOf(offsetDays) {
      var d = new Date();
      d.setDate(d.getDate() + offsetDays);
      return localDayKey(d);
    }
    /** Index the byDay array by day key (null-safe: an absent payload indexes empty). */
    function indexByDay(byDay) {
      var index = {};
      if (!Array.isArray(byDay)) return index;
      for (var i = 0; i < byDay.length; i++) index[byDay[i].day] = byDay[i];
      return index;
    }
    /** Sum `days` of daily totals ending today (missing days count zero). */
    function sumLastDays(index, days) {
      var total = 0;
      for (var i = 0; i < days; i++) {
        var entry = index[dayKeyOf(-i)];
        if (entry !== void 0) total += entry.total;
      }
      return total;
    }
    /** Day key `delta` calendar days after `dayKey` (negative = before). */
    function addDays(dayKey, delta) {
      var d = new Date(dayKey + "T00:00:00");
      d.setDate(d.getDate() + delta);
      return localDayKey(d);
    }
    /** Whole days between two keys (b - a). */
    function diffDays(a, b) {
      var da = new Date(a + "T00:00:00");
      var db = new Date(b + "T00:00:00");
      return Math.round((db - da) / 86400000);
    }
    /** Inclusive [start, end] calendar range as chart cells (missing days render empty bars). */
    function buildRangeDays(index, start, end) {
      var cells = [];
      var len = diffDays(start, end);
      for (var i = 0; i <= len; i++) {
        var day = addDays(start, i);
        var entry = index[day];
        cells.push({
          day: day,
          total: entry === void 0 ? 0 : entry.total,
          isToday: day === dayKeyOf(0),
          isEmpty: entry === void 0 || entry.total === 0
        });
      }
      return cells;
    }
    /** Build 24 hourly slots (0-23) for a day's non-empty `hours` array. */
    function buildHourSlots(hours) {
      var byHour = {};
      if (Array.isArray(hours)) for (var i = 0; i < hours.length; i++) byHour[hours[i].hour] = hours[i];
      var slots = [];
      for (var h = 0; h < 24; h++) {
        var entry = byHour[h];
        slots.push({ hour: h, total: entry === void 0 ? 0 : entry.total, isEmpty: entry === void 0, entry: entry });
      }
      return slots;
    }
    /** Fetch the global stats payload from the host route. */
    function fetchStats(signal) {
      return fetch("/api/token-stats", { signal: signal, headers: { accept: "application/json" } })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        });
    }

    /**
     * Global token-consumption panel: daily totals with a 30-day bar chart,
     * per-model breakdown with share bars, and a per-day drilldown table.
     * Data comes from GET /api/token-stats (the host half scans the session
     * logs). Refreshes on open and every REFRESH_MS while mounted.
     */
    function GlobalStatsPanel({ onClose, t }) {
      var statePair = React.useState({ status: "loading", data: null, error: null });
      var state = statePair[0];
      var setState = statePair[1];
      var expandedPair = React.useState(null);
      var expandedDay = expandedPair[0];
      var setExpandedDay = expandedPair[1];
      var hourPair = React.useState(null);
      var hourDay = hourPair[0];
      var setHourDay = hourPair[1];
      var modelsPair = React.useState(false);
      var modelsOpen = modelsPair[0];
      var setModelsOpen = modelsPair[1];
      var rangePair = React.useState(function () { return { start: dayKeyOf(-(CHART_DAYS - 1)), end: dayKeyOf(0) }; });
      var range = rangePair[0];
      var setRange = rangePair[1];
      var refresh = React.useCallback(function () {
        var controller = new AbortController();
        setState({ status: "loading", data: null, error: null });
        fetchStats(controller.signal).then(
          function (data) {
            setState({ status: "ready", data: data, error: null });
          },
          function (error) {
            if (error && error.name === "AbortError") return;
            setState({ status: "error", data: null, error: error instanceof Error ? error.message : String(error) });
          }
        );
        return controller;
      }, []);

      React.useEffect(function () {
        var controller = refresh();
        var timer = setInterval(function () {
          controller = refresh();
        }, REFRESH_MS);
        return function () {
          clearInterval(timer);
          controller.abort();
        };
      }, [refresh]);

      React.useEffect(function () {
        var onKey = function (event) {
          if (event.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        return function () {
          document.removeEventListener("keydown", onKey);
        };
      }, [onClose]);

      var data = state.data;
      var totals = data == null ? null : data.totals;
      var byDay = data == null ? null : data.byDay;
      var byModel = data == null ? null : data.byModel;
      var byDayIndex = byDay == null ? null : indexByDay(byDay);
      var todayEntry = byDayIndex === null ? null : byDayIndex[dayKeyOf(0)];
      var weekTotal = byDayIndex === null ? 0 : sumLastDays(byDayIndex, 7);
      var chartDays = byDayIndex === null ? [] : buildRangeDays(byDayIndex, range.start, range.end);
      var maxDay = 1;
      for (var i = 0; i < chartDays.length; i++) if (chartDays[i].total > maxDay) maxDay = chartDays[i].total;
      var xStep = Math.max(1, Math.ceil(chartDays.length / 6));
      var selectedHasData = chartDays.some(function (cell) { return !cell.isEmpty; });
      var setStart = function (value) {
        if (!value) return;
        setRange(function (prev) { return { start: value > prev.end ? prev.end : value, end: prev.end }; });
      };
      var setEnd = function (value) {
        if (!value) return;
        var end = value > dayKeyOf(0) ? dayKeyOf(0) : value;
        setRange(function (prev) { return { start: end < prev.start ? end : prev.start, end: end }; });
      };
      var resetRange = function () {
        setRange({ start: dayKeyOf(-(CHART_DAYS - 1)), end: dayKeyOf(0) });
      };
      var hasAny = totals !== null && typeof totals.total === "number" && totals.total > 0;
      var hourEntryOf = byDayIndex === null || hourDay === null ? null : byDayIndex[hourDay];
      var hasHoursData = hourEntryOf !== null && hourEntryOf !== void 0 && Array.isArray(hourEntryOf.hours) && hourEntryOf.hours.length > 0;
      var hourSlots = hasHoursData ? buildHourSlots(hourEntryOf.hours) : [];
      var hourMax = 1;
      for (var hi = 0; hi < hourSlots.length; hi++) if (hourSlots[hi].total > hourMax) hourMax = hourSlots[hi].total;

      var statusNode;
      if (state.status === "loading") {
        statusNode = jsx("div", { className: styles.status, children: [jsx("span", { className: styles.spinner }), jsx("span", { children: t("global.loading") })] });
      } else if (state.status === "error") {
        statusNode = jsxs("div", {
          className: styles.status + " " + styles.error,
          children: [
            jsx("span", { children: t("global.error", { error: state.error }) }),
            jsx("button", { type: "button", className: styles.iconBtn, title: t("global.retry"), onClick: refresh, children: "↻" })
          ]
        });
      } else if (!hasAny) {
        statusNode = jsx("div", { className: styles.status, children: t("global.empty") });
      } else {
        statusNode = jsxs(React.Fragment, {
          children: [
            jsxs("div", {
              className: styles.cards,
              children: [
                jsx("div", { className: styles.cardStat, children: [jsx("div", { className: styles.cardStatLabel, children: t("global.card.total") }), jsx("div", { className: styles.cardStatValue, children: formatCompact(totals.total) })] }),
                jsx("div", { className: styles.cardStat, children: [jsx("div", { className: styles.cardStatLabel, children: t("global.card.today") }), jsx("div", { className: styles.cardStatValue, children: formatCompact(todayEntry === void 0 ? 0 : todayEntry.total) })] }),
                jsx("div", { className: styles.cardStat, children: [jsx("div", { className: styles.cardStatLabel, children: t("global.card.week") }), jsx("div", { className: styles.cardStatValue, children: formatCompact(weekTotal) })] }),
                jsx("div", { className: styles.cardStat, children: [jsx("div", { className: styles.cardStatLabel, children: t("global.card.reasoning") }), jsx("div", { className: styles.cardStatValue, children: formatCompact(totals.reasoning) })] }),
                jsx("div", { className: styles.cardStat, children: [jsx("div", { className: styles.cardStatLabel, children: t("global.card.requests") }), jsx("div", { className: styles.cardStatValue, children: formatNumber(totals.requests) })] }),
                jsx("div", { className: styles.cardStat, children: [jsx("div", { className: styles.cardStatLabel, children: t("global.card.sessions") }), jsx("div", { className: styles.cardStatValue, children: formatNumber(data.sessionCount) })] })
              ]
            }),
            jsxs("div", {
              className: styles.section,
              children: [
                jsxs("div", {
                  className: styles.sectionTitleRow,
                  children: [
                    jsx("div", { className: styles.sectionTitle, children: t("global.section.chart") }),
                    jsxs("div", {
                      className: styles.rangeWrap,
                      children: [
                        jsx("input", {
                          type: "date",
                          className: styles.dateInput,
                          value: range.start,
                          max: range.end,
                          "aria-label": t("global.range.start"),
                          title: t("global.range.start"),
                          onChange: function (event) { setStart(event.target.value); }
                        }),
                        jsx("span", { className: styles.rangeSep, children: "–" }),
                        jsx("input", {
                          type: "date",
                          className: styles.dateInput,
                          value: range.end,
                          min: range.start,
                          max: dayKeyOf(0),
                          "aria-label": t("global.range.end"),
                          title: t("global.range.end"),
                          onChange: function (event) { setEnd(event.target.value); }
                        }),
                        jsx("button", {
                          type: "button",
                          className: styles.rangeReset,
                          title: t("global.range.last30"),
                          onClick: resetRange,
                          children: t("global.range.last30")
                        })
                      ]
                    })
                  ]
                }),
                jsx("div", {
                  className: styles.chart,
                  children: chartDays.map(function (cell) {
                    var barOpen = hourDay === cell.day;
                    return jsx("div", {
                      className: styles.bar + (cell.isToday ? " " + styles.barToday : "") + (cell.isEmpty ? " " + styles.barEmpty : "") + (barOpen ? " " + styles.barOpen : ""),
                      role: "button",
                      tabIndex: 0,
                      "aria-expanded": barOpen,
                      "aria-label": t("global.hoursAria", { day: cell.day, total: formatNumber(cell.total) }),
                      title: cell.day + " · " + formatNumber(cell.total) + " tokens",
                      onClick: function () {
                        setHourDay(function (current) { return current === cell.day ? null : cell.day; });
                      },
                      onKeyDown: function (event) {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setHourDay(function (current) { return current === cell.day ? null : cell.day; });
                        }
                      },
                      style: { height: Math.max(cell.total === 0 ? 2 : 10, (cell.total / maxDay) * 100) + "%" }
                    }, cell.day);
                  })
                }),
                jsx("div", {
                  className: styles.chartX,
                  children: chartDays.map(function (cell, index) {
                    var label = index === 0 || index === chartDays.length - 1 || index % xStep === 0 ? cell.day.slice(5) : "";
                    return jsx("span", { children: label }, cell.day);
                  })
                }),
                !selectedHasData ? jsx("div", { className: styles.hintMeta, children: t("global.range.empty") }) : null,
                hourDay !== null ? jsxs("div", {
                  className: styles.hourBlock,
                  children: [
                    jsx("div", { className: styles.hourTitle, children: t("global.hoursTitle", { day: hourDay }) }),
                    hourSlots.length === 0 ? jsx("div", { className: styles.hintMeta, children: t("global.hoursEmpty") }) : jsxs("div", {
                      className: styles.section,
                      children: [
                        jsx("div", {
                          className: styles.hourChart,
                          children: hourSlots.map(function (slot) {
                            return jsx("div", {
                              className: styles.hbar + (slot.isEmpty ? "" : (slot.hour === new Date().getHours() && hourDay === dayKeyOf(0) ? " " + styles.barToday : "")) + (slot.isEmpty ? " " + styles.barEmpty : ""),
                              role: "img",
                              title: (slot.hour < 10 ? "0" : "") + slot.hour + ":00 · " + formatNumber(slot.total) + " tokens",
                              style: { height: Math.max(slot.total === 0 ? 2 : 10, (slot.total / hourMax) * 100) + "%" }
                            }, slot.hour);
                          })
                        }),
                        jsx("div", {
                          className: styles.chartX,
                          children: hourSlots.map(function (slot) {
                            return jsx("span", { children: slot.hour % 6 === 0 ? slot.hour : "" }, slot.hour);
                          })
                        })
                      ]
                    })
                  ]
                }) : null
              ]
            }),
            jsxs("div", {
              className: styles.section,
              children: [
                jsxs("button", {
                  type: "button",
                  className: styles.modelsToggle,
                  "aria-expanded": modelsOpen,
                  onClick: function () {
                    setModelsOpen(function (current) { return !current; });
                  },
                  children: [
                    jsx("span", { className: styles.modelsToggleTitle, children: t("global.section.models") }),
                    jsx("span", { className: styles.modelsToggleSummary, children: t("global.models.summary", { count: (byModel || []).length, total: formatNumber(totals.total), requests: formatNumber(totals.requests) }) }),
                    jsx("span", { className: styles.colChevron, "aria-hidden": "true", children: modelsOpen ? "▴" : "▾" })
                  ]
                }),
                modelsOpen ? jsx("div", {
                  className: styles.table,
                  children: [
                    jsx("div", { className: styles.tableHead, children: [
                      jsx("span", { className: styles.colModel, children: t("global.col.model") }),
                      jsx("span", { className: styles.colNum, children: t("global.col.input") }),
                      jsx("span", { className: styles.colNum, children: t("global.col.output") }),
                      jsx("span", { className: styles.colNum, children: t("global.col.cache") }),
                      jsx("span", { className: styles.colNum, children: t("global.col.reasoning") }),
                      jsx("span", { className: styles.colNum, children: t("global.col.total") }),
                      jsx("span", { className: styles.colShare, children: t("global.col.share") })
                    ] }),
                    (byModel || []).map(function (entry) {
                      var share = totals.total > 0 ? (entry.total / totals.total) * 100 : 0;
                      return jsx("div", {
                        className: styles.tableRow,
                        key: entry.model,
                        children: [
                          jsx("span", { className: styles.colModel, title: entry.model, children: entry.model }),
                          jsx("span", { className: styles.colNum, children: formatNumber(entry.input) }),
                          jsx("span", { className: styles.colNum, children: formatNumber(entry.output) }),
                          jsx("span", { className: styles.colNum, children: formatNumber(entry.cacheRead + entry.cacheWrite) }),
                          jsx("span", { className: styles.colNum, children: formatNumber(entry.reasoning) }),
                          jsx("span", { className: styles.colNum, children: formatNumber(entry.total) }),
                          jsxs("span", {
                            className: styles.colShare,
                            children: [
                              jsx("div", { className: styles.colShareBar, children: jsx("div", { className: styles.colShareFill, style: { width: Math.max(2, share) + "%" } }) }),
                              jsx("span", { className: styles.colShareText, children: share.toFixed(1) + "%" })
                            ]
                          })
                        ]
                      });
                    })
                  ]
                }) : null
              ]
            }),
            jsxs("div", {
              className: styles.section,
              children: [
                jsx("div", { className: styles.sectionTitle, children: t("global.section.days") }),
                jsx("div", { className: styles.hintMeta, children: t("global.daysHint") }),
                jsx("div", {
                  className: styles.table,
                  children: [
                    jsx("div", { className: styles.tableHead, children: [
                      jsx("span", { className: styles.colDay, children: t("global.col.day") }),
                      jsx("span", { className: styles.colNum, children: t("global.col.total") }),
                      jsx("span", { className: styles.colNum, children: t("global.col.input") }),
                      jsx("span", { className: styles.colNum, children: t("global.col.output") }),
                      jsx("span", { className: styles.colNum, children: t("global.col.reasoning") }),
                      jsx("span", { className: styles.colNum, children: t("global.col.requests") }),
                      jsx("span", { className: styles.colModels, children: t("global.col.model") }),
                      jsx("span", { className: styles.colChevron, children: "" })
                    ] }),
                    (byDay || []).slice().reverse().map(function (entry) {
                      var open = expandedDay === entry.day;
                      var models = entry.models || [];
                      return jsxs("div", {
                        className: styles.dayGroup,
                        key: entry.day,
                        children: [
                          jsxs("button", {
                            type: "button",
                            className: styles.dayRowBtn,
                            "aria-expanded": open,
                            "aria-label": t("global.expandDayAria", { day: entry.day, total: formatNumber(entry.total) }),
                            onClick: function () {
                              setExpandedDay(function (current) { return current === entry.day ? null : entry.day; });
                            },
                            children: [
                              jsx("span", { className: styles.colDay, children: entry.day }),
                              jsx("span", { className: styles.colNum, children: formatNumber(entry.total) }),
                              jsx("span", { className: styles.colNum, children: formatNumber(entry.input) }),
                              jsx("span", { className: styles.colNum, children: formatNumber(entry.output) }),
                              jsx("span", { className: styles.colNum, children: formatNumber(entry.reasoning) }),
                              jsx("span", { className: styles.colNum, children: formatNumber(entry.requests) }),
                              jsx("span", { className: styles.colModels, children: t("global.models.count", { count: models.length }) }),
                              jsx("span", { className: styles.colChevron, "aria-hidden": "true", children: open ? "▴" : "▾" })
                            ]
                          }),
                          open ? jsxs("div", {
                            className: styles.dayModels,
                            children: [
                              jsx("div", { className: styles.tableHead, children: [
                                jsx("span", { className: styles.colModel, children: t("global.col.model") }),
                                jsx("span", { className: styles.colNum, children: t("global.col.calls") }),
                                jsx("span", { className: styles.colNum, children: t("global.col.input") }),
                                jsx("span", { className: styles.colNum, children: t("global.col.output") }),
                                jsx("span", { className: styles.colNum, children: t("global.col.cache") }),
                                jsx("span", { className: styles.colNum, children: t("global.col.reasoning") }),
                                jsx("span", { className: styles.colNum, children: t("global.col.total") }),
                                jsx("span", { className: styles.colShare, children: t("global.col.share") })
                              ] }),
                              models.map(function (m) {
                                var share = entry.total > 0 ? (m.total / entry.total) * 100 : 0;
                                return jsx("div", {
                                  className: styles.tableRow,
                                  key: m.model,
                                  children: [
                                    jsx("span", { className: styles.colModel, title: m.model, children: m.model }),
                                    jsx("span", { className: styles.colNum, children: formatNumber(m.requests) }),
                                    jsx("span", { className: styles.colNum, children: formatNumber(m.input) }),
                                    jsx("span", { className: styles.colNum, children: formatNumber(m.output) }),
                                    jsx("span", {
                                      className: styles.colNum,
                                      title: t("global.cache.detail", { read: formatNumber(m.cacheRead), write: formatNumber(m.cacheWrite) }),
                                      children: formatNumber(m.cacheRead + m.cacheWrite)
                                    }),
                                    jsx("span", { className: styles.colNum, children: formatNumber(m.reasoning) }),
                                    jsx("span", { className: styles.colNum, children: formatNumber(m.total) }),
                                    jsxs("span", {
                                      className: styles.colShare,
                                      children: [
                                        jsx("div", { className: styles.colShareBar, children: jsx("div", { className: styles.colShareFill, style: { width: Math.max(2, share) + "%" } }) }),
                                        jsx("span", { className: styles.colShareText, children: share.toFixed(1) + "%" })
                                      ]
                                    })
                                  ]
                                });
                              })
                            ]
                          }) : null
                        ]
                      });
                    })
                  ]
                })
              ]
            })
          ]
        });
      }

      return jsxs("div", {
        className: styles.overlay,
        onClick: function (event) {
          if (event.target === event.currentTarget) onClose();
        },
        children: [
          jsxs("div", {
            className: styles.card,
            role: "dialog",
            "aria-label": t("global.panelTitle"),
            children: [
              jsxs("div", {
                className: styles.cardHeader,
                children: [
                  jsx("div", { className: styles.cardTitle, children: t("global.panelTitle") }),
                  data !== null ? jsx("div", {
                    className: styles.cardMeta,
                    children: t("global.panelMeta", { time: new Date(data.generatedAt).toLocaleTimeString(), sessions: formatNumber(data.sessionCount) })
                  }) : null,
                  jsx("button", { type: "button", className: styles.iconBtn, title: t("global.refresh"), onClick: refresh, children: "↻" }),
                  jsx("button", { type: "button", className: styles.iconBtn, title: t("global.close"), onClick: onClose, children: "✕" })
                ]
              }),
              statusNode,
              jsx("div", { className: styles.footer, children: jsx("span", { className: styles.cardMeta, children: t("global.auto") }) })
            ]
          })
        ]
      });
    }

    /**
     * Sidebar footer action opening the global stats panel. Works in both the
     * wide sidebar (labeled row) and the 56px rail (icon-only button) — the
     * `wide` owner prop is passed by the sidebar.
     */
    function GlobalStatsAction(props) {
      var wide = props.wide === true;
      var t = props.t;
      var openPair = React.useState(false);
      var open = openPair[0];
      var setOpen = openPair[1];
      var icon = jsxs("svg", {
        viewBox: "0 0 16 16",
        width: 16,
        height: 16,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.5,
        strokeLinecap: "round",
        children: [
          jsx("path", { d: "M2 13.5h12" }),
          jsx("path", { d: "M4 13.5V9.5" }),
          jsx("path", { d: "M8 13.5V5.5" }),
          jsx("path", { d: "M12 13.5V7.5" })
        ]
      });
      return jsxs(React.Fragment, {
        children: [
          jsxs("button", {
            type: "button",
            className: styles.sideAction + (wide ? " " + styles.sideActionWide : ""),
            "aria-label": t("global.action"),
            title: t("global.action"),
            onClick: function () {
              setOpen(true);
            },
            children: [icon, wide ? jsx("span", { className: styles.sideLabel, children: t("global.action") }) : null]
          }),
          open ? jsx(GlobalStatsPanel, { t: t, onClose: function () { setOpen(false); } }) : null
        ]
      });
    }

    // ── locales ────────────────────────────────────────────────────────────
    /** Simplified Chinese dictionary (key-set source of truth). */
    var zh = {
      "seg.input": "入",
      "seg.output": "出",
      "seg.context": "上下",
      "badge.summary": "{input} 入 · {output} 出 · {pct}",
      "badge.empty": "Token 用量",
      "badge.aria": "查看 Token 用量",
      "badge.title": "Token 用量：输入/输出与上下文占用（点击查看明细）",
      "panel.aria": "Token 用量明细",
      "panel.empty": "暂无 Token 数据 —— 会话发起请求后自动显示。",
      "group.usage": "提供方用量",
      "group.breakdown": "上下文构成",
      "group.pressure": "上下文压力",
      "group.stats": "会话统计",
      "row.input.uncached": "输入（未缓存）",
      "row.input.cacheRead": "输入（缓存读）",
      "row.input.cacheWrite": "输入（缓存写）",
      "row.output": "输出",
      "row.total": "合计",
      "row.system": "系统提示",
      "row.tools": "工具定义",
      "row.messages": "消息",
      "row.window": "上下文窗口",
      "row.pressure": "压力（采样）",
      "row.occupancy": "占用比例",
      "row.occupancy.detail": "预计 {used} / 窗口 {window}",
      "row.turns": "轮次",
      "row.steps": "步骤",
      "row.llmTime": "LLM 用时",
      "row.toolTime": "工具用时",
      "row.ttft": "首 Token 平均",
      "row.decodeTokens": "解码 Token",
      "global.action": "Token 统计",
      "global.panelTitle": "全局 Token 消耗",
      "global.panelMeta": "更新于 {time} · {sessions} 个会话",
      "global.refresh": "刷新",
      "global.close": "关闭",
      "global.retry": "重试",
      "global.loading": "正在统计日志中的 Token 消耗…",
      "global.error": "加载失败：{error}",
      "global.empty": "暂无 Token 数据 —— 产生对话后自动统计。",
      "global.auto": "面板打开时每 60 秒自动刷新",
      "global.card.total": "累计消耗",
      "global.card.today": "今日",
      "global.card.week": "近 7 天",
      "global.card.reasoning": "思考",
      "global.card.requests": "请求数",
      "global.card.sessions": "会话数",
      "global.section.chart": "每日消耗趋势",
      "global.range.start": "开始日期",
      "global.range.end": "结束日期",
      "global.range.last30": "近30天",
      "global.range.empty": "所选时段暂无数据",
      "global.section.models": "按模型汇总",
      "global.section.days": "按日明细",
      "global.daysHint": "点击日期（或柱状图）展开该日各模型明细",
      "global.expandDayAria": "{day}：{total} tokens，展开/收起该日模型",
      "global.hoursTitle": "{day} · 当日 24 小时用量分布",
      "global.hoursEmpty": "该日暂无小时级数据",
      "global.hoursAria": "{day}：{total} tokens，查看/收起 24 小时用量分布",
      "global.models.summary": "{count} 个模型 · 合计 {total} · 请求 {requests}",
      "global.models.count": "{count} 个模型",
      "global.col.model": "模型",
      "global.col.day": "日期",
      "global.col.calls": "调用",
      "global.col.input": "输入",
      "global.col.output": "输出",
      "global.col.cache": "缓存",
      "global.col.reasoning": "思考",
      "global.col.total": "合计",
      "global.col.share": "占比",
      "global.col.requests": "请求",
      "global.cache.detail": "缓存读 {read} · 缓存写 {write}"
    };
    /** English dictionary, key-identical to the Chinese source of truth. */
    var en = {
      "seg.input": "in",
      "seg.output": "out",
      "seg.context": "ctx",
      "badge.summary": "{input} in · {output} out · {pct}",
      "badge.empty": "Token usage",
      "badge.aria": "View token usage",
      "badge.title": "Token usage: input/output tokens and context occupancy (click for details)",
      "panel.aria": "Token usage details",
      "panel.empty": "No token data yet — it appears once the session makes requests.",
      "group.usage": "Provider usage",
      "group.breakdown": "Context breakdown",
      "group.pressure": "Context pressure",
      "group.stats": "Session stats",
      "row.input.uncached": "Input (uncached)",
      "row.input.cacheRead": "Input (cache read)",
      "row.input.cacheWrite": "Input (cache write)",
      "row.output": "Output",
      "row.total": "Total",
      "row.system": "System prompt",
      "row.tools": "Tool schemas",
      "row.messages": "Messages",
      "row.window": "Context window",
      "row.pressure": "Pressure (sample)",
      "row.occupancy": "Occupancy",
      "row.occupancy.detail": "Projected {used} / window {window}",
      "row.turns": "Turns",
      "row.steps": "Steps",
      "row.llmTime": "LLM time",
      "row.toolTime": "Tool time",
      "row.ttft": "Avg first token",
      "row.decodeTokens": "Decode tokens",
      "global.action": "Token stats",
      "global.panelTitle": "Global token usage",
      "global.panelMeta": "Updated {time} · {sessions} sessions",
      "global.refresh": "Refresh",
      "global.close": "Close",
      "global.retry": "Retry",
      "global.loading": "Aggregating token usage from session logs…",
      "global.error": "Failed to load: {error}",
      "global.empty": "No token data yet — it appears once conversations produce usage.",
      "global.auto": "Auto-refreshes every 60s while open",
      "global.card.total": "Total",
      "global.card.today": "Today",
      "global.card.week": "Last 7 days",
      "global.card.reasoning": "Thinking",
      "global.card.requests": "Requests",
      "global.card.sessions": "Sessions",
      "global.section.chart": "Daily usage trend",
      "global.range.start": "Start date",
      "global.range.end": "End date",
      "global.range.last30": "30d",
      "global.range.empty": "No data in the selected range",
      "global.section.models": "By-model summary",
      "global.section.days": "Daily breakdown",
      "global.daysHint": "Click a day (or a bar) to expand that day's per-model breakdown",
      "global.expandDayAria": "{day}: {total} tokens, expand/collapse that day's models",
      "global.hoursTitle": "{day} · hourly usage over 24h",
      "global.hoursEmpty": "No hourly data for this day",
      "global.hoursAria": "{day}: {total} tokens, show/collapse hourly usage",
      "global.models.summary": "{count} models · total {total} · requests {requests}",
      "global.models.count": "{count} models",
      "global.col.model": "Model",
      "global.col.day": "Day",
      "global.col.calls": "Calls",
      "global.col.input": "Input",
      "global.col.output": "Output",
      "global.col.cache": "Cache",
      "global.col.reasoning": "Think",
      "global.col.total": "Total",
      "global.col.share": "Share",
      "global.col.requests": "Requests",
      "global.cache.detail": "Cache read {read} · cache write {write}"
    };

    // ── plugin body ────────────────────────────────────────────────────────
    /** Locale namespace owned by this plugin. */
    var NS = "token-usage";
    /** Required browser services: the slot registry and the locale face. */
    var inject = ["slots", "locale"];
    /**
     * Client plugin body: register the dictionaries, then contribute the token
     * pill into the session header utilities row once ui-conversation declares
     * it (ctx.slots.inject waits for the declaration).
     * @param ctx - browser root context.
     */
    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, "dsh-token-usage: dictionaries");
      ctx.slots.inject("conversation.session.header.utilities", function () {
        return ctx.slots.register({
          name: "conversation.session.header.utilities",
          id: "token-usage",
          order: 10,
          locale: NS
        }, TokenUsageBadge);
      });
      ctx.slots.inject("sidebar.footer.action", function () {
        return ctx.slots.register({
          name: "sidebar.footer.action",
          id: "token-usage-global",
          order: 20,
          locale: NS
        }, GlobalStatsAction);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});

//# sourceMappingURL=client.js.map
