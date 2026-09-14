const SUPPORTED_LANGS = ["en", "zh", "ja", "es", "pt", "ko", "fr", "de", "ar"];
const LANG_NAMES = {
  en: "English",
  zh: "中文",
  ja: "日本語",
  es: "Español",
  pt: "Português",
  ko: "한국어",
  fr: "Français",
  de: "Deutsch",
  ar: "العربية",
};
const FONT_FACES = {
  en: '"DM Sans", sans-serif',
  zh: '"Noto Sans SC", "DM Sans", sans-serif',
  ja: '"Noto Sans SC", "DM Sans", sans-serif',
  es: '"DM Sans", sans-serif',
  pt: '"DM Sans", sans-serif',
  ko: '"Noto Sans SC", "DM Sans", sans-serif',
  fr: '"DM Sans", sans-serif',
  de: '"DM Sans", sans-serif',
  ar: '"DM Sans", sans-serif',
};

let currentLang = "en";
let translations = {};
const listeners = [];

function detectBrowserLang() {
  try {
    const nav = navigator.languages?.[0] || navigator.language || "en";
    const tag = nav.toLowerCase().replace("-", "-");
    const base = tag.split("-")[0];
    if (SUPPORTED_LANGS.includes(tag)) return tag;
    if (SUPPORTED_LANGS.includes(base)) return base;
  } catch {}
  return "en";
}

function loadTranslations(lang) {
  if (translations[lang]) return Promise.resolve(translations[lang]);
  return fetch(`/locales/${lang}.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load ${lang}`);
      return res.json();
    })
    .then((data) => {
      translations[lang] = data;
      return data;
    })
    .catch(() => {
      if (lang !== "en") return loadTranslations("en");
      return {};
    });
}

export function initI18n() {
  const saved = null;
  try {
    const raw = localStorage.getItem("welo-lang");
    if (raw && SUPPORTED_LANGS.includes(raw)) return raw;
  } catch {}
  const detected = detectBrowserLang();
  const lang = saved || detected;
  setLang(lang, true);
  return lang;
}

export function setLang(lang, silent = false) {
  if (!SUPPORTED_LANGS.includes(lang)) lang = "en";
  currentLang = lang;
  try {
    localStorage.setItem("welo-lang", lang);
  } catch {}
  document.documentElement.lang = lang;
  const font = FONT_FACES[lang] || FONT_FACES.en;
  document.documentElement.style.fontFamily = font;
  loadTranslations(lang).then((data) => {
    translations = data;
    if (!silent) {
      listeners.forEach((fn) => fn(lang, data));
    }
  });
}

export function t(key) {
  const parts = key.split(".");
  let obj = translations;
  for (const part of parts) {
    if (obj == null || typeof obj !== "object") return key;
    obj = obj[part];
  }
  return obj != null && typeof obj !== "object" ? obj : key;
}

export function tFallback(key) {
  if (currentLang !== "en") {
    const enParts = key.split(".");
    let obj = translations["en"];
    for (const part of enParts) {
      if (obj == null || typeof obj !== "object") return key;
      obj = obj[part];
    }
    if (obj != null && typeof obj !== "object") return obj;
  }
  return t(key);
}

export function getLang() {
  return currentLang;
}

export function getSupportedLangs() {
  return SUPPORTED_LANGS;
}

export function getLangName(lang) {
  return LANG_NAMES[lang] || lang;
}

export function onLangChange(fn) {
  listeners.push(fn);
}

export function getFontFamily() {
  return FONT_FACES[currentLang] || FONT_FACES.en;
}
