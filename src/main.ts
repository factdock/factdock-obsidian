import {
  App, ItemView, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting,
  TFile, WorkspaceLeaf, normalizePath, requestUrl,
} from "obsidian";
import { obsidianLanguage, t } from "./i18n";

// Factdock for Obsidian.
// Talks to the same endpoint as Factdock's MCP server (https://fact-dock.com/mcp) with the
// user's own personal API key. Billing, limits and refunds are all handled there — this plugin
// only shows the price first, runs the search the user confirmed, and writes results into notes.

const ENDPOINT = "https://fact-dock.com/mcp";
const VIEW_TYPE = "factdock-results";
const SPHERES = ["en_global", "zh-CN", "zh-TW", "es", "pt", "fr", "ar"] as const;
// Countries offered in the picker (ISO 3166-1 alpha-2). Names come from Intl.DisplayNames.
const COUNTRIES = [
  "US", "GB", "CA", "AU", "NZ", "IE", "IN", "SG", "PH", "MY", "ID", "TH", "VN", "KH", "MM", "BD", "PK", "LK", "NP",
  "JP", "KR", "CN", "TW", "HK", "MN", "KZ", "UZ", "DE", "AT", "CH", "FR", "BE", "NL", "LU", "IT", "ES", "PT", "GR",
  "SE", "NO", "DK", "FI", "IS", "PL", "CZ", "SK", "HU", "RO", "BG", "HR", "SI", "RS", "UA", "EE", "LV", "LT", "TR",
  "IL", "SA", "AE", "QA", "KW", "EG", "MA", "DZ", "TN", "NG", "KE", "ET", "GH", "ZA", "MX", "BR", "AR", "CL", "CO",
  "PE", "UY", "EC", "VE", "CR", "PA", "DO", "GT",
];
const LANGS = [
  "en", "ja", "zh-CN", "zh-TW", "ko", "es", "pt", "fr", "de", "it", "nl", "pl", "ru", "uk", "tr", "ar", "he", "fa",
  "hi", "bn", "ur", "id", "ms", "th", "vi", "fil", "sv", "no", "da", "fi", "cs", "hu", "ro", "el", "bg", "sw",
];

type ToolName = "web_search" | "academic_search";

interface FactdockSettings {
  apiKey: string;
  folder: string;
  lang: string;
  lastZone: string;
  lastTool: ToolName;
}
const DEFAULTS: FactdockSettings = { apiKey: "", folder: "Factdock", lang: "", lastZone: "", lastTool: "web_search" };

interface ResultItem {
  title: string;
  url: string;
  publisher: string;
  date: string;
  originalLang: string;
  summary: string;
}
interface SearchRun {
  tool: ToolName;
  query: string;
  zone: string;
  lang: string;
  at: string;
  items: ResultItem[];
  creditsUsed: number | null;
}

// ── Talking to Factdock ───────────────────────────────────────────────────
let rpcId = 0;
class FactdockError extends Error {
  constructor(message: string, readonly network = false) { super(message); }
}

async function rpc(key: string, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  let res;
  try {
    res = await requestUrl({
      url: ENDPOINT,
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
      throw: false,
    });
  } catch {
    throw new FactdockError(t("errNetwork"), true);
  }
  const text = res.text ?? "";
  // The server answers with JSON; through some relays it may come as one SSE "data:" line.
  let body: Record<string, unknown> | null = null;
  const tryParse = (s: string) => { try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; } };
  body = tryParse(text);
  if (!body) {
    const lines = text.split(/\r?\n/).filter((l) => l.startsWith("data:"));
    for (let i = lines.length - 1; i >= 0 && !body; i--) body = tryParse(lines[i].slice(5).trim());
  }
  if (!body) throw new FactdockError(res.status >= 500 ? t("errServer") : `HTTP ${res.status}`, res.status >= 500);
  const err = body.error as { message?: string } | undefined;
  if (err) throw new FactdockError(String(err.message ?? `HTTP ${res.status}`));
  return (body.result ?? {}) as Record<string, unknown>;
}

