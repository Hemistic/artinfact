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
import "core-js/modules/es.promise.with-resolvers.js";
import { getPageSizeInches, isPortraitOrientation } from "./ui_utils.js";
import { PDFDateString } from "../pdf.js";
const NON_METRIC_LOCALES = ["en-us", "en-lr", "my"];
const US_PAGE_NAMES = {
  "8.5x11": "pdfjs-document-properties-page-size-name-letter",
  "8.5x14": "pdfjs-document-properties-page-size-name-legal"
};
const METRIC_PAGE_NAMES = {
  "297x420": "pdfjs-document-properties-page-size-name-a-three",
  "210x297": "pdfjs-document-properties-page-size-name-a-four"
};
function getPageName(size, isPortrait, pageNames) {
  const width = isPortrait ? size.width : size.height;
  const height = isPortrait ? size.height : size.width;
  return pageNames[`${width}x${height}`];
}
class PDFDocumentProperties {
  #fieldData = null;
  constructor({
    dialog,
    fields,
    closeButton
  }, overlayManager, eventBus, l10n, fileNameLookup, titleLookup) {
    this.dialog = dialog;
    this.fields = fields;
    this.overlayManager = overlayManager;
    this.l10n = l10n;
    this._fileNameLookup = fileNameLookup;
    this._titleLookup = titleLookup;
    this.#reset();
    closeButton.addEventListener("click", this.close.bind(this));
    this.overlayManager.register(this.dialog);
    eventBus._on("pagechanging", evt => {
      this._currentPageNumber = evt.pageNumber;
    });
    eventBus._on("rotationchanging", evt => {
      this._pagesRotation = evt.pagesRotation;
    });
  }
  async open() {
    await Promise.all([this.overlayManager.open(this.dialog), this._dataAvailableCapability.promise]);
    const currentPageNumber = this._currentPageNumber;
    const pagesRotation = this._pagesRotation;
    if (this.#fieldData && currentPageNumber === this.#fieldData._currentPageNumber && pagesRotation === this.#fieldData._pagesRotation) {
      this.#updateUI();
      return;
    }
    const [{
      info,
      metadata,
      contentLength
    }, pdfPage] = await Promise.all([this.pdfDocument.getMetadata(), this.pdfDocument.getPage(currentPageNumber)]);
    const [fileName, fileSize, title, creationDate, modificationDate, pageSize, isLinearized] = await Promise.all([this._fileNameLookup(), this.#parseFileSize(contentLength), this._titleLookup(), this.#parseDate(metadata?.get("xmp:createdate"), info.CreationDate), this.#parseDate(metadata?.get("xmp:modifydate"), info.ModDate), this.#parsePageSize(getPageSizeInches(pdfPage), pagesRotation), this.#parseLinearization(info.IsLinearized)]);
    this.#fieldData = Object.freeze({
      fileName,
      fileSize,
      title,
      author: metadata?.get("dc:creator")?.join("\n") || info.Author,
      subject: metadata?.get("dc:subject")?.join("\n") || info.Subject,
      keywords: metadata?.get("pdf:keywords") || info.Keywords,
      creationDate,
      modificationDate,
      creator: metadata?.get("xmp:creatortool") || info.Creator,
      producer: metadata?.get("pdf:producer") || info.Producer,
      version: info.PDFFormatVersion,
      pageCount: this.pdfDocument.numPages,
      pageSize,
      linearized: isLinearized,
      _currentPageNumber: currentPageNumber,
      _pagesRotation: pagesRotation
    });
    this.#updateUI();
    const {
      length
    } = await this.pdfDocument.getDownloadInfo();
    if (contentLength === length) {
      return;
    }
    const data = Object.assign(Object.create(null), this.#fieldData);
    data.fileSize = await this.#parseFileSize(length);
    this.#fieldData = Object.freeze(data);
    this.#updateUI();
  }
  async close() {
    this.overlayManager.close(this.dialog);
  }
  setDocument(pdfDocument) {
    if (this.pdfDocument) {
      this.#reset();
      this.#updateUI();
    }
    if (!pdfDocument) {
      return;
    }
    this.pdfDocument = pdfDocument;
    this._dataAvailableCapability.resolve();
  }
  #reset() {
    this.pdfDocument = null;
    this.#fieldData = null;
    this._dataAvailableCapability = Promise.withResolvers();
    this._currentPageNumber = 1;
    this._pagesRotation = 0;
  }
  #updateUI() {
    if (this.#fieldData && this.overlayManager.active !== this.dialog) {
      return;
    }
    for (const id in this.fields) {
      const content = this.#fieldData?.[id];
      this.fields[id].textContent = content || content === 0 ? content : "-";
    }
  }
  async #parseFileSize(b = 0) {
    const kb = b / 1024,
      mb = kb / 1024;
    return kb ? this.l10n.get(mb >= 1 ? "pdfjs-document-properties-size-mb" : "pdfjs-document-properties-size-kb", {
      mb,
      kb,
      b
    }) : undefined;
  }
  async #parsePageSize(pageSizeInches, pagesRotation) {
    if (!pageSizeInches) {
      return undefined;
    }
    if (pagesRotation % 180 !== 0) {
      pageSizeInches = {
        width: pageSizeInches.height,
        height: pageSizeInches.width
      };
    }
    const isPortrait = isPortraitOrientation(pageSizeInches),
      nonMetric = NON_METRIC_LOCALES.includes(this.l10n.getLanguage());
    let sizeInches = {
      width: Math.round(pageSizeInches.width * 100) / 100,
      height: Math.round(pageSizeInches.height * 100) / 100
    };
    let sizeMillimeters = {
      width: Math.round(pageSizeInches.width * 25.4 * 10) / 10,
      height: Math.round(pageSizeInches.height * 25.4 * 10) / 10
    };
    let nameId = getPageName(sizeInches, isPortrait, US_PAGE_NAMES) || getPageName(sizeMillimeters, isPortrait, METRIC_PAGE_NAMES);
    if (!nameId && !(Number.isInteger(sizeMillimeters.width) && Number.isInteger(sizeMillimeters.height))) {
      const exactMillimeters = {
        width: pageSizeInches.width * 25.4,
        height: pageSizeInches.height * 25.4
      };
      const intMillimeters = {
        width: Math.round(sizeMillimeters.width),
        height: Math.round(sizeMillimeters.height)
      };
      if (Math.abs(exactMillimeters.width - intMillimeters.width) < 0.1 && Math.abs(exactMillimeters.height - intMillimeters.height) < 0.1) {
        nameId = getPageName(intMillimeters, isPortrait, METRIC_PAGE_NAMES);
        if (nameId) {
          sizeInches = {
            width: Math.round(intMillimeters.width / 25.4 * 100) / 100,
            height: Math.round(intMillimeters.height / 25.4 * 100) / 100
          };
          sizeMillimeters = intMillimeters;
        }
      }
    }
    const [{
      width,
      height
    }, unit, name, orientation] = await Promise.all([nonMetric ? sizeInches : sizeMillimeters, this.l10n.get(nonMetric ? "pdfjs-document-properties-page-size-unit-inches" : "pdfjs-document-properties-page-size-unit-millimeters"), nameId && this.l10n.get(nameId), this.l10n.get(isPortrait ? "pdfjs-document-properties-page-size-orientation-portrait" : "pdfjs-document-properties-page-size-orientation-landscape")]);
    return this.l10n.get(name ? "pdfjs-document-properties-page-size-dimension-name-string" : "pdfjs-document-properties-page-size-dimension-string", {
      width,
      height,
      unit,
      name,
      orientation
    });
  }
  async #parseDate(metadataDate, infoDate) {
    const dateObj = Date.parse(metadataDate) || PDFDateString.toDateObject(infoDate);
    return dateObj ? this.l10n.get("pdfjs-document-properties-date-time-string", {
      dateObj: dateObj.valueOf()
    }) : undefined;
  }
  #parseLinearization(isLinearized) {
    return this.l10n.get(isLinearized ? "pdfjs-document-properties-linearized-yes" : "pdfjs-document-properties-linearized-no");
  }
}
export { PDFDocumentProperties };