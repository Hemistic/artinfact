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
import { isNodeJS, warn } from "../shared/util.js";
import { BaseCanvasFactory } from "./canvas_factory.js";
import { BaseCMapReaderFactory } from "./cmap_reader_factory.js";
import { BaseFilterFactory } from "./filter_factory.js";
import { BaseStandardFontDataFactory } from "./standard_fontdata_factory.js";
import { BaseWasmFactory } from "./wasm_factory.js";
if (isNodeJS) {
  let canvas;
  try {
    const require = process.getBuiltinModule("module").createRequire(import.meta.url);
    try {
      canvas = require("@napi-rs/canvas");
    } catch (ex) {
      warn(`Cannot load "@napi-rs/canvas" package: "${ex}".`);
    }
  } catch (ex) {
    warn(`Cannot access the \`require\` function: "${ex}".`);
  }
  if (!globalThis.DOMMatrix) {
    if (canvas?.DOMMatrix) {
      globalThis.DOMMatrix = canvas.DOMMatrix;
    } else {
      warn("Cannot polyfill `DOMMatrix`, rendering may be broken.");
    }
  }
  if (!globalThis.ImageData) {
    if (canvas?.ImageData) {
      globalThis.ImageData = canvas.ImageData;
    } else {
      warn("Cannot polyfill `ImageData`, rendering may be broken.");
    }
  }
  if (!globalThis.Path2D) {
    if (canvas?.Path2D) {
      globalThis.Path2D = canvas.Path2D;
    } else {
      warn("Cannot polyfill `Path2D`, rendering may be broken.");
    }
  }
  if (!globalThis.navigator?.language) {
    globalThis.navigator = {
      language: "en-US",
      platform: "",
      userAgent: ""
    };
  }
}
async function fetchData(url) {
  const fs = process.getBuiltinModule("fs");
  const data = await fs.promises.readFile(url);
  return new Uint8Array(data);
}
class NodeFilterFactory extends BaseFilterFactory {}
class NodeCanvasFactory extends BaseCanvasFactory {
  _createCanvas(width, height) {
    const require = process.getBuiltinModule("module").createRequire(import.meta.url);
    const canvas = require("@napi-rs/canvas");
    return canvas.createCanvas(width, height);
  }
}
class NodeCMapReaderFactory extends BaseCMapReaderFactory {
  async _fetch(url) {
    return fetchData(url);
  }
}
class NodeStandardFontDataFactory extends BaseStandardFontDataFactory {
  async _fetch(url) {
    return fetchData(url);
  }
}
class NodeWasmFactory extends BaseWasmFactory {
  async _fetch(url) {
    return fetchData(url);
  }
}
export { fetchData, NodeCanvasFactory, NodeCMapReaderFactory, NodeFilterFactory, NodeStandardFontDataFactory, NodeWasmFactory };