async function callTool(key: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const r = await rpc(key, "tools/call", { name, arguments: args });
  const content = Array.isArray(r.content) ? r.content as Array<{ type?: string; text?: string }> : [];
  const text = content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
  if (r.isError) throw new FactdockError(text || t("errServer"));
  try { return JSON.parse(text); } catch { return text; }
}

function str(v: unknown): string { return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : ""; }

function toItems(data: unknown): ResultItem[] {
  const d = (data ?? {}) as Record<string, unknown>;
  const list = [
    ...(Array.isArray(d.results) ? d.results : []),
    ...(Array.isArray(d.lite_results) ? d.lite_results : []),
  ] as Array<Record<string, unknown>>;
  const seen = new Set<string>();
  const out: ResultItem[] = [];
  for (const r of list) {
    const url = str(r.url) || str(r.link) || str(r.doi_url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      // Titles, URLs, publishers and dates are passed through exactly as Factdock returned them.
      title: str(r.title_translated) || str(r.title) || url,
      url,
      publisher: str(r.publisher) || str(r.journal) || str(r.venue) || str(r.source),
      date: shortDate(str(r.published_date) || str(r.year) || str(r.publication_date)),
      originalLang: str(r.source_lang) || str(r.language),
      summary: str(r.summary) || str(r.snippet_translated) || str(r.headline_15) || str(r.abstract_translated),
    });
  }
  return out;
}

