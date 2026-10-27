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
import { getVisibleElements, isValidRotation, RenderingStates, scrollIntoView, watchScroll } from "./ui_utils.js";
import { PDFThumbnailView, TempImageFactory } from "./pdf_thumbnail_view.js";
const THUMBNAIL_SCROLL_MARGIN = -19;
const THUMBNAIL_SELECTED_CLASS = "selected";
class PDFThumbnailViewer {
  constructor({
    container,
    eventBus,
    linkService,
    renderingQueue,
    maxCanvasPixels,
    maxCanvasDim,
    pageColors,
    abortSignal,
    enableHWA
  }) {
    this.container = container;
    this.eventBus = eventBus;
    this.linkService = linkService;
    this.renderingQueue = renderingQueue;
    this.maxCanvasPixels = maxCanvasPixels;
    this.maxCanvasDim = maxCanvasDim;
    this.pageColors = pageColors || null;
    this.enableHWA = enableHWA || false;
    this.scroll = watchScroll(this.container, this.#scrollUpdated.bind(this), abortSignal);
    this.#resetView();
  }
  #scrollUpdated() {
    this.renderingQueue.renderHighestPriority();
  }
  getThumbnail(index) {
    return this._thumbnails[index];
  }
  #getVisibleThumbs() {
    return getVisibleElements({
      scrollEl: this.container,
      views: this._thumbnails
    });
  }
  scrollThumbnailIntoView(pageNumber) {
    if (!this.pdfDocument) {
      return;
    }
    const thumbnailView = this._thumbnails[pageNumber - 1];
    if (!thumbnailView) {
      console.error('scrollThumbnailIntoView: Invalid "pageNumber" parameter.');
      return;
    }
    if (pageNumber !== this._currentPageNumber) {
      const prevThumbnailView = this._thumbnails[this._currentPageNumber - 1];
      prevThumbnailView.div.classList.remove(THUMBNAIL_SELECTED_CLASS);
      thumbnailView.div.classList.add(THUMBNAIL_SELECTED_CLASS);
    }
    const {
      first,
      last,
      views
    } = this.#getVisibleThumbs();
    if (views.length > 0) {
      let shouldScroll = false;
      if (pageNumber <= first.id || pageNumber >= last.id) {
        shouldScroll = true;
      } else {
        for (const {
          id,
          percent
        } of views) {
          if (id !== pageNumber) {
            continue;
          }
          shouldScroll = percent < 100;
          break;
        }
      }
      if (shouldScroll) {
        scrollIntoView(thumbnailView.div, {
          top: THUMBNAIL_SCROLL_MARGIN
        });
      }
    }
    this._currentPageNumber = pageNumber;
  }
  get pagesRotation() {
    return this._pagesRotation;
  }
  set pagesRotation(rotation) {
    if (!isValidRotation(rotation)) {
      throw new Error("Invalid thumbnails rotation angle.");
    }
    if (!this.pdfDocument) {
      return;
    }
    if (this._pagesRotation === rotation) {
      return;
    }
    this._pagesRotation = rotation;
    const updateArgs = {
      rotation
    };
    for (const thumbnail of this._thumbnails) {
      thumbnail.update(updateArgs);
    }
  }
  cleanup() {
    for (const thumbnail of this._thumbnails) {
      if (thumbnail.renderingState !== RenderingStates.FINISHED) {
        thumbnail.reset();
      }
    }
    TempImageFactory.destroyCanvas();
  }
  #resetView() {
    this._thumbnails = [];
    this._currentPageNumber = 1;
    this._pageLabels = null;
    this._pagesRotation = 0;
    this.container.textContent = "";
  }
  setDocument(pdfDocument) {
    if (this.pdfDocument) {
      this.#cancelRendering();
      this.#resetView();
    }
    this.pdfDocument = pdfDocument;
    if (!pdfDocument) {
      return;
    }
    const firstPagePromise = pdfDocument.getPage(1);
    const optionalContentConfigPromise = pdfDocument.getOptionalContentConfig({
      intent: "display"
    });
    firstPagePromise.then(firstPdfPage => {
      const pagesCount = pdfDocument.numPages;
      const viewport = firstPdfPage.getViewport({
        scale: 1
      });
      for (let pageNum = 1; pageNum <= pagesCount; ++pageNum) {
        const thumbnail = new PDFThumbnailView({
          container: this.container,
          eventBus: this.eventBus,
          id: pageNum,
          defaultViewport: viewport.clone(),
          optionalContentConfigPromise,
          linkService: this.linkService,
          renderingQueue: this.renderingQueue,
          maxCanvasPixels: this.maxCanvasPixels,
          maxCanvasDim: this.maxCanvasDim,
          pageColors: this.pageColors,
          enableHWA: this.enableHWA
        });
        this._thumbnails.push(thumbnail);
      }
      this._thumbnails[0]?.setPdfPage(firstPdfPage);
      const thumbnailView = this._thumbnails[this._currentPageNumber - 1];
      thumbnailView.div.classList.add(THUMBNAIL_SELECTED_CLASS);
    }).catch(reason => {
      console.error("Unable to initialize thumbnail viewer", reason);
    });
  }
  #cancelRendering() {
    for (const thumbnail of this._thumbnails) {
      thumbnail.cancelRendering();
    }
  }
  setPageLabels(labels) {
    if (!this.pdfDocument) {
      return;
    }
    if (!labels) {
      this._pageLabels = null;
    } else if (!(Array.isArray(labels) && this.pdfDocument.numPages === labels.length)) {
      this._pageLabels = null;
      console.error("PDFThumbnailViewer_setPageLabels: Invalid page labels.");
    } else {
      this._pageLabels = labels;
    }
    for (let i = 0, ii = this._thumbnails.length; i < ii; i++) {
      this._thumbnails[i].setPageLabel(this._pageLabels?.[i] ?? null);
    }
  }
  async #ensurePdfPageLoaded(thumbView) {
    if (thumbView.pdfPage) {
      return thumbView.pdfPage;
    }
    try {
      const pdfPage = await this.pdfDocument.getPage(thumbView.id);
      if (!thumbView.pdfPage) {
        thumbView.setPdfPage(pdfPage);
      }
      return pdfPage;
    } catch (reason) {
      console.error("Unable to get page for thumb view", reason);
      return null;
    }
  }
  #getScrollAhead(visible) {
    if (visible.first?.id === 1) {
      return true;
    } else if (visible.last?.id === this._thumbnails.length) {
      return false;
    }
    return this.scroll.down;
  }
  forceRendering() {
    const visibleThumbs = this.#getVisibleThumbs();
    const scrollAhead = this.#getScrollAhead(visibleThumbs);
    const thumbView = this.renderingQueue.getHighestPriority(visibleThumbs, this._thumbnails, scrollAhead, false, true);
    if (thumbView) {
      this.#ensurePdfPageLoaded(thumbView).then(() => {
        this.renderingQueue.renderView(thumbView);
      });
      return true;
    }
    return false;
  }
}
export { PDFThumbnailViewer };