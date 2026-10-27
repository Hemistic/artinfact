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
import "core-js/modules/web.url.can-parse.js";
import { AnnotationType, createValidAbsoluteUrl, Util } from "../pdf.js";
import { getOriginalIndex, normalize } from "./pdf_find_controller.js";
function DOMRectToPDF({
  width,
  height,
  left,
  top
}, pdfPageView) {
  if (width === 0 || height === 0) {
    return null;
  }
  const pageBox = pdfPageView.textLayer.div.getBoundingClientRect();
  const bottomLeft = pdfPageView.getPagePoint(left - pageBox.left, top - pageBox.top);
  const topRight = pdfPageView.getPagePoint(left - pageBox.left + width, top - pageBox.top + height);
  return Util.normalizeRect([bottomLeft[0], bottomLeft[1], topRight[0], topRight[1]]);
}
function calculateLinkPosition(range, pdfPageView) {
  const rangeRects = range.getClientRects();
  if (rangeRects.length === 1) {
    return {
      rect: DOMRectToPDF(rangeRects[0], pdfPageView)
    };
  }
  const rect = [Infinity, Infinity, -Infinity, -Infinity];
  const quadPoints = [];
  let i = 0;
  for (const domRect of rangeRects) {
    const normalized = DOMRectToPDF(domRect, pdfPageView);
    if (normalized === null) {
      continue;
    }
    quadPoints[i] = quadPoints[i + 4] = normalized[0];
    quadPoints[i + 1] = quadPoints[i + 3] = normalized[3];
    quadPoints[i + 2] = quadPoints[i + 6] = normalized[2];
    quadPoints[i + 5] = quadPoints[i + 7] = normalized[1];
    Util.rectBoundingBox(...normalized, rect);
    i += 8;
  }
  return {
    quadPoints,
    rect
  };
}
function textPosition(container, offset) {
  let currentContainer = container;
  do {
    if (currentContainer.nodeType === Node.TEXT_NODE) {
      const currentLength = currentContainer.textContent.length;
      if (offset <= currentLength) {
        return [currentContainer, offset];
      }
      offset -= currentLength;
    } else if (currentContainer.firstChild) {
      currentContainer = currentContainer.firstChild;
      continue;
    }
    while (!currentContainer.nextSibling && currentContainer !== container) {
      currentContainer = currentContainer.parentNode;
    }
    if (currentContainer !== container) {
      currentContainer = currentContainer.nextSibling;
    }
  } while (currentContainer !== container);
  throw new Error("Offset is bigger than container's contents length.");
}
function createLinkAnnotation({
  url,
  index,
  length
}, pdfPageView, id) {
  const highlighter = pdfPageView._textHighlighter;
  const [{
    begin,
    end
  }] = highlighter._convertMatches([index], [length]);
  const range = new Range();
  range.setStart(...textPosition(highlighter.textDivs[begin.divIdx], begin.offset));
  range.setEnd(...textPosition(highlighter.textDivs[end.divIdx], end.offset));
  return {
    id: `inferred_link_${id}`,
    unsafeUrl: url,
    url,
    annotationType: AnnotationType.LINK,
    rotation: 0,
    ...calculateLinkPosition(range, pdfPageView),
    borderStyle: null
  };
}
class Autolinker {
  static #index = 0;
  static #regex;
  static findLinks(text) {
    this.#regex ??= /\b(?:https?:\/\/|mailto:|www\.)(?:[\0-\x08\x0E-\x1F\$\+0-9=A-Z\^`-z\|~-\x9F\xA2-\xA6\xA8-\xAA\xAC-\xB5\xB8-\xBA\xBC-\xBE\xC0-\u037D\u037F-\u0386\u0388-\u0559\u0560-\u0588\u058B-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7-\u05F2\u05F5-\u0608\u060B\u060E-\u061A\u061C\u0620-\u0669\u066E-\u06D3\u06D5-\u06FF\u070E-\u07F6\u07FA-\u082F\u083F-\u085D\u085F-\u0963\u0966-\u096F\u0971-\u09FC\u09FE-\u0A75\u0A77-\u0AEF\u0AF1-\u0C76\u0C78-\u0C83\u0C85-\u0DF3\u0DF5-\u0E4E\u0E50-\u0E59\u0E5C-\u0F03\u0F13\u0F15-\u0F39\u0F3E-\u0F84\u0F86-\u0FCF\u0FD5-\u0FD8\u0FDB-\u1049\u1050-\u10FA\u10FC-\u135F\u1369-\u13FF\u1401-\u166D\u166F-\u167F\u1681-\u169A\u169D-\u16EA\u16EE-\u1734\u1737-\u17D3\u17D7\u17DB-\u17FF\u180B-\u1943\u1946-\u1A1D\u1A20-\u1A9F\u1AA7\u1AAE-\u1B4D\u1B50-\u1B59\u1B61-\u1B7C\u1B80-\u1BFB\u1C00-\u1C3A\u1C40-\u1C7D\u1C80-\u1CBF\u1CC8-\u1CD2\u1CD4-\u1FFF\u200B-\u200F\u202A-\u202E\u2044\u2052\u2060-\u207C\u207F-\u208C\u208F-\u2307\u230C-\u2328\u232B-\u2767\u2776-\u27C4\u27C7-\u27E5\u27F0-\u2982\u2999-\u29D7\u29DC-\u29FB\u29FE-\u2CF8\u2CFD\u2D00-\u2D6F\u2D71-\u2DFF\u2E2F\u2E50\u2E51\u2E5E-\u2FFF\u3004-\u3007\u3012\u3013\u3020-\u302F\u3031-\u303C\u303E-\u309F\u30A1-\u30FA\u30FC-\uA4FD\uA500-\uA60C\uA610-\uA672\uA674-\uA67D\uA67F-\uA6F1\uA6F8-\uA873\uA878-\uA8CD\uA8D0-\uA8F7\uA8FB\uA8FD-\uA92D\uA930-\uA95E\uA960-\uA9C0\uA9CE-\uA9DD\uA9E0-\uAA5B\uAA60-\uAADD\uAAE0-\uAAEF\uAAF2-\uABEA\uABEC-\uFD3D\uFD40-\uFE0F\uFE1A-\uFE2F\uFE53\uFE62\uFE64-\uFE67\uFE69\uFE6C-\uFEFE\uFF00\uFF04\uFF0B\uFF10-\uFF19\uFF1C-\uFF1E\uFF21-\uFF3A\uFF3E\uFF40-\uFF5A\uFF5C\uFF5E\uFF66-\u{100FF}\u{10103}-\u{1039E}\u{103A0}-\u{103CF}\u{103D1}-\u{1056E}\u{10570}-\u{10856}\u{10858}-\u{1091E}\u{10920}-\u{1093E}\u{10940}-\u{10A4F}\u{10A59}-\u{10A7E}\u{10A80}-\u{10AEF}\u{10AF7}-\u{10B38}\u{10B40}-\u{10B98}\u{10B9D}-\u{10D6D}\u{10D6F}-\u{10EAC}\u{10EAE}-\u{10F54}\u{10F5A}-\u{10F85}\u{10F8A}-\u{11046}\u{1104E}-\u{110BA}\u{110BD}\u{110C2}-\u{1113F}\u{11144}-\u{11173}\u{11176}-\u{111C4}\u{111C9}-\u{111CC}\u{111CE}-\u{111DA}\u{111DC}\u{111E0}-\u{11237}\u{1123E}-\u{112A8}\u{112AA}-\u{113D3}\u{113D6}\u{113D9}-\u{1144A}\u{11450}-\u{11459}\u{1145C}\u{1145E}-\u{114C5}\u{114C7}-\u{115C0}\u{115D8}-\u{11640}\u{11644}-\u{1165F}\u{1166D}-\u{116B8}\u{116BA}-\u{1173B}\u{1173F}-\u{1183A}\u{1183C}-\u{11943}\u{11947}-\u{119E1}\u{119E3}-\u{11A3E}\u{11A47}-\u{11A99}\u{11A9D}\u{11AA3}-\u{11AFF}\u{11B0A}-\u{11BE0}\u{11BE2}-\u{11C40}\u{11C46}-\u{11C6F}\u{11C72}-\u{11EF6}\u{11EF9}-\u{11F42}\u{11F50}-\u{11FFE}\u{12000}-\u{1246F}\u{12475}-\u{12FF0}\u{12FF3}-\u{16A6D}\u{16A70}-\u{16AF4}\u{16AF6}-\u{16B36}\u{16B3C}-\u{16B43}\u{16B45}-\u{16D6C}\u{16D70}-\u{16E96}\u{16E9B}-\u{16FE1}\u{16FE3}-\u{1BC9E}\u{1BCA0}-\u{1DA86}\u{1DA8C}-\u{1E5FE}\u{1E600}-\u{1E95D}\u{1E960}-\u{10FFFF}]|\/|[\0-\x08\x0E-\x1F!-Z\\\^-\x9F\xA1-\u167F\u1681-\u1FFF\u200B-\u2027\u202A-\u202E\u2030-\u205E\u2060-\u2FFF\u3001-\uFEFE\uFF00-\u{10FFFF}]+[\0-\x08\x0E-\x1F\$\+0-9=A-Z\^`-z\|~-\x9F\xA2-\xA6\xA8-\xAA\xAC-\xB5\xB8-\xBA\xBC-\xBE\xC0-\u037D\u037F-\u0386\u0388-\u0559\u0560-\u0588\u058B-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7-\u05F2\u05F5-\u0608\u060B\u060E-\u061A\u061C\u0620-\u0669\u066E-\u06D3\u06D5-\u06FF\u070E-\u07F6\u07FA-\u082F\u083F-\u085D\u085F-\u0963\u0966-\u096F\u0971-\u09FC\u09FE-\u0A75\u0A77-\u0AEF\u0AF1-\u0C76\u0C78-\u0C83\u0C85-\u0DF3\u0DF5-\u0E4E\u0E50-\u0E59\u0E5C-\u0F03\u0F13\u0F15-\u0F39\u0F3E-\u0F84\u0F86-\u0FCF\u0FD5-\u0FD8\u0FDB-\u1049\u1050-\u10FA\u10FC-\u135F\u1369-\u13FF\u1401-\u166D\u166F-\u167F\u1681-\u169A\u169D-\u16EA\u16EE-\u1734\u1737-\u17D3\u17D7\u17DB-\u17FF\u180B-\u1943\u1946-\u1A1D\u1A20-\u1A9F\u1AA7\u1AAE-\u1B4D\u1B50-\u1B59\u1B61-\u1B7C\u1B80-\u1BFB\u1C00-\u1C3A\u1C40-\u1C7D\u1C80-\u1CBF\u1CC8-\u1CD2\u1CD4-\u1FFF\u200B-\u200F\u202A-\u202E\u2044\u2052\u2060-\u207C\u207F-\u208C\u208F-\u2307\u230C-\u2328\u232B-\u2767\u2776-\u27C4\u27C7-\u27E5\u27F0-\u2982\u2999-\u29D7\u29DC-\u29FB\u29FE-\u2CF8\u2CFD\u2D00-\u2D6F\u2D71-\u2DFF\u2E2F\u2E50\u2E51\u2E5E-\u2FFF\u3004-\u3007\u3012\u3013\u3020-\u302F\u3031-\u303C\u303E-\u309F\u30A1-\u30FA\u30FC-\uA4FD\uA500-\uA60C\uA610-\uA672\uA674-\uA67D\uA67F-\uA6F1\uA6F8-\uA873\uA878-\uA8CD\uA8D0-\uA8F7\uA8FB\uA8FD-\uA92D\uA930-\uA95E\uA960-\uA9C0\uA9CE-\uA9DD\uA9E0-\uAA5B\uAA60-\uAADD\uAAE0-\uAAEF\uAAF2-\uABEA\uABEC-\uFD3D\uFD40-\uFE0F\uFE1A-\uFE2F\uFE53\uFE62\uFE64-\uFE67\uFE69\uFE6C-\uFEFE\uFF00\uFF04\uFF0B\uFF10-\uFF19\uFF1C-\uFF1E\uFF21-\uFF3A\uFF3E\uFF40-\uFF5A\uFF5C\uFF5E\uFF66-\u{100FF}\u{10103}-\u{1039E}\u{103A0}-\u{103CF}\u{103D1}-\u{1056E}\u{10570}-\u{10856}\u{10858}-\u{1091E}\u{10920}-\u{1093E}\u{10940}-\u{10A4F}\u{10A59}-\u{10A7E}\u{10A80}-\u{10AEF}\u{10AF7}-\u{10B38}\u{10B40}-\u{10B98}\u{10B9D}-\u{10D6D}\u{10D6F}-\u{10EAC}\u{10EAE}-\u{10F54}\u{10F5A}-\u{10F85}\u{10F8A}-\u{11046}\u{1104E}-\u{110BA}\u{110BD}\u{110C2}-\u{1113F}\u{11144}-\u{11173}\u{11176}-\u{111C4}\u{111C9}-\u{111CC}\u{111CE}-\u{111DA}\u{111DC}\u{111E0}-\u{11237}\u{1123E}-\u{112A8}\u{112AA}-\u{113D3}\u{113D6}\u{113D9}-\u{1144A}\u{11450}-\u{11459}\u{1145C}\u{1145E}-\u{114C5}\u{114C7}-\u{115C0}\u{115D8}-\u{11640}\u{11644}-\u{1165F}\u{1166D}-\u{116B8}\u{116BA}-\u{1173B}\u{1173F}-\u{1183A}\u{1183C}-\u{11943}\u{11947}-\u{119E1}\u{119E3}-\u{11A3E}\u{11A47}-\u{11A99}\u{11A9D}\u{11AA3}-\u{11AFF}\u{11B0A}-\u{11BE0}\u{11BE2}-\u{11C40}\u{11C46}-\u{11C6F}\u{11C72}-\u{11EF6}\u{11EF9}-\u{11F42}\u{11F50}-\u{11FFE}\u{12000}-\u{1246F}\u{12475}-\u{12FF0}\u{12FF3}-\u{16A6D}\u{16A70}-\u{16AF4}\u{16AF6}-\u{16B36}\u{16B3C}-\u{16B43}\u{16B45}-\u{16D6C}\u{16D70}-\u{16E96}\u{16E9B}-\u{16FE1}\u{16FE3}-\u{1BC9E}\u{1BCA0}-\u{1DA86}\u{1DA8C}-\u{1E5FE}\u{1E600}-\u{1E95D}\u{1E960}-\u{10FFFF}])+|\b[\0-\x08\x0E-\x1F!-'\*-;=\?A-Z\\\^-z\|~-\x9F\xA1-\u0F39\u0F3E-\u167F\u1681-\u169A\u169D-\u1FFF\u200B-\u2019\u201B-\u201D\u201F-\u2027\u202A-\u202E\u2030-\u2044\u2047-\u205E\u2060-\u207C\u207F-\u208C\u208F-\u2307\u230C-\u2328\u232B-\u2767\u2776-\u27C4\u27C7-\u27E5\u27F0-\u2982\u2999-\u29D7\u29DC-\u29FB\u29FE-\u2E21\u2E2A-\u2E41\u2E43-\u2E54\u2E5D-\u2FFF\u3001-\u3007\u3012\u3013\u301C\u3020-\uFD3D\uFD40-\uFE16\uFE19-\uFE34\uFE45\uFE46\uFE49-\uFE58\uFE5F-\uFEFE\uFF00-\uFF07\uFF0A-\uFF3A\uFF3C\uFF3E-\uFF5A\uFF5C\uFF5E\uFF61\uFF64-\u{10FFFF}]+@([\0-\x08\x0E-\x1F\$\+0-9=A-Z\^`-z\|~-\x9F\xA2-\xA6\xA8-\xAA\xAC-\xB5\xB8-\xBA\xBC-\xBE\xC0-\u037D\u037F-\u0386\u0388-\u0559\u0560-\u0588\u058B-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7-\u05F2\u05F5-\u0608\u060B\u060E-\u061A\u061C\u0620-\u0669\u066E-\u06D3\u06D5-\u06FF\u070E-\u07F6\u07FA-\u082F\u083F-\u085D\u085F-\u0963\u0966-\u096F\u0971-\u09FC\u09FE-\u0A75\u0A77-\u0AEF\u0AF1-\u0C76\u0C78-\u0C83\u0C85-\u0DF3\u0DF5-\u0E4E\u0E50-\u0E59\u0E5C-\u0F03\u0F13\u0F15-\u0F39\u0F3E-\u0F84\u0F86-\u0FCF\u0FD5-\u0FD8\u0FDB-\u1049\u1050-\u10FA\u10FC-\u135F\u1369-\u13FF\u1401-\u166D\u166F-\u167F\u1681-\u169A\u169D-\u16EA\u16EE-\u1734\u1737-\u17D3\u17D7\u17DB-\u17FF\u180B-\u1943\u1946-\u1A1D\u1A20-\u1A9F\u1AA7\u1AAE-\u1B4D\u1B50-\u1B59\u1B61-\u1B7C\u1B80-\u1BFB\u1C00-\u1C3A\u1C40-\u1C7D\u1C80-\u1CBF\u1CC8-\u1CD2\u1CD4-\u1FFF\u200B-\u200F\u202A-\u202E\u2044\u2052\u2060-\u207C\u207F-\u208C\u208F-\u2307\u230C-\u2328\u232B-\u2767\u2776-\u27C4\u27C7-\u27E5\u27F0-\u2982\u2999-\u29D7\u29DC-\u29FB\u29FE-\u2CF8\u2CFD\u2D00-\u2D6F\u2D71-\u2DFF\u2E2F\u2E50\u2E51\u2E5E-\u2FFF\u3004-\u3007\u3012\u3013\u3020-\u302F\u3031-\u303C\u303E-\u309F\u30A1-\u30FA\u30FC-\uA4FD\uA500-\uA60C\uA610-\uA672\uA674-\uA67D\uA67F-\uA6F1\uA6F8-\uA873\uA878-\uA8CD\uA8D0-\uA8F7\uA8FB\uA8FD-\uA92D\uA930-\uA95E\uA960-\uA9C0\uA9CE-\uA9DD\uA9E0-\uAA5B\uAA60-\uAADD\uAAE0-\uAAEF\uAAF2-\uABEA\uABEC-\uFD3D\uFD40-\uFE0F\uFE1A-\uFE2F\uFE53\uFE62\uFE64-\uFE67\uFE69\uFE6C-\uFEFE\uFF00\uFF04\uFF0B\uFF10-\uFF19\uFF1C-\uFF1E\uFF21-\uFF3A\uFF3E\uFF40-\uFF5A\uFF5C\uFF5E\uFF66-\u{100FF}\u{10103}-\u{1039E}\u{103A0}-\u{103CF}\u{103D1}-\u{1056E}\u{10570}-\u{10856}\u{10858}-\u{1091E}\u{10920}-\u{1093E}\u{10940}-\u{10A4F}\u{10A59}-\u{10A7E}\u{10A80}-\u{10AEF}\u{10AF7}-\u{10B38}\u{10B40}-\u{10B98}\u{10B9D}-\u{10D6D}\u{10D6F}-\u{10EAC}\u{10EAE}-\u{10F54}\u{10F5A}-\u{10F85}\u{10F8A}-\u{11046}\u{1104E}-\u{110BA}\u{110BD}\u{110C2}-\u{1113F}\u{11144}-\u{11173}\u{11176}-\u{111C4}\u{111C9}-\u{111CC}\u{111CE}-\u{111DA}\u{111DC}\u{111E0}-\u{11237}\u{1123E}-\u{112A8}\u{112AA}-\u{113D3}\u{113D6}\u{113D9}-\u{1144A}\u{11450}-\u{11459}\u{1145C}\u{1145E}-\u{114C5}\u{114C7}-\u{115C0}\u{115D8}-\u{11640}\u{11644}-\u{1165F}\u{1166D}-\u{116B8}\u{116BA}-\u{1173B}\u{1173F}-\u{1183A}\u{1183C}-\u{11943}\u{11947}-\u{119E1}\u{119E3}-\u{11A3E}\u{11A47}-\u{11A99}\u{11A9D}\u{11AA3}-\u{11AFF}\u{11B0A}-\u{11BE0}\u{11BE2}-\u{11C40}\u{11C46}-\u{11C6F}\u{11C72}-\u{11EF6}\u{11EF9}-\u{11F42}\u{11F50}-\u{11FFE}\u{12000}-\u{1246F}\u{12475}-\u{12FF0}\u{12FF3}-\u{16A6D}\u{16A70}-\u{16AF4}\u{16AF6}-\u{16B36}\u{16B3C}-\u{16B43}\u{16B45}-\u{16D6C}\u{16D70}-\u{16E96}\u{16E9B}-\u{16FE1}\u{16FE3}-\u{1BC9E}\u{1BCA0}-\u{1DA86}\u{1DA8C}-\u{1E5FE}\u{1E600}-\u{1E95D}\u{1E960}-\u{10FFFF}]+(?:\.[\0-\x08\x0E-\x1F\$\+0-9=A-Z\^`-z\|~-\x9F\xA2-\xA6\xA8-\xAA\xAC-\xB5\xB8-\xBA\xBC-\xBE\xC0-\u037D\u037F-\u0386\u0388-\u0559\u0560-\u0588\u058B-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7-\u05F2\u05F5-\u0608\u060B\u060E-\u061A\u061C\u0620-\u0669\u066E-\u06D3\u06D5-\u06FF\u070E-\u07F6\u07FA-\u082F\u083F-\u085D\u085F-\u0963\u0966-\u096F\u0971-\u09FC\u09FE-\u0A75\u0A77-\u0AEF\u0AF1-\u0C76\u0C78-\u0C83\u0C85-\u0DF3\u0DF5-\u0E4E\u0E50-\u0E59\u0E5C-\u0F03\u0F13\u0F15-\u0F39\u0F3E-\u0F84\u0F86-\u0FCF\u0FD5-\u0FD8\u0FDB-\u1049\u1050-\u10FA\u10FC-\u135F\u1369-\u13FF\u1401-\u166D\u166F-\u167F\u1681-\u169A\u169D-\u16EA\u16EE-\u1734\u1737-\u17D3\u17D7\u17DB-\u17FF\u180B-\u1943\u1946-\u1A1D\u1A20-\u1A9F\u1AA7\u1AAE-\u1B4D\u1B50-\u1B59\u1B61-\u1B7C\u1B80-\u1BFB\u1C00-\u1C3A\u1C40-\u1C7D\u1C80-\u1CBF\u1CC8-\u1CD2\u1CD4-\u1FFF\u200B-\u200F\u202A-\u202E\u2044\u2052\u2060-\u207C\u207F-\u208C\u208F-\u2307\u230C-\u2328\u232B-\u2767\u2776-\u27C4\u27C7-\u27E5\u27F0-\u2982\u2999-\u29D7\u29DC-\u29FB\u29FE-\u2CF8\u2CFD\u2D00-\u2D6F\u2D71-\u2DFF\u2E2F\u2E50\u2E51\u2E5E-\u2FFF\u3004-\u3007\u3012\u3013\u3020-\u302F\u3031-\u303C\u303E-\u309F\u30A1-\u30FA\u30FC-\uA4FD\uA500-\uA60C\uA610-\uA672\uA674-\uA67D\uA67F-\uA6F1\uA6F8-\uA873\uA878-\uA8CD\uA8D0-\uA8F7\uA8FB\uA8FD-\uA92D\uA930-\uA95E\uA960-\uA9C0\uA9CE-\uA9DD\uA9E0-\uAA5B\uAA60-\uAADD\uAAE0-\uAAEF\uAAF2-\uABEA\uABEC-\uFD3D\uFD40-\uFE0F\uFE1A-\uFE2F\uFE53\uFE62\uFE64-\uFE67\uFE69\uFE6C-\uFEFE\uFF00\uFF04\uFF0B\uFF10-\uFF19\uFF1C-\uFF1E\uFF21-\uFF3A\uFF3E\uFF40-\uFF5A\uFF5C\uFF5E\uFF66-\u{100FF}\u{10103}-\u{1039E}\u{103A0}-\u{103CF}\u{103D1}-\u{1056E}\u{10570}-\u{10856}\u{10858}-\u{1091E}\u{10920}-\u{1093E}\u{10940}-\u{10A4F}\u{10A59}-\u{10A7E}\u{10A80}-\u{10AEF}\u{10AF7}-\u{10B38}\u{10B40}-\u{10B98}\u{10B9D}-\u{10D6D}\u{10D6F}-\u{10EAC}\u{10EAE}-\u{10F54}\u{10F5A}-\u{10F85}\u{10F8A}-\u{11046}\u{1104E}-\u{110BA}\u{110BD}\u{110C2}-\u{1113F}\u{11144}-\u{11173}\u{11176}-\u{111C4}\u{111C9}-\u{111CC}\u{111CE}-\u{111DA}\u{111DC}\u{111E0}-\u{11237}\u{1123E}-\u{112A8}\u{112AA}-\u{113D3}\u{113D6}\u{113D9}-\u{1144A}\u{11450}-\u{11459}\u{1145C}\u{1145E}-\u{114C5}\u{114C7}-\u{115C0}\u{115D8}-\u{11640}\u{11644}-\u{1165F}\u{1166D}-\u{116B8}\u{116BA}-\u{1173B}\u{1173F}-\u{1183A}\u{1183C}-\u{11943}\u{11947}-\u{119E1}\u{119E3}-\u{11A3E}\u{11A47}-\u{11A99}\u{11A9D}\u{11AA3}-\u{11AFF}\u{11B0A}-\u{11BE0}\u{11BE2}-\u{11C40}\u{11C46}-\u{11C6F}\u{11C72}-\u{11EF6}\u{11EF9}-\u{11F42}\u{11F50}-\u{11FFE}\u{12000}-\u{1246F}\u{12475}-\u{12FF0}\u{12FF3}-\u{16A6D}\u{16A70}-\u{16AF4}\u{16AF6}-\u{16B36}\u{16B3C}-\u{16B43}\u{16B45}-\u{16D6C}\u{16D70}-\u{16E96}\u{16E9B}-\u{16FE1}\u{16FE3}-\u{1BC9E}\u{1BCA0}-\u{1DA86}\u{1DA8C}-\u{1E5FE}\u{1E600}-\u{1E95D}\u{1E960}-\u{10FFFF}]+)+)/gmu;
    const [normalizedText, diffs] = normalize(text, {
      ignoreDashEOL: true
    });
    const matches = normalizedText.matchAll(this.#regex);
    const links = [];
    for (const match of matches) {
      const [url, emailDomain] = match;
      let raw;
      if (url.startsWith("www.") || url.startsWith("http://") || url.startsWith("https://")) {
        raw = url;
      } else if (URL.canParse(`http://${emailDomain}`)) {
        raw = url.startsWith("mailto:") ? url : `mailto:${url}`;
      } else {
        continue;
      }
      const absoluteURL = createValidAbsoluteUrl(raw, null, {
        addDefaultProtocol: true
      });
      if (absoluteURL) {
        const [index, length] = getOriginalIndex(diffs, match.index, url.length);
        links.push({
          url: absoluteURL.href,
          index,
          length
        });
      }
    }
    return links;
  }
  static processLinks(pdfPageView) {
    return this.findLinks(pdfPageView._textHighlighter.textContentItemsStr.join("\n")).map(link => createLinkAnnotation(link, pdfPageView, this.#index++));
  }
}
export { Autolinker };