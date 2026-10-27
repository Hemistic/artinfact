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
import "core-js/modules/es.array-buffer.detached.js";
import "core-js/modules/es.array-buffer.transfer.js";
import "core-js/modules/es.array-buffer.transfer-to-fixed-length.js";
import "core-js/modules/es.iterator.constructor.js";
import "core-js/modules/es.iterator.filter.js";
import "core-js/modules/es.iterator.for-each.js";
import "core-js/modules/es.iterator.map.js";
import "core-js/modules/es.promise.with-resolvers.js";
import "core-js/modules/es.set.difference.v2.js";
import "core-js/modules/es.set.intersection.v2.js";
import "core-js/modules/es.set.is-disjoint-from.v2.js";
import "core-js/modules/es.set.is-subset-of.v2.js";
import "core-js/modules/es.set.is-superset-of.v2.js";
import "core-js/modules/es.set.symmetric-difference.v2.js";
import "core-js/modules/es.set.union.v2.js";
import "core-js/modules/es.typed-array.with.js";
import { binarySearchFirstItem, scrollIntoView } from "./ui_utils.js";
import { getCharacterType, getNormalizeWithNFKC } from "./pdf_find_utils.js";
const FindState = {
  FOUND: 0,
  NOT_FOUND: 1,
  WRAPPED: 2,
  PENDING: 3
};
const FIND_TIMEOUT = 250;
const MATCH_SCROLL_OFFSET_TOP = -50;
const MATCH_SCROLL_OFFSET_LEFT = -400;
const CHARACTERS_TO_NORMALIZE = {
  "\u2010": "-",
  "\u2018": "'",
  "\u2019": "'",
  "\u201A": "'",
  "\u201B": "'",
  "\u201C": '"',
  "\u201D": '"',
  "\u201E": '"',
  "\u201F": '"',
  "\u00BC": "1/4",
  "\u00BD": "1/2",
  "\u00BE": "3/4"
};
const DIACRITICS_EXCEPTION = new Set([0x3099, 0x309a, 0x094d, 0x09cd, 0x0a4d, 0x0acd, 0x0b4d, 0x0bcd, 0x0c4d, 0x0ccd, 0x0d3b, 0x0d3c, 0x0d4d, 0x0dca, 0x0e3a, 0x0eba, 0x0f84, 0x1039, 0x103a, 0x1714, 0x1734, 0x17d2, 0x1a60, 0x1b44, 0x1baa, 0x1bab, 0x1bf2, 0x1bf3, 0x2d7f, 0xa806, 0xa82c, 0xa8c4, 0xa953, 0xa9c0, 0xaaf6, 0xabed, 0x0c56, 0x0f71, 0x0f72, 0x0f7a, 0x0f7b, 0x0f7c, 0x0f7d, 0x0f80, 0x0f74]);
let DIACRITICS_EXCEPTION_STR;
const DIACRITICS_REG_EXP = /\p{M}+/gu;
const SPECIAL_CHARS_REG_EXP = /([.*+?^${}()|[\]\\])|(\p{P})|(\s+)|(\p{M})|(\p{L})/gu;
const NOT_DIACRITIC_FROM_END_REG_EXP = /([^\p{M}])\p{M}*$/u;
const NOT_DIACRITIC_FROM_START_REG_EXP = /^\p{M}*([^\p{M}])/u;
const SYLLABLES_REG_EXP = /[\uAC00-\uD7AF\uFA6C\uFACF-\uFAD1\uFAD5-\uFAD7]+/g;
const SYLLABLES_LENGTHS = new Map();
const FIRST_CHAR_SYLLABLES_REG_EXP = "[\\u1100-\\u1112\\ud7a4-\\ud7af\\ud84a\\ud84c\\ud850\\ud854\\ud857\\ud85f]";
const NFKC_CHARS_TO_NORMALIZE = new Map();
let noSyllablesRegExp = null;
let withSyllablesRegExp = null;
function normalize(text, options = {}) {
  const syllablePositions = [];
  let m;
  while ((m = SYLLABLES_REG_EXP.exec(text)) !== null) {
    let {
      index
    } = m;
    for (const char of m[0]) {
      let len = SYLLABLES_LENGTHS.get(char);
      if (!len) {
        len = char.normalize("NFD").length;
        SYLLABLES_LENGTHS.set(char, len);
      }
      syllablePositions.push([len, index++]);
    }
  }
  const hasSyllables = syllablePositions.length > 0;
  const ignoreDashEOL = options.ignoreDashEOL ?? false;
  let normalizationRegex;
  if (!hasSyllables && noSyllablesRegExp) {
    normalizationRegex = noSyllablesRegExp;
  } else if (hasSyllables && withSyllablesRegExp) {
    normalizationRegex = withSyllablesRegExp;
  } else {
    const replace = Object.keys(CHARACTERS_TO_NORMALIZE).join("");
    const toNormalizeWithNFKC = getNormalizeWithNFKC();
    const CJK = "(?:\\p{Ideographic}|[\u3040-\u30FF])";
    const HKDiacritics = "(?:\u3099|\u309A)";
    const BrokenWord = `\\p{Ll}-\\n(?=\\p{Ll})|\\p{Lu}-\\n(?=\\p{L})`;
    const regexps = [`[${replace}]`, `[${toNormalizeWithNFKC}]`, `${HKDiacritics}\\n`, "\\p{M}+(?:-\\n)?", `${BrokenWord}`, "\\S-\\n", `${CJK}\\n`, "\\n", hasSyllables ? FIRST_CHAR_SYLLABLES_REG_EXP : "\\u0000"];
    normalizationRegex = new RegExp(regexps.map(r => `(${r})`).join("|"), "gum");
    if (hasSyllables) {
      withSyllablesRegExp = normalizationRegex;
    } else {
      noSyllablesRegExp = normalizationRegex;
    }
  }
  const rawDiacriticsPositions = [];
  while ((m = DIACRITICS_REG_EXP.exec(text)) !== null) {
    rawDiacriticsPositions.push([m[0].length, m.index]);
  }
  let normalized = text.normalize("NFD");
  const positions = [0, 0];
  let rawDiacriticsIndex = 0;
  let syllableIndex = 0;
  let shift = 0;
  let shiftOrigin = 0;
  let eol = 0;
  let hasDiacritics = false;
  normalized = normalized.replace(normalizationRegex, (match, p1, p2, p3, p4, p5, p6, p7, p8, p9, i) => {
    i -= shiftOrigin;
    if (p1) {
      const replacement = CHARACTERS_TO_NORMALIZE[p1];
      const jj = replacement.length;
      for (let j = 1; j < jj; j++) {
        positions.push(i - shift + j, shift - j);
      }
      shift -= jj - 1;
      return replacement;
    }
    if (p2) {
      let replacement = NFKC_CHARS_TO_NORMALIZE.get(p2);
      if (!replacement) {
        replacement = p2.normalize("NFKC");
        NFKC_CHARS_TO_NORMALIZE.set(p2, replacement);
      }
      const jj = replacement.length;
      for (let j = 1; j < jj; j++) {
        positions.push(i - shift + j, shift - j);
      }
      shift -= jj - 1;
      return replacement;
    }
    if (p3) {
      hasDiacritics = true;
      if (i + eol === rawDiacriticsPositions[rawDiacriticsIndex]?.[1]) {
        ++rawDiacriticsIndex;
      } else {
        positions.push(i - 1 - shift + 1, shift - 1);
        shift -= 1;
        shiftOrigin += 1;
      }
      positions.push(i - shift + 1, shift);
      shiftOrigin += 1;
      eol += 1;
      return p3.charAt(0);
    }
    if (p4) {
      const hasTrailingDashEOL = p4.endsWith("\n");
      const len = hasTrailingDashEOL ? p4.length - 2 : p4.length;
      hasDiacritics = true;
      let jj = len;
      if (i + eol === rawDiacriticsPositions[rawDiacriticsIndex]?.[1]) {
        jj -= rawDiacriticsPositions[rawDiacriticsIndex][0];
        ++rawDiacriticsIndex;
      }
      for (let j = 1; j <= jj; j++) {
        positions.push(i - 1 - shift + j, shift - j);
      }
      shift -= jj;
      shiftOrigin += jj;
      if (hasTrailingDashEOL) {
        i += len - 1;
        positions.push(i - shift + 1, 1 + shift);
        shift += 1;
        shiftOrigin += 1;
        eol += 1;
        return p4.slice(0, len);
      }
      return p4;
    }
    if (p5) {
      if (ignoreDashEOL) {
        shiftOrigin += 1;
        eol += 1;
        return p5.slice(0, -1);
      }
      const len = p5.length - 2;
      positions.push(i - shift + len, 1 + shift);
      shift += 1;
      shiftOrigin += 1;
      eol += 1;
      return p5.slice(0, -2);
    }
    if (p6) {
      shiftOrigin += 1;
      eol += 1;
      return p6.slice(0, -1);
    }
    if (p7) {
      const len = p7.length - 1;
      positions.push(i - shift + len, shift);
      shiftOrigin += 1;
      eol += 1;
      return p7.slice(0, -1);
    }
    if (p8) {
      positions.push(i - shift + 1, shift - 1);
      shift -= 1;
      shiftOrigin += 1;
      eol += 1;
      return " ";
    }
    if (i + eol === syllablePositions[syllableIndex]?.[1]) {
      const newCharLen = syllablePositions[syllableIndex][0] - 1;
      ++syllableIndex;
      for (let j = 1; j <= newCharLen; j++) {
        positions.push(i - (shift - j), shift - j);
      }
      shift -= newCharLen;
      shiftOrigin += newCharLen;
    }
    return p9;
  });
  positions.push(normalized.length, shift);
  const starts = new Uint32Array(positions.length >> 1);
  const shifts = new Int32Array(positions.length >> 1);
  for (let i = 0, ii = positions.length; i < ii; i += 2) {
    starts[i >> 1] = positions[i];
    shifts[i >> 1] = positions[i + 1];
  }
  return [normalized, [starts, shifts], hasDiacritics];
}
function getOriginalIndex(diffs, pos, len) {
  if (!diffs) {
    return [pos, len];
  }
  const [starts, shifts] = diffs;
  const start = pos;
  const end = pos + len - 1;
  let i = binarySearchFirstItem(starts, x => x >= start);
  if (starts[i] > start) {
    --i;
  }
  let j = binarySearchFirstItem(starts, x => x >= end, i);
  if (starts[j] > end) {
    --j;
  }
  const oldStart = start + shifts[i];
  const oldEnd = end + shifts[j];
  const oldLen = oldEnd + 1 - oldStart;
  return [oldStart, oldLen];
}
class PDFFindController {
  #state = null;
  #updateMatchesCountOnProgress = true;
  #visitedPagesCount = 0;
  constructor({
    linkService,
    eventBus,
    updateMatchesCountOnProgress = true
  }) {
    this._linkService = linkService;
    this._eventBus = eventBus;
    this.#updateMatchesCountOnProgress = updateMatchesCountOnProgress;
    this.onIsPageVisible = null;
    this.#reset();
    eventBus._on("find", this.#onFind.bind(this));
    eventBus._on("findbarclose", this.#onFindBarClose.bind(this));
  }
  get highlightMatches() {
    return this._highlightMatches;
  }
  get pageMatches() {
    return this._pageMatches;
  }
  get pageMatchesLength() {
    return this._pageMatchesLength;
  }
  get selected() {
    return this._selected;
  }
  get state() {
    return this.#state;
  }
  setDocument(pdfDocument) {
    if (this._pdfDocument) {
      this.#reset();
    }
    if (!pdfDocument) {
      return;
    }
    this._pdfDocument = pdfDocument;
    this._firstPageCapability.resolve();
  }
  #onFind(state) {
    if (!state) {
      return;
    }
    const pdfDocument = this._pdfDocument;
    const {
      type
    } = state;
    if (this.#state === null || this.#shouldDirtyMatch(state)) {
      this._dirtyMatch = true;
    }
    this.#state = state;
    if (type !== "highlightallchange") {
      this.#updateUIState(FindState.PENDING);
    }
    this._firstPageCapability.promise.then(() => {
      if (!this._pdfDocument || pdfDocument && this._pdfDocument !== pdfDocument) {
        return;
      }
      this.#extractText();
      const findbarClosed = !this._highlightMatches;
      const pendingTimeout = !!this._findTimeout;
      if (this._findTimeout) {
        clearTimeout(this._findTimeout);
        this._findTimeout = null;
      }
      if (!type) {
        this._findTimeout = setTimeout(() => {
          this.#nextMatch();
          this._findTimeout = null;
        }, FIND_TIMEOUT);
      } else if (this._dirtyMatch) {
        this.#nextMatch();
      } else if (type === "again") {
        this.#nextMatch();
        if (findbarClosed && this.#state.highlightAll) {
          this.#updateAllPages();
        }
      } else if (type === "highlightallchange") {
        if (pendingTimeout) {
          this.#nextMatch();
        } else {
          this._highlightMatches = true;
        }
        this.#updateAllPages();
      } else {
        this.#nextMatch();
      }
    });
  }
  scrollMatchIntoView({
    element = null,
    selectedLeft = 0,
    pageIndex = -1,
    matchIndex = -1
  }) {
    if (!this._scrollMatches || !element) {
      return;
    } else if (matchIndex === -1 || matchIndex !== this._selected.matchIdx) {
      return;
    } else if (pageIndex === -1 || pageIndex !== this._selected.pageIdx) {
      return;
    }
    this._scrollMatches = false;
    const spot = {
      top: MATCH_SCROLL_OFFSET_TOP,
      left: selectedLeft + MATCH_SCROLL_OFFSET_LEFT
    };
    scrollIntoView(element, spot, true);
  }
  #reset() {
    this._highlightMatches = false;
    this._scrollMatches = false;
    this._pdfDocument = null;
    this._pageMatches = [];
    this._pageMatchesLength = [];
    this.#visitedPagesCount = 0;
    this.#state = null;
    this._selected = {
      pageIdx: -1,
      matchIdx: -1
    };
    this._offset = {
      pageIdx: null,
      matchIdx: null,
      wrapped: false
    };
    this._extractTextPromises = [];
    this._pageContents = [];
    this._pageDiffs = [];
    this._hasDiacritics = [];
    this._matchesCountTotal = 0;
    this._pagesToSearch = null;
    this._pendingFindMatches = new Set();
    this._resumePageIdx = null;
    this._dirtyMatch = false;
    clearTimeout(this._findTimeout);
    this._findTimeout = null;
    this._firstPageCapability = Promise.withResolvers();
  }
  get #query() {
    const {
      query
    } = this.#state;
    if (typeof query === "string") {
      if (query !== this._rawQuery) {
        this._rawQuery = query;
        [this._normalizedQuery] = normalize(query);
      }
      return this._normalizedQuery;
    }
    return (query || []).filter(q => !!q).map(q => normalize(q)[0]);
  }
  #shouldDirtyMatch(state) {
    const newQuery = state.query,
      prevQuery = this.#state.query;
    const newType = typeof newQuery,
      prevType = typeof prevQuery;
    if (newType !== prevType) {
      return true;
    }
    if (newType === "string") {
      if (newQuery !== prevQuery) {
        return true;
      }
    } else if (JSON.stringify(newQuery) !== JSON.stringify(prevQuery)) {
      return true;
    }
    switch (state.type) {
      case "again":
        const pageNumber = this._selected.pageIdx + 1;
        const linkService = this._linkService;
        return pageNumber >= 1 && pageNumber <= linkService.pagesCount && pageNumber !== linkService.page && !(this.onIsPageVisible?.(pageNumber) ?? true);
      case "highlightallchange":
        return false;
    }
    return true;
  }
  #isEntireWord(content, startIdx, length) {
    let match = content.slice(0, startIdx).match(NOT_DIACRITIC_FROM_END_REG_EXP);
    if (match) {
      const first = content.charCodeAt(startIdx);
      const limit = match[1].charCodeAt(0);
      if (getCharacterType(first) === getCharacterType(limit)) {
        return false;
      }
    }
    match = content.slice(startIdx + length).match(NOT_DIACRITIC_FROM_START_REG_EXP);
    if (match) {
      const last = content.charCodeAt(startIdx + length - 1);
      const limit = match[1].charCodeAt(0);
      if (getCharacterType(last) === getCharacterType(limit)) {
        return false;
      }
    }
    return true;
  }
  #convertToRegExpString(query, hasDiacritics) {
    const {
      matchDiacritics
    } = this.#state;
    let isUnicode = false;
    query = query.replaceAll(SPECIAL_CHARS_REG_EXP, (match, p1, p2, p3, p4, p5) => {
      if (p1) {
        return `[ ]*\\${p1}[ ]*`;
      }
      if (p2) {
        return `[ ]*${p2}[ ]*`;
      }
      if (p3) {
        return "[ ]+";
      }
      if (matchDiacritics) {
        return p4 || p5;
      }
      if (p4) {
        return DIACRITICS_EXCEPTION.has(p4.charCodeAt(0)) ? p4 : "";
      }
      if (hasDiacritics) {
        isUnicode = true;
        return `${p5}\\p{M}*`;
      }
      return p5;
    });
    const trailingSpaces = "[ ]*";
    if (query.endsWith(trailingSpaces)) {
      query = query.slice(0, query.length - trailingSpaces.length);
    }
    if (matchDiacritics) {
      if (hasDiacritics) {
        DIACRITICS_EXCEPTION_STR ||= String.fromCharCode(...DIACRITICS_EXCEPTION);
        isUnicode = true;
        query = `${query}(?=[${DIACRITICS_EXCEPTION_STR}]|[^\\p{M}]|$)`;
      }
    }
    return [isUnicode, query];
  }
  #calculateMatch(pageIndex) {
    if (!this.#state) {
      return;
    }
    const query = this.#query;
    if (query.length === 0) {
      return;
    }
    const pageContent = this._pageContents[pageIndex];
    const matcherResult = this.match(query, pageContent, pageIndex);
    const matches = this._pageMatches[pageIndex] = [];
    const matchesLength = this._pageMatchesLength[pageIndex] = [];
    const diffs = this._pageDiffs[pageIndex];
    matcherResult?.forEach(({
      index,
      length
    }) => {
      const [matchPos, matchLen] = getOriginalIndex(diffs, index, length);
      if (matchLen) {
        matches.push(matchPos);
        matchesLength.push(matchLen);
      }
    });
    if (this.#state.highlightAll) {
      this.#updatePage(pageIndex);
    }
    if (this._resumePageIdx === pageIndex) {
      this._resumePageIdx = null;
      this.#nextPageMatch();
    }
    const pageMatchesCount = matches.length;
    this._matchesCountTotal += pageMatchesCount;
    if (this.#updateMatchesCountOnProgress) {
      if (pageMatchesCount > 0) {
        this.#updateUIResultsCount();
      }
    } else if (++this.#visitedPagesCount === this._linkService.pagesCount) {
      this.#updateUIResultsCount();
    }
  }
  match(query, pageContent, pageIndex) {
    const hasDiacritics = this._hasDiacritics[pageIndex];
    let isUnicode = false;
    if (typeof query === "string") {
      [isUnicode, query] = this.#convertToRegExpString(query, hasDiacritics);
    } else {
      query = query.sort().reverse().map(q => {
        const [isUnicodePart, queryPart] = this.#convertToRegExpString(q, hasDiacritics);
        isUnicode ||= isUnicodePart;
        return `(${queryPart})`;
      }).join("|");
    }
    if (!query) {
      return undefined;
    }
    const {
      caseSensitive,
      entireWord
    } = this.#state;
    const flags = `g${isUnicode ? "u" : ""}${caseSensitive ? "" : "i"}`;
    query = new RegExp(query, flags);
    const matches = [];
    let match;
    while ((match = query.exec(pageContent)) !== null) {
      if (entireWord && !this.#isEntireWord(pageContent, match.index, match[0].length)) {
        continue;
      }
      matches.push({
        index: match.index,
        length: match[0].length
      });
    }
    return matches;
  }
  #extractText() {
    if (this._extractTextPromises.length > 0) {
      return;
    }
    let deferred = Promise.resolve();
    const textOptions = {
      disableNormalization: true
    };
    const pdfDoc = this._pdfDocument;
    for (let i = 0, ii = this._linkService.pagesCount; i < ii; i++) {
      const {
        promise,
        resolve
      } = Promise.withResolvers();
      this._extractTextPromises[i] = promise;
      deferred = deferred.then(async () => {
        if (pdfDoc !== this._pdfDocument) {
          resolve();
          return;
        }
        await pdfDoc.getPage(i + 1).then(pdfPage => pdfPage.getTextContent(textOptions)).then(textContent => {
          const strBuf = [];
          for (const textItem of textContent.items) {
            strBuf.push(textItem.str);
            if (textItem.hasEOL) {
              strBuf.push("\n");
            }
          }
          [this._pageContents[i], this._pageDiffs[i], this._hasDiacritics[i]] = normalize(strBuf.join(""));
          resolve();
        }, reason => {
          console.error(`Unable to get text content for page ${i + 1}`, reason);
          this._pageContents[i] = "";
          this._pageDiffs[i] = null;
          this._hasDiacritics[i] = false;
          resolve();
        });
      });
    }
  }
  #updatePage(index) {
    if (this._scrollMatches && this._selected.pageIdx === index) {
      this._linkService.page = index + 1;
    }
    this._eventBus.dispatch("updatetextlayermatches", {
      source: this,
      pageIndex: index
    });
  }
  #updateAllPages() {
    this._eventBus.dispatch("updatetextlayermatches", {
      source: this,
      pageIndex: -1
    });
  }
  #nextMatch() {
    const previous = this.#state.findPrevious;
    const currentPageIndex = this._linkService.page - 1;
    const numPages = this._linkService.pagesCount;
    this._highlightMatches = true;
    if (this._dirtyMatch) {
      this._dirtyMatch = false;
      this._selected.pageIdx = this._selected.matchIdx = -1;
      this._offset.pageIdx = currentPageIndex;
      this._offset.matchIdx = null;
      this._offset.wrapped = false;
      this._resumePageIdx = null;
      this._pageMatches.length = 0;
      this._pageMatchesLength.length = 0;
      this.#visitedPagesCount = 0;
      this._matchesCountTotal = 0;
      this.#updateAllPages();
      for (let i = 0; i < numPages; i++) {
        if (this._pendingFindMatches.has(i)) {
          continue;
        }
        this._pendingFindMatches.add(i);
        this._extractTextPromises[i].then(() => {
          this._pendingFindMatches.delete(i);
          this.#calculateMatch(i);
        });
      }
    }
    const query = this.#query;
    if (query.length === 0) {
      this.#updateUIState(FindState.FOUND);
      return;
    }
    if (this._resumePageIdx) {
      return;
    }
    const offset = this._offset;
    this._pagesToSearch = numPages;
    if (offset.matchIdx !== null) {
      const numPageMatches = this._pageMatches[offset.pageIdx].length;
      if (!previous && offset.matchIdx + 1 < numPageMatches || previous && offset.matchIdx > 0) {
        offset.matchIdx = previous ? offset.matchIdx - 1 : offset.matchIdx + 1;
        this.#updateMatch(true);
        return;
      }
      this.#advanceOffsetPage(previous);
    }
    this.#nextPageMatch();
  }
  #matchesReady(matches) {
    const offset = this._offset;
    const numMatches = matches.length;
    const previous = this.#state.findPrevious;
    if (numMatches) {
      offset.matchIdx = previous ? numMatches - 1 : 0;
      this.#updateMatch(true);
      return true;
    }
    this.#advanceOffsetPage(previous);
    if (offset.wrapped) {
      offset.matchIdx = null;
      if (this._pagesToSearch < 0) {
        this.#updateMatch(false);
        return true;
      }
    }
    return false;
  }
  #nextPageMatch() {
    if (this._resumePageIdx !== null) {
      console.error("There can only be one pending page.");
    }
    let matches = null;
    do {
      const pageIdx = this._offset.pageIdx;
      matches = this._pageMatches[pageIdx];
      if (!matches) {
        this._resumePageIdx = pageIdx;
        break;
      }
    } while (!this.#matchesReady(matches));
  }
  #advanceOffsetPage(previous) {
    const offset = this._offset;
    const numPages = this._linkService.pagesCount;
    offset.pageIdx = previous ? offset.pageIdx - 1 : offset.pageIdx + 1;
    offset.matchIdx = null;
    this._pagesToSearch--;
    if (offset.pageIdx >= numPages || offset.pageIdx < 0) {
      offset.pageIdx = previous ? numPages - 1 : 0;
      offset.wrapped = true;
    }
  }
  #updateMatch(found = false) {
    let state = FindState.NOT_FOUND;
    const wrapped = this._offset.wrapped;
    this._offset.wrapped = false;
    if (found) {
      const previousPage = this._selected.pageIdx;
      this._selected.pageIdx = this._offset.pageIdx;
      this._selected.matchIdx = this._offset.matchIdx;
      state = wrapped ? FindState.WRAPPED : FindState.FOUND;
      if (previousPage !== -1 && previousPage !== this._selected.pageIdx) {
        this.#updatePage(previousPage);
      }
    }
    this.#updateUIState(state, this.#state.findPrevious);
    if (this._selected.pageIdx !== -1) {
      this._scrollMatches = true;
      this.#updatePage(this._selected.pageIdx);
    }
  }
  #onFindBarClose(evt) {
    const pdfDocument = this._pdfDocument;
    this._firstPageCapability.promise.then(() => {
      if (!this._pdfDocument || pdfDocument && this._pdfDocument !== pdfDocument) {
        return;
      }
      if (this._findTimeout) {
        clearTimeout(this._findTimeout);
        this._findTimeout = null;
      }
      if (this._resumePageIdx) {
        this._resumePageIdx = null;
        this._dirtyMatch = true;
      }
      this.#updateUIState(FindState.FOUND);
      this._highlightMatches = false;
      this.#updateAllPages();
    });
  }
  #requestMatchesCount() {
    const {
      pageIdx,
      matchIdx
    } = this._selected;
    let current = 0,
      total = this._matchesCountTotal;
    if (matchIdx !== -1) {
      for (let i = 0; i < pageIdx; i++) {
        current += this._pageMatches[i]?.length || 0;
      }
      current += matchIdx + 1;
    }
    if (current < 1 || current > total) {
      current = total = 0;
    }
    return {
      current,
      total
    };
  }
  #updateUIResultsCount() {
    this._eventBus.dispatch("updatefindmatchescount", {
      source: this,
      matchesCount: this.#requestMatchesCount()
    });
  }
  #updateUIState(state, previous = false) {
    if (!this.#updateMatchesCountOnProgress && (this.#visitedPagesCount !== this._linkService.pagesCount || state === FindState.PENDING)) {
      return;
    }
    this._eventBus.dispatch("updatefindcontrolstate", {
      source: this,
      state,
      previous,
      entireWord: this.#state?.entireWord ?? null,
      matchesCount: this.#requestMatchesCount(),
      rawQuery: this.#state?.query ?? null
    });
  }
}
export { FindState, getOriginalIndex, normalize, PDFFindController };