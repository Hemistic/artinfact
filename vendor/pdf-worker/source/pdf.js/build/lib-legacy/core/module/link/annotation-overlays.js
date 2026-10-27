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
import { overlayDestinationsEqual } from './util.js';
import { getPositionFromDestination, getRectCenter, getSortIndex } from '../util.js';
async function _getLinkAnnotationOverlays(pdfDocument, chars, pageIndex) {
  let overlays = [];
  let page = await pdfDocument.getPage(pageIndex);
  let annotations = await page._parsedAnnotations;
  for (let annotation of annotations) {
    annotation = annotation.data;
    let {
      url,
      dest,
      rect
    } = annotation;
    if (!url && !dest || !rect) {
      continue;
    }
    let offsetFrom = null;
    let offsetTo = null;
    for (let i = 0; i < chars.length; i++) {
      let char = chars[i];
      let {
        x,
        y
      } = getRectCenter(char.rect);
      if (rect[0] <= x && x <= rect[2] && rect[1] <= y && y <= rect[3]) {
        if (offsetFrom !== null) {
          if (i - offsetFrom !== 1) {
            offsetFrom = null;
            offsetTo = null;
            break;
          }
        } else {
          offsetFrom = i;
        }
        offsetTo = i;
      }
    }
    let overlay = {
      source: 'annotation',
      sortIndex: getSortIndex(pageIndex, offsetFrom || 0, 0),
      position: {
        pageIndex,
        rects: [annotation.rect]
      }
    };
    if (offsetFrom !== null) {
      overlay.offsetFrom = offsetFrom;
      overlay.offsetTo = offsetTo;
      if (offsetFrom === 0) {
        overlay.first = true;
      }
      if (overlay.offsetTo === chars.length - 1) {
        overlay.last = true;
      }
    }
    if (annotation.url) {
      overlay.type = 'external-link';
      overlay.url = url;
      overlays.push(overlay);
    } else if (annotation.dest) {
      overlay.type = 'internal-link';
      let destinationPosition = await getPositionFromDestination(pdfDocument, annotation.dest);
      if (destinationPosition) {
        overlay.destinationPosition = destinationPosition;
        overlays.push(overlay);
      }
    }
  }
  let combinedOverlays = [];
  for (let overlay of overlays) {
    let prevOverlay = combinedOverlays.at(-1);
    if (prevOverlay && prevOverlay.offsetTo + 1 === overlay.offsetFrom && overlayDestinationsEqual(prevOverlay, overlay)) {
      prevOverlay.offsetTo = overlay.offsetTo;
      if (prevOverlay.position) {
        prevOverlay.position.rects.push(overlay.position.rects[0]);
      }
    } else {
      combinedOverlays.push(overlay);
    }
  }
  return combinedOverlays;
}
export async function getAnnotationOverlays(pdfDocument, chars, pageIndex) {
  let linkOverlays = await _getLinkAnnotationOverlays(pdfDocument, chars, pageIndex);
  for (let linkOverlay of linkOverlays) {
    delete linkOverlay.offsetFrom;
    delete linkOverlay.offsetTo;
    delete linkOverlay.first;
    delete linkOverlay.last;
  }
  return linkOverlays;
}