/** "2024-04-01T00:00:00.000Z" → "2024-04-01". Other forms ("2024", "2024-04") are kept as they are. */
function shortDate(v: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(v);
  return m ? m[1] : v;
}
/** Today's date on this computer (not UTC), as YYYY-MM-DD. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function zoneLabel(zone: string, lang: string): string {
  if (zone.startsWith("cc_")) {
    try { return new Intl.DisplayNames([lang || "en"], { type: "region" }).of(zone.slice(3)) ?? zone; } catch { return zone; }
  }
  return t(`sphere_${zone}`);
}
function langLabel(code: string, ui: string): string {
  try { return new Intl.DisplayNames([ui || "en"], { type: "language" }).of(code) ?? code; } catch { return code; }
}
function yamlStr(s: string): string { return JSON.stringify(s); }
function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|#^[\]\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Factdock";
}

// ── Plugin ────────────────────────────────────────────────────────────────
export default class FactdockPlugin extends Plugin {
  settings: FactdockSettings = { ...DEFAULTS };
  lastRun: SearchRun | null = null;
  busy = false;

  async onload() {
    this.settings = { ...DEFAULTS, ...(await this.loadData()) };
    if (!this.settings.lang) this.settings.lang = defaultLang();
    this.registerView(VIEW_TYPE, (leaf) => new ResultsView(leaf, this));
    this.addRibbonIcon("search", t("ribbonSearch"), () => this.openSearch());
    this.addCommand({ id: "search", name: t("cmdSearch"), callback: () => this.openSearch() });
    this.addCommand({ id: "show-results", name: t("cmdShowResults"), callback: () => this.showResults() });
    this.addSettingTab(new FactdockSettingTab(this.app, this));
  }

  async saveSettings() { await this.saveData(this.settings); }

  openSearch() {
    if (!this.settings.apiKey) {
      new Notice(t("needKey"));
      return;
    }
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const selected = view?.editor.getSelection().trim() ?? "";
    new SearchModal(this.app, this, selected).open();
  }

  async showResults(): Promise<ResultsView> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false)!;
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
    return leaf.view as ResultsView;
  }

  async runSearch(tool: ToolName, query: string, zone: string, lang: string) {
    if (this.busy) { new Notice(t("busy")); return; }
    this.busy = true;
    const view = await this.showResults();
    view.renderLoading(query);
    const args: Record<string, unknown> = tool === "web_search" ? { query, zone, lang } : { query, lang };
    try {
      let data: unknown;
      try {
        data = await callTool(this.settings.apiKey, tool, args);
      } catch (e) {
        // A paid result that did not arrive is held by Factdock for 10 minutes. Receiving it is free
        // and does not run the search again.
        if (!(e instanceof FactdockError && e.network)) throw e;
        const held = await callTool(this.settings.apiKey, "get_pending_result", {});
        if ((held as Record<string, unknown>)?.pending === false) throw e;
        data = held;
      }
      const d = (data ?? {}) as Record<string, unknown>;
      this.lastRun = {
        tool, query, zone, lang, at: localToday(),
        items: toItems(d), creditsUsed: typeof d.credits_used === "number" ? d.credits_used : null,
      };
      view.render();
    } catch (e) {
      view.renderError(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy = false;
    }
  }

  /** Insert one result at the cursor of the most recent note (as a callout with its source). */
  insertIntoNote(item: ResultItem) {
    const leaf = this.app.workspace.getMostRecentLeaf();
    const view = leaf?.view instanceof MarkdownView ? leaf.view
      : this.app.workspace.getLeavesOfType("markdown").map((l) => l.view as MarkdownView)[0];
    if (!view) { new Notice(t("noNote")); return; }
    const editor = view.editor;
    if (editor.getValue().includes(item.url)) { new Notice(t("already")); return; }
    const meta = [item.publisher, item.date, item.originalLang && `${t("original")}: ${item.originalLang}`].filter(Boolean).join(" · ");
    const lines = [
      `> [!cite] [${item.title.replace(/[[\]]/g, "")}](${item.url})`,
      ...(meta ? [`> ${meta}`] : []),
      ...(item.summary ? [">", ...item.summary.split(/\r?\n/).map((l) => `> ${l}`)] : []),
      "",
    ];
    editor.replaceSelection(lines.join("\n") + "\n");
    new Notice(t("inserted"));
  }

  /** Create a new note for one result, with its source in the properties. */
  async newNote(item: ResultItem) {
    const run = this.lastRun;
    const folder = normalizePath(this.settings.folder || "Factdock");
    if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    let path = normalizePath(`${folder}/${safeFileName(item.title)}.md`);
    for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) {
      path = normalizePath(`${folder}/${safeFileName(item.title)} ${i}.md`);
    }
    const fm = [
      "---",
      "source: Factdock",
      ...(run ? [`query: ${yamlStr(run.query)}`, ...(run.zone ? [`country: ${yamlStr(run.zone.replace(/^cc_/, ""))}`] : []), `result_language: ${yamlStr(run.lang)}`] : []),
      ...(item.publisher ? [`publisher: ${yamlStr(item.publisher)}`] : []),
      ...(item.date ? [`published: ${yamlStr(item.date)}`] : []),
      ...(item.originalLang ? [`original_language: ${yamlStr(item.originalLang)}`] : []),
      `url: ${yamlStr(item.url)}`,
      `retrieved: ${run?.at ?? localToday()}`,
      "tags: [factdock]",
      "---",
    ];
    const body = [`# ${item.title}`, "", ...(item.summary ? [item.summary, ""] : []), `${t("original")}: [${item.publisher || item.url}](${item.url})`, ""];
    const file = await this.app.vault.create(path, [...fm, "", ...body].join("\n"));
    if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file);
  }
}

function defaultLang(): string {
  const ui = (obsidianLanguage() || navigator.language || "en").trim();
  if (/^zh/i.test(ui)) return /tw|hk|hant/i.test(ui) ? "zh-TW" : "zh-CN";
  const base = ui.split("-")[0].toLowerCase();
  return LANGS.includes(base) ? base : "en";
}

// ── Search modal: choose, see the price, then search ──────────────────────
class SearchModal extends Modal {
  private tool: ToolName;
  private query: string;
  private zone: string;
  private lang: string;
  private priceEl!: HTMLElement;
  private goBtn!: HTMLButtonElement;
  private price: number | null = null;

