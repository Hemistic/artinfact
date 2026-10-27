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
import { getPositionFromDestination, getSortIndex } from './util.js';
export async function getExistingOutline(pdfDocument, structuredCharsProvider) {
  let outline = [];
  let items = await pdfDocument.pdfManager.ensureCatalog("documentOutline");
  async function transformItems(items) {
    let newItems = [];
    for (let item of items) {
      let newItem = {
        title: item.title,
        items: await transformItems(item.items)
      };
      if (item.dest) {
        let position = await getPositionFromDestination(pdfDocument, item.dest);
        if (position) {
          newItem.location = {
            position
          };
        }
      } else if (item.unsafeUrl) {
        newItem.url = item.unsafeUrl;
      }
      newItems.push(newItem);
    }
    return newItems;
  }
  if (items) {
    outline = await transformItems(items);
    if (outline.length === 1 && outline[0].items.length > 1) {
      outline = outline[0].items;
    }
  }
  return outline;
}