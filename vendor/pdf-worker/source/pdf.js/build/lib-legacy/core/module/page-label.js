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
import { getBoundingRect, getRectCenter } from './util.js';
function romanToInteger(str) {
  if (!str || str.length === 0 || str !== str.toUpperCase() && str !== str.toLowerCase()) {
    return null;
  }
  const values = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1000
  };
  const input = str.toUpperCase();
  let total = 0;
  let prevValue = 0;
  for (let i = 0; i < input.length; i++) {
    const currentValue = values[input[i]];
    if (currentValue === undefined) return null;
    if (currentValue > prevValue) {
      total += currentValue - 2 * prevValue;
    } else {
      total += currentValue;
    }
    prevValue = currentValue;
  }
  return total;
}
function extractLastInteger(str) {
  let numStr = '';
  let foundDigit = false;
  for (let i = str.length - 1; i >= 0; i--) {
    const char = str[i];
    if (char >= '0' && char <= '9') {
      numStr = char + numStr;
      foundDigit = true;
    } else if (foundDigit) {
      break;
    }
  }
  return foundDigit ? parseInt(numStr, 10) : null;
}
function parseCandidateNumber(str) {
  let type = 'arabic';
  let integer = extractLastInteger(str);
  if (!integer) {
    type = 'roman';
    integer = romanToInteger(str);
    if (!integer) {
      return null;
    }
  }
  return {
    type,
    integer
  };
}
function splitIntoWords(chars) {
  let words = [];
  let currentWordChars = [];
  let offsetFrom = 0;
  for (let i = 0; i < chars.length; i++) {
    const charObj = chars[i];
    if (currentWordChars.length === 0) {
      offsetFrom = i;
    }
    currentWordChars.push(charObj);
    if (charObj.spaceAfter || charObj.lineBreakAfter || charObj.paragraphBreakAfter || i === chars.length - 1) {
      if (currentWordChars.length > 0) {
        words.push({
          chars: currentWordChars,
          offsetFrom: offsetFrom,
          offsetTo: i,
          rect: getBoundingRect(currentWordChars)
        });
        currentWordChars = [];
      }
    }
  }
  return words;
}
function getPageWords(chars, viewportRect) {
  let contentRect = getBoundingRect(chars);
  let contentCenter = getRectCenter(contentRect);
  let viewportCenter = getRectCenter(viewportRect);
  let words = splitIntoWords(chars);
  for (let word of words) {
    let wordCenter = getRectCenter(word.rect);
    let eps = 5;
    let deltaX = wordCenter[0] - viewportCenter[0];
    if (Math.abs(deltaX) < eps) {
      word.relativeX = deltaX;
    } else if (deltaX < 0) {
      word.relativeX = word.rect[0] - contentRect[0];
    } else {
      word.relativeX = contentRect[2] - word.rect[2];
    }
    if (wordCenter[1] < viewportCenter[1]) {
      word.relativeY = word.rect[1] - contentRect[1];
    } else {
      word.relativeY = contentRect[3] - word.rect[3];
    }
    if (word.offsetFrom > chars.length - word.offsetTo) {
      word.relativeOffset = word.offsetFrom;
    } else {
      word.relativeOffset = word.offsetTo;
    }
  }
  return words;
}
function getClusters(objects, property, eps) {
  if (!objects.length) {
    return [];
  }
  objects.sort((a, b) => a[property] - b[property]);
  let clusters = [];
  let currentCluster = [objects[0]];
  for (let i = 1; i < objects.length; i++) {
    const object = objects[i];
    const distance = Math.abs(object[property] - currentCluster[currentCluster.length - 1][property]);
    if (distance <= eps) {
      currentCluster.push(object);
    } else {
      if (new Set(currentCluster.map(x => x.pageIndex)).size >= 3) {
        clusters.push(currentCluster);
      }
      currentCluster = [object];
    }
  }
  if (new Set(currentCluster.map(x => x.pageIndex)).size >= 3) {
    clusters.push(currentCluster);
  }
  return clusters;
}
function getLabelSequence(words) {
  words.sort((a, b) => a.integer - b.integer);
  let sequences = [];
  let currentSequence = [];
  for (let i = 0; i < words.length; i++) {
    let a = words[i];
    currentSequence = [a];
    for (let j = i + 1; j < words.length; j++) {
      let b = words[j];
      let prev = currentSequence.at(-1);
      if (b.pageIndex > prev.pageIndex && b.pageIndex - prev.pageIndex === b.integer - prev.integer) {
        currentSequence.push(b);
      }
    }
    if (currentSequence.length >= 3) {
      sequences.push(currentSequence);
    }
    currentSequence = [];
  }
  return sequences.sort((a, b) => b.length - a.length)[0];
}
function getClusterMaxDistance(cluster, property) {
  let min = Math.min(...cluster.map(x => x[property]));
  let max = Math.max(...cluster.map(x => x[property]));
  return max - min;
}
export async function getPageLabel(pdfDocument, structuredCharsProvider, pageIndex, metadataPagesField) {
  const NEXT_PREV_PAGES = 2;
  let numPages = pdfDocument.catalog.numPages;
  let pageLabels = pdfDocument.catalog.pageLabels;
  let from = pageIndex - NEXT_PREV_PAGES;
  let to = pageIndex + NEXT_PREV_PAGES;
  if (from < 0) {
    to += -from;
    from = 0;
  }
  if (to >= numPages) {
    to = numPages - 1;
  }
  let candidateWords = [];
  for (let i = from; i <= to; i++) {
    let chars = await structuredCharsProvider(i);
    let page = await pdfDocument.getPage(i);
    let {
      view
    } = page;
    let words = getPageWords(chars, view);
    for (let word of words) {
      word.pageIndex = i;
      let candidateNumber = parseCandidateNumber(word.chars.map(x => x.c).join(''));
      if (candidateNumber) {
        word.type = candidateNumber.type;
        word.integer = candidateNumber.integer;
        candidateWords.push(word);
      }
    }
  }
  let eps = 5;
  let yClusters = getClusters(candidateWords, 'relativeY', eps);
  let bestSequence = [];
  for (let yCluster of yClusters) {
    let clusters = getClusters(yCluster, 'relativeX', eps);
    for (let cluster of clusters) {
      if (cluster.length > eps * 5) {
        continue;
      }
      let sequence = getLabelSequence(cluster);
      if (sequence && sequence.length > bestSequence && getClusterMaxDistance(sequence, 'relativeY') <= eps && getClusterMaxDistance(sequence, 'relativeX') <= eps) {
        bestSequence = sequence;
      }
    }
  }
  let data = bestSequence.find(x => x.pageIndex === pageIndex);
  if (data) {
    return data;
  }
  return null;
}
export function predictPageLabels(extractedPageLabels, catalogPageLabels, pagesCount) {
  let pageLabels = [];
  let hasRoman = false;
  let hasArabic = false;
  let numCatalogValidatedPageLabels = 0;
  if (extractedPageLabels) {
    hasRoman = !!extractedPageLabels.find(x => x.type === 'roman');
    hasArabic = !!extractedPageLabels.find(x => x.type === 'arabic');
    if (catalogPageLabels) {
      numCatalogValidatedPageLabels = extractedPageLabels.filter(x => catalogPageLabels[x.pageIndex] === x.chars.map(c => c.u).join('')).length;
    }
  }
  if (catalogPageLabels && catalogPageLabels.length === pagesCount && (numCatalogValidatedPageLabels || !hasArabic || hasRoman)) {
    for (let i = 0; i < pagesCount; i++) {
      pageLabels[i] = catalogPageLabels[i];
    }
  } else if (hasArabic) {
    for (let i = 0; i < pagesCount; i++) {
      pageLabels[i] = '-';
    }
    let firstArabicPageLabel = extractedPageLabels.find(x => x.type === 'arabic');
    let startInteger = firstArabicPageLabel.integer - firstArabicPageLabel.pageIndex;
    for (let i = 0; i < pagesCount; i++) {
      if (startInteger + i >= 1) {
        pageLabels[i] = (startInteger + i).toString();
      }
    }
  } else {
    for (let i = 0; i < pagesCount; i++) {
      pageLabels[i] = (i + 1).toString();
    }
  }
  return pageLabels;
}
function validateExtractedPageLabels(labels, processedPages) {
  if (labels.length < 2) {
    return false;
  }
  for (let i = 1; i < labels.length; i++) {
    let prevLabel = labels[i - 1];
    let curlabel = labels[i];
    if (prevLabel.type === curlabel.type && curlabel.pageIndex - prevLabel.pageIndex !== curlabel.integer - prevLabel.integer) {
      return false;
    }
  }
  return true;
}
export async function getPageLabels(pdfDocument, structuredCharsProvider) {
  let pageLabels = [];
  try {
    const MAX_PAGES = 25;
    let {
      numPages
    } = pdfDocument.catalog;
    let extractedPageLabels = [];
    let i = 0;
    for (; i < MAX_PAGES; i++) {
      let pageLabel = await getPageLabel(pdfDocument, structuredCharsProvider, i);
      if (pageLabel) {
        extractedPageLabels.push(pageLabel);
      }
    }
    if (!validateExtractedPageLabels(extractedPageLabels, i)) {
      extractedPageLabels = null;
    }
    let catalogPageLabels = await pdfDocument.pdfManager.ensureCatalog("pageLabels");
    pageLabels = predictPageLabels(extractedPageLabels, catalogPageLabels, numPages);
  } catch (e) {
    console.log(e);
  }
  return pageLabels;
}