  constructor(app: App, private plugin: FactdockPlugin, selected: string) {
    super(app);
    const s = plugin.settings;
    this.tool = s.lastTool;
    this.query = selected;
    this.zone = s.lastZone; // the user must choose it at least once; never guessed
    this.lang = s.lang;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("factdock-modal");
    contentEl.createEl("h3", { text: t("modalTitle") });

    new Setting(contentEl).setName(t("query")).addTextArea((ta) => {
      ta.setValue(this.query).onChange((v) => { this.query = v; this.refreshButton(); });
      ta.inputEl.rows = 2;
      ta.inputEl.addClass("factdock-query");
      window.setTimeout(() => ta.inputEl.focus(), 0);
    });
    new Setting(contentEl).setName(t("tool")).addDropdown((dd) => {
      dd.addOption("web_search", t("tool_web")).addOption("academic_search", t("tool_academic"))
        .setValue(this.tool).onChange((v) => { this.tool = v as ToolName; this.redraw(); });
    });
    if (this.tool === "web_search") {
      new Setting(contentEl).setName(t("zone")).setDesc(t("zoneDesc")).addDropdown((dd) => {
        dd.addOption("", t("choose"));
        for (const sp of SPHERES) dd.addOption(sp, `${t("sphere")}: ${zoneLabel(sp, this.lang)}`);
        const names = COUNTRIES.map((c) => ({ c, n: zoneLabel(`cc_${c}`, this.lang) }))
          .sort((a, b) => a.n.localeCompare(b.n, this.lang));
        for (const { c, n } of names) dd.addOption(`cc_${c}`, n);
        dd.setValue(this.zone).onChange((v) => { this.zone = v; this.loadPrice(); });
      });
    }
    new Setting(contentEl).setName(t("lang")).setDesc(t("langDesc")).addDropdown((dd) => {
      for (const l of LANGS) dd.addOption(l, langLabel(l, this.lang));
      dd.setValue(this.lang).onChange((v) => { this.lang = v; this.loadPrice(); });
    });

    this.priceEl = contentEl.createDiv({ cls: "factdock-price" });
    const row = contentEl.createDiv({ cls: "factdock-buttons" });
    row.createEl("button", { text: t("cancel") }).onclick = () => this.close();
    this.goBtn = row.createEl("button", { cls: "mod-cta", text: t("search") });
    this.goBtn.onclick = () => this.submit();
    this.loadPrice();
  }

  private redraw() { this.contentEl.empty(); this.onOpen(); }

  private refreshButton() {
    const ready = this.query.trim().length >= 2 && (this.tool !== "web_search" || !!this.zone) && this.price !== null;
    this.goBtn.disabled = !ready;
    this.goBtn.setText(this.price !== null ? t("searchFor", { n: this.price }) : t("search"));
  }

  private async loadPrice() {
    this.price = null;
    this.refreshButton();
    if (this.tool === "web_search" && !this.zone) { this.priceEl.setText(t("chooseZoneFirst")); return; }
    this.priceEl.setText(t("priceLoading"));
    try {
      const p = await callTool(this.plugin.settings.apiKey, "get_prices", { lang: this.lang, tool: this.tool }) as {
        tools?: Array<{ prices?: Array<{ item: string; credits: number }> }>;
      };
      const lines = p.tools?.[0]?.prices ?? [];
      if (!lines.length) throw new Error(t("errServer"));
      if (this.tool === "web_search" && !this.zone.startsWith("cc_")) {
        // A language sphere costs by its number of countries; show the range and charge what Factdock charges.
        const spheres = lines.filter((l) => /sphere/i.test(l.item)).map((l) => l.credits);
        const lo = Math.min(...spheres), hi = Math.max(...spheres);
        this.price = hi;
        this.priceEl.setText(t("priceSphere", { lo, hi }));
      } else {
        this.price = lines[0].credits;
        this.priceEl.setText(t("priceOne", { n: this.price }));
      }
    } catch (e) {
      this.priceEl.setText(e instanceof Error ? e.message : String(e));
    }
    this.refreshButton();
  }

  private async submit() {
    if (this.goBtn.disabled) return;
    const s = this.plugin.settings;
    s.lastTool = this.tool; s.lang = this.lang; if (this.zone) s.lastZone = this.zone;
    await this.plugin.saveSettings();
    this.close();
    void this.plugin.runSearch(this.tool, this.query.trim(), this.zone, this.lang);
  }

  onClose() { this.contentEl.empty(); }
}

