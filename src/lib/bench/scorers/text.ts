import type { BenchFixture } from "../fixtures";
import type { LexicalScore, SemanticScore } from "../types";

/**
 * Lexical and semantic scorers. Both are deterministic and offline.
 *
 * ON THE SEMANTIC SCORER — read this before trusting the number.
 *
 * The audit found no embedding path in this app: every model call goes through the `claude` CLI as
 * a subprocess (src/lib/claude.ts), which has no embeddings endpoint, and no vector/embedding
 * client exists anywhere in the tree. Adding one would mean a new provider, a new key and a new
 * network dependency for a dev-only harness.
 *
 * So `relevance` and `model_agreement` are computed with **local sublinear-TF cosine over
 * bag-of-words vectors — not neural embeddings.** That is a real, deterministic, reproducible
 * similarity measure, and it is genuinely weaker than embeddings: it sees shared vocabulary, not
 * shared meaning, so a plan that delivers "history" entirely through castle and ruin names scores
 * lower than one that says the word. Every surface that shows these numbers says so. If a real
 * embedding path is ever added to the app, swap `vectorize()` for it and the scorers stand.
 */

export const SEMANTIC_METHOD =
  "local sublinear-TF bag-of-words cosine (NOT neural embeddings — no embedding path exists in this app)";

const WORD = /[a-z0-9']+/g;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with",
  "is", "are", "was", "be", "by", "from", "as", "it", "its", "this", "that", "you",
  "your", "then", "than", "so", "if", "will", "can", "有",
]);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(WORD) ?? []).filter((w) => !STOPWORDS.has(w));
}

/** Sublinear term frequency, L2-normalized. */
function vectorize(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) counts.set(token, (counts.get(token) ?? 0) + 1);

  const weighted = new Map<string, number>();
  for (const [token, n] of counts) weighted.set(token, 1 + Math.log(n));

  let norm = 0;
  for (const w of weighted.values()) norm += w * w;
  norm = Math.sqrt(norm);
  if (norm === 0) return weighted;

  for (const [token, w] of weighted) weighted.set(token, w / norm);
  return weighted;
}

export function cosine(a: string, b: string): number | null {
  const va = vectorize(a);
  const vb = vectorize(b);
  if (va.size === 0 || vb.size === 0) return null;
  let dot = 0;
  for (const [token, w] of va) dot += w * (vb.get(token) ?? 0);
  return Math.max(0, Math.min(1, dot));
}

/**
 * The "what was asked for" document a trip's output is measured against: the traveler's priorities,
 * purpose, and the resolved flags in plain words. Built from the fixture, never from the output.
 */
export function askDocument(fixture: BenchFixture): string {
  const a = fixture.reconciled.userAnswers;
  const f = fixture.reconciled.resolvedFlags;
  return [
    a.purpose,
    f.prioritiesRanked.primary.join(" "),
    f.prioritiesRanked.tiebreakers.join(" "),
    `${a.explorerStyle} ${a.group} ${a.energy} energy ${a.crowds} crowds`,
    `${f.paceResolved} pace ${f.paceSpotsPerDay} stops per day`,
    f.mobilityProfile.walkLegCap === "tight" ? "short walks step free rest breaks accessible" : "",
    f.crowdBias.preferOffpeakTiming ? "quiet offbeat off peak early late uncrowded" : "",
    f.crowdBias.marketsAndLivelyOk ? "busy lively markets nightlife popular" : "",
    f.familyRules ? "kid friendly family children early evening short legs" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** relevance — does the output's vocabulary reflect the ask? See the file header on its limits. */
export function scoreSemantic(itineraryMd: string, fixture: BenchFixture): SemanticScore {
  return { relevance: cosine(itineraryMd, askDocument(fixture)), method: SEMANTIC_METHOD };
}

/** model_agreement — pairwise similarity between two models' outputs on the same trip. */
export function outputSimilarity(a: string, b: string): number | null {
  return cosine(a, b);
}

// --- lexical -----------------------------------------------------------------------------------

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const groups = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "")
    .match(/[aeiouy]{1,2}/g);
  return Math.max(groups?.length ?? 1, 1);
}

function ngramRepetitionRate(tokens: string[], n: number): number {
  if (tokens.length < n) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i + n <= tokens.length; i++) {
    const key = tokens.slice(i, i + n).join(" ");
    grams.set(key, (grams.get(key) ?? 0) + 1);
  }
  const total = tokens.length - n + 1;
  let repeated = 0;
  for (const count of grams.values()) if (count > 1) repeated += count - 1;
  return total > 0 ? repeated / total : 0;
}

/**
 * Cheap text statistics: length, lexical diversity (type-token ratio), n-gram repetition and
 * Flesch-Kincaid grade level. Descriptive only — none of these feed the composite score, because
 * "longer" and "more varied" aren't better or worse for an itinerary without further argument.
 */
export function scoreLexical(itineraryMd: string): LexicalScore {
  const allWords = itineraryMd.toLowerCase().match(WORD) ?? [];
  const contentTokens = tokenize(itineraryMd);
  const words = allWords.length;

  const sentences = Math.max(
    (itineraryMd.match(/[.!?]+(?:\s|$)/g) ?? []).length,
    // Bulleted lines read as sentences for readability purposes; without this a list-shaped
    // itinerary divides by ~1 and reports an absurd grade level.
    (itineraryMd.match(/^\s*[-*]\s+/gm) ?? []).length,
    1
  );
  const syllables = allWords.reduce((sum, w) => sum + countSyllables(w), 0);

  return {
    words,
    approxTokens: Math.round(itineraryMd.length / 4),
    typeTokenRatio: words > 0 ? new Set(allWords).size / words : 0,
    bigramRepetitionRate: ngramRepetitionRate(contentTokens, 2),
    trigramRepetitionRate: ngramRepetitionRate(contentTokens, 3),
    fleschKincaidGrade:
      words > 0
        ? Math.round((0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59) * 10) / 10
        : 0,
  };
}
