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
import { removeNullCharacters } from "./ui_utils.js";
const TREEITEM_OFFSET_TOP = -100;
const TREEITEM_SELECTED_CLASS = "selected";
class BaseTreeViewer {
  constructor(options) {
    this.container = options.container;
    this.eventBus = options.eventBus;
    this._l10n = options.l10n;
    this.reset();
  }
  reset() {
    this._pdfDocument = null;
    this._lastToggleIsShow = true;
    this._currentTreeItem = null;
    this.container.textContent = "";
    this.container.classList.remove("treeWithDeepNesting");
  }
  _dispatchEvent(count) {
    throw new Error("Not implemented: _dispatchEvent");
  }
  _bindLink(element, params) {
    throw new Error("Not implemented: _bindLink");
  }
  _normalizeTextContent(str) {
    return removeNullCharacters(str, true) || "\u2013";
  }
  _addToggleButton(div, hidden = false) {
    const toggler = document.createElement("div");
    toggler.className = "treeItemToggler";
    if (hidden) {
      toggler.classList.add("treeItemsHidden");
    }
    toggler.onclick = evt => {
      evt.stopPropagation();
      toggler.classList.toggle("treeItemsHidden");
      if (evt.shiftKey) {
        const shouldShowAll = !toggler.classList.contains("treeItemsHidden");
        this._toggleTreeItem(div, shouldShowAll);
      }
    };
    div.prepend(toggler);
  }
  _toggleTreeItem(root, show = false) {
    this._l10n.pause();
    this._lastToggleIsShow = show;
    for (const toggler of root.querySelectorAll(".treeItemToggler")) {
      toggler.classList.toggle("treeItemsHidden", !show);
    }
    this._l10n.resume();
  }
  _toggleAllTreeItems() {
    this._toggleTreeItem(this.container, !this._lastToggleIsShow);
  }
  _finishRendering(fragment, count, hasAnyNesting = false) {
    if (hasAnyNesting) {
      this.container.classList.add("treeWithDeepNesting");
      this._lastToggleIsShow = !fragment.querySelector(".treeItemsHidden");
    }
    this._l10n.pause();
    this.container.append(fragment);
    this._l10n.resume();
    this._dispatchEvent(count);
  }
  render(params) {
    throw new Error("Not implemented: render");
  }
  _updateCurrentTreeItem(treeItem = null) {
    if (this._currentTreeItem) {
      this._currentTreeItem.classList.remove(TREEITEM_SELECTED_CLASS);
      this._currentTreeItem = null;
    }
    if (treeItem) {
      treeItem.classList.add(TREEITEM_SELECTED_CLASS);
      this._currentTreeItem = treeItem;
    }
  }
  _scrollToCurrentTreeItem(treeItem) {
    if (!treeItem) {
      return;
    }
    this._l10n.pause();
    let currentNode = treeItem.parentNode;
    while (currentNode && currentNode !== this.container) {
      if (currentNode.classList.contains("treeItem")) {
        const toggler = currentNode.firstElementChild;
        toggler?.classList.remove("treeItemsHidden");
      }
      currentNode = currentNode.parentNode;
    }
    this._l10n.resume();
    this._updateCurrentTreeItem(treeItem);
    this.container.scrollTo(treeItem.offsetLeft, treeItem.offsetTop + TREEITEM_OFFSET_TOP);
  }
}
export { BaseTreeViewer };