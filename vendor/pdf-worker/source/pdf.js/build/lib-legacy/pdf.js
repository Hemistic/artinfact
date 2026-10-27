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
import { AbortException, AnnotationEditorParamsType, AnnotationEditorType, AnnotationMode, AnnotationType, createValidAbsoluteUrl, FeatureTest, getUuid, ImageKind, InvalidPDFException, MathClamp, normalizeUnicode, OPS, PasswordResponses, PermissionFlag, ResponseException, shadow, updateUrlHash, Util, VerbosityLevel } from "./shared/util.js";
import { build, getDocument, PDFDataRangeTransport, PDFWorker, version } from "./display/api.js";
import { fetchData, getFilenameFromUrl, getPdfFilenameFromUrl, getRGB, getXfaPageViewport, isDataScheme, isPdfFile, noContextMenu, OutputScale, PDFDateString, PixelsPerInch, RenderingCancelledException, setLayerDimensions, stopEvent, SupportedImageMimeTypes } from "./display/display_utils.js";
import { AnnotationEditorLayer } from "./display/editor/annotation_editor_layer.js";
import { AnnotationEditorUIManager } from "./display/editor/tools.js";
import { AnnotationLayer } from "./display/annotation_layer.js";
import { ColorPicker } from "./display/editor/color_picker.js";
import { DOMSVGFactory } from "./display/svg_factory.js";
import { DrawLayer } from "./display/draw_layer.js";
import { GlobalWorkerOptions } from "./display/worker_options.js";
import { HighlightOutliner } from "./display/editor/drawers/highlight.js";
import { isValidExplicitDest } from "./display/api_utils.js";
import { SignatureExtractor } from "./display/editor/drawers/signaturedraw.js";
import { TextLayer } from "./display/text_layer.js";
import { TouchManager } from "./display/touch_manager.js";
import { XfaLayer } from "./display/xfa_layer.js";
{
  globalThis._pdfjsTestingUtils = {
    HighlightOutliner
  };
}
globalThis.pdfjsLib = {
  AbortException,
  AnnotationEditorLayer,
  AnnotationEditorParamsType,
  AnnotationEditorType,
  AnnotationEditorUIManager,
  AnnotationLayer,
  AnnotationMode,
  AnnotationType,
  build,
  ColorPicker,
  createValidAbsoluteUrl,
  DOMSVGFactory,
  DrawLayer,
  FeatureTest,
  fetchData,
  getDocument,
  getFilenameFromUrl,
  getPdfFilenameFromUrl,
  getRGB,
  getUuid,
  getXfaPageViewport,
  GlobalWorkerOptions,
  ImageKind,
  InvalidPDFException,
  isDataScheme,
  isPdfFile,
  isValidExplicitDest,
  MathClamp,
  noContextMenu,
  normalizeUnicode,
  OPS,
  OutputScale,
  PasswordResponses,
  PDFDataRangeTransport,
  PDFDateString,
  PDFWorker,
  PermissionFlag,
  PixelsPerInch,
  RenderingCancelledException,
  ResponseException,
  setLayerDimensions,
  shadow,
  SignatureExtractor,
  stopEvent,
  SupportedImageMimeTypes,
  TextLayer,
  TouchManager,
  updateUrlHash,
  Util,
  VerbosityLevel,
  version,
  XfaLayer
};
export { AbortException, AnnotationEditorLayer, AnnotationEditorParamsType, AnnotationEditorType, AnnotationEditorUIManager, AnnotationLayer, AnnotationMode, AnnotationType, build, ColorPicker, createValidAbsoluteUrl, DOMSVGFactory, DrawLayer, FeatureTest, fetchData, getDocument, getFilenameFromUrl, getPdfFilenameFromUrl, getRGB, getUuid, getXfaPageViewport, GlobalWorkerOptions, ImageKind, InvalidPDFException, isDataScheme, isPdfFile, isValidExplicitDest, MathClamp, noContextMenu, normalizeUnicode, OPS, OutputScale, PasswordResponses, PDFDataRangeTransport, PDFDateString, PDFWorker, PermissionFlag, PixelsPerInch, RenderingCancelledException, ResponseException, setLayerDimensions, shadow, SignatureExtractor, stopEvent, SupportedImageMimeTypes, TextLayer, TouchManager, updateUrlHash, Util, VerbosityLevel, version, XfaLayer };