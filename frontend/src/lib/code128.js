// Code 128 barcodes, code set B: the barcode on a FOFO shipping label.
//
// WHY BY HAND. The label needs one barcode, of an invoice number, and Code 128
// is a lookup table and a checksum. That is less code than a barcode library's
// wrapper, with nothing to keep up to date.
//
// WHAT CODE SET B COVERS. Every printable ASCII character, space (32) to ~
// (126): capitals, lower case, digits and punctuation. That is all an invoice
// or order number ever holds ("INV/26-27/0001", "FO-000012"). Code set C would
// pack digit pairs tighter, but these numbers are short and mixed, and one code
// set keeps this readable. Anything outside the range is refused, never
// dropped: a barcode that silently encodes a different string is worse than no
// barcode.
//
// HOW A SYMBOL IS BUILT. Start B, one pattern per character, a check pattern,
// stop. Each pattern is six alternating bar and space widths adding up to 11
// modules (the stop is seven widths, 13 modules). The check value is
//   (104 + Σ position × value) mod 103, positions counted from 1,
// where a character's value is its ASCII code less 32 and 104 is Start B.
//
// The table was checked against the Code 128 barcode on the sample label this
// one was modelled on, bar for bar (docs/fofo-handoff.md).

// Values 0–102, then Start A (103), Start B (104), Start C (105). Each entry is
// the widths bar, space, bar, space, bar, space.
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232',
]
const STOP = '2331112'
const START_B = 104
const FIRST = 32 // space
const LAST = 126 // ~

/** The values of a Code 128 B symbol for `text`: start, characters, check. */
export function code128Values(text) {
  const value = String(text)
  if (!value) throw new Error('A barcode needs something to encode')
  const values = [START_B]
  let sum = START_B
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < FIRST || code > LAST) {
      throw new Error(`"${value}" cannot be put in a barcode: "${value[i]}" is not a plain printable character`)
    }
    values.push(code - FIRST)
    sum += (i + 1) * (code - FIRST)
  }
  values.push(sum % 103)
  return values
}

/**
 * The barcode for `text` as module widths, starting with a BAR and alternating
 * bar, space, bar… A width is 1 to 4 modules. Draw each bar `width × module`
 * wide and leave quiet space of at least 10 modules either side.
 */
export function code128Widths(text) {
  const widths = []
  for (const value of code128Values(text)) {
    for (const digit of PATTERNS[value]) widths.push(Number(digit))
  }
  for (const digit of STOP) widths.push(Number(digit))
  return widths
}

/** How many modules wide the barcode for `text` is, without quiet zones. */
export const code128ModuleCount = (text) => code128Widths(text).reduce((sum, width) => sum + width, 0)
