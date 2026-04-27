'use strict';
// token-set Jaccard similarity for G7 duplicate task detection
// Zero external dependencies — pure Node.js Set operations.

/**
 * Tokenize a string into a Set of lowercase words.
 * Splits on any non-word character sequence and discards empty tokens.
 *
 * @param {string} str
 * @returns {Set<string>}
 */
function tokenize(str) {
  return new Set(str.toLowerCase().split(/\W+/).filter(Boolean));
}

/**
 * Compute token-set Jaccard similarity between two strings.
 * Returns a value in [0.0, 1.0].
 * Returns 1.0 if both strings are empty (identical empty sets).
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function jaccard(a, b) {
  const sa = tokenize(a), sb = tokenize(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 1.0 : inter / union;
}

/**
 * Map a Jaccard ratio to a 1–5 integer bucket (§12 scoring spec).
 *
 * Bucket boundaries (inclusive upper bound):
 *   0.00–0.20 → 1
 *   0.21–0.40 → 2
 *   0.41–0.60 → 3
 *   0.61–0.80 → 4
 *   0.81–1.00 → 5
 *
 * @param {number} ratio  Value in [0.0, 1.0]
 * @returns {1|2|3|4|5}
 */
function bucketize(ratio) {
  if (ratio <= 0.2) return 1;
  if (ratio <= 0.4) return 2;
  if (ratio <= 0.6) return 3;
  if (ratio <= 0.8) return 4;
  return 5;
}

module.exports = { jaccard, bucketize };
