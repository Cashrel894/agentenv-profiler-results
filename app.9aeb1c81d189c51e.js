"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const SVG_NS = "http://www.w3.org/2000/svg";
  const COLORS = {rss_mib: "#087f78", read_bps: "#5275c9", write_bps: "#bc6c2a", physical_read_bps: "#277da1", physical_write_bps: "#c25175", cpu_utilization_pct: "#8560a9"};
  const EVENT_LABELS = {create: "创建", setup: "初始化", pause: "暂停", resume: "恢复", tool: "工具调用", kill: "销毁"};
  const EVENT_COLORS = {create: "#4e9a80", setup: "#7a9b6d", pause: "#b39954", resume: "#5c91a7", tool: "#7086ba", kill: "#b77b74"};
  const EVENT_ORDER = Object.keys(EVENT_LABELS);
  const state = {listVersion: 0, scenarioVersion: 0, sandboxVersion: 0, scenarioId: "", sandboxResults: {}};
  let listRequest, scenarioRequest, sandboxRequest;
  const manifestPath = document.documentElement.dataset.profilerManifest;
  let snapshot;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function svgElement(tag, attrs = {}, text) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const exact = (value) => value === null || value === undefined ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value);
  const short = (value) => finite(value) ? new Intl.NumberFormat("zh-CN", {maximumFractionDigits: 3}).format(value) : exact(value);
  const eventLabel = (event) => EVENT_LABELS[event] || event || "未知事件";
  function unitFor(key) {
    if (/_mib_s$/.test(key)) return "MiB·s";
    if (/_mib$/.test(key)) return "MiB";
    if (/_ms$/.test(key)) return "ms";
    if (/_bps$/.test(key)) return "B/s";
    if (/_bytes$/.test(key)) return "B";
    if (/_pct$/.test(key)) return "%";
    if (/_cores$/.test(key)) return "核";
    if (/_ios$/.test(key)) return "次";
    if (/_s$/.test(key)) return "s";
    return "";
  }
  function setStatus(id, message, error = false) {
    const node = $(id);
    node.textContent = message;
    node.classList.toggle("error", error);
    node.setAttribute("role", error ? "alert" : "status");
  }
  async function requestJSON(path, signal) {
    const response = await fetch(new URL(path, document.baseURI), {signal, cache: "no-store", headers: {Accept: "application/json"}});
    let data;
    try { data = await response.json(); }
    catch { throw new Error(`响应格式错误（HTTP ${response.status}）`); }
    if (!response.ok) throw new Error(data.error || `请求失败（HTTP ${response.status}）`);
    if (data.error) throw new Error(data.error);
    return data;
  }
  async function api(path, signal) {
    if (!manifestPath) return requestJSON(path.slice(1), signal);
    if (path === "/api/scenarios") {
      snapshot = await requestJSON(manifestPath, signal);
      if (snapshot.format_version !== 1) throw new Error("不支持的静态结果格式");
      document.title = snapshot.title;
      return snapshot;
    }
    const request = new URL(path, document.baseURI);
    const scenario = snapshot?.scenarios.find((item) => item.id === request.searchParams.get("scenario"));
    let target;
    if (request.pathname === "/api/scenario") target = scenario?.url;
    else if (request.pathname === "/api/trajectory") target = scenario?.trajectories?.[request.searchParams.get("slot")];
    else if (request.pathname === "/api/sandbox") target = scenario?.sandboxes?.[request.searchParams.get("sandbox")];
    if (!target) throw new Error("该场景或轨迹未包含在公开快照中");
    return requestJSON(target, signal);
  }
  function metricCard(label, metrics, key) {
    const card = element("article", undefined, "metric-card");
    card.dataset.metric = key;
    card.append(element("p", label, "metric-label"));
    const value = Object.prototype.hasOwnProperty.call(metrics, key) ? metrics[key] : null;
    const content = element("div", value === null ? "—" : short(value), "metric-value");
    content.title = `${key}: ${exact(value)}${unitFor(key) ? ` ${unitFor(key)}` : ""}`;
    if (value !== null && unitFor(key)) content.append(element("span", unitFor(key), "unit"));
    card.append(content);
    return card;
  }
  function showMetrics(id, metrics, specifications) {
    $(id).replaceChildren(...specifications.map(([label, key]) => metricCard(label, metrics, key)));
  }
  function completeDetails(id, value) {
    const table = element("table", undefined, "detail-table");
    table.setAttribute("aria-label", "原始字段与数值");
    const body = element("tbody");
    function visit(item, path) {
      if (item !== null && typeof item === "object" && Object.keys(item).length) {
        for (const [key, child] of Object.entries(item)) visit(child, path ? `${path}.${key}` : key);
        return;
      }
      const row = element("tr");
      const key = element("th", path || "数据");
      key.scope = "row";
      const unit = unitFor(path.split(".").pop());
      const cell = element("td", `${exact(item)}${finite(item) && unit ? ` ${unit}` : ""}`, item === null ? "null-value" : "");
      row.append(key, cell);
      body.append(row);
    }
    visit(value, "");
    table.append(body);
    $(id).replaceChildren(table);
  }
  function showConfiguration(config, summary) {
    const execution = config?.execution || {};
    const metrics = config?.metrics || {};
    const thinking = execution.thinking_time;
    const cacheFields = ["host_periodic_enabled", "host_periodic_interval_s", "host_pre_run_enabled"];
    const cachePolicy = (policy) => Object.fromEntries(cacheFields
      .filter((key) => policy && Object.hasOwn(policy, key))
      .map((key) => [key, policy[key]]));
    const cache = cachePolicy(summary.cache_control?.policy || config?.cache_control);
    const sampling = summary.sandbox_sampling;
    const missing = "未记录";
    const value = (item, unit = "") => item === undefined ? missing : item === null ? "未设置" : `${exact(item)}${unit}`;
    const enabled = (item) => item === true ? "开启" : item === false ? "关闭" : missing;
    let thinkingLabel = missing;
    if (thinking?.mode === "fixed") thinkingLabel = `固定 ${value(thinking.value_s, " s")}`;
    else if (thinking?.mode === "uniform") thinkingLabel = `均匀随机 ${value(thinking.min_s)}–${value(thinking.max_s)} s`;
    else if (thinking?.mode) thinkingLabel = thinking.mode;
    const counts = summary.task_counts;
    const assignments = counts && typeof counts === "object" && Object.keys(counts).length
      ? Object.entries(counts).map(([task, count]) => `${task} × ${exact(count)}`).join("\n")
      : summary.task_id || missing;
    const intervals = ["rss", "io", "cpu"]
      .filter((name) => metrics.enabled?.includes(name))
      .map((name) => `${name.toUpperCase()} ${value(metrics[name]?.interval_s, " s")}`);
    const resources = config?.resources;
    const resourceLabel = resources === undefined ? missing : resources === null ? "未设置"
      : `CPU ${value(resources.cpu_cores, " 核")} / 内存 ${value(resources.memory_mib, " MiB")}`;
    const samplingLabel = sampling
      ? sampling.mode === "disabled" ? "关闭" : `${value(sampling.interval_s, " s")} · 每任务固定代表槽`
      : metrics.sandbox ? `${enabled(metrics.sandbox.enabled)} · ${value(metrics.sandbox.interval_s, " s")}` : missing;
    const items = [
      ["执行模式", ({keep_running: "持续运行", pause_resume: "暂停 / 恢复"})[summary.mode] || value(summary.mode)],
      ["场景并发数", value(summary.concurrency)],
      ["推理间隔", thinkingLabel],
      ["重复执行", enabled(execution.repeat)],
      ["全局时限", value(execution.max_duration_s, " s")],
      ["沙箱超时", value(execution.sandbox_timeout_s, " s")],
      ["启用指标", Array.isArray(metrics.enabled) ? metrics.enabled.join(" / ") || "无" : missing],
      ["整组采样间隔", intervals.join(" / ") || missing],
      ["代表沙箱采样", samplingLabel],
      ["整组资源上限", resourceLabel],
      ["宿主预清缓存", enabled(cache.host_pre_run_enabled)],
      ["宿主定时清缓存", cache.host_periodic_enabled === true ? `每 ${value(cache.host_periodic_interval_s, " s")}` : enabled(cache.host_periodic_enabled)],
      ["任务分配", assignments]
    ];
    $("configuration-summary").replaceChildren(...items.map(([label, text]) => {
      const item = element("div");
      item.append(element("dt", label), element("dd", text));
      return item;
    }));
    setStatus("configuration-status", config
      ? "执行参数来自本次实验快照；模式、并发与任务分配以当前场景为准。"
      : "所选结果范围内没有可读的实验配置快照，仅展示场景已记录的信息。可选择包含本次运行 summary.json 的结果根目录查看完整配置。");
    completeDetails("configuration-details", {
      ...(config || {}),
      ...(config?.cache_control ? {cache_control: cachePolicy(config.cache_control)} : {}),
      scenario: {
        mode: summary.mode, concurrency: summary.concurrency, task_counts: summary.task_counts,
        sandbox_sampling: summary.sandbox_sampling, cache_control: cachePolicy(summary.cache_control?.policy)
      }
    });
  }
  function showGenerationCPU(generations) {
    if (!generations?.some((generation) => state.sandboxResults[generation.sandbox_id]?.metrics?.cpu_source === "proc_pid_stat")) return;
    const table = element("table", undefined, "generation-table");
    table.id = "generation-cpu-table";
    table.append(element("caption", "各轮已观测 CPU"));
    const head = element("thead");
    const labels = element("tr");
    for (const label of ["轮次", "沙箱 ID", "CPU 时间（s）", "用户态（s）", "内核态（s）"]) {
      const cell = element("th", label);
      cell.scope = "col";
      labels.append(cell);
    }
    head.append(labels);
    const body = element("tbody");
    for (const generation of generations) {
      const recorded = state.sandboxResults[generation.sandbox_id]?.metrics;
      const metrics = recorded?.cpu_source === "proc_pid_stat" ? recorded : {};
      const row = element("tr");
      row.dataset.sandboxId = generation.sandbox_id;
      row.append(element("td", exact(generation.iteration)), element("td", generation.sandbox_id));
      for (const key of ["cpu_observed_time_s", "cpu_observed_user_time_s", "cpu_observed_system_time_s"]) {
        const cell = element("td", exact(metrics[key]));
        cell.dataset.field = key;
        row.append(cell);
      }
      body.append(row);
    }
    table.append(head, body);
    const scroll = element("div", undefined, "table-scroll");
    scroll.append(table);
    $("sandbox-detail-content").prepend(scroll);
  }
  function clearSandbox(message = "") {
    sandboxTimeline.clear();
    $("sandbox-content").hidden = true;
    delete $("sandbox-content").dataset.selection;
    $("sandbox-metrics").replaceChildren();
    $("sandbox-detail-content").replaceChildren();
    $("event-table-body").replaceChildren();
    setStatus("sandbox-status", message);
  }
  function clearScenario() {
    state.scenarioVersion++;
    state.sandboxVersion++;
    scenarioRequest?.abort();
    sandboxRequest?.abort();
    state.scenarioId = "";
    state.sandboxResults = {};
    globalTimeline.clear();
    $("configuration-summary").replaceChildren();
    $("configuration-details").replaceChildren();
    setStatus("configuration-status", "");
    $("scenario-section").hidden = true;
    $("sandbox-select").replaceChildren(new Option("暂无资源采样轨迹", ""));
    $("sandbox-select").disabled = true;
    clearSandbox();
  }
  async function loadScenarios() {
    const version = ++state.listVersion;
    const previous = $("scenario-select").value;
    listRequest?.abort();
    listRequest = new AbortController();
    clearScenario();
    $("refresh-button").disabled = true;
    $("scenario-select").disabled = true;
    setStatus("app-status", "正在读取结果列表…");
    try {
      const data = await api("/api/scenarios", listRequest.signal);
      if (version !== state.listVersion) return;
      const scenarios = data.scenarios || [];
      if (!scenarios.length) {
        $("scenario-select").replaceChildren(new Option("未发现可展示的场景", ""));
        setStatus("app-status", "没有评测结果");
        return;
      }
      $("scenario-select").replaceChildren(...scenarios.map((item) => new Option(item.id, item.id)));
      $("scenario-select").disabled = false;
      if (scenarios.some((item) => item.id === previous)) $("scenario-select").value = previous;
      await loadScenario();
    } catch (error) {
      if (error.name !== "AbortError" && version === state.listVersion) {
        $("scenario-select").replaceChildren(new Option("结果读取失败", ""));
        setStatus("app-status", `结果读取失败：${error.message}`, true);
      }
    } finally {
      if (version === state.listVersion) $("refresh-button").disabled = false;
    }
  }
  async function loadScenario() {
    const id = $("scenario-select").value;
    clearScenario();
    if (!id) return;
    state.scenarioId = id;
    const version = state.scenarioVersion;
    scenarioRequest = new AbortController();
    setStatus("app-status", `正在读取场景：${id}…`);
    try {
      const data = await api(`/api/scenario?${new URLSearchParams({scenario: id})}`, scenarioRequest.signal);
      if (version !== state.scenarioVersion) return;
      const summary = data.summary || {};
      state.sandboxResults = summary.sandbox_results || {};
      const metrics = summary.metrics || {};
      showConfiguration(data.config, summary);
      $("scenario-status").textContent = ({completed: "已完成", failed: "失败", cancelled: "已取消", time_limit_reached: "达到时限"})[summary.status] || exact(summary.status);
      $("scenario-status").classList.toggle("failed", /fail|error|interrupt/.test(summary.status || ""));
      showMetrics("scenario-metrics", metrics, [
        ["成功调用数", "successful_calls"],
        ["成功调用平均延迟", "mean_tool_call_latency_ms"],
        ["相邻成功调用平均延迟", "mean_inter_call_latency_ms"],
        ["整组 RSS 时间积分", "rss_time_mib_s"],
        ["整组 CPU 时间", "cpu_time_s"],
        ["失败调用数", "failed_calls"]
      ]);
      completeDetails("scenario-detail-content", data.warnings?.length ? {...summary, warnings: data.warnings} : summary);
      globalTimeline.render({series: data.series || []});
      $("scenario-section").hidden = false;
      setStatus("app-status", "");
      const trajectories = data.trajectories || [];
      const choices = trajectories.length
        ? trajectories.filter((trajectory) => trajectory.resource_recorded === true).map((trajectory) => new Option(`${trajectory.task_id} · 槽 ${trajectory.slot_id}`, `slot:${trajectory.slot_id}`))
        : (data.sandboxes || []).filter((sandbox) => sandbox.resource_recorded === true).map((sandbox) => new Option(`${sandbox.task_id || "任务未记录"} · 槽未记录 · ${sandbox.id}`, `sandbox:${sandbox.id}`));
      if (!choices.length) {
        $("sandbox-select").replaceChildren(new Option("暂无资源采样轨迹", ""));
        $("sandbox-select").disabled = true;
        clearSandbox("没有沙箱资源采样记录；调用与生命周期记录不作为资源采样。仍可查看总体指标与全局资源时间线。");
        return;
      }
      $("sandbox-select").replaceChildren(...choices);
      $("sandbox-select").disabled = false;
      await loadSandbox();
    } catch (error) {
      if (error.name !== "AbortError" && version === state.scenarioVersion) setStatus("app-status", `场景读取失败：${error.message}`, true);
    }
  }
  async function loadSandbox() {
    const id = $("sandbox-select").value;
    const scenario = state.scenarioId;
    const version = ++state.sandboxVersion;
    sandboxRequest?.abort();
    clearSandbox("正在读取轨迹…");
    if (!id || !scenario) return;
    sandboxRequest = new AbortController();
    try {
      const isSlot = id.startsWith("slot:");
      const endpoint = isSlot
        ? `/api/trajectory?${new URLSearchParams({scenario, slot: id.slice(5)})}`
        : `/api/sandbox?${new URLSearchParams({scenario, sandbox: id.slice(8)})}`;
      const data = await api(endpoint, sandboxRequest.signal);
      if (version !== state.sandboxVersion || scenario !== state.scenarioId) return;
      if (data.resource_recorded !== true) {
        const selected = $("sandbox-select").selectedOptions[0];
        if (selected) selected.remove();
        if (!$("sandbox-select").options.length) {
          $("sandbox-select").replaceChildren(new Option("暂无资源采样轨迹", ""));
          $("sandbox-select").disabled = true;
        }
        clearSandbox("该轨迹已无资源采样记录，请重新选择或刷新结果。");
        return;
      }
      const metrics = data.metrics || {};
      const specifications = isSlot ? [
        ["资源采样轮次", "generation_count"],
        ["RSS 时间积分", "rss_time_mib_s"],
        ["已观测读取量", "io_observed_read_bytes"],
        ["已观测写入量", "io_observed_write_bytes"]
      ] : [
        ["RSS 时间积分", "rss_time_mib_s"],
        ["已观测 RSS 时间积分", "observed_rss_time_mib_s"],
        ["RSS 采样数", "rss_samples"],
        ["IO 采样数", "io_samples"]
      ];
      if (Object.prototype.hasOwnProperty.call(metrics, "cpu_observed_time_s")) {
        specifications.push(["已观测 CPU 时间", "cpu_observed_time_s"]);
      }
      showMetrics("sandbox-metrics", metrics, specifications);
      $("sandbox-details").querySelector("summary").textContent = isSlot ? "轨迹数据" : "沙箱数据";
      const details = {...metrics};
      if (data.generations) details.generations = data.generations;
      if (data.warnings?.length) details.warnings = data.warnings;
      completeDetails("sandbox-detail-content", details);
      showGenerationCPU(data.generations);
      renderEventTable(data.events || []);
      $("sandbox-content").dataset.selection = id;
      $("sandbox-content").hidden = false;
      sandboxTimeline.render(data);
      setStatus("sandbox-status", isSlot ? "资源指标与曲线仅包含有资源采样记录的轮次；事件表保留该槽全部生命周期。" : "");
    } catch (error) {
      if (error.name !== "AbortError" && version === state.sandboxVersion) setStatus("sandbox-status", `轨迹读取失败：${error.message}`, true);
    }
  }
  function eventDescription(event) {
    const result = event.success === true ? "成功" : event.success === false ? "失败" : "结果未记录";
    return `${eventLabel(event.event)}\n槽：${exact(event.slot_id)} · 轮次：${exact(event.iteration)}\n沙箱：${exact(event.sandbox_id)}\n开始：${exact(event.started_s)} s\n结束：${exact(event.finished_s)} s\n步骤：${exact(event.step_id)}\n${result} · ${event.source || "—"}${event.error ? `\n错误：${event.error}` : ""}`;
  }
  function renderEventTable(events) {
    const body = $("event-table-body");
    body.replaceChildren();
    if (!events.length) {
      const row = element("tr");
      const cell = element("td", "没有事件记录");
      cell.colSpan = 9;
      row.append(cell);
      body.append(row);
      return;
    }
    events.forEach((event, index) => {
      const row = element("tr");
      row.dataset.event = event.event;
      row.dataset.eventIndex = String(index);
      row.dataset.sandboxId = event.sandbox_id || "";
      row.dataset.iteration = event.iteration ?? "";
      row.append(element("td", eventLabel(event.event), "event-label"));
      row.append(element("td", exact(event.iteration)), element("td", exact(event.sandbox_id), "event-sandbox"));
      for (const key of ["started_s", "finished_s"]) {
        const cell = element("td", exact(event[key]), "event-time");
        cell.dataset.field = key;
        row.append(cell);
      }
      row.append(element("td", finite(event.started_s) && finite(event.finished_s) ? String(event.finished_s - event.started_s) : "未记录", "event-time"));
      row.append(element("td", event.step_id ?? "—"));
      const result = event.success === true ? "成功" : event.success === false ? "失败" : "未记录";
      row.append(element("td", result, `event-result ${event.success === true ? "success" : event.success === false ? "failed" : ""}`));
      const source = element("td");
      source.append(element("div", event.source || "来源未记录", "event-source"));
      if (event.error !== undefined && event.error !== null && event.error !== "") source.append(element("div", exact(event.error), "event-error"));
      row.append(source);
      body.append(row);
    });
  }
  function timelineLayout(viewportWidth, scale) {
    // Explicit zoom expands the time axis without stretching chart height or text.
    const width = Math.min(4096, Math.max(1060, Math.ceil(viewportWidth * 2))) * scale;
    return {width, ticks: Math.min(scale === 1 ? 24 : 512, Math.max(6, Math.floor((width - 130) / 120)))};
  }
  function createTimeline(prefix, showEvents) {
    const id = (name) => `${prefix}${name}`;
    const $ = (name) => document.getElementById(id(name));
    const state = {chart: null, data: null, range: "events", enabled: new Map(), scale: showEvents ? Number($("chart-time-scale").value) : 1};
    function renderChart(data) {
      state.data = data;
      const svg = $("timeline-chart");
      svg.replaceChildren(svgElement("title", {id: id("chart-title")}, showEvents
        ? "沙箱轨迹资源峰值占比与事件时间线" : "全局资源峰值占比时间线"));
      const series = (data.series || []).map((item, index) => ({...item, color: COLORS[item.id] || ["#8560a9", "#7c8c44", "#a45d83"][index % 3], points: (item.points || []).filter((point) => Array.isArray(point) && finite(point[0]))}));
      const events = showEvents ? data.events || [] : [];
      let min = 0, max = 0;
      let hasTime = false, validPoints = 0;
      for (const item of series) {
        item.max = 0;
        for (const [time, value] of item.points) {
          min = Math.min(min, time); max = Math.max(max, time); hasTime = true;
          if (finite(value)) { item.max = Math.max(item.max, value); validPoints++; }
        }
      }
      for (const event of events) for (const time of [event.started_s, event.finished_s]) if (finite(time)) { min = Math.min(min, time); max = Math.max(max, time); hasTime = true; }
      if (max === min) max = min + 1;
      const eventTimes = events.flatMap((event) => [event.started_s, event.finished_s]).filter(finite);
      const fullMin = min, fullMax = max;
      const useEventWindow = state.range === "events" && eventTimes.length > 0;
      if (useEventWindow) {
        let first = Infinity, last = -Infinity;
        for (const time of eventTimes) { first = Math.min(first, time); last = Math.max(last, time); }
        const padding = Math.max((last - first) * .06, .1);
        min = Math.max(fullMin, first - padding);
        max = Math.min(fullMax, last + padding);
        if (max === min) max = min + 1;
      }
      if (showEvents) {
        $("chart-event-range").disabled = eventTimes.length === 0;
        $("chart-event-range").setAttribute("aria-pressed", String(useEventWindow));
        $("chart-full-range").setAttribute("aria-pressed", String(!useEventWindow));
      }
      $("chart-tooltip").hidden = true;
      $("chart-container").hidden = !hasTime;
      const {width, ticks} = timelineLayout($("chart-scroll").clientWidth || document.documentElement.clientWidth, state.scale);
      const height = showEvents ? 520 : 320;
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.style.width = `${width}px`;
      const plot = {left: 95, right: width - 35, top: 36, bottom: showEvents ? 232 : 252, axis: showEvents ? 480 : 280};
      const x = (time) => plot.left + (time - min) / (max - min) * (plot.right - plot.left);
      const y = (value, maximum) => plot.bottom - value / (maximum || 1) * (plot.bottom - plot.top);
      const defs = svgElement("defs");
      const clip = svgElement("clipPath", {id: id("resource-plot-clip")});
      clip.append(svgElement("rect", {x: plot.left, y: plot.top - 3, width: plot.right - plot.left, height: plot.bottom - plot.top + 6}));
      defs.append(clip);
      svg.append(defs);
      state.chart = {series, events, min, max, plot, x, hasTime, width};
      $("chart-empty").hidden = validPoints > 0;
      $("chart-empty").textContent = hasTime ? "没有有效资源样本" : showEvents ? "没有资源样本或事件记录" : "没有资源采样数据";
      $("sample-navigation").hidden = !hasTime;
      $("sample-readout").textContent = "";
      $("sample-cursor").value = "0";
      const controls = $("series-controls");
      controls.replaceChildren(element("legend", "资源曲线", "sr-only"));
      series.forEach((item) => {
        if (!state.enabled.has(item.id)) state.enabled.set(item.id, true);
        const label = element("label", undefined, "series-toggle");
        label.style.setProperty("--series-color", item.color);
        const checkbox = element("input");
        checkbox.type = "checkbox";
        checkbox.id = id(`toggle-${item.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`);
        checkbox.value = item.id;
        checkbox.dataset.series = item.id;
        checkbox.checked = state.enabled.get(item.id);
        const swatch = element("span", undefined, "swatch");
        swatch.setAttribute("aria-hidden", "true");
        const description = element("span");
        const hasSamples = item.points.some((point) => finite(point[1]));
        description.textContent = `${item.label || item.id}（${hasSamples ? `峰值 ${short(item.max)} ${item.unit || ""}` : "无有效样本"}）`;
        label.append(checkbox, swatch, description);
        controls.append(label);
        checkbox.addEventListener("change", () => {
          state.enabled.set(item.id, checkbox.checked);
          for (const group of svg.querySelectorAll("g[data-series]")) if (group.dataset.series === item.id) group.style.display = checkbox.checked ? "" : "none";
          $("chart-tooltip").hidden = true;
          $("sample-readout").textContent = "";
        });
      });
      for (let i = 0; i <= 4; i++) {
        const position = plot.top + (plot.bottom - plot.top) * i / 4;
        svg.append(svgElement("line", {x1: plot.left, x2: plot.right, y1: position, y2: position, class: "grid-line"}));
      }
      svg.append(svgElement("text", {x: 55, y: 39, class: "axis-label"}, "100%"), svgElement("text", {x: 55, y: plot.bottom + 4, class: "axis-label"}, "0%"));
      for (let i = 0; i <= ticks; i++) {
        const time = min + (max - min) * i / ticks;
        const position = x(time);
        svg.append(svgElement("line", {x1: position, x2: position, y1: plot.top, y2: plot.axis, class: "grid-line"}));
        svg.append(svgElement("text", {x: position, y: plot.axis + 17, "text-anchor": i === 0 ? "start" : i === ticks ? "end" : "middle"}, short(time)));
      }
      svg.append(svgElement("text", {x: plot.right, y: height - 6, "text-anchor": "end", class: "axis-label"}, "场景相对时间（s）"));
      series.forEach((item) => {
        const group = svgElement("g", {"data-series": item.id, id: id(`series-${item.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`), "clip-path": `url(#${id("resource-plot-clip")})`, "aria-label": `${item.label}（${item.unit}），独立最大值 ${item.max}`});
        group.style.display = state.enabled.get(item.id) ? "" : "none";
        let path = "", connected = false, lastTime = null;
        for (const [time, value] of item.points) {
          if (!finite(value)) { connected = false; lastTime = null; continue; }
          if (lastTime !== null && time < lastTime) connected = false;
          path += `${connected ? "L" : "M"}${x(time).toFixed(3)},${y(value, item.max).toFixed(3)} `;
          group.append(svgElement("circle", {cx: x(time), cy: y(value, item.max), r: 1.5, fill: item.color, "data-series": item.id}));
          connected = true; lastTime = time;
        }
        group.prepend(svgElement("path", {d: path, stroke: item.color, class: "resource-path", "data-series": item.id}));
        svg.append(group);
      });
      if (showEvents) EVENT_ORDER.forEach((name, index) => {
        const position = 295 + index * 30;
        svg.append(svgElement("rect", {x: plot.left, y: position - 11, width: plot.right - plot.left, height: 22, fill: index % 2 ? "#f4f7f3" : "#fafcf9", rx: 3}));
        svg.append(svgElement("text", {x: 13, y: position + 4, class: "track-label"}, EVENT_LABELS[name]));
      });
      events.forEach((event, index) => {
        const lane = EVENT_ORDER.indexOf(event.event);
        if (lane < 0) return;
        const start = finite(event.started_s) ? event.started_s : event.finished_s;
        if (!finite(start)) return;
        const complete = finite(event.started_s) && finite(event.finished_s) && event.finished_s >= event.started_s;
        if ((complete ? event.finished_s : start) < min || start > max) return;
        const position = 295 + lane * 30;
        const attrs = {"data-event": event.event, "data-event-index": index, class: "event-interval", tabindex: "0", role: "img", "aria-label": eventDescription(event), stroke: EVENT_COLORS[event.event]};
        let marker;
        if (complete) marker = svgElement("rect", {...attrs, x: x(Math.max(start, min)), y: position - 6, width: Math.max(2, x(Math.min(event.finished_s, max)) - x(Math.max(start, min))), height: 12, rx: 2, fill: EVENT_COLORS[event.event], "fill-opacity": event.success === false ? ".25" : ".62"});
        else marker = svgElement("path", {...attrs, d: `M${x(start)},${position - 7} l5,7 l-5,7 l-5,-7 Z`, fill: "#fff"});
        marker.append(svgElement("title", {}, eventDescription(event)));
        marker.addEventListener("focus", () => {
          marker.scrollIntoView({block: "nearest", inline: "nearest"});
          const bounds = marker.getBoundingClientRect();
          const container = $("chart-container").getBoundingClientRect();
          showTooltip(eventDescription(event), bounds.left - container.left, bounds.bottom - container.top);
        });
        marker.addEventListener("blur", () => { $("chart-tooltip").hidden = true; });
        svg.append(marker);
      });
      svg.append(svgElement("line", {id: id("chart-cursor-line"), x1: plot.left, x2: plot.left, y1: plot.top, y2: plot.axis, class: "cursor-line", visibility: "hidden"}));
      $("chart-scroll").scrollLeft = 0;
    }
    function nearestPoint(points, time) {
      // Preserve the nearest null point as a gap; never substitute a distant valid sample.
      let nearest = null, distance = Infinity;
      for (const point of points) {
        const candidate = Math.abs(point[0] - time);
        if (candidate < distance) { nearest = point; distance = candidate; }
      }
      return nearest;
    }
    function sampleText(time) {
      const chart = state.chart;
      const lines = [`场景时间：${String(time)} s`];
      for (const series of chart.series) {
        if (!state.enabled.get(series.id)) continue;
        const point = nearestPoint(series.points, time);
        lines.push(point ? `${series.label || series.id}：${finite(point[1]) ? `${String(point[1])} ${series.unit || ""}` : "—"}\n  采样时间：${String(point[0])} s` : `${series.label || series.id}：—`);
      }
      return lines.join("\n");
    }
    function showTooltip(text, left, top) {
      const tooltip = $("chart-tooltip");
      tooltip.textContent = text;
      tooltip.hidden = false;
      const container = $("chart-container");
      tooltip.style.left = `${Math.max(8, Math.min(left + 14, container.clientWidth - tooltip.offsetWidth - 8))}px`;
      tooltip.style.top = `${Math.max(8, Math.min(top + 14, container.clientHeight - tooltip.offsetHeight - 8))}px`;
    }
    $("timeline-chart").addEventListener("pointermove", (event) => {
      if (!state.chart) return;
      const svg = $("timeline-chart");
      const rect = svg.getBoundingClientRect();
      const container = $("chart-container").getBoundingClientRect();
      const localX = event.clientX - container.left;
      const localY = event.clientY - container.top;
      const marker = event.target.closest("[data-event-index]");
      if (marker) { showTooltip(eventDescription(state.chart.events[Number(marker.dataset.eventIndex)]), localX, localY); return; }
      const svgX = (event.clientX - rect.left) / rect.width * state.chart.width;
      const {plot, min, max} = state.chart;
      if (svgX < plot.left || svgX > plot.right) { $("chart-tooltip").hidden = true; return; }
      const time = min + (svgX - plot.left) / (plot.right - plot.left) * (max - min);
      const cursor = $("chart-cursor-line");
      cursor.setAttribute("x1", svgX); cursor.setAttribute("x2", svgX); cursor.setAttribute("visibility", "visible");
      showTooltip(sampleText(time), localX, localY);
    });
    $("timeline-chart").addEventListener("pointerleave", () => {
      $("chart-tooltip").hidden = true;
      $("chart-cursor-line")?.setAttribute("visibility", "hidden");
    });
    $("chart-scroll").addEventListener("scroll", () => {
      $("chart-tooltip").hidden = true;
    });
    $("sample-cursor").addEventListener("input", () => {
      if (!state.chart) return;
      const {min, max, x} = state.chart;
      const time = min + Number($("sample-cursor").value) / 1000 * (max - min);
      $("sample-readout").textContent = sampleText(time);
      const cursor = $("chart-cursor-line");
      cursor.setAttribute("x1", x(time)); cursor.setAttribute("x2", x(time)); cursor.setAttribute("visibility", "visible");
      const scroll = $("chart-scroll");
      scroll.scrollTo({left: x(time) - scroll.clientWidth / 2});
    });
    if (showEvents) for (const [name, range] of [["chart-event-range", "events"], ["chart-full-range", "full"]]) {
      $(name).addEventListener("click", () => {
        state.range = range;
        if (state.data) renderChart(state.data);
      });
    }
    if (showEvents) $("chart-time-scale").addEventListener("change", () => {
      const scroll = $("chart-scroll");
      const chart = state.chart;
      const center = chart ? chart.min + (scroll.scrollLeft + scroll.clientWidth / 2 - chart.plot.left)
        / (chart.plot.right - chart.plot.left) * (chart.max - chart.min) : null;
      state.scale = Number($("chart-time-scale").value);
      if (state.data) {
        renderChart(state.data);
        if (center !== null) scroll.scrollLeft = state.chart.x(center) - scroll.clientWidth / 2;
      }
    });
    return {
      render: renderChart,
      clear() {
        state.chart = state.data = null;
        $("timeline-chart").replaceChildren();
        $("series-controls").replaceChildren();
        $("chart-tooltip").hidden = true;
        $("chart-container").hidden = true;
        $("chart-empty").hidden = true;
        $("sample-navigation").hidden = true;
        $("sample-readout").textContent = "";
      }
    };
  }
  const sandboxTimeline = createTimeline("", true);
  const globalTimeline = createTimeline("global-", false);
  $("refresh-button").addEventListener("click", loadScenarios);
  $("scenario-select").addEventListener("change", loadScenario);
  $("sandbox-select").addEventListener("change", loadSandbox);
  loadScenarios();
})();
