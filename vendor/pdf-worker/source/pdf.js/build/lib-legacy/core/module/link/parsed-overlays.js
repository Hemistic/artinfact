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
import { getRangeRects, getSortIndex } from '../util.js';
export function getParsedOverlays(chars) {
  if (!chars.length) {
    return [];
  }
  let sequences = [];
  let sequence = {
    from: 0,
    to: 0,
    lbp: []
  };
  let urlBreakChars = ['/', '-', '_', '.', '?', '&', '=', ':', '#', ';', ',', '+', '~', '@', '!'];
  for (let i = 0; i < chars.length; i++) {
    let char = chars[i];
    let charBefore = chars[i - 1];
    if (!charBefore || charBefore.spaceAfter || charBefore && (char.fontSize !== charBefore.fontSize || char.fontName !== charBefore.fontName || charBefore.rect[0] > char.rect[0] && (charBefore.rect[1] - char.rect[3] > (char.rect[3] - char.rect[1]) / 2 || !(urlBreakChars.includes(charBefore.c) || urlBreakChars.includes(char.c))))) {
      sequences.push(sequence);
      sequence = {
        from: i,
        to: i
      };
    } else {
      sequence.to = i;
    }
  }
  if (sequence.from !== sequence.to) {
    sequences.push(sequence);
  }
  let links = [];
  let urlRegExp = new RegExp(/(https?:\/\/|www\.|10\.)[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&\/\/=]*)/);
  let doiRegExp = new RegExp(/10(?:\.[0-9]{4,})?\/[^\s]*[^\s\.,]/);
  for (let sequence of sequences) {
    let text = '';
    for (let j = sequence.from; j <= sequence.to; j++) {
      let char = chars[j];
      text += char.c[0] || '_';
    }
    let match = text.match(urlRegExp);
    if (match) {
      let from = sequence.from + match.index;
      let to = from + match[0].length;
      let url = chars.slice(from, to).map(x => x.c).join('');
      if (url.includes('@')) {
        continue;
      }
      url = url.replace(/[.)]*$/, '');
      links.push({
        from,
        to,
        url
      });
    }
    match = text.match(doiRegExp);
    if (match) {
      let from = sequence.from + match.index;
      let to = from + match[0].length;
      let doi = chars.slice(from, to).map(x => x.c).join('');
      let url = 'https://doi.org/' + encodeURIComponent(doi);
      links.push({
        from,
        to,
        text: doi,
        url
      });
      continue;
    }
  }
  let {
    pageIndex
  } = chars[0];
  let overlays = [];
  for (let link of links) {
    let rects = getRangeRects(chars, link.from, link.to - 1);
    let overlay = {
      type: 'external-link',
      source: 'parsed',
      url: link.url,
      sortIndex: getSortIndex(pageIndex, link.from, 0),
      position: {
        pageIndex,
        rects
      }
    };
    overlays.push(overlay);
  }
  return overlays;
}