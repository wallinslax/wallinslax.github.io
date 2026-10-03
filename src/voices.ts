// Opinionated read-aloud voices: one natural-sounding female voice per language,
// listed in order of preference across Edge, Chrome, and Apple devices (Safari, Mac, iPhone).
// The first name the reader's device actually has wins. To add a language, add an entry.

type VoicePrefs = { primary: string; accepts: (lang: string) => boolean; names: string[] };

export const VOICE_PREFS: Record<string, VoicePrefs> = {
  en: {
    primary: 'en-us',
    accepts: (lang) => lang.startsWith('en'),
    names: [
      'Microsoft Ava Online (Natural)', // Edge
      'Microsoft Jenny Online (Natural)',
      'Microsoft Aria Online (Natural)',
      'Ava (Premium)', // Apple, after downloading in Settings
      'Zoe (Premium)',
      'Ava (Enhanced)',
      'Zoe (Enhanced)',
      'Samantha (Enhanced)',
      'Google US English', // Chrome desktop
      'Samantha', // Apple built-in
      'Microsoft Zira', // Windows built-in
    ],
  },
  ja: {
    primary: 'ja-jp',
    accepts: (lang) => lang.startsWith('ja'),
    names: [
      'Microsoft Nanami Online (Natural)',
      'O-Ren (Premium)',
      'Kyoko (Enhanced)',
      'O-Ren (Enhanced)',
      'Google 日本語',
      'Kyoko',
      'O-Ren',
      'Microsoft Haruka',
    ],
  },
  'zh-TW': {
    primary: 'zh-tw',
    accepts: (lang) => lang === 'zh-tw' || lang.startsWith('zh-hant'),
    names: [
      'Microsoft HsiaoChen Online (Natural)',
      'Microsoft HsiaoYu Online (Natural)',
      'Mei-Jia (Premium)',
      'Mei-Jia (Enhanced)',
      'Google 國語（臺灣）',
      'Mei-Jia',
      'Microsoft Hanhan',
    ],
  },
};

const normalize = (lang: string) => lang.replace('_', '-').toLowerCase();

/** Maps a page language like "en", "ja-JP", or "zh-Hant-TW" to a key of VOICE_PREFS. */
export function prefsKey(lang: string) {
  const l = normalize(lang || 'en');
  if (l.startsWith('zh')) return 'zh-TW';
  if (l.startsWith('ja')) return 'ja';
  return 'en';
}

/** Picks the preferred voice for a language from what the device offers, or a sensible fallback. */
export function pickVoice(all: SpeechSynthesisVoice[], lang: string) {
  const prefs = VOICE_PREFS[prefsKey(lang)];
  const inLang = all.filter((v) => prefs.accepts(normalize(v.lang)));
  for (const name of prefs.names) {
    const match = inLang.find((v) => v.name === name || v.name.startsWith(`${name} `));
    if (match) return match;
  }
  // Unknown device: prefer anything labelled natural/premium/enhanced in the right language.
  return (
    inLang.find((v) => /natural|neural|premium|enhanced/i.test(v.name)) ??
    inLang.find((v) => normalize(v.lang) === prefs.primary) ??
    inLang[0]
  );
}
