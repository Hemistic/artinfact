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
import { getPositionFromRects, getSortIndex } from '../../util.js';
function isYear(word) {
  let number = parseInt(word);
  return word.length === 4 && number == word && number >= 1800 && number <= new Date().getFullYear();
}
function isName(word) {
  return word.length >= 2 && word[0] === word[0].toUpperCase();
}
function canJoinMatches(chars, match1, match2, matches) {
  let offsetFrom = match1.pageOffset + match1.text.length;
  let offsetTo = match2.pageOffset;
  let text = chars.slice(offsetFrom, offsetTo - 1).map(x => x.c).join('');
  let words = [];
  let word = [];
  for (let i = offsetFrom; i < offsetTo; i++) {
    let char = chars[i];
    word.push(char);
    if (char.wordBreakAfter) {
      words.push(word);
      word = [];
    }
  }
  let innerMatches = matches.slice(match1.matchIndex + 1, match2.matchIndex);
  if (match1.type === 'name' && match2.type === 'name') {
    return match1.referenceOffset < match2.referenceOffset && text.length < 10 && !text.split('').some(c => [';', ')'].includes(c));
  } else {
    return text.length < 30 && (match1.matchIndex + 1 === match2.matchIndex || !innerMatches.some(x => x.type === 'name')) && !text.split('').some(c => [';', ')'].includes(c));
  }
}
function getReferenceIndex(references) {
  let index = new Map();
  for (let reference of references) {
    let addingNames = true;
    let addingYear = true;
    let word = [];
    let wordOffsetFrom = 0;
    for (let i = 0; i < reference.chars.length; i++) {
      let char = reference.chars[i];
      word.push(char);
      if (char.wordBreakAfter) {
        let text = word.map(x => x.c).join('');
        let type;
        if (isName(text)) {
          type = 'name';
        } else if (isYear(text)) {
          type = 'year';
        }
        if (['“', '‘'].includes(text[0])) {
          addingNames = false;
        }
        if (type === 'name' && addingNames === true || type === 'year' && addingYear) {
          let existing = index.get(text);
          if (existing) {
            if (!existing.has(reference)) {
              existing.set(reference, wordOffsetFrom);
            }
          } else {
            index.set(text, new Map([[reference, wordOffsetFrom]]));
          }
          if (type === 'year') {
            break;
          }
        }
        word = [];
        wordOffsetFrom = i + 1;
      }
    }
  }
  return index;
}
function getRegularWordsIndex(combinedChars) {
  let index = new Set();
  let word = [];
  let wordOffsetFrom = 0;
  for (let i = 0; i < combinedChars.length; i++) {
    let char = combinedChars[i];
    word.push(char);
    if (char.wordBreakAfter) {
      let text = word.map(x => x.c).join('');
      let lower = text.toLowerCase();
      let upper = text.toUpperCase();
      if (lower !== upper && text === lower) {
        index.add(text);
      }
      word = [];
      wordOffsetFrom = i + 1;
    }
  }
  return index;
}
export function matchByNameAndYear(combinedChars, references) {
  let index = getReferenceIndex(references);
  let regularWordsIndex = getRegularWordsIndex(combinedChars);
  let matches = [];
  let matchIndex = 0;
  let word = [];
  let wordOffsetFrom = 0;
  for (let i = 0; i < combinedChars.length; i++) {
    let char = combinedChars[i];
    word.push(char);
    if (char.wordBreakAfter) {
      if (word.length >= 2 && word[0].c === word[0].c.toUpperCase()) {
        let text = word.map(x => x.c).join('');
        let result = index.get(text);
        if (result && !regularWordsIndex.has(text.toLowerCase())) {
          let type = 'name';
          if (isYear(text)) {
            type = 'year';
          }
          matches.push({
            type,
            text,
            references: result,
            offset: wordOffsetFrom,
            matchIndex: matchIndex++
          });
        }
      }
      word = [];
      wordOffsetFrom = i + 1;
    }
  }
  let matches2 = new Map();
  for (let i = 0; i < matches.length; i++) {
    let match = matches[i];
    for (let [reference, offset] of match.references) {
      let obj = {
        type: match.type,
        text: match.text,
        pageOffset: match.offset,
        referenceOffset: offset,
        matchIndex: match.matchIndex,
        reference
      };
      let existing = matches2.get(reference);
      if (existing) {
        existing.push(obj);
      } else {
        matches2.set(reference, [obj]);
      }
    }
  }
  let groups = [];
  let allMatches = matches;
  for (let [reference, matches] of matches2) {
    let currentGroup = [matches[0]];
    for (let i = 1; i < matches.length; i++) {
      let prevMatch = matches[i - 1];
      let match = matches[i];
      if (canJoinMatches(combinedChars, prevMatch, match, allMatches)) {
        currentGroup.push(match);
      } else {
        groups.push(currentGroup);
        currentGroup = [match];
      }
    }
    groups.push(currentGroup);
  }
  let groups2 = [];
  for (let group of groups) {
    let matches = group;
    let hasName = matches.some(x => x.type === 'name');
    let minOffset = matches.reduce((acc, val) => Math.min(acc, val.referenceOffset), Infinity);
    if (hasName && minOffset < 15) {
      groups2.push(group);
    }
  }
  let offsetMatches = new Map();
  for (let matches of groups2) {
    for (let i = 0; i < matches.length; i++) {
      let match = matches[i];
      let existing = offsetMatches.get(match.pageOffset);
      if (!existing) {
        existing = [];
        offsetMatches.set(match.pageOffset, existing);
      }
      existing.push({
        index: i,
        matches
      });
    }
  }
  let overlays = [];
  for (let [offset, values] of offsetMatches) {
    let references = values.map(x => x.matches[0].reference);
    let length = values[0].matches[values[0].index].text.length;
    let word = combinedChars.slice(offset, offset + length);
    let position = getPositionFromRects(word, word[0].pageIndex);
    overlays.push({
      type: 'citation',
      word,
      offset,
      position,
      sortIndex: getSortIndex(word[0].pageIndex, offset, 0),
      references
    });
  }
  overlays.sort((a, b) => a.offset - b.offset);
  return overlays;
}