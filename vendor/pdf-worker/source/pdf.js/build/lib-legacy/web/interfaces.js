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
class IPDFLinkService {
  get pagesCount() {}
  get page() {}
  set page(value) {}
  get rotation() {}
  set rotation(value) {}
  get isInPresentationMode() {}
  get externalLinkEnabled() {}
  set externalLinkEnabled(value) {}
  async goToDestination(dest) {}
  goToPage(val) {}
  addLinkAttributes(link, url, newWindow = false) {}
  getDestinationHash(dest) {}
  getAnchorUrl(hash) {}
  setHash(hash) {}
  executeNamedAction(action) {}
  executeSetOCGState(action) {}
}
class IRenderableView {
  constructor() {
    this.resume = null;
  }
  get renderingId() {}
  get renderingState() {}
  async draw() {}
}
class IDownloadManager {
  downloadData(data, filename, contentType) {}
  openOrDownloadData(data, filename, dest = null) {}
  download(data, url, filename) {}
}
class IL10n {
  getLanguage() {}
  getDirection() {}
  async get(ids, args = null, fallback) {}
  async translate(element) {}
  pause() {}
  resume() {}
}
class IPDFPrintServiceFactory {
  static initGlobals() {}
  static get supportsPrinting() {
    return false;
  }
  static createPrintService() {
    throw new Error("Not implemented: createPrintService");
  }
}
export { IDownloadManager, IL10n, IPDFLinkService, IPDFPrintServiceFactory, IRenderableView };