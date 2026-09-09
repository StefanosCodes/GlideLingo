import type { AudioClipId, Course } from '@/constants/catalog';

export type LetterReference = {
  id: string;
  upper: string;
  lower: string;
  name: string;
  sound: string;
  example: string;
  meaning: string;
  note?: string;
  lessonId?: string;
  audioId?: AudioClipId;
};

export const greekLetters: LetterReference[] = [
  { id: 'alpha', upper: 'Α', lower: 'α', name: 'Alpha', sound: 'a as in father', example: 'αλάτι', meaning: 'salt', lessonId: 'el-letters-1', audioId: 'el-letter-alpha' },
  { id: 'vita', upper: 'Β', lower: 'β', name: 'Vita', sound: 'v as in voice', example: 'βάρκα', meaning: 'boat' },
  { id: 'gamma', upper: 'Γ', lower: 'γ', name: 'Gamma', sound: 'a soft g sound', example: 'γάλα', meaning: 'milk', note: 'Its sound changes before ε and ι sounds.' },
  { id: 'delta', upper: 'Δ', lower: 'δ', name: 'Delta', sound: 'th as in this', example: 'δέντρο', meaning: 'tree' },
  { id: 'epsilon', upper: 'Ε', lower: 'ε', name: 'Epsilon', sound: 'e as in red', example: 'ένα', meaning: 'one', lessonId: 'el-letters-1', audioId: 'el-letter-epsilon' },
  { id: 'zita', upper: 'Ζ', lower: 'ζ', name: 'Zita', sound: 'z as in zoo', example: 'ζάχαρη', meaning: 'sugar' },
  { id: 'ita', upper: 'Η', lower: 'η', name: 'Ita', sound: 'ee as in see', example: 'ήλιος', meaning: 'sun' },
  { id: 'thita', upper: 'Θ', lower: 'θ', name: 'Thita', sound: 'th as in thing', example: 'θέλω', meaning: 'I want' },
  { id: 'iota', upper: 'Ι', lower: 'ι', name: 'Iota', sound: 'ee as in see', example: 'ιστορία', meaning: 'story', lessonId: 'el-letters-1', audioId: 'el-letter-iota' },
  { id: 'kappa', upper: 'Κ', lower: 'κ', name: 'Kappa', sound: 'k as in key', example: 'καφές', meaning: 'coffee' },
  { id: 'lamda', upper: 'Λ', lower: 'λ', name: 'Lamda', sound: 'l as in light', example: 'λεμόνι', meaning: 'lemon' },
  { id: 'mi', upper: 'Μ', lower: 'μ', name: 'Mi', sound: 'm as in map', example: 'μέρα', meaning: 'day' },
  { id: 'ni', upper: 'Ν', lower: 'ν', name: 'Ni', sound: 'n as in name', example: 'νερό', meaning: 'water' },
  { id: 'xi', upper: 'Ξ', lower: 'ξ', name: 'Xi', sound: 'x as in box', example: 'ξέρω', meaning: 'I know' },
  { id: 'omicron', upper: 'Ο', lower: 'ο', name: 'Omicron', sound: 'o as in off', example: 'όνομα', meaning: 'name' },
  { id: 'pi', upper: 'Π', lower: 'π', name: 'Pi', sound: 'p as in pen', example: 'παρακαλώ', meaning: 'please' },
  { id: 'ro', upper: 'Ρ', lower: 'ρ', name: 'Ro', sound: 'a tapped or rolled r', example: 'ρύζι', meaning: 'rice' },
  { id: 'sigma', upper: 'Σ', lower: 'σ / ς', name: 'Sigma', sound: 's as in sun', example: 'σπίτι', meaning: 'house', note: 'Use ς only at the end of a word.' },
  { id: 'taf', upper: 'Τ', lower: 'τ', name: 'Taf', sound: 't as in stop', example: 'τώρα', meaning: 'now' },
  { id: 'ipsilon', upper: 'Υ', lower: 'υ', name: 'Ipsilon', sound: 'ee as in see', example: 'ύπνος', meaning: 'sleep' },
  { id: 'fi', upper: 'Φ', lower: 'φ', name: 'Fi', sound: 'f as in food', example: 'φίλος', meaning: 'friend' },
  { id: 'chi', upper: 'Χ', lower: 'χ', name: 'Chi', sound: 'ch as in loch', example: 'χαρά', meaning: 'joy', note: 'It becomes softer before ε and ι sounds.' },
  { id: 'psi', upper: 'Ψ', lower: 'ψ', name: 'Psi', sound: 'ps as in taps', example: 'ψωμί', meaning: 'bread' },
  { id: 'omega', upper: 'Ω', lower: 'ω', name: 'Omega', sound: 'o as in off', example: 'ώρα', meaning: 'hour' },
];

/** First single-grapheme letter taught by a lesson, or null when the lesson has no featured letter. */
export function featuredLetterGlyph(lessonId: string): string | null {
  const match = greekLetters.find((letter) => letter.lessonId === lessonId);
  const glyph = match?.lower.trim() ?? '';
  return glyph.length === 1 ? glyph : null;
}

export type PhraseReference = {
  id: string;
  greek: string;
  meaning: string;
  audioId?: AudioClipId;
  lessonId: string;
  lessonTitle: string;
  unitTitle: string;
};

export function phrasesForCourse(course: Course): PhraseReference[] {
  return course.modules.flatMap((unit) =>
    unit.lessons.flatMap((lesson) =>
      (lesson.blocks ?? []).flatMap((block, index) => {
        if (block.type !== 'example' || block.greek.includes('·')) return [];
        return [{
          id: `${lesson.id}-${index}`,
          greek: block.greek,
          meaning: block.gloss,
          audioId: block.audioId,
          lessonId: lesson.id,
          lessonTitle: lesson.title,
          unitTitle: unit.title,
        }];
      }),
    ),
  );
}
