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
import "core-js/modules/es.iterator.some.js";
import { getParsedOverlays } from './parsed-overlays.js';
import { getAnnotationOverlays } from './annotation-overlays.js';
import { getMatchedOverlays } from './matched-overlays.js';
import { overlaysIntersect } from '../util.js';
export async function getRegularLinkOverlays(pdfDocument, chars, pageIndex) {
  let annotationOverlays = await getAnnotationOverlays(pdfDocument, chars, pageIndex);
  let parsedOverlays = getParsedOverlays(chars);
  let overlays = [...annotationOverlays];
  for (let parsedOverlay of parsedOverlays) {
    if (!annotationOverlays.some(x => overlaysIntersect(x, parsedOverlay))) {
      overlays.push(parsedOverlay);
    }
  }
  return overlays;
}
export async function getLinkOverlays(pdfDocument, structuredCharsProvider, contentRect) {
  let maxPages = Math.min(50, pdfDocument.catalog.numPages);
  let pages = new Map();
  for (let i = 0; i < maxPages; i++) {
    let chars = await structuredCharsProvider(i);
    let annotationOverlays = await getAnnotationOverlays(pdfDocument, chars, i);
    let parsedOverlays = getParsedOverlays(chars);
    let matchedOverlays = await getMatchedOverlays(pdfDocument, structuredCharsProvider, i, annotationOverlays, contentRect);
    let overlays = [...annotationOverlays];
    for (let matchedOverlay of matchedOverlays) {
      if (!overlays.some(x => overlaysIntersect(x, matchedOverlay))) {
        overlays.push(matchedOverlay);
      }
    }
    for (let parsedOverlay of parsedOverlays) {
      if (!overlays.some(x => overlaysIntersect(x, parsedOverlay))) {
        overlays.push(parsedOverlay);
      }
    }
    if (overlays.length) {
      pages.set(i, overlays);
    }
  }
  return pages;
}