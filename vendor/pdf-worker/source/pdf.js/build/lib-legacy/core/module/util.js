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
import "core-js/modules/es.iterator.for-each.js";
import "core-js/modules/es.iterator.map.js";
export function intersectRects(r1, r2) {
  return !(r2[0] > r1[2] || r2[2] < r1[0] || r2[1] > r1[3] || r2[3] < r1[1]);
}
export function getCenterRect(r) {
  return [r[0] + (r[2] - r[0]) / 2, r[1] + (r[3] - r[1]) / 2, r[0] + (r[2] - r[0]) / 2, r[1] + (r[3] - r[1]) / 2];
}
export function getBoundingRect(chars) {
  return [Math.min(...chars.map(x => x.rect[0])), Math.min(...chars.map(x => x.rect[1])), Math.max(...chars.map(x => x.rect[2])), Math.max(...chars.map(x => x.rect[3]))];
}
export function getClosestDistance(rectA, rectB) {
  const [Ax1, Ay1, Ax2, Ay2] = rectA;
  const [Bx1, By1, Bx2, By2] = rectB;
  let horizontalDistance = 0;
  if (Ax2 < Bx1) {
    horizontalDistance = Bx1 - Ax2;
  } else if (Bx2 < Ax1) {
    horizontalDistance = Ax1 - Bx2;
  }
  let verticalDistance = 0;
  if (Ay2 < By1) {
    verticalDistance = By1 - Ay2;
  } else if (By2 < Ay1) {
    verticalDistance = Ay1 - By2;
  }
  return Math.max(horizontalDistance, verticalDistance);
}
export function basicDeepEqual(x, y) {
  if (x === y) {
    return true;
  } else if (typeof x === 'object' && x != null && typeof y === 'object' && y !== null) {
    if (Object.keys(x).length !== Object.keys(y).length) {
      return false;
    }
    for (let prop in x) {
      if (y.hasOwnProperty(prop)) {
        if (!basicDeepEqual(x[prop], y[prop])) {
          return false;
        }
      } else {
        return false;
      }
    }
    return true;
  }
  return false;
}
export function getSortIndex(pageIndex, offset, top) {
  return [pageIndex.toString().slice(0, 5).padStart(5, '0'), offset.toString().slice(0, 6).padStart(6, '0'), Math.max(Math.floor(top), 0).toString().slice(0, 5).padStart(5, '0')].join('|');
}
export function getRectCenter(rect) {
  const [x1, y1, x2, y2] = rect;
  const centerX = (x1 + x2) / 2;
  const centerY = (y1 + y2) / 2;
  return [centerX, centerY];
}
export function getCharsDistance(a, b) {
  const [ax1, ay1, ax2, ay2] = a.rect;
  const [bx1, by1, bx2, by2] = b.rect;
  let xDistance = 0;
  if (ax2 < bx1) {
    xDistance = bx1 - ax2;
  } else if (bx2 < ax1) {
    xDistance = ax1 - bx2;
  }
  let yDistance = 0;
  if (ay2 < by1) {
    yDistance = by1 - ay2;
  } else if (by2 < ay1) {
    yDistance = ay1 - by2;
  }
  return Math.hypot(xDistance, yDistance);
}
export function getRangeRects(chars, offsetStart, offsetEnd) {
  let rects = [];
  let start = offsetStart;
  for (let i = start; i <= offsetEnd; i++) {
    let char = chars[i];
    if (char.lineBreakAfter || i === offsetEnd) {
      let firstChar = chars[start];
      let lastChar = char;
      let rect = [firstChar.rect[0], firstChar.inlineRect[1], lastChar.rect[2], firstChar.inlineRect[3]];
      rects.push(rect);
      start = i + 1;
    }
  }
  return rects;
}
export function getRectsFromChars(chars) {
  let lineRects = [];
  let currentLineRect = null;
  for (let char of chars) {
    if (!currentLineRect) {
      currentLineRect = char.inlineRect.slice();
    }
    currentLineRect = [Math.min(currentLineRect[0], char.inlineRect[0]), Math.min(currentLineRect[1], char.inlineRect[1]), Math.max(currentLineRect[2], char.inlineRect[2]), Math.max(currentLineRect[3], char.inlineRect[3])];
    if (char.lineBreakAfter) {
      lineRects.push(currentLineRect);
      currentLineRect = null;
    }
  }
  if (currentLineRect) {
    lineRects.push(currentLineRect);
  }
  return lineRects;
}
export function getPositionFromRects(chars, pageIndex) {
  let chars1 = [];
  let chars2 = [];
  for (let char of chars) {
    if (char.pageIndex === pageIndex) {
      chars1.push(char);
    } else {
      chars2.push(char);
    }
  }
  let position = {
    pageIndex,
    rects: getRectsFromChars(chars1)
  };
  if (chars2.length) {
    position.nextPageRects = getRectsFromChars(chars2);
  }
  return position;
}
export function printOutline(items, level = 0) {
  let result = '';
  items.forEach(item => {
    let indentation = '  '.repeat(level);
    result += `${indentation}${item.title}\n`;
    if (item.items && item.items.length > 0) {
      result += printOutline(item.items, level + 1);
    }
  });
  if (level === 0) {
    console.log(result);
  } else {
    return result;
  }
}
export function getClusters(objects, property, eps) {
  if (!objects.length) {
    return [];
  }
  objects = objects.slice();
  objects.sort((a, b) => a[property] - b[property]);
  let clusters = [];
  let currentCluster = [objects[0]];
  for (let i = 1; i < objects.length; i++) {
    const object = objects[i];
    let min = Math.min(object[property], currentCluster[currentCluster.length - 1][property]);
    let max = Math.max(object[property], currentCluster[currentCluster.length - 1][property]);
    const distance = max - min;
    if (distance <= eps) {
      currentCluster.push(object);
    } else {
      clusters.push(currentCluster);
      currentCluster = [object];
    }
  }
  clusters.push(currentCluster);
  return clusters;
}
export function overlaysIntersect(overlay1, overlay2) {
  if (overlay1.position.pageIndex === overlay2.position.pageIndex) {
    for (let r1 of overlay1.position.rects) {
      for (let r2 of overlay2.position.rects) {
        if (intersectRects(r1, r2)) {
          return true;
        }
      }
    }
  }
  return false;
}
export async function getPositionFromDestination(pdfDocument, dest) {
  if (!pdfDocument || !dest || !dest.length) {
    return;
  }
  let destArray;
  if (typeof dest === 'string') {
    try {
      destArray = await pdfDocument.pdfManager.ensureCatalog("getDestination", [dest]);
      if (!destArray) {
        return;
      }
    } catch (e) {
      console.log(e);
      return;
    }
  } else {
    destArray = dest;
  }
  const ref = destArray[0];
  let pageIndex;
  if (ref && typeof ref === "object") {
    try {
      pageIndex = await pdfDocument.pdfManager.ensureCatalog("getPageIndex", [ref]);
    } catch (e) {
      console.log(`Error getting page index from destination "${dest}"`);
      console.error(e);
      return;
    }
  } else if (Number.isInteger(ref)) {
    pageIndex = ref;
    if (pageIndex < 0 || pageIndex > pdfDocument.pagesCount - 1) {
      console.error(`"${pageIndex}" is not a valid page number, for destination "${dest}"`);
      return;
    }
  } else {
    console.error(`Invalid destination "${dest}"`);
    return;
  }
  let {
    rotate,
    view
  } = await pdfDocument.getPage(pageIndex);
  let width = view[2] - view[0];
  let height = view[3] - view[1];
  const changeOrientation = rotate % 180 !== 0;
  const pageHeight = changeOrientation ? width : height;
  let x, y;
  switch (destArray[1].name) {
    case "XYZ":
      x = destArray[2] !== null ? destArray[2] : 0;
      y = destArray[3] !== null ? destArray[3] : pageHeight;
      break;
    case "Fit":
    case "FitB":
      x = 0;
      y = pageHeight;
      break;
    case "FitH":
    case "FitBH":
      y = destArray[2] !== null ? destArray[2] : pageHeight;
      x = 0;
      break;
    case "FitV":
    case "FitBV":
      x = destArray[2] !== null ? destArray[2] : 0;
      y = pageHeight;
      break;
    case "FitR":
      x = destArray[2] !== null ? destArray[2] : 0;
      y = destArray[5] !== null ? destArray[5] : pageHeight;
      break;
    default:
      return;
  }
  x = Math.max(view[0], x);
  x = Math.min(view[2], x);
  y = Math.max(view[1], y);
  y = Math.min(view[3], y);
  return {
    pageIndex,
    rects: [[x, y, x, y]]
  };
}