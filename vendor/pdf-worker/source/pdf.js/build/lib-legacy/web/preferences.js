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
import { AppOptions, OptionKind } from "./app_options.js";
class BasePreferences {
  #defaults = Object.freeze({
    altTextLearnMoreUrl: "",
    annotationEditorMode: 0,
    annotationMode: 2,
    capCanvasAreaFactor: 200,
    cursorToolOnLoad: 0,
    defaultZoomDelay: 400,
    defaultZoomValue: "",
    disablePageLabels: false,
    enableAltText: false,
    enableAltTextModelDownload: true,
    enableAutoLinking: true,
    enableComment: false,
    enableGuessAltText: true,
    enableHighlightFloatingButton: false,
    enableNewAltTextWhenAddingImage: true,
    enablePermissions: false,
    enablePrintAutoRotate: true,
    enableScripting: true,
    enableSignatureEditor: false,
    enableUpdatedAddImage: false,
    externalLinkTarget: 0,
    highlightEditorColors: "yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F,yellow_HCM=#FFFFCC,green_HCM=#53FFBC,blue_HCM=#80EBFF,pink_HCM=#F6B8FF,red_HCM=#C50043",
    historyUpdateUrl: false,
    ignoreDestinationZoom: false,
    forcePageColors: false,
    pageColorsBackground: "Canvas",
    pageColorsForeground: "CanvasText",
    pdfBugEnabled: false,
    sidebarViewOnLoad: -1,
    scrollModeOnLoad: -1,
    spreadModeOnLoad: -1,
    textLayerMode: 1,
    viewerCssTheme: 0,
    viewOnLoad: 0,
    disableAutoFetch: false,
    disableFontFace: false,
    disableRange: false,
    disableStream: false,
    enableHWA: true,
    enableXfa: true
  });
  #initializedPromise = null;
  constructor() {
    this.#initializedPromise = this._readFromStorage(this.#defaults).then(({
      browserPrefs,
      prefs
    }) => {
      if (AppOptions._checkDisablePreferences()) {
        return;
      }
      AppOptions.setAll({
        ...browserPrefs,
        ...prefs
      }, true);
    });
  }
  async _writeToStorage(prefObj) {
    throw new Error("Not implemented: _writeToStorage");
  }
  async _readFromStorage(prefObj) {
    throw new Error("Not implemented: _readFromStorage");
  }
  async reset() {
    await this.#initializedPromise;
    AppOptions.setAll(this.#defaults, true);
    await this._writeToStorage(this.#defaults);
  }
  async set(name, value) {
    await this.#initializedPromise;
    AppOptions.setAll({
      [name]: value
    }, true);
    await this._writeToStorage(AppOptions.getAll(OptionKind.PREFERENCE));
  }
  async get(name) {
    await this.#initializedPromise;
    return AppOptions.get(name);
  }
  get initializedPromise() {
    return this.#initializedPromise;
  }
}
export { BasePreferences };