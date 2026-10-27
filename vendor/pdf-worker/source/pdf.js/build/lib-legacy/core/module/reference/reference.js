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
import { extractReferences } from './extractor/extractor.js';
import { getOverlays } from './matcher/matcher.js';
export async function getCitationAndReferenceOverlays(pdfDocument, structuredCharsProvider) {
  let {
    numPages
  } = pdfDocument.catalog;
  if (numPages > 100) {
    return [];
  }
  let combinedChars = [];
  for (let i = 0; i < numPages; i++) {
    let chars = await structuredCharsProvider(i);
    chars = chars.filter(x => !x.isolated).map(x => ({
      ...x
    }));
    combinedChars.push(...chars);
  }
  let res = await extractReferences(pdfDocument, combinedChars);
  if (!res) {
    return [];
  }
  let {
    references,
    offset
  } = res;
  combinedChars = combinedChars.slice(0, offset);
  let {
    citationOverlays,
    referenceOverlays
  } = await getOverlays(pdfDocument, combinedChars, references);
  return [...citationOverlays, ...referenceOverlays];
}