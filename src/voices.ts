// Opinionated read-aloud voices: one natural-sounding female voice per language,
// listed in order of preference across Edge, Chrome, and Apple devices (Safari, Mac, iPhone).
// The first name the reader's device actually has wins. An entry can also be a voiceURI
// (Safari reports Apple voices as e.g. com.apple.voice.premium.zh-TW.Meijia).
// To add a language, add an entry.

type VoicePrefs = { primary: string; accepts: (lang: string) => boolean; names: string[] };

export const VOICE_PREFS: Record<string, VoicePrefs> = {
  en: {
    primary: 'en-us',
    accepts: (lang) => lang.startsWith('en'),
    names: [
      'Microsoft Ava Online (Natural)', // Edge
      'Microsoft Jenny Online (Natural)',
      'Microsoft Aria Online (Natural)',
      'Google US English', // Chrome: the online voice beats Apple's voices there
      'com.apple.voice.premium.en-US.Ava', // Apple, after downloading in Settings
      'Ava (Premium)',
      'com.apple.voice.premium.en-US.Zoe',
      'Zoe (Premium)',
      'com.apple.voice.enhanced.en-US.Ava',
      'Ava (Enhanced)',
      'com.apple.voice.enhanced.en-US.Zoe',
      'Zoe (Enhanced)',
      'com.apple.voice.enhanced.en-US.Samantha',
      'Samantha (Enhanced)',
      'Samantha', // Apple built-in
      'Microsoft Zira', // Windows built-in
    ],
  },
  ja: {
    primary: 'ja-jp',
    accepts: (lang) => lang.startsWith('ja'),
    names: [
      'Microsoft Nanami Online (Natural)',
      'Google 日本語', // Chrome: the online voice beats Apple's voices there
      'O-Ren (Premium)', // Apple, after downloading in Settings
      'com.apple.voice.enhanced.ja-JP.Kyoko',
      'Kyoko (Enhanced)',
      'O-Ren (Enhanced)',
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
      'Google 國語（臺灣）', // Chrome: the online voice beats Apple's voices there
      'com.apple.voice.premium.zh-TW.Meijia', // Apple, after downloading in Settings
      'Meijia (Premium)',
      'Mei-Jia (Premium)',
      'com.apple.voice.enhanced.zh-TW.Meijia',
      'Meijia (Enhanced)',
      'Mei-Jia (Enhanced)',
      'Meijia', // Apple built-in (macOS spells it without a hyphen)
      'Mei-Jia',
      'Microsoft Hanhan',
    ],
  },
};

// Apple's novelty and Eloquence voices (Bubbles, Grandpa, ...) are never a good fallback.
const NOVELTY =
  /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Eddy|Flo|Fred|Good News|Grandma|Grandpa|Jester|Junior|Organ|Ralph|Reed|Rocko|Sandy|Shelley|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/;

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
    const match = inLang.find((v) => v.voiceURI === name || v.name === name || v.name.startsWith(`${name} `));
    if (match) return match;
  }
  // Unknown device: prefer anything labelled natural/premium/enhanced in the right language,
  // then the device default, and never a novelty voice when a normal one exists.
  const normal = inLang.filter((v) => !NOVELTY.test(v.name));
  return (
    normal.find((v) => /natural|neural|premium|enhanced/i.test(`${v.name} ${v.voiceURI}`)) ??
    normal.find((v) => v.default) ??
    normal.find((v) => normalize(v.lang) === prefs.primary) ??
    normal[0] ??
    inLang[0]
  );
}
