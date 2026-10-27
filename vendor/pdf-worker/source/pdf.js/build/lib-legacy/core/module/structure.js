/**
 * @licstart The following is the entire license notice for the
 * JavaScript code in this page
 *
 * Copyright 2024 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @licend The above is the entire license notice for the
 * JavaScript code in this page
 */
import "core-js/modules/es.array.push.js";
import "core-js/modules/es.iterator.constructor.js";
import "core-js/modules/es.iterator.filter.js";
import "core-js/modules/es.iterator.find.js";
import "core-js/modules/es.iterator.map.js";
import "core-js/modules/es.set.difference.v2.js";
import "core-js/modules/es.set.intersection.v2.js";
import "core-js/modules/es.set.is-disjoint-from.v2.js";
import "core-js/modules/es.set.is-subset-of.v2.js";
import "core-js/modules/es.set.is-superset-of.v2.js";
import "core-js/modules/es.set.symmetric-difference.v2.js";
import "core-js/modules/es.set.union.v2.js";
let baseTypes = ["BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "S", "B", "S", "WS", "B", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "B", "B", "B", "S", "WS", "ON", "ON", "ET", "ET", "ET", "ON", "ON", "ON", "ON", "ON", "ES", "CS", "ES", "CS", "CS", "EN", "EN", "EN", "EN", "EN", "EN", "EN", "EN", "EN", "EN", "CS", "ON", "ON", "ON", "ON", "ON", "ON", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "ON", "ON", "ON", "ON", "ON", "ON", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "ON", "ON", "ON", "ON", "BN", "BN", "BN", "BN", "BN", "BN", "B", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "CS", "ON", "ET", "ET", "ET", "ET", "ON", "ON", "ON", "ON", "L", "ON", "ON", "BN", "ON", "ON", "ET", "ET", "EN", "EN", "ON", "L", "ON", "ON", "ON", "EN", "L", "ON", "ON", "ON", "ON", "ON", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "ON", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "ON", "L", "L", "L", "L", "L", "L", "L", "L"];
let arabicTypes = ["AN", "AN", "AN", "AN", "AN", "AN", "ON", "ON", "AL", "ET", "ET", "AL", "CS", "AL", "ON", "ON", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "AL", "AL", "", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "AN", "AN", "AN", "AN", "AN", "AN", "AN", "AN", "AN", "AN", "ET", "AN", "AN", "AL", "AL", "AL", "NSM", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "AN", "ON", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "AL", "AL", "NSM", "NSM", "ON", "NSM", "NSM", "NSM", "NSM", "AL", "AL", "EN", "EN", "EN", "EN", "EN", "EN", "EN", "EN", "EN", "EN", "AL", "AL", "AL", "AL", "AL", "AL"];
function isOdd(i) {
  return (i & 1) !== 0;
}
function isEven(i) {
  return (i & 1) === 0;
}
function findUnequal(arr, start, value) {
  let j, jj;
  for (j = start, jj = arr.length; j < jj; ++j) {
    if (arr[j] !== value) {
      return j;
    }
  }
  return j;
}
function setValues(arr, start, end, value) {
  for (let j = start; j < end; ++j) {
    arr[j] = value;
  }
}
function reverseValues(arr, start, end) {
  for (let i = start, j = end - 1; i < j; ++i, --j) {
    let temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
}
function createBidiText(chars, isLTR, vertical = false) {
  let dir = "ltr";
  if (vertical) {
    dir = "ttb";
  } else if (!isLTR) {
    dir = "rtl";
  }
  return {
    chars,
    dir
  };
}
let types = [];
function bidi(chars, startLevel = -1, vertical = false) {
  let isLTR = true;
  let strLength = chars.length;
  if (strLength === 0 || vertical) {
    return createBidiText(chars, isLTR, vertical);
  }
  types.length = strLength;
  let numBidi = 0;
  let i, ii;
  for (i = 0; i < strLength; ++i) {
    let charCode = chars[i].c.charCodeAt(0);
    let charType = "L";
    if (charCode <= 0x00ff) {
      charType = baseTypes[charCode];
    } else if (0x0590 <= charCode && charCode <= 0x05f4) {
      charType = "R";
    } else if (0x0600 <= charCode && charCode <= 0x06ff) {
      charType = arabicTypes[charCode & 0xff];
      if (!charType) {
        console.log("Bidi: invalid Unicode character " + charCode.toString(16));
      }
    } else if (0x0700 <= charCode && charCode <= 0x08ac) {
      charType = "AL";
    }
    if (charType === "R" || charType === "AL" || charType === "AN") {
      numBidi++;
    }
    types[i] = charType;
  }
  if (numBidi === 0) {
    isLTR = true;
    return createBidiText(chars, isLTR);
  }
  if (startLevel === -1) {
    if (numBidi / strLength < 0.3 && strLength > 4) {
      isLTR = true;
      startLevel = 0;
    } else {
      isLTR = false;
      startLevel = 1;
    }
  }
  let levels = [];
  for (i = 0; i < strLength; ++i) {
    levels[i] = startLevel;
  }
  let e = isOdd(startLevel) ? "R" : "L";
  let sor = e;
  let eor = sor;
  let lastType = sor;
  for (i = 0; i < strLength; ++i) {
    if (types[i] === "NSM") {
      types[i] = lastType;
    } else {
      lastType = types[i];
    }
  }
  lastType = sor;
  let t;
  for (i = 0; i < strLength; ++i) {
    t = types[i];
    if (t === "EN") {
      types[i] = lastType === "AL" ? "AN" : "EN";
    } else if (t === "R" || t === "L" || t === "AL") {
      lastType = t;
    }
  }
  for (i = 0; i < strLength; ++i) {
    t = types[i];
    if (t === "AL") {
      types[i] = "R";
    }
  }
  for (i = 1; i < strLength - 1; ++i) {
    if (types[i] === "ES" && types[i - 1] === "EN" && types[i + 1] === "EN") {
      types[i] = "EN";
    }
    if (types[i] === "CS" && (types[i - 1] === "EN" || types[i - 1] === "AN") && types[i + 1] === types[i - 1]) {
      types[i] = types[i - 1];
    }
  }
  for (i = 0; i < strLength; ++i) {
    if (types[i] === "EN") {
      for (let j = i - 1; j >= 0; --j) {
        if (types[j] !== "ET") {
          break;
        }
        types[j] = "EN";
      }
      for (let j = i + 1; j < strLength; ++j) {
        if (types[j] !== "ET") {
          break;
        }
        types[j] = "EN";
      }
    }
  }
  for (i = 0; i < strLength; ++i) {
    t = types[i];
    if (t === "WS" || t === "ES" || t === "ET" || t === "CS") {
      types[i] = "ON";
    }
  }
  lastType = sor;
  for (i = 0; i < strLength; ++i) {
    t = types[i];
    if (t === "EN") {
      types[i] = lastType === "L" ? "L" : "EN";
    } else if (t === "R" || t === "L") {
      lastType = t;
    }
  }
  for (i = 0; i < strLength; ++i) {
    if (types[i] === "ON") {
      let end = findUnequal(types, i + 1, "ON");
      let before = sor;
      if (i > 0) {
        before = types[i - 1];
      }
      let after = eor;
      if (end + 1 < strLength) {
        after = types[end + 1];
      }
      if (before !== "L") {
        before = "R";
      }
      if (after !== "L") {
        after = "R";
      }
      if (before === after) {
        setValues(types, i, end, before);
      }
      i = end - 1;
    }
  }
  for (i = 0; i < strLength; ++i) {
    if (types[i] === "ON") {
      types[i] = e;
    }
  }
  for (i = 0; i < strLength; ++i) {
    t = types[i];
    if (isEven(levels[i])) {
      if (t === "R") {
        levels[i] += 1;
      } else if (t === "AN" || t === "EN") {
        levels[i] += 2;
      }
    } else {
      if (t === "L" || t === "AN" || t === "EN") {
        levels[i] += 1;
      }
    }
  }
  let highestLevel = -1;
  let lowestOddLevel = 99;
  let level;
  for (i = 0, ii = levels.length; i < ii; ++i) {
    level = levels[i];
    if (highestLevel < level) {
      highestLevel = level;
    }
    if (lowestOddLevel > level && isOdd(level)) {
      lowestOddLevel = level;
    }
  }
  for (level = highestLevel; level >= lowestOddLevel; --level) {
    let start = -1;
    for (i = 0, ii = levels.length; i < ii; ++i) {
      if (levels[i] < level) {
        if (start >= 0) {
          reverseValues(chars, start, i);
          start = -1;
        }
      } else if (start < 0) {
        start = i;
      }
    }
    if (start >= 0) {
      reverseValues(chars, start, levels.length);
    }
  }
  for (i = 0, ii = chars.length; i < ii; ++i) {
    let ch = chars[i];
    if (ch === "<" || ch === ">") {
      chars[i] = "";
    }
  }
  return createBidiText(chars, isLTR);
}
function isRTL(char) {
  let charCode = char.charCodeAt(0);
  let charType = "L";
  if (charCode <= 0x00ff) {
    charType = baseTypes[charCode];
  } else if (0x0590 <= charCode && charCode <= 0x05f4) {
    charType = "R";
  } else if (0x0600 <= charCode && charCode <= 0x06ff) {
    charType = arabicTypes[charCode & 0xff];
    if (!charType) {
      console.log("Bidi: invalid Unicode character " + charCode.toString(16));
    }
  } else if (0x0700 <= charCode && charCode <= 0x08ac) {
    charType = "AL";
  }
  if (charType === "R" || charType === "AL" || charType === "AN") {
    return true;
  }
  return false;
}
function computeWordSpacingThreshold(chars) {
  let uniformSpacing = 0.07;
  let wordSpacing = 0.1;
  let char, char2;
  let avgFontSize;
  let minAdjGap, maxAdjGap, minSpGap, maxSpGap, minGap, maxGap, gap, gap2;
  let i;
  avgFontSize = 0;
  minGap = maxGap = 0;
  minAdjGap = minSpGap = 1;
  maxAdjGap = maxSpGap = 0;
  for (i = 0; i < chars.length; ++i) {
    char = chars[i];
    avgFontSize += char.fontSize;
    if (i < chars.length - 1) {
      char2 = chars[i + 1];
      gap = getSpaceBetweenChars(char, char2);
      if (char.spaceAfter) {
        if (minSpGap > maxSpGap) {
          minSpGap = maxSpGap = gap;
        } else if (gap < minSpGap) {
          minSpGap = gap;
        } else if (gap > maxSpGap) {
          maxSpGap = gap;
        }
      } else if (minAdjGap > maxAdjGap) {
        minAdjGap = maxAdjGap = gap;
      } else if (gap < minAdjGap) {
        minAdjGap = gap;
      } else if (gap > maxAdjGap) {
        maxAdjGap = gap;
      }
      if (i == 0 || gap < minGap) {
        minGap = gap;
      }
      if (gap > maxGap) {
        maxGap = gap;
      }
    }
  }
  avgFontSize /= chars.length;
  if (minGap < 0) {
    minGap = 0;
  }
  if (maxGap - minGap < uniformSpacing * avgFontSize) {
    if (minAdjGap <= maxAdjGap && minSpGap <= maxSpGap && minSpGap - maxAdjGap > 0.01) {
      return 0.5 * (maxAdjGap + minSpGap);
    } else {
      return maxGap + 1;
    }
  } else if (maxGap - minGap < wordSpacing * avgFontSize) {
    return 0.5 * (minGap + maxGap);
  } else if (minAdjGap <= maxAdjGap && minSpGap <= maxSpGap && minSpGap - maxAdjGap > uniformSpacing * avgFontSize) {
    gap = wordSpacing * avgFontSize;
    gap2 = 0.5 * (minSpGap - minGap);
    return minGap + (gap < gap2 ? gap : gap2);
  } else {
    return minGap + wordSpacing * avgFontSize;
  }
}
function getSpaceBetweenChars(char, char2) {
  let {
    rotation
  } = char;
  return !rotation && char2.rect[0] - char.rect[2] || rotation === 90 && char2.rect[1] - char.rect[3] || rotation === 180 && char.rect[0] - char2.rect[2] || rotation === 270 && char.rect[1] - char2.rect[3];
}
function overlaps(rect1, rect2, rotation) {
  if ([0, 180].includes(rotation)) {
    return rect1[1] <= rect2[1] && rect2[1] <= rect1[3] || rect2[1] <= rect1[1] && rect1[1] <= rect2[3];
  }
  return rect1[0] <= rect2[0] && rect2[0] <= rect1[2] || rect2[0] <= rect1[0] && rect1[0] <= rect2[2];
}
const dashChars = new Set(['\x2D', '\u058A', '\u05BE', '\u1400', '\u1806', '\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2015', '\u2E17', '\u2E1A', '\u2E3A', '\u2E3B', '\u301C', '\u3030', '\u30A0', '\uFE31', '\uFE32', '\uFE58', '\uFE63', '\uFF0D']);
function charHeight(char) {
  return [0, 180].includes(char.rotation) && char.rect[3] - char.rect[1] || [90, 270].includes(char.rotation) && char.rect[2] - char.rect[0];
}
function getBoundingRect(objs, from, to) {
  let objs2 = objs.slice(from, to + 1);
  return [Math.min(...objs2.map(x => x.rect[0])), Math.min(...objs2.map(x => x.rect[1])), Math.max(...objs2.map(x => x.rect[2])), Math.max(...objs2.map(x => x.rect[3]))];
}
function median(values) {
  if (values.length === 0) throw new Error("No inputs");
  values.sort(function (a, b) {
    return a - b;
  });
  var half = Math.floor(values.length / 2);
  if (values.length % 2) return values[half];
  return (values[half - 1] + values[half]) / 2.0;
}
function getLineBottom(chars, from, to) {
  let values = [];
  for (let i = from; i <= to; i++) {
    let char = chars[i];
    if (char.rotation === 0) {
      values.push(char.rect[1]);
    } else if (char.rotation === 90) {
      values.push(char.rect[2]);
    } else if (char.rotation === 180) {
      values.push(char.rect[3]);
    } else if (char.rotation === 270) {
      values.push(char.rect[0]);
    }
  }
  return median(values);
}
function getLineTop(chars, from, to) {
  let values = [];
  for (let i = from; i <= to; i++) {
    let char = chars[i];
    if (char.rotation === 0) {
      values.push(char.rect[3]);
    } else if (char.rotation === 90) {
      values.push(char.rect[0]);
    } else if (char.rotation === 180) {
      values.push(char.rect[1]);
    } else if (char.rotation === 270) {
      values.push(char.rect[2]);
    }
  }
  return median(values);
}
function mostCommonFontName(chars) {
  const fontCount = {};
  for (let i = 0; i < chars.length; i++) {
    const fontName = chars[i].fontName;
    fontCount[fontName] = (fontCount[fontName] || 0) + 1;
  }
  let mostCommonFont = null;
  let maxCount = 0;
  for (const fontName in fontCount) {
    if (fontCount[fontName] > maxCount) {
      maxCount = fontCount[fontName];
      mostCommonFont = fontName;
    }
  }
  return mostCommonFont;
}
function split(chars, reflowRTL) {
  if (!chars.length) {
    return [];
  }
  let lines = [];
  let hasRTL = false;
  for (let char of chars) {
    if (isRTL(char.c)) {
      hasRTL = true;
      break;
    }
  }
  let lineBreaks = [];
  for (let i = 1; i < chars.length; i++) {
    let char = chars[i - 1];
    let char2 = chars[i];
    if (!hasRTL && Math.abs(char.baseline - char2.baseline) > 0.01 && (!char2.rotation && char.rect[0] - 10 > char2.rect[0] || char2.rotation === 90 && char.rect[1] > char2.rect[1] || char2.rotation === 180 && char.rect[0] < char2.rect[0] || char2.rotation === 270 && char.rect[1] < char2.rect[1]) || hasRTL && Math.abs(char.baseline - char2.baseline) > 0.01 || char.rotation !== char2.rotation || !overlaps(char.rect, char2.rect, char2.rotation) || lineBreaks.find(x => x === i - 1) && charHeight(char) > charHeight(char2) * 2) {
      lineBreaks.push(i);
    }
  }
  lineBreaks = [0, ...lineBreaks, chars.length];
  for (let i = 0; i < lineBreaks.length - 1; i++) {
    let from = lineBreaks[i];
    let to = lineBreaks[i + 1] - 1;
    let lineChars = chars.slice(from, to + 1);
    lineChars.sort((a, b) => {
      let {
        rotation
      } = a;
      let x1 = a.rect[0] + (a.rect[2] - a.rect[0]) / 2;
      let x2 = b.rect[0] + (b.rect[2] - b.rect[0]) / 2;
      let y1 = a.rect[1] + (a.rect[3] - a.rect[1]) / 2;
      let y2 = b.rect[1] + (b.rect[3] - b.rect[1]) / 2;
      return !rotation && x1 - x2 || rotation === 90 && y1 - y2 || rotation === 180 && x2 - x1 || rotation === 270 && y2 - y1;
    });
    bidi(lineChars, -1, false);
    chars.splice(from, to - from + 1, ...lineChars);
  }
  let wordBreaks = [];
  let wordSpaces = [];
  for (let i = 0; i < lineBreaks.length - 1; i++) {
    let from = lineBreaks[i];
    let to = lineBreaks[i + 1] - 1;
    let wordSp = computeWordSpacingThreshold(chars.slice(from, to + 1));
    let spaces = [];
    for (let j = from + 1; j <= to; j++) {
      let sp = wordSp - 1;
      let char = chars[j - 1];
      let char2 = chars[j];
      let rtl = isRTL(char.c) && isRTL(char2.c);
      sp = rtl ? char.rect[0] - char2.rect[2] : getSpaceBetweenChars(char, char2);
      if (sp > wordSp || sp < -char.fontSize) {
        wordSpaces.push(j);
        wordBreaks.push(j);
        spaces.push({
          index: j,
          width: sp
        });
        continue;
      }
      let punctuation = '?.,;!¡¿。、·(){}[]/$:';
      if (Math.abs(char.baseline - char2.baseline) > 0.01 || punctuation.includes(char.c) || punctuation.includes(char2.c)) {
        wordBreaks.push(j);
      }
    }
    if (to < chars.length - 1) {
      wordBreaks.push(to + 1);
    }
  }
  let lineSpacings = [];
  for (let i = 1; i < lineBreaks.length - 1; i++) {
    let previousBreak = lineBreaks[i - 1];
    let currentBreak = lineBreaks[i];
    let nextBreak = lineBreaks[i + 1];
    let currentLineBottom = getLineBottom(chars, previousBreak, currentBreak - 1);
    let nextLineTop = getLineTop(chars, currentBreak, nextBreak - 1);
    lineSpacings.push(currentLineBottom - nextLineTop);
  }
  let lineHeights = [];
  for (let i = 1; i < lineBreaks.length; i++) {
    let previousBreak = lineBreaks[i - 1];
    let currentBreak = lineBreaks[i];
    let lineTop = getLineTop(chars, previousBreak, currentBreak - 1);
    let lineBottom = getLineBottom(chars, previousBreak, currentBreak - 1);
    lineHeights.push(lineTop - lineBottom);
  }
  let MAX_LINE_SPACING = 5;
  let MIN_LINE_SPACING = -2;
  let MAX_LINE_SPACING_CHANGE = 2;
  let INDENT_EPS = 10;
  let isGapValid = gap => gap >= MIN_LINE_SPACING && gap <= MAX_LINE_SPACING;
  let paragraphBreaks = [];
  let indentedBreaks = new Set();
  for (let i = 1; i < lineBreaks.length - 1; i++) {
    let currentLine = {
      start: lineBreaks[i - 1],
      end: lineBreaks[i] - 1
    };
    let nextLine = {
      start: lineBreaks[i] || 0,
      end: lineBreaks[i + 1] - 1
    };
    let currentRect = getBoundingRect(chars, lineBreaks[i - 1], lineBreaks[i] - 1);
    let nextRect = getBoundingRect(chars, lineBreaks[i], lineBreaks[i + 1] - 1);
    let currentLineSpacing = lineSpacings[i - 1];
    let nextLineSpacing = lineSpacings[i];
    let currentLineHeight = lineHeights[i - 1];
    let nextLineHeight = lineHeights[i];
    let allowGap = false;
    if (isGapValid(currentLineSpacing) && !isGapValid(nextLineSpacing)) {
      allowGap = true;
    } else if (isGapValid(currentLineSpacing) && isGapValid(nextLineSpacing)) {
      if (Math.abs(currentLineSpacing - nextLineSpacing) < MAX_LINE_SPACING_CHANGE) {
        allowGap = true;
      } else if (currentLineSpacing < nextLineSpacing) {
        allowGap = true;
      }
    }
    let currentLineFontName = mostCommonFontName(chars.slice(currentLine.start, currentLine.end));
    let nextLineFontName = mostCommonFontName(chars.slice(nextLine.start, nextLine.end));
    let rotation = chars[currentLine.start].rotation;
    let isIndented = rotation === 0 && nextRect[0] > currentRect[0] + INDENT_EPS || rotation === 90 && nextRect[1] > currentRect[1] + INDENT_EPS || rotation === 180 && currentRect[2] > nextRect[2] + INDENT_EPS || rotation === 270 && currentRect[3] > nextRect[3] + INDENT_EPS;
    if (!allowGap || !(currentRect[1] > nextRect[3]) || currentLineFontName !== nextLineFontName && currentRect[2] < nextRect[2] - 10 || Math.abs(currentLineHeight - nextLineHeight) > 2 || isIndented) {
      paragraphBreaks.push(lineBreaks[i]);
      if (isIndented) {
        indentedBreaks.add(lineBreaks[i]);
      }
    }
  }
  paragraphBreaks.push(chars.length);
  let paragraphStarts = [0];
  for (let pb of paragraphBreaks) {
    if (pb < chars.length) {
      paragraphStarts.push(pb);
    }
  }
  let removedBreaks = new Set();
  for (let p = 1; p < paragraphStarts.length; p++) {
    let currentStart = paragraphStarts[p];
    if (indentedBreaks.has(currentStart)) {
      continue;
    }
    let currentEnd = p + 1 < paragraphStarts.length ? paragraphStarts[p + 1] : chars.length;
    let lineCount = 0;
    for (let lb of lineBreaks) {
      if (lb >= currentStart && lb < currentEnd) {
        lineCount++;
      }
    }
    if (lineCount === 1 && chars[currentStart].fontName === chars[paragraphStarts[p - 1]].fontName) {
      removedBreaks.add(currentStart);
    }
  }
  paragraphBreaks = paragraphBreaks.filter(pb => !removedBreaks.has(pb));
  for (let paragraphBreak of paragraphBreaks) {
    chars[paragraphBreak - 1].paragraphBreakAfter = true;
  }
  for (let i = 1; i < lineBreaks.length; i++) {
    let lineStart = lineBreaks[i - 1];
    let lineEnd = lineBreaks[i] - 1;
    chars[lineEnd].lineBreakAfter = true;
    let lineRect = getBoundingRect(chars, lineStart, lineEnd);
    let vertical = [90, 270].includes(chars[lineStart].rotation);
    for (let j = lineStart; j <= lineEnd; j++) {
      let char = chars[j];
      char.inlineRect = char.rect.slice();
      if (vertical) {
        char.inlineRect[0] = lineRect[0];
        char.inlineRect[2] = lineRect[2];
      } else {
        char.inlineRect[1] = lineRect[1];
        char.inlineRect[3] = lineRect[3];
      }
    }
  }
  for (let wordBreak of wordBreaks) {
    chars[wordBreak - 1].wordBreakAfter = true;
  }
  for (let wordSpace of wordSpaces) {
    chars[wordSpace - 1].spaceAfter = true;
  }
  for (let char of chars) {
    if (char.lineBreakAfter && dashChars.has(char.c)) {
      char.ignorable = true;
    }
  }
  return chars;
}
export function getStructuredChars(chars) {
  let chars2 = [];
  let fingerprints = new Set();
  for (let char of chars) {
    let fingerprint = char.c + char.rect.join('');
    if (!fingerprints.has(fingerprint)) {
      fingerprints.add(fingerprint);
      chars2.push(char);
    }
  }
  let structuredChars = split(chars2);
  for (let i = 0; i < structuredChars.length; i++) {
    structuredChars[i].offset = i;
  }
  return structuredChars;
}