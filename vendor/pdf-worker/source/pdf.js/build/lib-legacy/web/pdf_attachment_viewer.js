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
import { BaseTreeViewer } from "./base_tree_viewer.js";
import { waitOnEventOrTimeout } from "./event_utils.js";
class PDFAttachmentViewer extends BaseTreeViewer {
  constructor(options) {
    super(options);
    this.downloadManager = options.downloadManager;
    this.eventBus._on("fileattachmentannotation", this.#appendAttachment.bind(this));
  }
  reset(keepRenderedCapability = false) {
    super.reset();
    this._attachments = null;
    if (!keepRenderedCapability) {
      this._renderedCapability = Promise.withResolvers();
    }
    this._pendingDispatchEvent = false;
  }
  async _dispatchEvent(attachmentsCount) {
    this._renderedCapability.resolve();
    if (attachmentsCount === 0 && !this._pendingDispatchEvent) {
      this._pendingDispatchEvent = true;
      await waitOnEventOrTimeout({
        target: this.eventBus,
        name: "annotationlayerrendered",
        delay: 1000
      });
      if (!this._pendingDispatchEvent) {
        return;
      }
    }
    this._pendingDispatchEvent = false;
    this.eventBus.dispatch("attachmentsloaded", {
      source: this,
      attachmentsCount
    });
  }
  _bindLink(element, {
    content,
    description,
    filename
  }) {
    if (description) {
      element.title = description;
    }
    element.onclick = () => {
      this.downloadManager.openOrDownloadData(content, filename);
      return false;
    };
  }
  render({
    attachments,
    keepRenderedCapability = false
  }) {
    if (this._attachments) {
      this.reset(keepRenderedCapability);
    }
    this._attachments = attachments || null;
    if (!attachments) {
      this._dispatchEvent(0);
      return;
    }
    const fragment = document.createDocumentFragment();
    let attachmentsCount = 0;
    for (const name in attachments) {
      const item = attachments[name];
      const div = document.createElement("div");
      div.className = "treeItem";
      const element = document.createElement("a");
      this._bindLink(element, item);
      element.textContent = this._normalizeTextContent(item.filename);
      div.append(element);
      fragment.append(div);
      attachmentsCount++;
    }
    this._finishRendering(fragment, attachmentsCount);
  }
  #appendAttachment(item) {
    const renderedPromise = this._renderedCapability.promise;
    renderedPromise.then(() => {
      if (renderedPromise !== this._renderedCapability.promise) {
        return;
      }
      const attachments = this._attachments || Object.create(null);
      for (const name in attachments) {
        if (item.filename === name) {
          return;
        }
      }
      attachments[item.filename] = item;
      this.render({
        attachments,
        keepRenderedCapability: true
      });
    });
  }
}
export { PDFAttachmentViewer };