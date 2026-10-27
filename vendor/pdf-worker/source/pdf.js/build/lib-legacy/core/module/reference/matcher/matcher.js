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
import { getSortIndex } from '../../util.js';
import { matchByNumber } from './number.js';
import { matchByNameAndYear } from './name-year.js';
export async function getOverlays(pdfDocument, combinedChars, references) {
  let citationOverlays;
  if (references[0].index) {
    citationOverlays = await matchByNumber(pdfDocument, combinedChars, references);
  } else {
    citationOverlays = matchByNameAndYear(combinedChars, references);
  }
  let referenceMap = new Map();
  for (let citationOverlay of citationOverlays) {
    for (let reference of citationOverlay.references) {
      let group = referenceMap.get(reference);
      if (!group) {
        group = [];
        referenceMap.set(reference, group);
      }
      group.push(citationOverlay);
    }
  }
  let referenceOverlays = [];
  for (let [reference, citationOverlays] of referenceMap) {
    let {
      pageIndex,
      offset
    } = reference.chars[0];
    let referenceOverlay = {
      type: 'reference',
      position: reference.position,
      sortIndex: getSortIndex(pageIndex, offset, 0),
      references: [reference],
      citations: []
    };
    for (let citationOverlay of citationOverlays) {
      let {
        word,
        offset,
        position
      } = citationOverlay;
      referenceOverlay.citations.push({
        word,
        offset,
        position
      });
    }
    referenceOverlays.push(referenceOverlay);
  }
  return {
    citationOverlays,
    referenceOverlays
  };
}