// ── Results panel ─────────────────────────────────────────────────────────
class ResultsView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: FactdockPlugin) { super(leaf); }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return t("resultsTitle"); }
  getIcon() { return "search"; }
  async onOpen() { this.render(); }

  private root(): HTMLElement {
    const el = this.containerEl.children[1] as HTMLElement;
    el.empty();
    el.addClass("factdock-view");
    return el;
  }

  renderLoading(query: string) {
    const el = this.root();
    el.createEl("h4", { text: t("resultsTitle") });
    el.createDiv({ cls: "factdock-status", text: t("searching", { q: query }) });
    el.createDiv({ cls: "factdock-hint", text: t("searchingHint") });
  }

  renderError(message: string) {
    const el = this.root();
    el.createEl("h4", { text: t("resultsTitle") });
    el.createDiv({ cls: "factdock-error", text: message });
  }

  render() {
    const el = this.root();
    const run = this.plugin.lastRun;
    const head = el.createDiv({ cls: "factdock-head" });
    head.createEl("h4", { text: t("resultsTitle") });
    if (!run) {
      el.createDiv({ cls: "factdock-hint", text: t("emptyHint") });
      const b = el.createEl("button", { cls: "mod-cta", text: t("ribbonSearch") });
      b.onclick = () => this.plugin.openSearch();
      return;
    }
    const where = run.zone ? zoneLabel(run.zone, run.lang) : t("tool_academic");
    head.createDiv({ cls: "factdock-meta", text: `${run.query} · ${where} · ${t("count", { n: run.items.length })}` });
    if (run.creditsUsed !== null) head.createDiv({ cls: "factdock-meta", text: t("used", { n: run.creditsUsed }) });
    if (!run.items.length) { el.createDiv({ cls: "factdock-hint", text: t("noResults") }); return; }
    for (const item of run.items) {
      const card = el.createDiv({ cls: "factdock-card" });
      card.createDiv({ cls: "factdock-title", text: item.title });
      const meta = [item.publisher, item.date, item.originalLang && `${t("original")}: ${item.originalLang}`].filter(Boolean).join(" · ");
      if (meta) card.createDiv({ cls: "factdock-meta", text: meta });
      if (item.summary) card.createDiv({ cls: "factdock-summary", text: item.summary });
      const acts = card.createDiv({ cls: "factdock-acts" });
      acts.createEl("button", { cls: "mod-cta", text: t("insert") }).onclick = () => this.plugin.insertIntoNote(item);
      acts.createEl("button", { text: t("newNote") }).onclick = () => void this.plugin.newNote(item);
      acts.createEl("button", { text: t("open") }).onclick = () => window.open(item.url, "_blank");
    }
  }
}

// ── Settings ──────────────────────────────────────────────────────────────
class FactdockSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: FactdockPlugin) { super(app, plugin); }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    new Setting(containerEl).setName(t("apiKey")).setDesc(t("apiKeyDesc")).addText((tx) => {
      tx.inputEl.type = "password";
      tx.setPlaceholder("fdu_…").setValue(s.apiKey).onChange(async (v) => { s.apiKey = v.trim(); await this.plugin.saveSettings(); });
    });
    const status = new Setting(containerEl).setName(t("status")).setDesc(t("statusDesc"));
    status.addButton((b) => b.setButtonText(t("check")).onClick(async () => {
      status.setDesc(t("checking"));
      try {
        await rpc(s.apiKey, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "obsidian-factdock", version: this.plugin.manifest.version } });
        status.setDesc(t("connected"));
      } catch (e) {
        status.setDesc(e instanceof Error ? e.message : String(e));
      }
    }));
    new Setting(containerEl).setName(t("folder")).setDesc(t("folderDesc")).addText((tx) => {
      tx.setValue(s.folder).onChange(async (v) => { s.folder = v.trim() || "Factdock"; await this.plugin.saveSettings(); });
    });
    new Setting(containerEl).setName(t("lang")).setDesc(t("langDesc")).addDropdown((dd) => {
      for (const l of LANGS) dd.addOption(l, langLabel(l, s.lang));
      dd.setValue(s.lang).onChange(async (v) => { s.lang = v; await this.plugin.saveSettings(); });
    });
    containerEl.createEl("p", { cls: "setting-item-description", text: t("about") });
  }
}
