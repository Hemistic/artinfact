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
import { docStyle, PresentationModeState, SidebarView, toggleCheckedBtn, toggleExpandedBtn } from "./ui_utils.js";
const SIDEBAR_WIDTH_VAR = "--sidebar-width";
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_RESIZING_CLASS = "sidebarResizing";
const UI_NOTIFICATION_CLASS = "pdfSidebarNotification";
class PDFSidebar {
  #isRTL = false;
  #mouseAC = null;
  #outerContainerWidth = null;
  #width = null;
  constructor({
    elements,
    eventBus,
    l10n
  }) {
    this.isOpen = false;
    this.active = SidebarView.THUMBS;
    this.isInitialViewSet = false;
    this.isInitialEventDispatched = false;
    this.onToggled = null;
    this.onUpdateThumbnails = null;
    this.outerContainer = elements.outerContainer;
    this.sidebarContainer = elements.sidebarContainer;
    this.toggleButton = elements.toggleButton;
    this.resizer = elements.resizer;
    this.thumbnailButton = elements.thumbnailButton;
    this.outlineButton = elements.outlineButton;
    this.attachmentsButton = elements.attachmentsButton;
    this.layersButton = elements.layersButton;
    this.thumbnailView = elements.thumbnailView;
    this.outlineView = elements.outlineView;
    this.attachmentsView = elements.attachmentsView;
    this.layersView = elements.layersView;
    this._currentOutlineItemButton = elements.currentOutlineItemButton;
    this.eventBus = eventBus;
    this.#isRTL = l10n.getDirection() === "rtl";
    this.#addEventListeners();
  }
  reset() {
    this.isInitialViewSet = false;
    this.isInitialEventDispatched = false;
    this.#hideUINotification(true);
    this.switchView(SidebarView.THUMBS);
    this.outlineButton.disabled = false;
    this.attachmentsButton.disabled = false;
    this.layersButton.disabled = false;
    this._currentOutlineItemButton.disabled = true;
  }
  get visibleView() {
    return this.isOpen ? this.active : SidebarView.NONE;
  }
  setInitialView(view = SidebarView.NONE) {
    if (this.isInitialViewSet) {
      return;
    }
    this.isInitialViewSet = true;
    if (view === SidebarView.NONE || view === SidebarView.UNKNOWN) {
      this.#dispatchEvent();
      return;
    }
    this.switchView(view, true);
    if (!this.isInitialEventDispatched) {
      this.#dispatchEvent();
    }
  }
  switchView(view, forceOpen = false) {
    const isViewChanged = view !== this.active;
    let forceRendering = false;
    switch (view) {
      case SidebarView.NONE:
        if (this.isOpen) {
          this.close();
        }
        return;
      case SidebarView.THUMBS:
        if (this.isOpen && isViewChanged) {
          forceRendering = true;
        }
        break;
      case SidebarView.OUTLINE:
        if (this.outlineButton.disabled) {
          return;
        }
        break;
      case SidebarView.ATTACHMENTS:
        if (this.attachmentsButton.disabled) {
          return;
        }
        break;
      case SidebarView.LAYERS:
        if (this.layersButton.disabled) {
          return;
        }
        break;
      default:
        console.error(`PDFSidebar.switchView: "${view}" is not a valid view.`);
        return;
    }
    this.active = view;
    toggleCheckedBtn(this.thumbnailButton, view === SidebarView.THUMBS, this.thumbnailView);
    toggleCheckedBtn(this.outlineButton, view === SidebarView.OUTLINE, this.outlineView);
    toggleCheckedBtn(this.attachmentsButton, view === SidebarView.ATTACHMENTS, this.attachmentsView);
    toggleCheckedBtn(this.layersButton, view === SidebarView.LAYERS, this.layersView);
    if (forceOpen && !this.isOpen) {
      this.open();
      return;
    }
    if (forceRendering) {
      this.onUpdateThumbnails();
      this.onToggled();
    }
    if (isViewChanged) {
      this.#dispatchEvent();
    }
  }
  open() {
    if (this.isOpen) {
      return;
    }
    this.isOpen = true;
    toggleExpandedBtn(this.toggleButton, true);
    this.outerContainer.classList.add("sidebarMoving", "sidebarOpen");
    if (this.active === SidebarView.THUMBS) {
      this.onUpdateThumbnails();
    }
    this.onToggled();
    this.#dispatchEvent();
    this.#hideUINotification();
  }
  close(evt = null) {
    if (!this.isOpen) {
      return;
    }
    this.isOpen = false;
    toggleExpandedBtn(this.toggleButton, false);
    this.outerContainer.classList.add("sidebarMoving");
    this.outerContainer.classList.remove("sidebarOpen");
    this.onToggled();
    this.#dispatchEvent();
    if (evt?.detail > 0) {
      this.toggleButton.blur();
    }
  }
  toggle(evt = null) {
    if (this.isOpen) {
      this.close(evt);
    } else {
      this.open();
    }
  }
  #dispatchEvent() {
    if (this.isInitialViewSet) {
      this.isInitialEventDispatched ||= true;
    }
    this.eventBus.dispatch("sidebarviewchanged", {
      source: this,
      view: this.visibleView
    });
  }
  #showUINotification() {
    this.toggleButton.setAttribute("data-l10n-id", "pdfjs-toggle-sidebar-notification-button");
    if (!this.isOpen) {
      this.toggleButton.classList.add(UI_NOTIFICATION_CLASS);
    }
  }
  #hideUINotification(reset = false) {
    if (this.isOpen || reset) {
      this.toggleButton.classList.remove(UI_NOTIFICATION_CLASS);
    }
    if (reset) {
      this.toggleButton.setAttribute("data-l10n-id", "pdfjs-toggle-sidebar-button");
    }
  }
  #addEventListeners() {
    const {
      eventBus,
      outerContainer
    } = this;
    this.sidebarContainer.addEventListener("transitionend", evt => {
      if (evt.target === this.sidebarContainer) {
        outerContainer.classList.remove("sidebarMoving");
        eventBus.dispatch("resize", {
          source: this
        });
      }
    });
    this.toggleButton.addEventListener("click", evt => {
      this.toggle(evt);
    });
    this.thumbnailButton.addEventListener("click", () => {
      this.switchView(SidebarView.THUMBS);
    });
    this.outlineButton.addEventListener("click", () => {
      this.switchView(SidebarView.OUTLINE);
    });
    this.outlineButton.addEventListener("dblclick", () => {
      eventBus.dispatch("toggleoutlinetree", {
        source: this
      });
    });
    this.attachmentsButton.addEventListener("click", () => {
      this.switchView(SidebarView.ATTACHMENTS);
    });
    this.layersButton.addEventListener("click", () => {
      this.switchView(SidebarView.LAYERS);
    });
    this.layersButton.addEventListener("dblclick", () => {
      eventBus.dispatch("resetlayers", {
        source: this
      });
    });
    this._currentOutlineItemButton.addEventListener("click", () => {
      eventBus.dispatch("currentoutlineitem", {
        source: this
      });
    });
    const onTreeLoaded = (count, button, view) => {
      button.disabled = !count;
      if (count) {
        this.#showUINotification();
      } else if (this.active === view) {
        this.switchView(SidebarView.THUMBS);
      }
    };
    eventBus._on("outlineloaded", evt => {
      onTreeLoaded(evt.outlineCount, this.outlineButton, SidebarView.OUTLINE);
      evt.currentOutlineItemPromise.then(enabled => {
        if (!this.isInitialViewSet) {
          return;
        }
        this._currentOutlineItemButton.disabled = !enabled;
      });
    });
    eventBus._on("attachmentsloaded", evt => {
      onTreeLoaded(evt.attachmentsCount, this.attachmentsButton, SidebarView.ATTACHMENTS);
    });
    eventBus._on("layersloaded", evt => {
      onTreeLoaded(evt.layersCount, this.layersButton, SidebarView.LAYERS);
    });
    eventBus._on("presentationmodechanged", evt => {
      if (evt.state === PresentationModeState.NORMAL && this.visibleView === SidebarView.THUMBS) {
        this.onUpdateThumbnails();
      }
    });
    this.resizer.addEventListener("mousedown", evt => {
      if (evt.button !== 0) {
        return;
      }
      outerContainer.classList.add(SIDEBAR_RESIZING_CLASS);
      this.#mouseAC = new AbortController();
      const opts = {
        signal: this.#mouseAC.signal
      };
      window.addEventListener("mousemove", this.#mouseMove.bind(this), opts);
      window.addEventListener("mouseup", this.#mouseUp.bind(this), opts);
      window.addEventListener("blur", this.#mouseUp.bind(this), opts);
    });
    eventBus._on("resize", evt => {
      if (evt.source !== window) {
        return;
      }
      this.#outerContainerWidth = null;
      if (!this.#width) {
        return;
      }
      if (!this.isOpen) {
        this.#updateWidth(this.#width);
        return;
      }
      outerContainer.classList.add(SIDEBAR_RESIZING_CLASS);
      const updated = this.#updateWidth(this.#width);
      Promise.resolve().then(() => {
        outerContainer.classList.remove(SIDEBAR_RESIZING_CLASS);
        if (updated) {
          eventBus.dispatch("resize", {
            source: this
          });
        }
      });
    });
  }
  get outerContainerWidth() {
    return this.#outerContainerWidth ||= this.outerContainer.clientWidth;
  }
  #updateWidth(width = 0) {
    const maxWidth = Math.floor(this.outerContainerWidth / 2);
    if (width > maxWidth) {
      width = maxWidth;
    }
    if (width < SIDEBAR_MIN_WIDTH) {
      width = SIDEBAR_MIN_WIDTH;
    }
    if (width === this.#width) {
      return false;
    }
    this.#width = width;
    docStyle.setProperty(SIDEBAR_WIDTH_VAR, `${width}px`);
    return true;
  }
  #mouseMove(evt) {
    let width = evt.clientX;
    if (this.#isRTL) {
      width = this.outerContainerWidth - width;
    }
    this.#updateWidth(width);
  }
  #mouseUp(evt) {
    this.outerContainer.classList.remove(SIDEBAR_RESIZING_CLASS);
    this.eventBus.dispatch("resize", {
      source: this
    });
    this.#mouseAC?.abort();
    this.#mouseAC = null;
  }
}
export { PDFSidebar };