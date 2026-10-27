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
import "core-js/modules/web.url-search-params.delete.js";
import "core-js/modules/web.url-search-params.has.js";
import "core-js/modules/web.url-search-params.size.js";
import { FeatureTest, fetchData } from "../pdf.js";
import { FluentBundle, FluentResource } from "../../../node_modules/@fluent/bundle/esm/index.js";
import { DOMLocalization } from "../../../node_modules/@fluent/dom/esm/index.js";
import { L10n } from "./l10n.js";
function PLATFORM() {
  const {
    isAndroid,
    isLinux,
    isMac,
    isWindows
  } = FeatureTest.platform;
  if (isLinux) {
    return "linux";
  }
  if (isWindows) {
    return "windows";
  }
  if (isMac) {
    return "macos";
  }
  if (isAndroid) {
    return "android";
  }
  return "other";
}
function createBundle(lang, text) {
  const resource = new FluentResource(text);
  const bundle = new FluentBundle(lang, {
    functions: {
      PLATFORM
    }
  });
  const errors = bundle.addResource(resource);
  if (errors.length) {
    console.error("L10n errors", errors);
  }
  return bundle;
}
class GenericL10n extends L10n {
  constructor(lang) {
    super({
      lang
    });
    const generateBundles = !lang ? GenericL10n.#generateBundlesFallback.bind(GenericL10n, this.getLanguage()) : GenericL10n.#generateBundles.bind(GenericL10n, "en-us", this.getLanguage());
    this._setL10n(new DOMLocalization([], generateBundles));
  }
  static async *#generateBundles(defaultLang, baseLang) {
    const {
      baseURL,
      paths
    } = await this.#getPaths();
    const langs = [baseLang];
    if (defaultLang !== baseLang) {
      const shortLang = baseLang.split("-", 1)[0];
      if (shortLang !== baseLang) {
        langs.push(shortLang);
      }
      langs.push(defaultLang);
    }
    const bundles = langs.map(lang => [lang, this.#createBundle(lang, baseURL, paths)]);
    for (const [lang, bundlePromise] of bundles) {
      const bundle = await bundlePromise;
      if (bundle) {
        yield bundle;
      } else if (lang === "en-us") {
        yield this.#createBundleFallback(lang);
      }
    }
  }
  static async #createBundle(lang, baseURL, paths) {
    const path = paths[lang];
    if (!path) {
      return null;
    }
    const url = new URL(path, baseURL);
    const text = await fetchData(url, "text");
    return createBundle(lang, text);
  }
  static async #getPaths() {
    try {
      const {
        href
      } = document.querySelector(`link[type="application/l10n"]`);
      const paths = await fetchData(href, "json");
      return {
        baseURL: href.substring(0, href.lastIndexOf("/") + 1) || "./",
        paths
      };
    } catch {}
    return {
      baseURL: "./",
      paths: Object.create(null)
    };
  }
  static async *#generateBundlesFallback(lang) {
    yield this.#createBundleFallback(lang);
  }
  static async #createBundleFallback(lang) {
    const text = "pdfjs-previous-button =\n    .title = Previous Page\npdfjs-previous-button-label = Previous\npdfjs-next-button =\n    .title = Next Page\npdfjs-next-button-label = Next\npdfjs-page-input =\n    .title = Page\npdfjs-of-pages = of { $pagesCount }\npdfjs-page-of-pages = ({ $pageNumber } of { $pagesCount })\npdfjs-zoom-out-button =\n    .title = Zoom Out\npdfjs-zoom-out-button-label = Zoom Out\npdfjs-zoom-in-button =\n    .title = Zoom In\npdfjs-zoom-in-button-label = Zoom In\npdfjs-zoom-select =\n    .title = Zoom\npdfjs-presentation-mode-button =\n    .title = Switch to Presentation Mode\npdfjs-presentation-mode-button-label = Presentation Mode\npdfjs-open-file-button =\n    .title = Open File\npdfjs-open-file-button-label = Open\npdfjs-print-button =\n    .title = Print\npdfjs-print-button-label = Print\npdfjs-save-button =\n    .title = Save\npdfjs-save-button-label = Save\npdfjs-download-button =\n    .title = Download\npdfjs-download-button-label = Download\npdfjs-bookmark-button =\n    .title = Current Page (View URL from Current Page)\npdfjs-bookmark-button-label = Current Page\npdfjs-tools-button =\n    .title = Tools\npdfjs-tools-button-label = Tools\npdfjs-first-page-button =\n    .title = Go to First Page\npdfjs-first-page-button-label = Go to First Page\npdfjs-last-page-button =\n    .title = Go to Last Page\npdfjs-last-page-button-label = Go to Last Page\npdfjs-page-rotate-cw-button =\n    .title = Rotate Clockwise\npdfjs-page-rotate-cw-button-label = Rotate Clockwise\npdfjs-page-rotate-ccw-button =\n    .title = Rotate Counterclockwise\npdfjs-page-rotate-ccw-button-label = Rotate Counterclockwise\npdfjs-cursor-text-select-tool-button =\n    .title = Enable Text Selection Tool\npdfjs-cursor-text-select-tool-button-label = Text Selection Tool\npdfjs-cursor-hand-tool-button =\n    .title = Enable Hand Tool\npdfjs-cursor-hand-tool-button-label = Hand Tool\npdfjs-scroll-page-button =\n    .title = Use Page Scrolling\npdfjs-scroll-page-button-label = Page Scrolling\npdfjs-scroll-vertical-button =\n    .title = Use Vertical Scrolling\npdfjs-scroll-vertical-button-label = Vertical Scrolling\npdfjs-scroll-horizontal-button =\n    .title = Use Horizontal Scrolling\npdfjs-scroll-horizontal-button-label = Horizontal Scrolling\npdfjs-scroll-wrapped-button =\n    .title = Use Wrapped Scrolling\npdfjs-scroll-wrapped-button-label = Wrapped Scrolling\npdfjs-spread-none-button =\n    .title = Do not join page spreads\npdfjs-spread-none-button-label = No Spreads\npdfjs-spread-odd-button =\n    .title = Join page spreads starting with odd-numbered pages\npdfjs-spread-odd-button-label = Odd Spreads\npdfjs-spread-even-button =\n    .title = Join page spreads starting with even-numbered pages\npdfjs-spread-even-button-label = Even Spreads\npdfjs-document-properties-button =\n    .title = Document Properties\u2026\npdfjs-document-properties-button-label = Document Properties\u2026\npdfjs-document-properties-file-name = File name:\npdfjs-document-properties-file-size = File size:\npdfjs-document-properties-size-kb = { NUMBER($kb, maximumSignificantDigits: 3) } KB ({ $b } bytes)\npdfjs-document-properties-size-mb = { NUMBER($mb, maximumSignificantDigits: 3) } MB ({ $b } bytes)\npdfjs-document-properties-title = Title:\npdfjs-document-properties-author = Author:\npdfjs-document-properties-subject = Subject:\npdfjs-document-properties-keywords = Keywords:\npdfjs-document-properties-creation-date = Creation Date:\npdfjs-document-properties-modification-date = Modification Date:\npdfjs-document-properties-date-time-string = { DATETIME($dateObj, dateStyle: \"short\", timeStyle: \"medium\") }\npdfjs-document-properties-creator = Creator:\npdfjs-document-properties-producer = PDF Producer:\npdfjs-document-properties-version = PDF Version:\npdfjs-document-properties-page-count = Page Count:\npdfjs-document-properties-page-size = Page Size:\npdfjs-document-properties-page-size-unit-inches = in\npdfjs-document-properties-page-size-unit-millimeters = mm\npdfjs-document-properties-page-size-orientation-portrait = portrait\npdfjs-document-properties-page-size-orientation-landscape = landscape\npdfjs-document-properties-page-size-name-a-three = A3\npdfjs-document-properties-page-size-name-a-four = A4\npdfjs-document-properties-page-size-name-letter = Letter\npdfjs-document-properties-page-size-name-legal = Legal\npdfjs-document-properties-page-size-dimension-string = { $width } \xD7 { $height } { $unit } ({ $orientation })\npdfjs-document-properties-page-size-dimension-name-string = { $width } \xD7 { $height } { $unit } ({ $name }, { $orientation })\npdfjs-document-properties-linearized = Fast Web View:\npdfjs-document-properties-linearized-yes = Yes\npdfjs-document-properties-linearized-no = No\npdfjs-document-properties-close-button = Close\npdfjs-print-progress-message = Preparing document for printing\u2026\npdfjs-print-progress-percent = { $progress }%\npdfjs-print-progress-close-button = Cancel\npdfjs-printing-not-supported = Warning: Printing is not fully supported by this browser.\npdfjs-printing-not-ready = Warning: The PDF is not fully loaded for printing.\npdfjs-toggle-sidebar-button =\n    .title = Toggle Sidebar\npdfjs-toggle-sidebar-notification-button =\n    .title = Toggle Sidebar (document contains outline/attachments/layers)\npdfjs-toggle-sidebar-button-label = Toggle Sidebar\npdfjs-document-outline-button =\n    .title = Show Document Outline (double-click to expand/collapse all items)\npdfjs-document-outline-button-label = Document Outline\npdfjs-attachments-button =\n    .title = Show Attachments\npdfjs-attachments-button-label = Attachments\npdfjs-layers-button =\n    .title = Show Layers (double-click to reset all layers to the default state)\npdfjs-layers-button-label = Layers\npdfjs-thumbs-button =\n    .title = Show Thumbnails\npdfjs-thumbs-button-label = Thumbnails\npdfjs-current-outline-item-button =\n    .title = Find Current Outline Item\npdfjs-current-outline-item-button-label = Current Outline Item\npdfjs-findbar-button =\n    .title = Find in Document\npdfjs-findbar-button-label = Find\npdfjs-additional-layers = Additional Layers\npdfjs-thumb-page-title =\n    .title = Page { $page }\npdfjs-thumb-page-canvas =\n    .aria-label = Thumbnail of Page { $page }\npdfjs-find-input =\n    .title = Find\n    .placeholder = Find in document\u2026\npdfjs-find-previous-button =\n    .title = Find the previous occurrence of the phrase\npdfjs-find-previous-button-label = Previous\npdfjs-find-next-button =\n    .title = Find the next occurrence of the phrase\npdfjs-find-next-button-label = Next\npdfjs-find-highlight-checkbox = Highlight All\npdfjs-find-match-case-checkbox-label = Match Case\npdfjs-find-match-diacritics-checkbox-label = Match Diacritics\npdfjs-find-entire-word-checkbox-label = Whole Words\npdfjs-find-reached-top = Reached top of document, continued from bottom\npdfjs-find-reached-bottom = Reached end of document, continued from top\npdfjs-find-match-count =\n    { $total ->\n        [one] { $current } of { $total } match\n       *[other] { $current } of { $total } matches\n    }\npdfjs-find-match-count-limit =\n    { $limit ->\n        [one] More than { $limit } match\n       *[other] More than { $limit } matches\n    }\npdfjs-find-not-found = Phrase not found\npdfjs-page-scale-width = Page Width\npdfjs-page-scale-fit = Page Fit\npdfjs-page-scale-auto = Automatic Zoom\npdfjs-page-scale-actual = Actual Size\npdfjs-page-scale-percent = { $scale }%\npdfjs-page-landmark =\n    .aria-label = Page { $page }\npdfjs-loading-error = An error occurred while loading the PDF.\npdfjs-invalid-file-error = Invalid or corrupted PDF file.\npdfjs-missing-file-error = Missing PDF file.\npdfjs-unexpected-response-error = Unexpected server response.\npdfjs-rendering-error = An error occurred while rendering the page.\npdfjs-annotation-date-time-string = { DATETIME($dateObj, dateStyle: \"short\", timeStyle: \"medium\") }\npdfjs-text-annotation-type =\n    .alt = [{ $type } Annotation]\npdfjs-password-label = Enter the password to open this PDF file.\npdfjs-password-invalid = Invalid password. Please try again.\npdfjs-password-ok-button = OK\npdfjs-password-cancel-button = Cancel\npdfjs-web-fonts-disabled = Web fonts are disabled: unable to use embedded PDF fonts.\npdfjs-editor-free-text-button =\n    .title = Text\npdfjs-editor-color-picker-free-text-input =\n    .title = Change text color\npdfjs-editor-free-text-button-label = Text\npdfjs-editor-ink-button =\n    .title = Draw\npdfjs-editor-color-picker-ink-input =\n    .title = Change drawing color\npdfjs-editor-ink-button-label = Draw\npdfjs-editor-stamp-button =\n    .title = Add or edit images\npdfjs-editor-stamp-button-label = Add or edit images\npdfjs-editor-highlight-button =\n    .title = Highlight\npdfjs-editor-highlight-button-label = Highlight\npdfjs-highlight-floating-button1 =\n    .title = Highlight\n    .aria-label = Highlight\npdfjs-highlight-floating-button-label = Highlight\npdfjs-editor-signature-button =\n    .title = Add signature\npdfjs-editor-signature-button-label = Add signature\npdfjs-editor-highlight-editor =\n    .aria-label = Highlight editor\npdfjs-editor-ink-editor =\n    .aria-label = Drawing editor\npdfjs-editor-signature-editor1 =\n    .aria-description = Signature editor: { $description }\npdfjs-editor-stamp-editor =\n    .aria-label = Image editor\npdfjs-editor-remove-ink-button =\n    .title = Remove drawing\npdfjs-editor-remove-freetext-button =\n    .title = Remove text\npdfjs-editor-remove-stamp-button =\n    .title = Remove image\npdfjs-editor-remove-highlight-button =\n    .title = Remove highlight\npdfjs-editor-remove-signature-button =\n    .title = Remove signature\npdfjs-editor-free-text-color-input = Color\npdfjs-editor-free-text-size-input = Size\npdfjs-editor-ink-color-input = Color\npdfjs-editor-ink-thickness-input = Thickness\npdfjs-editor-ink-opacity-input = Opacity\npdfjs-editor-stamp-add-image-button =\n    .title = Add image\npdfjs-editor-stamp-add-image-button-label = Add image\npdfjs-editor-free-highlight-thickness-input = Thickness\npdfjs-editor-free-highlight-thickness-title =\n    .title = Change thickness when highlighting items other than text\npdfjs-editor-add-signature-container =\n    .aria-label = Signature controls and saved signatures\npdfjs-editor-signature-add-signature-button =\n    .title = Add new signature\npdfjs-editor-signature-add-signature-button-label = Add new signature\npdfjs-editor-add-saved-signature-button =\n    .title = Saved signature: { $description }\npdfjs-free-text2 =\n    .aria-label = Text Editor\n    .default-content = Start typing\u2026\npdfjs-editor-alt-text-button =\n    .aria-label = Alt text\npdfjs-editor-alt-text-button-label = Alt text\npdfjs-editor-alt-text-edit-button =\n    .aria-label = Edit alt text\npdfjs-editor-alt-text-dialog-label = Choose an option\npdfjs-editor-alt-text-dialog-description = Alt text (alternative text) helps when people can\u2019t see the image or when it doesn\u2019t load.\npdfjs-editor-alt-text-add-description-label = Add a description\npdfjs-editor-alt-text-add-description-description = Aim for 1-2 sentences that describe the subject, setting, or actions.\npdfjs-editor-alt-text-mark-decorative-label = Mark as decorative\npdfjs-editor-alt-text-mark-decorative-description = This is used for ornamental images, like borders or watermarks.\npdfjs-editor-alt-text-cancel-button = Cancel\npdfjs-editor-alt-text-save-button = Save\npdfjs-editor-alt-text-decorative-tooltip = Marked as decorative\npdfjs-editor-alt-text-textarea =\n    .placeholder = For example, \u201CA young man sits down at a table to eat a meal\u201D\npdfjs-editor-resizer-top-left =\n    .aria-label = Top left corner \u2014 resize\npdfjs-editor-resizer-top-middle =\n    .aria-label = Top middle \u2014 resize\npdfjs-editor-resizer-top-right =\n    .aria-label = Top right corner \u2014 resize\npdfjs-editor-resizer-middle-right =\n    .aria-label = Middle right \u2014 resize\npdfjs-editor-resizer-bottom-right =\n    .aria-label = Bottom right corner \u2014 resize\npdfjs-editor-resizer-bottom-middle =\n    .aria-label = Bottom middle \u2014 resize\npdfjs-editor-resizer-bottom-left =\n    .aria-label = Bottom left corner \u2014 resize\npdfjs-editor-resizer-middle-left =\n    .aria-label = Middle left \u2014 resize\npdfjs-editor-highlight-colorpicker-label = Highlight color\npdfjs-editor-colorpicker-button =\n    .title = Change color\npdfjs-editor-colorpicker-dropdown =\n    .aria-label = Color choices\npdfjs-editor-colorpicker-yellow =\n    .title = Yellow\npdfjs-editor-colorpicker-green =\n    .title = Green\npdfjs-editor-colorpicker-blue =\n    .title = Blue\npdfjs-editor-colorpicker-pink =\n    .title = Pink\npdfjs-editor-colorpicker-red =\n    .title = Red\npdfjs-editor-highlight-show-all-button-label = Show all\npdfjs-editor-highlight-show-all-button =\n    .title = Show all\npdfjs-editor-new-alt-text-dialog-edit-label = Edit alt text (image description)\npdfjs-editor-new-alt-text-dialog-add-label = Add alt text (image description)\npdfjs-editor-new-alt-text-textarea =\n    .placeholder = Write your description here\u2026\npdfjs-editor-new-alt-text-description = Short description for people who can\u2019t see the image or when the image doesn\u2019t load.\npdfjs-editor-new-alt-text-disclaimer1 = This alt text was created automatically and may be inaccurate.\npdfjs-editor-new-alt-text-disclaimer-learn-more-url = Learn more\npdfjs-editor-new-alt-text-create-automatically-button-label = Create alt text automatically\npdfjs-editor-new-alt-text-not-now-button = Not now\npdfjs-editor-new-alt-text-error-title = Couldn\u2019t create alt text automatically\npdfjs-editor-new-alt-text-error-description = Please write your own alt text or try again later.\npdfjs-editor-new-alt-text-error-close-button = Close\npdfjs-editor-new-alt-text-ai-model-downloading-progress = Downloading alt text AI model ({ $downloadedSize } of { $totalSize } MB)\n    .aria-valuetext = Downloading alt text AI model ({ $downloadedSize } of { $totalSize } MB)\npdfjs-editor-new-alt-text-added-button =\n    .aria-label = Alt text added\npdfjs-editor-new-alt-text-added-button-label = Alt text added\npdfjs-editor-new-alt-text-missing-button =\n    .aria-label = Missing alt text\npdfjs-editor-new-alt-text-missing-button-label = Missing alt text\npdfjs-editor-new-alt-text-to-review-button =\n    .aria-label = Review alt text\npdfjs-editor-new-alt-text-to-review-button-label = Review alt text\npdfjs-editor-new-alt-text-generated-alt-text-with-disclaimer = Created automatically: { $generatedAltText }\npdfjs-image-alt-text-settings-button =\n    .title = Image alt text settings\npdfjs-image-alt-text-settings-button-label = Image alt text settings\npdfjs-editor-alt-text-settings-dialog-label = Image alt text settings\npdfjs-editor-alt-text-settings-automatic-title = Automatic alt text\npdfjs-editor-alt-text-settings-create-model-button-label = Create alt text automatically\npdfjs-editor-alt-text-settings-create-model-description = Suggests descriptions to help people who can\u2019t see the image or when the image doesn\u2019t load.\npdfjs-editor-alt-text-settings-download-model-label = Alt text AI model ({ $totalSize } MB)\npdfjs-editor-alt-text-settings-ai-model-description = Runs locally on your device so your data stays private. Required for automatic alt text.\npdfjs-editor-alt-text-settings-delete-model-button = Delete\npdfjs-editor-alt-text-settings-download-model-button = Download\npdfjs-editor-alt-text-settings-downloading-model-button = Downloading\u2026\npdfjs-editor-alt-text-settings-editor-title = Alt text editor\npdfjs-editor-alt-text-settings-show-dialog-button-label = Show alt text editor right away when adding an image\npdfjs-editor-alt-text-settings-show-dialog-description = Helps you make sure all your images have alt text.\npdfjs-editor-alt-text-settings-close-button = Close\npdfjs-editor-highlight-added-alert = Highlight added\npdfjs-editor-freetext-added-alert = Text added\npdfjs-editor-ink-added-alert = Drawing added\npdfjs-editor-stamp-added-alert = Image added\npdfjs-editor-signature-added-alert = Signature added\npdfjs-editor-undo-bar-message-highlight = Highlight removed\npdfjs-editor-undo-bar-message-freetext = Text removed\npdfjs-editor-undo-bar-message-ink = Drawing removed\npdfjs-editor-undo-bar-message-stamp = Image removed\npdfjs-editor-undo-bar-message-signature = Signature removed\npdfjs-editor-undo-bar-message-multiple =\n    { $count ->\n        [one] { $count } annotation removed\n       *[other] { $count } annotations removed\n    }\npdfjs-editor-undo-bar-undo-button =\n    .title = Undo\npdfjs-editor-undo-bar-undo-button-label = Undo\npdfjs-editor-undo-bar-close-button =\n    .title = Close\npdfjs-editor-undo-bar-close-button-label = Close\npdfjs-editor-add-signature-dialog-label = This modal allows the user to create a signature to add to a PDF document. The user can edit the name (which also serves as the alt text), and optionally save the signature for repeated use.\npdfjs-editor-add-signature-dialog-title = Add a signature\npdfjs-editor-add-signature-type-button = Type\n    .title = Type\npdfjs-editor-add-signature-draw-button = Draw\n    .title = Draw\npdfjs-editor-add-signature-image-button = Image\n    .title = Image\npdfjs-editor-add-signature-type-input =\n    .aria-label = Type your signature\n    .placeholder = Type your signature\npdfjs-editor-add-signature-draw-placeholder = Draw your signature\npdfjs-editor-add-signature-draw-thickness-range-label = Thickness\npdfjs-editor-add-signature-draw-thickness-range =\n    .title = Drawing thickness: { $thickness }\npdfjs-editor-add-signature-image-placeholder = Drag a file here to upload\npdfjs-editor-add-signature-image-browse-link =\n    { PLATFORM() ->\n        [macos] Or choose image files\n       *[other] Or browse image files\n    }\npdfjs-editor-add-signature-description-label = Description (alt text)\npdfjs-editor-add-signature-description-input =\n    .title = Description (alt text)\npdfjs-editor-add-signature-description-default-when-drawing = Signature\npdfjs-editor-add-signature-clear-button-label = Clear signature\npdfjs-editor-add-signature-clear-button =\n    .title = Clear signature\npdfjs-editor-add-signature-save-checkbox = Save signature\npdfjs-editor-add-signature-save-warning-message = You\u2019ve reached the limit of 5 saved signatures. Remove one to save more.\npdfjs-editor-add-signature-image-upload-error-title = Couldn\u2019t upload image\npdfjs-editor-add-signature-image-upload-error-description = Check your network connection or try another image.\npdfjs-editor-add-signature-image-no-data-error-title = Can\u2019t convert this image into a signature\npdfjs-editor-add-signature-image-no-data-error-description = Please try uploading a different image.\npdfjs-editor-add-signature-error-close-button = Close\npdfjs-editor-add-signature-cancel-button = Cancel\npdfjs-editor-add-signature-add-button = Add\npdfjs-editor-delete-signature-button1 =\n    .title = Remove saved signature\npdfjs-editor-delete-signature-button-label1 = Remove saved signature\npdfjs-editor-add-signature-edit-button-label = Edit description\npdfjs-editor-edit-signature-dialog-title = Edit description\npdfjs-editor-edit-signature-update-button = Update\npdfjs-editor-edit-comment-actions-button-label = Actions\npdfjs-editor-edit-comment-actions-button =\n    .title = Actions\npdfjs-editor-edit-comment-close-button-label = Close\npdfjs-editor-edit-comment-close-button =\n    .title = Close\npdfjs-editor-edit-comment-actions-edit-button-label = Edit\npdfjs-editor-edit-comment-actions-delete-button-label = Delete\npdfjs-editor-edit-comment-manager-text-input =\n    .placeholder = Enter your comment\npdfjs-editor-edit-comment-manager-cancel-button = Cancel\npdfjs-editor-edit-comment-manager-save-button = Save\npdfjs-editor-edit-comment-button =\n    .title = Edit comment";
    return createBundle(lang, text);
  }
}
export { GenericL10n };