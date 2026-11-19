// UI text. English is the base; a key missing in a language falls back to English.
// One JSON file per language in ./locales (the same 38 languages as fact-dock.com).
import * as obsidian from "obsidian";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import es from "./locales/es.json";
import pt from "./locales/pt.json";
import fr from "./locales/fr.json";
import de from "./locales/de.json";
import it from "./locales/it.json";
import ru from "./locales/ru.json";
import nl from "./locales/nl.json";
import sv from "./locales/sv.json";
import cs from "./locales/cs.json";
import ro from "./locales/ro.json";
import el from "./locales/el.json";
import pl from "./locales/pl.json";
import uk from "./locales/uk.json";
import zhCn from "./locales/zh-cn.json";
import zhTw from "./locales/zh-tw.json";
import ko from "./locales/ko.json";
import th from "./locales/th.json";
import id from "./locales/id.json";
import vi from "./locales/vi.json";
import hi from "./locales/hi.json";
import bn from "./locales/bn.json";
import ms from "./locales/ms.json";
import fil from "./locales/fil.json";
import ta from "./locales/ta.json";
import te from "./locales/te.json";
import mr from "./locales/mr.json";
import my from "./locales/my.json";
import uz from "./locales/uz.json";
import ur from "./locales/ur.json";
import ar from "./locales/ar.json";
import am from "./locales/am.json";
import ha from "./locales/ha.json";
import sw from "./locales/sw.json";
import tr from "./locales/tr.json";
import fa from "./locales/fa.json";
import he from "./locales/he.json";

type Dict = Record<string, string>;

const DICTS: Record<string, Dict> = {
  en, ja, es, pt, fr, de, it, ru, nl, sv, cs, ro, el, pl, uk, "zh-cn": zhCn, "zh-tw": zhTw, ko, th, id, vi,
  hi, bn, ms, fil, ta, te, mr, my, uz, ur, ar, am, ha, sw, tr, fa, he,
};
// Obsidian's own language codes that differ from ours.
const ALIASES: Record<string, string> = {
  zh: "zh-cn", "zh-hans": "zh-cn", "zh-hant": "zh-tw", "zh-hk": "zh-tw", tl: "fil", "pt-br": "pt", iw: "he",
};

/** Obsidian's interface language. getLanguage() exists from Obsidian 1.8; older versions fall back. */
export function obsidianLanguage(): string {
  const api = obsidian as unknown as { getLanguage?: () => string; moment?: { locale: () => string } };
  try { if (typeof api.getLanguage === "function") return api.getLanguage() || "en"; } catch { /* fall back */ }
  return api.moment?.locale() || "en";
}

function uiLang(): string {
  const l = obsidianLanguage().toLowerCase();
  const pick = (c: string) => (DICTS[c] ? c : ALIASES[c] && DICTS[ALIASES[c]] ? ALIASES[c] : "");
  return pick(l) || pick(l.split("-")[0]) || "en";
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let s = DICTS[uiLang()][key] ?? (en as Dict)[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
