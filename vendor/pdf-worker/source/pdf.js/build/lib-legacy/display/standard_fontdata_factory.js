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
import "core-js/modules/es.array-buffer.detached.js";
import "core-js/modules/es.array-buffer.transfer.js";
import "core-js/modules/es.array-buffer.transfer-to-fixed-length.js";
import "core-js/modules/es.typed-array.with.js";
import "core-js/modules/esnext.uint8-array.set-from-base64.js";
import "core-js/modules/esnext.uint8-array.set-from-hex.js";
import "core-js/modules/esnext.uint8-array.to-base64.js";
import "core-js/modules/esnext.uint8-array.to-hex.js";
import { fetchData } from "./display_utils.js";
import { unreachable } from "../shared/util.js";
class BaseStandardFontDataFactory {
  constructor({
    baseUrl = null
  }) {
    this.baseUrl = baseUrl;
  }
  async fetch({
    filename
  }) {
    if (!this.baseUrl) {
      throw new Error("Ensure that the `standardFontDataUrl` API parameter is provided.");
    }
    if (!filename) {
      throw new Error("Font filename must be specified.");
    }
    const url = `${this.baseUrl}${filename}`;
    return this._fetch(url).catch(reason => {
      throw new Error(`Unable to load font data at: ${url}`);
    });
  }
  async _fetch(url) {
    unreachable("Abstract method `_fetch` called.");
  }
}
class DOMStandardFontDataFactory extends BaseStandardFontDataFactory {
  async _fetch(url) {
    const data = await fetchData(url, "arraybuffer");
    return new Uint8Array(data);
  }
}
export { BaseStandardFontDataFactory, DOMStandardFontDataFactory };