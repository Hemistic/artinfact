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
import "core-js/modules/es.iterator.map.js";
import { getCenterRect, intersectRects } from '../../util.js';
import { getRegularLinkOverlays } from '../../link/link.js';
import { extractByListNumberSpacing } from './list-number-spacing.js';
import { extractByFirstLineIndent } from './first-line-indent.js';
import { extractByParagraphSpacing } from './paragraph-spacing.js';
import { getReferencesTitleOffset, getTextParts } from './common.js';
export async function extractReferences(pdfDocument, combinedChars) {
  let sectionOffset = getReferencesTitleOffset(combinedChars);
  let groups = [await extractByListNumberSpacing(combinedChars, sectionOffset), await extractByFirstLineIndent(combinedChars, sectionOffset), await extractByParagraphSpacing(combinedChars, sectionOffset)];
  groups = groups.filter(x => x);
  let bestGroup = null;
  for (let group of groups) {
    if (bestGroup === null || bestGroup.references.length < group.references.length) {
      bestGroup = group;
    }
  }
  if (!bestGroup) {
    return null;
  }
  let {
    references,
    offset
  } = bestGroup;
  await addUrls(pdfDocument, combinedChars, references);
  for (let reference of references) {
    reference.textParts = getTextParts(reference.chars);
  }
  return {
    references,
    offset
  };
}
async function addUrls(pdfDocument, combinedChars, references) {
  let charPagesMap = new Map();
  for (let char of combinedChars) {
    if (!charPagesMap.has(char.pageIndex)) {
      charPagesMap.set(char.pageIndex, []);
    }
    charPagesMap.get(char.pageIndex).push(char);
  }
  let allPageIndexes = references.map(x => x.position.pageIndex);
  let minPageIndex = Math.min(...allPageIndexes);
  let maxPageIndex = Math.max(...allPageIndexes);
  for (let i = minPageIndex; i <= maxPageIndex; i++) {
    let linkOverlays = await getRegularLinkOverlays(pdfDocument, charPagesMap.get(i), i);
    linkOverlays = linkOverlays.filter(x => x.type === 'external-link');
    for (let linkOverlay of linkOverlays) {
      let {
        rects
      } = linkOverlay.position;
      for (let reference of references) {
        for (let char of reference.chars) {
          if (char.pageIndex === linkOverlay.position.pageIndex) {
            for (let rect of rects) {
              let centerRect = getCenterRect(char.rect);
              if (intersectRects(centerRect, rect)) {
                char.url = linkOverlay.url;
              }
            }
          }
        }
      }
    }
  }
}