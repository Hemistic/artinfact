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
import { FeatureTest, shadow, warn } from "../shared/util.js";
import { DecodeStream } from "./decode_stream.js";
import { Dict } from "./primitives.js";
import { JpegImage } from "./jpg.js";
class JpegStream extends DecodeStream {
  static #isImageDecoderSupported = FeatureTest.isImageDecoderSupported;
  constructor(stream, maybeLength, params) {
    super(maybeLength);
    this.stream = stream;
    this.dict = stream.dict;
    this.maybeLength = maybeLength;
    this.params = params;
  }
  static get canUseImageDecoder() {
    return shadow(this, "canUseImageDecoder", this.#isImageDecoderSupported ? ImageDecoder.isTypeSupported("image/jpeg") : Promise.resolve(false));
  }
  static setOptions({
    isImageDecoderSupported = false
  }) {
    this.#isImageDecoderSupported = isImageDecoderSupported;
  }
  get bytes() {
    return shadow(this, "bytes", this.stream.getBytes(this.maybeLength));
  }
  ensureBuffer(requested) {}
  readBlock() {
    this.decodeImage();
  }
  get jpegOptions() {
    const jpegOptions = {
      decodeTransform: undefined,
      colorTransform: undefined
    };
    const decodeArr = this.dict.getArray("D", "Decode");
    if ((this.forceRGBA || this.forceRGB) && Array.isArray(decodeArr)) {
      const bitsPerComponent = this.dict.get("BPC", "BitsPerComponent") || 8;
      const decodeArrLength = decodeArr.length;
      const transform = new Int32Array(decodeArrLength);
      let transformNeeded = false;
      const maxValue = (1 << bitsPerComponent) - 1;
      for (let i = 0; i < decodeArrLength; i += 2) {
        transform[i] = (decodeArr[i + 1] - decodeArr[i]) * 256 | 0;
        transform[i + 1] = decodeArr[i] * maxValue | 0;
        if (transform[i] !== 256 || transform[i + 1] !== 0) {
          transformNeeded = true;
        }
      }
      if (transformNeeded) {
        jpegOptions.decodeTransform = transform;
      }
    }
    if (this.params instanceof Dict) {
      const colorTransform = this.params.get("ColorTransform");
      if (Number.isInteger(colorTransform)) {
        jpegOptions.colorTransform = colorTransform;
      }
    }
    return shadow(this, "jpegOptions", jpegOptions);
  }
  #skipUselessBytes(data) {
    for (let i = 0, ii = data.length - 1; i < ii; i++) {
      if (data[i] === 0xff && data[i + 1] === 0xd8) {
        if (i > 0) {
          data = data.subarray(i);
        }
        break;
      }
    }
    return data;
  }
  decodeImage(bytes) {
    if (this.eof) {
      return this.buffer;
    }
    bytes = this.#skipUselessBytes(bytes || this.bytes);
    const jpegImage = new JpegImage(this.jpegOptions);
    jpegImage.parse(bytes);
    const data = jpegImage.getData({
      width: this.drawWidth,
      height: this.drawHeight,
      forceRGBA: this.forceRGBA,
      forceRGB: this.forceRGB,
      isSourcePDF: true
    });
    this.buffer = data;
    this.bufferLength = data.length;
    this.eof = true;
    return this.buffer;
  }
  get canAsyncDecodeImageFromBuffer() {
    return this.stream.isAsync;
  }
  async getTransferableImage() {
    if (!(await JpegStream.canUseImageDecoder)) {
      return null;
    }
    const jpegOptions = this.jpegOptions;
    if (jpegOptions.decodeTransform) {
      return null;
    }
    let decoder;
    try {
      const bytes = this.canAsyncDecodeImageFromBuffer && (await this.stream.asyncGetBytes()) || this.bytes;
      if (!bytes) {
        return null;
      }
      let data = this.#skipUselessBytes(bytes);
      const useImageDecoder = JpegImage.canUseImageDecoder(data, jpegOptions.colorTransform);
      if (!useImageDecoder) {
        return null;
      }
      if (useImageDecoder.exifStart) {
        data = data.slice();
        data.fill(0x00, useImageDecoder.exifStart, useImageDecoder.exifEnd);
      }
      decoder = new ImageDecoder({
        data,
        type: "image/jpeg",
        preferAnimation: false
      });
      return (await decoder.decode()).image;
    } catch (reason) {
      warn(`getTransferableImage - failed: "${reason}".`);
      return null;
    } finally {
      decoder?.close();
    }
  }
}
export { JpegStream };