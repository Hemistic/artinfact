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
import { BaseStream } from "./base_stream.js";
import { DecodeStream } from "./decode_stream.js";
import { Dict } from "./primitives.js";
import { Jbig2Image } from "./jbig2.js";
import { shadow } from "../shared/util.js";
class Jbig2Stream extends DecodeStream {
  constructor(stream, maybeLength, params) {
    super(maybeLength);
    this.stream = stream;
    this.dict = stream.dict;
    this.maybeLength = maybeLength;
    this.params = params;
  }
  get bytes() {
    return shadow(this, "bytes", this.stream.getBytes(this.maybeLength));
  }
  ensureBuffer(requested) {}
  readBlock() {
    this.decodeImage();
  }
  decodeImage(bytes) {
    if (this.eof) {
      return this.buffer;
    }
    bytes ||= this.bytes;
    const jbig2Image = new Jbig2Image();
    const chunks = [];
    if (this.params instanceof Dict) {
      const globalsStream = this.params.get("JBIG2Globals");
      if (globalsStream instanceof BaseStream) {
        const globals = globalsStream.getBytes();
        chunks.push({
          data: globals,
          start: 0,
          end: globals.length
        });
      }
    }
    chunks.push({
      data: bytes,
      start: 0,
      end: bytes.length
    });
    const data = jbig2Image.parseChunks(chunks);
    const dataLength = data.length;
    for (let i = 0; i < dataLength; i++) {
      data[i] ^= 0xff;
    }
    this.buffer = data;
    this.bufferLength = dataLength;
    this.eof = true;
    return this.buffer;
  }
  get canAsyncDecodeImageFromBuffer() {
    return this.stream.isAsync;
  }
}
export { Jbig2Stream };