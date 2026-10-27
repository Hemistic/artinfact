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
import "core-js/modules/es.iterator.for-each.js";
import "core-js/modules/es.iterator.map.js";
import "core-js/modules/es.iterator.reduce.js";
import "core-js/modules/es.set.difference.v2.js";
import "core-js/modules/es.set.intersection.v2.js";
import "core-js/modules/es.set.is-disjoint-from.v2.js";
import "core-js/modules/es.set.is-subset-of.v2.js";
import "core-js/modules/es.set.is-superset-of.v2.js";
import "core-js/modules/es.set.symmetric-difference.v2.js";
import "core-js/modules/es.set.union.v2.js";
import { getClusters } from '../../util.js';
import { canStartWithChar, getGroupsFromClusters, getLinesFromChars, getReferencesFromGroup, splitByPageIndexContinuity } from './common.js';
function findClosestSmallerAndHigher(arr, target) {
  let closestSmaller = null;
  let closestHigher = null;
  for (let i = 0; i < arr.length; i++) {
    const num = arr[i];
    if (num < target) {
      if (closestSmaller === null || num > closestSmaller) {
        closestSmaller = num;
      }
    } else if (num > target) {
      if (closestHigher === null || num < closestHigher) {
        closestHigher = num;
      }
    }
  }
  let res = [];
  if (closestSmaller) {
    res.push(closestSmaller);
  }
  if (closestHigher) {
    res.push(closestHigher);
  }
  return res;
}
function addExtraBreakPoints(chars, clusters, sectionOffset) {
  for (let cluster of clusters) {
    let paragraphBreaks = cluster.map(x => x.offset);
    let offsetStart = Math.min(...paragraphBreaks);
    let offsetEnd = Math.max(...paragraphBreaks);
    let starPageIndex = chars[offsetStart].pageIndex;
    let endPageIndex = chars[offsetEnd].pageIndex;
    if (sectionOffset && chars[sectionOffset].pageIndex === starPageIndex) {
      offsetStart = sectionOffset;
    }
    while (offsetEnd < chars.length - 1 && chars[offsetEnd].pageIndex <= endPageIndex) {
      offsetEnd++;
    }
    let paragraphBreakSet = new Set(paragraphBreaks);
    let extraParagraphBreaks = [];
    for (let i = offsetStart; i < offsetEnd; i++) {
      let prevChar = chars[i - 1];
      let char = chars[i];
      if (prevChar && prevChar.lineBreakAfter && canStartWithChar(char) && !paragraphBreakSet.has(i)) {
        let closestBreaks = findClosestSmallerAndHigher(paragraphBreaks, i);
        for (let closestBreak of closestBreaks) {
          let otherChar = chars[closestBreak];
          if (Math.abs(otherChar.rect[0] - char.rect[0]) < 1) {
            extraParagraphBreaks.push(i);
            break;
          }
        }
      }
    }
    for (let extraParagraphBreak of extraParagraphBreaks) {
      cluster.push({
        offset: extraParagraphBreak,
        text: '---'
      });
      cluster.sort((a, b) => a.offset - b.offset);
    }
  }
}
function keepConcentratedItemsOnly(groups) {
  let groups2 = [];
  for (let group of groups) {
    let pageItemCount = new Map();
    for (let item of group) {
      if (item.valid) {
        let count = pageItemCount.get(item.pageIndex) || 0;
        count++;
        pageItemCount.set(item.pageIndex, count);
      }
    }
    let group2 = [];
    for (let item of group) {
      if (pageItemCount.get(item.pageIndex) >= 5 || pageItemCount.get(item.pageIndex - 1) >= 5 || pageItemCount.get(item.pageIndex + 1) >= 5) {
        group2.push(item);
      }
    }
    if (group2.length) {
      groups2.push(group2);
    }
  }
  return groups2;
}
export async function extractByFirstLineIndent(chars, sectionOffset) {
  let lines = getLinesFromChars(chars);
  let breakPoints = [];
  for (let i = 1; i < lines.length; i++) {
    let beforeLine = lines[i - 2];
    let prevLine = lines[i - 1];
    let line = lines[i];
    let nextLine = lines[i + 1];
    let tooBigLinespacing = false;
    if (nextLine) {
      let lineSpacing = prevLine.rect[1] - line.rect[3];
      let nextLineSpacing = line.rect[1] - nextLine.rect[3];
      if (!(lineSpacing < nextLineSpacing || Math.abs(lineSpacing - nextLineSpacing) < 0.5)) {
        tooBigLinespacing = true;
      }
    }
    if (beforeLine) {
      let lineSpacing = prevLine.rect[1] - line.rect[3];
      let beforeLineSpacing = beforeLine.rect[1] - prevLine.rect[3];
      if (!(lineSpacing < beforeLineSpacing || Math.abs(lineSpacing - beforeLineSpacing) < 0.5)) {
        tooBigLinespacing = true;
      }
    }
    if (sectionOffset && prevLine.offset < sectionOffset) {
      continue;
    }
    let delta = line.rect[0] - prevLine.rect[0];
    if (Math.abs(delta) > 5 && Math.abs(delta) < 50 && canStartWithChar(prevLine.chars[0]) && !tooBigLinespacing) {
      breakPoints.push({
        offset: prevLine.offset,
        delta,
        text: prevLine.chars.map(x => x.c).join(''),
        pageIndex: prevLine.pageIndex
      });
    }
  }
  let clusters = getClusters(breakPoints, 'delta', 1);
  clusters.forEach(x => x.sort((a, b) => a.offset - b.offset));
  clusters = splitByPageIndexContinuity(clusters);
  addExtraBreakPoints(chars, clusters, sectionOffset);
  let groups = getGroupsFromClusters(chars, clusters);
  groups = keepConcentratedItemsOnly(groups);
  groups = groups.filter(group => group.filter(item => item.valid).length / group.length >= 0.8);
  if (!sectionOffset) {
    groups = groups.filter(x => (chars[x[0].offset].pageIndex + 1) / (chars.at(-1).pageIndex + 1) >= 0.75);
  }
  if (groups.length === 0) {
    return null;
  }
  let group = groups.reduce((a, b) => a.length > b.length ? a : b, []);
  let references = getReferencesFromGroup(group);
  let offset = group[0].offset;
  return {
    references,
    offset
  };
}