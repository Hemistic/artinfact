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
import "core-js/modules/es.iterator.for-each.js";
import "core-js/modules/es.iterator.map.js";
import "core-js/modules/es.iterator.reduce.js";
import "core-js/modules/es.iterator.some.js";
import "core-js/modules/es.set.difference.v2.js";
import "core-js/modules/es.set.intersection.v2.js";
import "core-js/modules/es.set.is-disjoint-from.v2.js";
import "core-js/modules/es.set.is-subset-of.v2.js";
import "core-js/modules/es.set.is-superset-of.v2.js";
import "core-js/modules/es.set.symmetric-difference.v2.js";
import "core-js/modules/es.set.union.v2.js";
import { getBoundingRect, getClosestDistance, getSortIndex, printOutline } from "./util.js";
function charsToText(chars) {
  let text = [];
  for (let i = 0; i < chars.length; i++) {
    let char = chars[i];
    text.push(char.c);
    if ((char.spaceAfter || char.lineBreakAfter) && i !== chars.length - 1) {
      text.push(' ');
    }
  }
  return text.join('');
}
function allUpperCase(chars) {
  return !chars.some(x => x.c !== x.c.toUpperCase());
}
function startsWithLowerCase(chars) {
  let char = chars.find(x => x.c.toLowerCase() !== x.c.toUpperCase());
  if (char) {
    return char.c === char.c.toLowerCase();
  }
  return false;
}
function parseNumberParts(chars) {
  let i = 0;
  while (i < chars.length && ('1' <= chars[i].c && chars[i].c <= '9' || chars[i].c === '.') && !chars[i].spaceAfter) {
    i++;
  }
  let parts = chars.slice(0, i).map(x => x.c).join('').split('.').filter(x => x).map(x => parseInt(x));
  return parts;
}
function getItemsWithDepth(parentItems, rangeGroups, depth) {
  let depthItemGroups = [];
  for (let items of rangeGroups) {
    let depthItems = items.filter(x => x.numberParts.length === depth + 1);
    let uniqueCount = new Set(depthItems.map(x => x.numberParts.join('.'))).size;
    if (depthItems.length === uniqueCount) {
      let failedValidation = false;
      for (let i = 1; i < depthItems.length; i++) {
        let prevDepthItem = depthItems[i - 1];
        let depthItem = depthItems[i];
        let a = prevDepthItem.numberParts[depth - 1];
        let b = depthItem.numberParts[depth - 1];
        if (a !== b) {
          let aa = parentItems.findLastIndex(x => x.globalOffset < prevDepthItem.globalOffset);
          let bb = parentItems.findLastIndex(x => x.globalOffset < depthItem.globalOffset);
          if (b - a !== bb - aa) {
            failedValidation = true;
          }
        }
      }
      if (!failedValidation) {
        depthItemGroups.push(depthItems);
      }
    }
  }
  if (!depthItemGroups.length) {
    return [];
  }
  return depthItemGroups.sort((a, b) => b.length - a.length)[0];
}
function rangeGroupHasDuplicates(ranges) {
  let unique = new Set();
  for (let range of ranges) {
    if (unique.has(range.text)) {
      return true;
    }
    unique.add(range.text);
  }
  return false;
}
export async function extractOutline(pdfDocument, structuredCharsProvider) {
  let pagesNum = await pdfDocument.pdfManager.ensureDoc('numPages');
  let from = 0;
  let to = pagesNum - 1;
  to = Math.min(to, 100);
  let pages = [];
  let charsCount = 0;
  for (let i = from; i <= to; i++) {
    let chars = await structuredCharsProvider(i);
    pages.push(chars);
    charsCount += chars.length;
  }
  if (!charsCount) {
    return;
  }
  let fontRanges = new Map();
  let fontCounts = new Map();
  let rotationCounts = new Map();
  let fontSizes = new Map();
  for (let chars of pages) {
    for (let i = 0; i < chars.length; i++) {
      let char = chars[i];
      let count = fontCounts.get(char.fontName);
      if (!count) {
        count = 0;
      }
      count++;
      fontCounts.set(char.fontName, count);
      count = rotationCounts.get(char.rotation);
      if (!count) {
        count = 0;
      }
      count++;
      rotationCounts.set(char.rotation, count);
    }
  }
  const mainFont = Array.from(fontCounts.entries()).reduce((max, entry) => max[1] > entry[1] ? max : entry)[0];
  const mainRotation = Array.from(rotationCounts.entries()).reduce((max, entry) => max[1] > entry[1] ? max : entry)[0];
  let globalOffset = 0;
  for (let j = 0; j < pages.length; j++) {
    let chars = pages[j];
    let range = null;
    let start = 0;
    let end = 0;
    let lineFontsEqual = true;
    for (let i = 0; i < chars.length; i++) {
      end = i;
      let prevChar = chars[i - 1];
      let char = chars[i];
      let fontID = char.fontName + '-' + Math.round(char.fontSize * 10) / 10;
      let prevFontID = prevChar && prevChar.fontName + '-' + Math.round(prevChar.fontSize * 10) / 10;
      if (end - start > 0 && prevFontID !== fontID) {
        lineFontsEqual = false;
      }
      if (char.lineBreakAfter) {
        let upperCase = allUpperCase(chars.slice(start, end + 1));
        if (range) {
          let pushedToRange = false;
          if (lineFontsEqual && range.fontID === fontID && (!range.upperCase || range.upperCase === upperCase)) {
            range.to = end;
            range.text = chars.slice(range.from, range.to + 1).map(x => x.c).join('');
            range.chars = chars.slice(range.from, range.to + 1);
            pushedToRange = true;
          }
          if (!pushedToRange || i === chars.length - 1) {
            if (range.upperCase) {
              range.fontID += '-U';
            }
            let list = fontRanges.get(range.fontID) || [];
            list.push(range);
            fontRanges.set(range.fontID, list);
            range = null;
          }
        }
        if (!range && lineFontsEqual && chars[end].c !== '.' && chars[start].fontName !== mainFont && chars[start].rotation === mainRotation) {
          let startsWithLower = startsWithLowerCase(chars.slice(start, end + 1));
          range = {
            pageIndex: j,
            fontID,
            fontSize: Math.round(char.fontSize * 10) / 10,
            from: start,
            to: end,
            upperCase,
            font: chars[start].font,
            globalOffset
          };
          range.text = chars.slice(range.from, range.to + 1).map(x => x.c).join('');
          range.chars = chars.slice(range.from, range.to + 1);
          range.numberParts = parseNumberParts(range.chars);
        }
        lineFontsEqual = true;
        start = end + 1;
      }
      globalOffset++;
    }
  }
  fontRanges = Array.from(fontRanges.values());
  fontRanges.sort((a, b) => b[0].fontSize - a[0].fontSize);
  for (let i = 0; i < fontRanges.length; i++) {
    fontRanges[i] = fontRanges[i].filter(x => x.text.length < 100);
  }
  fontRanges = fontRanges.filter(x => x.length >= 3);
  let titles = ['references', 'bibliography', 'acknowledgments', 'bibliographie'];
  let prevalentFontsRanges = [];
  for (let i = 0; i < fontRanges.length; i++) {
    let ranges = fontRanges[i];
    let indexes = ranges.map(x => x.pageIndex);
    let min = Math.min(...indexes);
    let max = Math.max(...indexes);
    if (max - min >= pagesNum / 2) {
      prevalentFontsRanges.push(ranges);
    }
  }
  let h1 = [],
    h2 = [],
    h3 = [];
  for (let i = 0; i < fontRanges.length; i++) {
    let ranges = fontRanges[i];
    if (!prevalentFontsRanges.includes(ranges) || rangeGroupHasDuplicates(ranges)) {
      continue;
    }
    for (let range of ranges) {
      if (titles.includes(range.text.toLowerCase())) {
        h1 = ranges;
        fontRanges.splice(0, i + 1);
        break;
      }
    }
    if (h1.length) {
      break;
    }
  }
  if (!h1.length && 0) {
    for (let i = 0; i < fontRanges.length; i++) {
      let ranges = fontRanges[i];
      if (!prevalentFontsRanges.includes(ranges) || rangeGroupHasDuplicates(ranges)) {
        continue;
      }
      h1 = ranges;
      break;
    }
  }
  h1.forEach(range => range.depth = 0);
  let ranges = getItemsWithDepth(h1, fontRanges, 1);
  if (ranges.length >= 2) {
    h2 = ranges;
    h2.forEach(range => range.depth = 1);
    ranges = getItemsWithDepth(h2, fontRanges, 2);
    if (ranges.length >= 2) {
      h3 = ranges;
      h3.forEach(range => range.depth = 0);
    }
  } else if (fontRanges.length) {
    let ranges = fontRanges[0];
    if (!rangeGroupHasDuplicates(ranges)) {
      h2 = fontRanges[0];
      h2.forEach(range => range.depth = 1);
    }
  }
  let list = [];
  let n = 0;
  for (let j = 0; j < pages.length; j++) {
    let chars = pages[j];
    let start = 0;
    let end = 0;
    for (let i = 0; i < chars.length; i++) {
      end = i;
      let char = chars[i];
      if (char.lineBreakAfter) {
        let prev = chars[start - 1];
        let first = chars[start];
        let last = chars[end];
        if (first.fontName !== mainFont && chars.slice(start, end + 1).some(x => x.fontName === mainFont)) {
          let firstName = first.fontName;
          let lastName = last.fontName;
          let nameLength = Math.min(firstName.length, lastName.length);
          let numMatches = 0;
          for (let k = 0; k < nameLength; k++) {
            if (firstName[k] === lastName[k]) {
              numMatches++;
            }
          }
          if ((!prev || prev.fontName !== first.fontName) && (parseInt(first.c) == first.c || first.c === first.c.toUpperCase())) {
            let k = start;
            for (; k <= end; k++) {
              if (chars[k].fontName !== first.fontName) {
                break;
              }
            }
            let hasDot = ['.', ':'].includes(chars[k - 1].c);
            let nextUpper = chars[k].c === chars[k].c.toUpperCase();
            let dist = getClosestDistance(chars[k - 1].rect, chars[k].rect);
            let largeSpace = dist > chars[k - 1].rect[2] - chars[k - 1].rect[0];
            if (hasDot && nextUpper) {
              list.push({
                leaf: true,
                pageIndex: j,
                globalOffset: n + start,
                text: chars.slice(start, k).map(x => x.c).join(''),
                chars: chars.slice(start, k),
                from: start,
                to: k
              });
            }
          }
        }
        start = end + 1;
      }
    }
    n += chars.length;
  }
  if (h1.length < 4) {
    return;
  }
  let items = [...h1, ...h2, ...h3];
  items.sort((a, b) => a.globalOffset - b.globalOffset);
  let root = {
    items: []
  };
  let stack = [root];
  for (let i = 0; i < items.length; i++) {
    let item = items[i];
    let node = {
      items: item.leaf ? undefined : [],
      title: charsToText(item.chars),
      sortIndex: getSortIndex(item.pageIndex, item.from, 0),
      location: {
        position: {
          pageIndex: item.pageIndex,
          rects: [getBoundingRect(item.chars)]
        }
      }
    };
    while (stack.length - 1 > item.depth) {
      stack.pop();
    }
    stack[stack.length - 1].items.push(node);
    if (!item.leaf) {
      stack.push(node);
    }
  }
  let outline = root.items;
  return outline;
}