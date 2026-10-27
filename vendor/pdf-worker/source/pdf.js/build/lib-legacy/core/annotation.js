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
import "core-js/modules/es.array-buffer.detached.js";
import "core-js/modules/es.array-buffer.transfer.js";
import "core-js/modules/es.array-buffer.transfer-to-fixed-length.js";
import "core-js/modules/es.iterator.constructor.js";
import "core-js/modules/es.iterator.every.js";
import "core-js/modules/es.iterator.filter.js";
import "core-js/modules/es.iterator.find.js";
import "core-js/modules/es.iterator.map.js";
import "core-js/modules/es.iterator.some.js";
import "core-js/modules/es.regexp.flags.js";
import "core-js/modules/es.typed-array.with.js";
import "core-js/modules/esnext.math.sum-precise.js";
import "core-js/modules/esnext.uint8-array.set-from-base64.js";
import "core-js/modules/esnext.uint8-array.set-from-hex.js";
import "core-js/modules/esnext.uint8-array.to-base64.js";
import "core-js/modules/esnext.uint8-array.to-hex.js";
import { AnnotationActionEventType, AnnotationBorderStyleType, AnnotationEditorType, AnnotationFieldFlag, AnnotationFlag, AnnotationReplyType, AnnotationType, assert, BASELINE_FACTOR, FeatureTest, getModificationDate, info, isArrayEqual, LINE_DESCENT_FACTOR, LINE_FACTOR, OPS, RenderingIntentFlag, shadow, stringToPDFString, unreachable, Util, warn } from "../shared/util.js";
import { collectActions, escapeString, getInheritableProperty, getParentToUpdate, getRotationMatrix, IDENTITY_MATRIX, isNumberArray, lookupMatrix, lookupNormalRect, lookupRect, numberToString, RESOURCES_KEYS_OPERATOR_LIST, RESOURCES_KEYS_TEXT_CONTENT, stringToAsciiOrUTF16BE, stringToUTF16String } from "./core_utils.js";
import { createDefaultAppearance, FakeUnicodeFont, getPdfColor, parseAppearanceStream, parseDefaultAppearance } from "./default_appearance.js";
import { DateFormats, TimeFormats } from "../shared/scripting_utils.js";
import { Dict, isName, isRefsEqual, Name, Ref, RefSet } from "./primitives.js";
import { Stream, StringStream } from "./stream.js";
import { BaseStream } from "./base_stream.js";
import { bidi } from "./bidi.js";
import { Catalog } from "./catalog.js";
import { ColorSpaceUtils } from "./colorspace_utils.js";
import { FileSpec } from "./file_spec.js";
import { JpegStream } from "./jpeg_stream.js";
import { ObjectLoader } from "./object_loader.js";
import { OperatorList } from "./operator_list.js";
import { XFAFactory } from "./xfa/factory.js";
class AnnotationFactory {
  static createGlobals(pdfManager) {
    return Promise.all([pdfManager.ensureCatalog("acroForm"), pdfManager.ensureDoc("xfaDatasets"), pdfManager.ensureCatalog("structTreeRoot"), pdfManager.ensureCatalog("baseUrl"), pdfManager.ensureCatalog("attachments"), pdfManager.ensureCatalog("globalColorSpaceCache")]).then(([acroForm, xfaDatasets, structTreeRoot, baseUrl, attachments, globalColorSpaceCache]) => ({
      pdfManager,
      acroForm: acroForm instanceof Dict ? acroForm : Dict.empty,
      xfaDatasets,
      structTreeRoot,
      baseUrl,
      attachments,
      globalColorSpaceCache
    }), reason => {
      warn(`createGlobals: "${reason}".`);
      return null;
    });
  }
  static async create(xref, ref, annotationGlobals, idFactory, collectFields, orphanFields, pageRef) {
    const pageIndex = collectFields ? await this._getPageIndex(xref, ref, annotationGlobals.pdfManager) : null;
    return annotationGlobals.pdfManager.ensure(this, "_create", [xref, ref, annotationGlobals, idFactory, collectFields, orphanFields, pageIndex, pageRef]);
  }
  static _create(xref, ref, annotationGlobals, idFactory, collectFields = false, orphanFields = null, pageIndex = null, pageRef = null) {
    const dict = xref.fetchIfRef(ref);
    if (!(dict instanceof Dict)) {
      return undefined;
    }
    const {
      acroForm,
      pdfManager
    } = annotationGlobals;
    const id = ref instanceof Ref ? ref.toString() : `annot_${idFactory.createObjId()}`;
    let subtype = dict.get("Subtype");
    subtype = subtype instanceof Name ? subtype.name : null;
    const parameters = {
      xref,
      ref,
      dict,
      subtype,
      id,
      annotationGlobals,
      collectFields,
      orphanFields,
      needAppearances: !collectFields && acroForm.get("NeedAppearances") === true,
      pageIndex,
      evaluatorOptions: pdfManager.evaluatorOptions,
      pageRef
    };
    switch (subtype) {
      case "Link":
        return new LinkAnnotation(parameters);
      case "Text":
        return new TextAnnotation(parameters);
      case "Widget":
        let fieldType = getInheritableProperty({
          dict,
          key: "FT"
        });
        fieldType = fieldType instanceof Name ? fieldType.name : null;
        switch (fieldType) {
          case "Tx":
            return new TextWidgetAnnotation(parameters);
          case "Btn":
            return new ButtonWidgetAnnotation(parameters);
          case "Ch":
            return new ChoiceWidgetAnnotation(parameters);
          case "Sig":
            return new SignatureWidgetAnnotation(parameters);
        }
        warn(`Unimplemented widget field type "${fieldType}", ` + "falling back to base field type.");
        return new WidgetAnnotation(parameters);
      case "Popup":
        return new PopupAnnotation(parameters);
      case "FreeText":
        return new FreeTextAnnotation(parameters);
      case "Line":
        return new LineAnnotation(parameters);
      case "Square":
        return new SquareAnnotation(parameters);
      case "Circle":
        return new CircleAnnotation(parameters);
      case "PolyLine":
        return new PolylineAnnotation(parameters);
      case "Polygon":
        return new PolygonAnnotation(parameters);
      case "Caret":
        return new CaretAnnotation(parameters);
      case "Ink":
        return new InkAnnotation(parameters);
      case "Highlight":
        return new HighlightAnnotation(parameters);
      case "Underline":
        return new UnderlineAnnotation(parameters);
      case "Squiggly":
        return new SquigglyAnnotation(parameters);
      case "StrikeOut":
        return new StrikeOutAnnotation(parameters);
      case "Stamp":
        return new StampAnnotation(parameters);
      case "FileAttachment":
        return new FileAttachmentAnnotation(parameters);
      default:
        if (!collectFields) {
          if (!subtype) {
            warn("Annotation is missing the required /Subtype.");
          } else {
            warn(`Unimplemented annotation type "${subtype}", ` + "falling back to base annotation.");
          }
        }
        return new Annotation(parameters);
    }
  }
  static async _getPageIndex(xref, ref, pdfManager) {
    try {
      const annotDict = await xref.fetchIfRefAsync(ref);
      if (!(annotDict instanceof Dict)) {
        return -1;
      }
      const pageRef = annotDict.getRaw("P");
      if (pageRef instanceof Ref) {
        try {
          const pageIndex = await pdfManager.ensureCatalog("getPageIndex", [pageRef]);
          return pageIndex;
        } catch (ex) {
          info(`_getPageIndex -- not a valid page reference: "${ex}".`);
        }
      }
      if (annotDict.has("Kids")) {
        return -1;
      }
      const numPages = await pdfManager.ensureDoc("numPages");
      for (let pageIndex = 0; pageIndex < numPages; pageIndex++) {
        const page = await pdfManager.getPage(pageIndex);
        const annotations = await pdfManager.ensure(page, "annotations");
        for (const annotRef of annotations) {
          if (annotRef instanceof Ref && isRefsEqual(annotRef, ref)) {
            return pageIndex;
          }
        }
      }
    } catch (ex) {
      warn(`_getPageIndex: "${ex}".`);
    }
    return -1;
  }
  static generateImages(annotations, xref, isOffscreenCanvasSupported) {
    if (!isOffscreenCanvasSupported) {
      warn("generateImages: OffscreenCanvas is not supported, cannot save or print some annotations with images.");
      return null;
    }
    let imagePromises;
    for (const {
      bitmapId,
      bitmap
    } of annotations) {
      if (!bitmap) {
        continue;
      }
      imagePromises ||= new Map();
      imagePromises.set(bitmapId, StampAnnotation.createImage(bitmap, xref));
    }
    return imagePromises;
  }
  static async saveNewAnnotations(evaluator, task, annotations, imagePromises, changes) {
    const xref = evaluator.xref;
    let baseFontRef;
    const promises = [];
    const {
      isOffscreenCanvasSupported
    } = evaluator.options;
    for (const annotation of annotations) {
      if (annotation.deleted) {
        continue;
      }
      switch (annotation.annotationType) {
        case AnnotationEditorType.FREETEXT:
          if (!baseFontRef) {
            const baseFont = new Dict(xref);
            baseFont.setIfName("BaseFont", "Helvetica");
            baseFont.setIfName("Type", "Font");
            baseFont.setIfName("Subtype", "Type1");
            baseFont.setIfName("Encoding", "WinAnsiEncoding");
            baseFontRef = xref.getNewTemporaryRef();
            changes.put(baseFontRef, {
              data: baseFont
            });
          }
          promises.push(FreeTextAnnotation.createNewAnnotation(xref, annotation, changes, {
            evaluator,
            task,
            baseFontRef
          }));
          break;
        case AnnotationEditorType.HIGHLIGHT:
          if (annotation.quadPoints) {
            promises.push(HighlightAnnotation.createNewAnnotation(xref, annotation, changes));
          } else {
            promises.push(InkAnnotation.createNewAnnotation(xref, annotation, changes));
          }
          break;
        case AnnotationEditorType.INK:
          promises.push(InkAnnotation.createNewAnnotation(xref, annotation, changes));
          break;
        case AnnotationEditorType.STAMP:
          const image = isOffscreenCanvasSupported ? await imagePromises?.get(annotation.bitmapId) : null;
          if (image?.imageStream) {
            const {
              imageStream,
              smaskStream
            } = image;
            if (smaskStream) {
              const smaskRef = xref.getNewTemporaryRef();
              changes.put(smaskRef, {
                data: smaskStream
              });
              imageStream.dict.set("SMask", smaskRef);
            }
            const imageRef = image.imageRef = xref.getNewTemporaryRef();
            changes.put(imageRef, {
              data: imageStream
            });
            image.imageStream = image.smaskStream = null;
          }
          promises.push(StampAnnotation.createNewAnnotation(xref, annotation, changes, {
            image
          }));
          break;
        case AnnotationEditorType.SIGNATURE:
          promises.push(StampAnnotation.createNewAnnotation(xref, annotation, changes, {}));
          break;
      }
    }
    return {
      annotations: (await Promise.all(promises)).flat()
    };
  }
  static async printNewAnnotations(annotationGlobals, evaluator, task, annotations, imagePromises) {
    if (!annotations) {
      return null;
    }
    const {
      options,
      xref
    } = evaluator;
    const promises = [];
    for (const annotation of annotations) {
      if (annotation.deleted) {
        continue;
      }
      switch (annotation.annotationType) {
        case AnnotationEditorType.FREETEXT:
          promises.push(FreeTextAnnotation.createNewPrintAnnotation(annotationGlobals, xref, annotation, {
            evaluator,
            task,
            evaluatorOptions: options
          }));
          break;
        case AnnotationEditorType.HIGHLIGHT:
          if (annotation.quadPoints) {
            promises.push(HighlightAnnotation.createNewPrintAnnotation(annotationGlobals, xref, annotation, {
              evaluatorOptions: options
            }));
          } else {
            promises.push(InkAnnotation.createNewPrintAnnotation(annotationGlobals, xref, annotation, {
              evaluatorOptions: options
            }));
          }
          break;
        case AnnotationEditorType.INK:
          promises.push(InkAnnotation.createNewPrintAnnotation(annotationGlobals, xref, annotation, {
            evaluatorOptions: options
          }));
          break;
        case AnnotationEditorType.STAMP:
          const image = options.isOffscreenCanvasSupported ? await imagePromises?.get(annotation.bitmapId) : null;
          if (image?.imageStream) {
            const {
              imageStream,
              smaskStream
            } = image;
            if (smaskStream) {
              imageStream.dict.set("SMask", smaskStream);
            }
            image.imageRef = new JpegStream(imageStream, imageStream.length);
            image.imageStream = image.smaskStream = null;
          }
          promises.push(StampAnnotation.createNewPrintAnnotation(annotationGlobals, xref, annotation, {
            image,
            evaluatorOptions: options
          }));
          break;
        case AnnotationEditorType.SIGNATURE:
          promises.push(StampAnnotation.createNewPrintAnnotation(annotationGlobals, xref, annotation, {
            evaluatorOptions: options
          }));
          break;
      }
    }
    return Promise.all(promises);
  }
}
function getRgbColor(color, defaultColor = new Uint8ClampedArray(3)) {
  if (!Array.isArray(color)) {
    return defaultColor;
  }
  const rgbColor = defaultColor || new Uint8ClampedArray(3);
  switch (color.length) {
    case 0:
      return null;
    case 1:
      ColorSpaceUtils.gray.getRgbItem(color, 0, rgbColor, 0);
      return rgbColor;
    case 3:
      ColorSpaceUtils.rgb.getRgbItem(color, 0, rgbColor, 0);
      return rgbColor;
    case 4:
      ColorSpaceUtils.cmyk.getRgbItem(color, 0, rgbColor, 0);
      return rgbColor;
    default:
      return defaultColor;
  }
}
function getPdfColorArray(color, defaultValue = null) {
  return color && Array.from(color, c => c / 255) || defaultValue;
}
function getQuadPoints(dict, rect) {
  const quadPoints = dict.getArray("QuadPoints");
  if (!isNumberArray(quadPoints, null) || quadPoints.length === 0 || quadPoints.length % 8 > 0) {
    return null;
  }
  const newQuadPoints = new Float32Array(quadPoints.length);
  for (let i = 0, ii = quadPoints.length; i < ii; i += 8) {
    const [x1, y1, x2, y2, x3, y3, x4, y4] = quadPoints.slice(i, i + 8);
    const minX = Math.min(x1, x2, x3, x4);
    const maxX = Math.max(x1, x2, x3, x4);
    const minY = Math.min(y1, y2, y3, y4);
    const maxY = Math.max(y1, y2, y3, y4);
    if (rect !== null && (minX < rect[0] || maxX > rect[2] || minY < rect[1] || maxY > rect[3])) {
      return null;
    }
    newQuadPoints.set([minX, maxY, maxX, maxY, minX, minY, maxX, minY], i);
  }
  return newQuadPoints;
}
function getTransformMatrix(rect, bbox, matrix) {
  const minMax = new Float32Array([Infinity, Infinity, -Infinity, -Infinity]);
  Util.axialAlignedBoundingBox(bbox, matrix, minMax);
  const [minX, minY, maxX, maxY] = minMax;
  if (minX === maxX || minY === maxY) {
    return [1, 0, 0, 1, rect[0], rect[1]];
  }
  const xRatio = (rect[2] - rect[0]) / (maxX - minX);
  const yRatio = (rect[3] - rect[1]) / (maxY - minY);
  return [xRatio, 0, 0, yRatio, rect[0] - minX * xRatio, rect[1] - minY * yRatio];
}
class Annotation {
  constructor(params) {
    const {
      dict,
      xref,
      annotationGlobals,
      ref,
      orphanFields
    } = params;
    const parentRef = orphanFields?.get(ref);
    if (parentRef) {
      dict.set("Parent", parentRef);
    }
    this.setTitle(dict.get("T"));
    this.setContents(dict.get("Contents"));
    this.setModificationDate(dict.get("M"));
    this.setFlags(dict.get("F"));
    this.setRectangle(dict.getArray("Rect"));
    this.setColor(dict.getArray("C"));
    this.setBorderStyle(dict);
    this.setAppearance(dict);
    this.setOptionalContent(dict);
    const MK = dict.get("MK");
    this.setBorderAndBackgroundColors(MK);
    this.setRotation(MK, dict);
    this.ref = params.ref instanceof Ref ? params.ref : null;
    this._streams = [];
    if (this.appearance) {
      this._streams.push(this.appearance);
    }
    const isLocked = !!(this.flags & AnnotationFlag.LOCKED);
    const isContentLocked = !!(this.flags & AnnotationFlag.LOCKEDCONTENTS);
    this.data = {
      annotationFlags: this.flags,
      borderStyle: this.borderStyle,
      color: this.color,
      backgroundColor: this.backgroundColor,
      borderColor: this.borderColor,
      rotation: this.rotation,
      contentsObj: this._contents,
      hasAppearance: !!this.appearance,
      id: params.id,
      modificationDate: this.modificationDate,
      rect: this.rectangle,
      subtype: params.subtype,
      hasOwnCanvas: false,
      noRotate: !!(this.flags & AnnotationFlag.NOROTATE),
      noHTML: isLocked && isContentLocked,
      isEditable: false,
      structParent: -1,
      isZotero: (dict.get("NM") || '').startsWith('Zotero-') || dict.get("Zotero:Key")
    };
    if (annotationGlobals.structTreeRoot) {
      let structParent = dict.get("StructParent");
      this.data.structParent = structParent = Number.isInteger(structParent) && structParent >= 0 ? structParent : -1;
      annotationGlobals.structTreeRoot.addAnnotationIdToPage(params.pageRef, structParent);
    }
    if (params.collectFields) {
      const kids = dict.get("Kids");
      if (Array.isArray(kids)) {
        const kidIds = [];
        for (const kid of kids) {
          if (kid instanceof Ref) {
            kidIds.push(kid.toString());
          }
        }
        if (kidIds.length !== 0) {
          this.data.kidIds = kidIds;
        }
      }
      this.data.actions = collectActions(xref, dict, AnnotationActionEventType);
      this.data.fieldName = this._constructFieldName(dict);
      this.data.pageIndex = params.pageIndex;
    }
    const it = dict.get("IT");
    if (it instanceof Name) {
      this.data.it = it.name;
    }
    this._isOffscreenCanvasSupported = params.evaluatorOptions.isOffscreenCanvasSupported;
    this._fallbackFontDict = null;
    this._needAppearances = false;
  }
  _hasFlag(flags, flag) {
    return !!(flags & flag);
  }
  _buildFlags(noView, noPrint) {
    let {
      flags
    } = this;
    if (noView === undefined) {
      if (noPrint === undefined) {
        return undefined;
      }
      if (noPrint) {
        return flags & ~AnnotationFlag.PRINT;
      }
      return flags & ~AnnotationFlag.HIDDEN | AnnotationFlag.PRINT;
    }
    if (noView) {
      flags |= AnnotationFlag.PRINT;
      if (noPrint) {
        return flags & ~AnnotationFlag.NOVIEW | AnnotationFlag.HIDDEN;
      }
      return flags & ~AnnotationFlag.HIDDEN | AnnotationFlag.NOVIEW;
    }
    flags &= ~(AnnotationFlag.HIDDEN | AnnotationFlag.NOVIEW);
    if (noPrint) {
      return flags & ~AnnotationFlag.PRINT;
    }
    return flags | AnnotationFlag.PRINT;
  }
  _isViewable(flags) {
    return !this._hasFlag(flags, AnnotationFlag.INVISIBLE) && !this._hasFlag(flags, AnnotationFlag.NOVIEW);
  }
  _isPrintable(flags) {
    return this._hasFlag(flags, AnnotationFlag.PRINT) && !this._hasFlag(flags, AnnotationFlag.HIDDEN) && !this._hasFlag(flags, AnnotationFlag.INVISIBLE);
  }
  mustBeViewed(annotationStorage, _renderForms) {
    const noView = annotationStorage?.get(this.data.id)?.noView;
    if (noView !== undefined) {
      return !noView;
    }
    return this.viewable && !this._hasFlag(this.flags, AnnotationFlag.HIDDEN);
  }
  mustBePrinted(annotationStorage) {
    const noPrint = annotationStorage?.get(this.data.id)?.noPrint;
    if (noPrint !== undefined) {
      return !noPrint;
    }
    return this.printable;
  }
  mustBeViewedWhenEditing(isEditing, modifiedIds = null) {
    return isEditing ? !this.data.isEditable : !modifiedIds?.has(this.data.id);
  }
  get viewable() {
    if (this.data.quadPoints === null) {
      return false;
    }
    if (this.flags === 0) {
      return true;
    }
    return this._isViewable(this.flags);
  }
  get printable() {
    if (this.data.quadPoints === null) {
      return false;
    }
    if (this.flags === 0) {
      return false;
    }
    return this._isPrintable(this.flags);
  }
  _parseStringHelper(data) {
    const str = typeof data === "string" ? stringToPDFString(data) : "";
    const dir = str && bidi(str).dir === "rtl" ? "rtl" : "ltr";
    return {
      str,
      dir
    };
  }
  setDefaultAppearance(params) {
    const {
      dict,
      annotationGlobals
    } = params;
    const defaultAppearance = getInheritableProperty({
      dict,
      key: "DA"
    }) || annotationGlobals.acroForm.get("DA");
    this._defaultAppearance = typeof defaultAppearance === "string" ? defaultAppearance : "";
    this.data.defaultAppearanceData = parseDefaultAppearance(this._defaultAppearance);
  }
  setTitle(title) {
    this._title = this._parseStringHelper(title);
  }
  setContents(contents) {
    this._contents = this._parseStringHelper(contents);
  }
  setModificationDate(modificationDate) {
    this.modificationDate = typeof modificationDate === "string" ? modificationDate : null;
  }
  setFlags(flags) {
    this.flags = Number.isInteger(flags) && flags > 0 ? flags : 0;
    if (this.flags & AnnotationFlag.INVISIBLE && this.constructor.name !== "Annotation") {
      this.flags ^= AnnotationFlag.INVISIBLE;
    }
  }
  hasFlag(flag) {
    return this._hasFlag(this.flags, flag);
  }
  setRectangle(rectangle) {
    this.rectangle = lookupNormalRect(rectangle, [0, 0, 0, 0]);
  }
  setColor(color) {
    this.color = getRgbColor(color);
  }
  setLineEndings(lineEndings) {
    this.lineEndings = ["None", "None"];
    if (Array.isArray(lineEndings) && lineEndings.length === 2) {
      for (let i = 0; i < 2; i++) {
        const obj = lineEndings[i];
        if (obj instanceof Name) {
          switch (obj.name) {
            case "None":
              continue;
            case "Square":
            case "Circle":
            case "Diamond":
            case "OpenArrow":
            case "ClosedArrow":
            case "Butt":
            case "ROpenArrow":
            case "RClosedArrow":
            case "Slash":
              this.lineEndings[i] = obj.name;
              continue;
          }
        }
        warn(`Ignoring invalid lineEnding: ${obj}`);
      }
    }
  }
  setRotation(mk, dict) {
    this.rotation = 0;
    let angle = mk instanceof Dict ? mk.get("R") || 0 : dict.get("Rotate") || 0;
    if (Number.isInteger(angle) && angle !== 0) {
      angle %= 360;
      if (angle < 0) {
        angle += 360;
      }
      if (angle % 90 === 0) {
        this.rotation = angle;
      }
    }
  }
  setBorderAndBackgroundColors(mk) {
    if (mk instanceof Dict) {
      this.borderColor = getRgbColor(mk.getArray("BC"), null);
      this.backgroundColor = getRgbColor(mk.getArray("BG"), null);
    } else {
      this.borderColor = this.backgroundColor = null;
    }
  }
  setBorderStyle(borderStyle) {
    this.borderStyle = new AnnotationBorderStyle();
    if (!(borderStyle instanceof Dict)) {
      return;
    }
    if (borderStyle.has("BS")) {
      const dict = borderStyle.get("BS");
      if (dict instanceof Dict) {
        const dictType = dict.get("Type");
        if (!dictType || isName(dictType, "Border")) {
          this.borderStyle.setWidth(dict.get("W"), this.rectangle);
          this.borderStyle.setStyle(dict.get("S"));
          this.borderStyle.setDashArray(dict.getArray("D"));
        }
      }
    } else if (borderStyle.has("Border")) {
      const array = borderStyle.getArray("Border");
      if (Array.isArray(array) && array.length >= 3) {
        this.borderStyle.setHorizontalCornerRadius(array[0]);
        this.borderStyle.setVerticalCornerRadius(array[1]);
        this.borderStyle.setWidth(array[2], this.rectangle);
        if (array.length === 4) {
          this.borderStyle.setDashArray(array[3], true);
        }
      }
    } else {
      this.borderStyle.setWidth(0);
    }
  }
  setAppearance(dict) {
    this.appearance = null;
    const appearanceStates = dict.get("AP");
    if (!(appearanceStates instanceof Dict)) {
      return;
    }
    const normalAppearanceState = appearanceStates.get("N");
    if (normalAppearanceState instanceof BaseStream) {
      this.appearance = normalAppearanceState;
      return;
    }
    if (!(normalAppearanceState instanceof Dict)) {
      return;
    }
    const as = dict.get("AS");
    if (!(as instanceof Name) || !normalAppearanceState.has(as.name)) {
      return;
    }
    const appearance = normalAppearanceState.get(as.name);
    if (appearance instanceof BaseStream) {
      this.appearance = appearance;
    }
  }
  setOptionalContent(dict) {
    this.oc = null;
    const oc = dict.get("OC");
    if (oc instanceof Name) {
      warn("setOptionalContent: Support for /Name-entry is not implemented.");
    } else if (oc instanceof Dict) {
      this.oc = oc;
    }
  }
  async loadResources(keys, appearance) {
    const resources = await appearance.dict.getAsync("Resources");
    if (resources) {
      await ObjectLoader.load(resources, keys, resources.xref);
    }
    return resources;
  }
  async getOperatorList(evaluator, task, intent, annotationStorage) {
    const {
      hasOwnCanvas,
      id,
      rect
    } = this.data;
    let appearance = this.appearance;
    const isUsingOwnCanvas = !!(hasOwnCanvas && intent & RenderingIntentFlag.DISPLAY);
    if (isUsingOwnCanvas && (this.width === 0 || this.height === 0)) {
      this.data.hasOwnCanvas = false;
      return {
        opList: new OperatorList(),
        separateForm: false,
        separateCanvas: false
      };
    }
    if (!appearance) {
      if (!isUsingOwnCanvas) {
        return {
          opList: new OperatorList(),
          separateForm: false,
          separateCanvas: false
        };
      }
      appearance = new StringStream("");
      appearance.dict = new Dict();
    }
    const appearanceDict = appearance.dict;
    const resources = await this.loadResources(RESOURCES_KEYS_OPERATOR_LIST, appearance);
    const bbox = lookupRect(appearanceDict.getArray("BBox"), [0, 0, 1, 1]);
    const matrix = lookupMatrix(appearanceDict.getArray("Matrix"), IDENTITY_MATRIX);
    const transform = getTransformMatrix(rect, bbox, matrix);
    const opList = new OperatorList();
    let optionalContent;
    if (this.oc) {
      optionalContent = await evaluator.parseMarkedContentProps(this.oc, null);
    }
    if (optionalContent !== undefined) {
      opList.addOp(OPS.beginMarkedContentProps, ["OC", optionalContent]);
    }
    opList.addOp(OPS.beginAnnotation, [id, rect, transform, matrix, isUsingOwnCanvas]);
    await evaluator.getOperatorList({
      stream: appearance,
      task,
      resources,
      operatorList: opList,
      fallbackFontDict: this._fallbackFontDict
    });
    opList.addOp(OPS.endAnnotation, []);
    if (optionalContent !== undefined) {
      opList.addOp(OPS.endMarkedContent, []);
    }
    this.reset();
    return {
      opList,
      separateForm: false,
      separateCanvas: isUsingOwnCanvas
    };
  }
  async save(evaluator, task, annotationStorage, changes) {
    return null;
  }
  get overlaysTextContent() {
    return false;
  }
  get hasTextContent() {
    return false;
  }
  async extractTextContent(evaluator, task, viewBox) {
    if (!this.appearance) {
      return;
    }
    const resources = await this.loadResources(RESOURCES_KEYS_TEXT_CONTENT, this.appearance);
    const text = [];
    const buffer = [];
    let firstPosition = null;
    const sink = {
      desiredSize: Math.Infinity,
      ready: true,
      enqueue(chunk, size) {
        for (const item of chunk.items) {
          if (item.str === undefined) {
            continue;
          }
          firstPosition ||= item.transform.slice(-2);
          buffer.push(item.str);
          if (item.hasEOL) {
            text.push(buffer.join("").trimEnd());
            buffer.length = 0;
          }
        }
      }
    };
    await evaluator.getTextContent({
      stream: this.appearance,
      task,
      resources,
      includeMarkedContent: true,
      keepWhiteSpace: true,
      sink,
      viewBox
    });
    this.reset();
    if (buffer.length) {
      text.push(buffer.join("").trimEnd());
    }
    if (text.length > 1 || text[0]) {
      const appearanceDict = this.appearance.dict;
      const bbox = lookupRect(appearanceDict.getArray("BBox"), null);
      const matrix = lookupMatrix(appearanceDict.getArray("Matrix"), null);
      this.data.textPosition = this._transformPoint(firstPosition, bbox, matrix);
      this.data.textContent = text;
    }
  }
  _transformPoint(coords, bbox, matrix) {
    const {
      rect
    } = this.data;
    bbox ||= [0, 0, 1, 1];
    matrix ||= [1, 0, 0, 1, 0, 0];
    const transform = getTransformMatrix(rect, bbox, matrix);
    transform[4] -= rect[0];
    transform[5] -= rect[1];
    const p = coords.slice();
    Util.applyTransform(p, transform);
    Util.applyTransform(p, matrix);
    return p;
  }
  getFieldObject() {
    if (this.data.kidIds) {
      return {
        id: this.data.id,
        actions: this.data.actions,
        name: this.data.fieldName,
        strokeColor: this.data.borderColor,
        fillColor: this.data.backgroundColor,
        type: "",
        kidIds: this.data.kidIds,
        page: this.data.pageIndex,
        rotation: this.rotation
      };
    }
    return null;
  }
  reset() {
    for (const stream of this._streams) {
      stream.reset();
    }
  }
  _constructFieldName(dict) {
    if (!dict.has("T") && !dict.has("Parent")) {
      warn("Unknown field name, falling back to empty field name.");
      return "";
    }
    if (!dict.has("Parent")) {
      return stringToPDFString(dict.get("T"));
    }
    const fieldName = [];
    if (dict.has("T")) {
      fieldName.unshift(stringToPDFString(dict.get("T")));
    }
    let loopDict = dict;
    const visited = new RefSet();
    if (dict.objId) {
      visited.put(dict.objId);
    }
    while (loopDict.has("Parent")) {
      loopDict = loopDict.get("Parent");
      if (!(loopDict instanceof Dict) || loopDict.objId && visited.has(loopDict.objId)) {
        break;
      }
      if (loopDict.objId) {
        visited.put(loopDict.objId);
      }
      if (loopDict.has("T")) {
        fieldName.unshift(stringToPDFString(loopDict.get("T")));
      }
    }
    return fieldName.join(".");
  }
  get width() {
    return this.data.rect[2] - this.data.rect[0];
  }
  get height() {
    return this.data.rect[3] - this.data.rect[1];
  }
}
class AnnotationBorderStyle {
  constructor() {
    this.width = 1;
    this.rawWidth = 1;
    this.style = AnnotationBorderStyleType.SOLID;
    this.dashArray = [3];
    this.horizontalCornerRadius = 0;
    this.verticalCornerRadius = 0;
  }
  setWidth(width, rect = [0, 0, 0, 0]) {
    if (width instanceof Name) {
      this.width = 0;
      return;
    }
    if (typeof width === "number") {
      if (width > 0) {
        this.rawWidth = width;
        const maxWidth = (rect[2] - rect[0]) / 2;
        const maxHeight = (rect[3] - rect[1]) / 2;
        if (maxWidth > 0 && maxHeight > 0 && (width > maxWidth || width > maxHeight)) {
          warn(`AnnotationBorderStyle.setWidth - ignoring width: ${width}`);
          width = 1;
        }
      }
      this.width = width;
    }
  }
  setStyle(style) {
    if (!(style instanceof Name)) {
      return;
    }
    switch (style.name) {
      case "S":
        this.style = AnnotationBorderStyleType.SOLID;
        break;
      case "D":
        this.style = AnnotationBorderStyleType.DASHED;
        break;
      case "B":
        this.style = AnnotationBorderStyleType.BEVELED;
        break;
      case "I":
        this.style = AnnotationBorderStyleType.INSET;
        break;
      case "U":
        this.style = AnnotationBorderStyleType.UNDERLINE;
        break;
      default:
        break;
    }
  }
  setDashArray(dashArray, forceStyle = false) {
    if (Array.isArray(dashArray)) {
      let isValid = true;
      let allZeros = true;
      for (const element of dashArray) {
        const validNumber = +element >= 0;
        if (!validNumber) {
          isValid = false;
          break;
        } else if (element > 0) {
          allZeros = false;
        }
      }
      if (dashArray.length === 0 || isValid && !allZeros) {
        this.dashArray = dashArray;
        if (forceStyle) {
          this.setStyle(Name.get("D"));
        }
      } else {
        this.width = 0;
      }
    } else if (dashArray) {
      this.width = 0;
    }
  }
  setHorizontalCornerRadius(radius) {
    if (Number.isInteger(radius)) {
      this.horizontalCornerRadius = radius;
    }
  }
  setVerticalCornerRadius(radius) {
    if (Number.isInteger(radius)) {
      this.verticalCornerRadius = radius;
    }
  }
}
class MarkupAnnotation extends Annotation {
  constructor(params) {
    super(params);
    const {
      dict
    } = params;
    if (dict.has("IRT")) {
      const rawIRT = dict.getRaw("IRT");
      this.data.inReplyTo = rawIRT instanceof Ref ? rawIRT.toString() : null;
      const rt = dict.get("RT");
      this.data.replyType = rt instanceof Name ? rt.name : AnnotationReplyType.REPLY;
    }
    let popupRef = null;
    if (this.data.replyType === AnnotationReplyType.GROUP) {
      const parent = dict.get("IRT");
      this.setTitle(parent.get("T"));
      this.data.titleObj = this._title;
      this.setContents(parent.get("Contents"));
      this.data.contentsObj = this._contents;
      if (!parent.has("CreationDate")) {
        this.data.creationDate = null;
      } else {
        this.setCreationDate(parent.get("CreationDate"));
        this.data.creationDate = this.creationDate;
      }
      if (!parent.has("M")) {
        this.data.modificationDate = null;
      } else {
        this.setModificationDate(parent.get("M"));
        this.data.modificationDate = this.modificationDate;
      }
      popupRef = parent.getRaw("Popup");
      if (!parent.has("C")) {
        this.data.color = null;
      } else {
        this.setColor(parent.getArray("C"));
        this.data.color = this.color;
      }
    } else {
      this.data.titleObj = this._title;
      this.setCreationDate(dict.get("CreationDate"));
      this.data.creationDate = this.creationDate;
      popupRef = dict.getRaw("Popup");
      if (!dict.has("C")) {
        this.data.color = null;
      }
    }
    this.data.popupRef = popupRef instanceof Ref ? popupRef.toString() : null;
    if (dict.has("RC")) {
      this.data.richText = XFAFactory.getRichTextAsHtml(dict.get("RC"));
    }
  }
  setCreationDate(creationDate) {
    this.creationDate = typeof creationDate === "string" ? creationDate : null;
  }
  _setDefaultAppearance({
    xref,
    extra,
    strokeColor,
    fillColor,
    blendMode,
    strokeAlpha,
    fillAlpha,
    pointsCallback
  }) {
    const bbox = this.data.rect = [Infinity, Infinity, -Infinity, -Infinity];
    const buffer = ["q"];
    if (extra) {
      buffer.push(extra);
    }
    if (strokeColor) {
      buffer.push(`${strokeColor[0]} ${strokeColor[1]} ${strokeColor[2]} RG`);
    }
    if (fillColor) {
      buffer.push(`${fillColor[0]} ${fillColor[1]} ${fillColor[2]} rg`);
    }
    const pointsArray = this.data.quadPoints || Float32Array.from([this.rectangle[0], this.rectangle[3], this.rectangle[2], this.rectangle[3], this.rectangle[0], this.rectangle[1], this.rectangle[2], this.rectangle[1]]);
    for (let i = 0, ii = pointsArray.length; i < ii; i += 8) {
      const points = pointsCallback(buffer, pointsArray.subarray(i, i + 8));
      Util.rectBoundingBox(...points, bbox);
    }
    buffer.push("Q");
    const formDict = new Dict(xref);
    const appearanceStreamDict = new Dict(xref);
    appearanceStreamDict.setIfName("Subtype", "Form");
    const appearanceStream = new StringStream(buffer.join(" "));
    appearanceStream.dict = appearanceStreamDict;
    formDict.set("Fm0", appearanceStream);
    const gsDict = new Dict(xref);
    if (blendMode) {
      gsDict.setIfName("BM", blendMode);
    }
    gsDict.setIfNumber("CA", strokeAlpha);
    gsDict.setIfNumber("ca", fillAlpha);
    const stateDict = new Dict(xref);
    stateDict.set("GS0", gsDict);
    const resources = new Dict(xref);
    resources.set("ExtGState", stateDict);
    resources.set("XObject", formDict);
    const appearanceDict = new Dict(xref);
    appearanceDict.set("Resources", resources);
    appearanceDict.set("BBox", bbox);
    this.appearance = new StringStream("/GS0 gs /Fm0 Do");
    this.appearance.dict = appearanceDict;
    this._streams.push(this.appearance, appearanceStream);
  }
  static async createNewAnnotation(xref, annotation, changes, params) {
    const annotationRef = annotation.ref ||= xref.getNewTemporaryRef();
    const ap = await this.createNewAppearanceStream(annotation, xref, params);
    let annotationDict;
    if (ap) {
      const apRef = xref.getNewTemporaryRef();
      annotationDict = this.createNewDict(annotation, xref, {
        apRef
      });
      changes.put(apRef, {
        data: ap
      });
    } else {
      annotationDict = this.createNewDict(annotation, xref, {});
    }
    if (Number.isInteger(annotation.parentTreeId)) {
      annotationDict.set("StructParent", annotation.parentTreeId);
    }
    changes.put(annotationRef, {
      data: annotationDict
    });
    const retRef = {
      ref: annotationRef
    };
    if (annotation.popup) {
      const popup = annotation.popup;
      if (popup.deleted) {
        annotationDict.delete("Popup");
        annotationDict.delete("Contents");
        annotationDict.delete("RC");
        return retRef;
      }
      const popupRef = popup.ref ||= xref.getNewTemporaryRef();
      popup.parent = annotationRef;
      const popupDict = PopupAnnotation.createNewDict(popup, xref);
      changes.put(popupRef, {
        data: popupDict
      });
      annotationDict.setIfDefined("Contents", stringToAsciiOrUTF16BE(popup.contents));
      annotationDict.set("Popup", popupRef);
      return [retRef, {
        ref: popupRef
      }];
    }
    return retRef;
  }
  static async createNewPrintAnnotation(annotationGlobals, xref, annotation, params) {
    const ap = await this.createNewAppearanceStream(annotation, xref, params);
    const annotationDict = this.createNewDict(annotation, xref, ap ? {
      ap
    } : {});
    const newAnnotation = new this.prototype.constructor({
      dict: annotationDict,
      xref,
      annotationGlobals,
      evaluatorOptions: params.evaluatorOptions
    });
    if (annotation.ref) {
      newAnnotation.ref = newAnnotation.refToReplace = annotation.ref;
    }
    return newAnnotation;
  }
}
class WidgetAnnotation extends Annotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref,
      annotationGlobals
    } = params;
    const data = this.data;
    this._needAppearances = params.needAppearances;
    data.annotationType = AnnotationType.WIDGET;
    if (data.fieldName === undefined) {
      data.fieldName = this._constructFieldName(dict);
    }
    if (data.actions === undefined) {
      data.actions = collectActions(xref, dict, AnnotationActionEventType);
    }
    let fieldValue = getInheritableProperty({
      dict,
      key: "V",
      getArray: true
    });
    data.fieldValue = this._decodeFormValue(fieldValue);
    const defaultFieldValue = getInheritableProperty({
      dict,
      key: "DV",
      getArray: true
    });
    data.defaultFieldValue = this._decodeFormValue(defaultFieldValue);
    if (fieldValue === undefined && annotationGlobals.xfaDatasets) {
      const path = this._title.str;
      if (path) {
        this._hasValueFromXFA = true;
        data.fieldValue = fieldValue = annotationGlobals.xfaDatasets.getValue(path);
      }
    }
    if (fieldValue === undefined && data.defaultFieldValue !== null) {
      data.fieldValue = data.defaultFieldValue;
    }
    data.alternativeText = stringToPDFString(dict.get("TU") || "");
    this.setDefaultAppearance(params);
    data.hasAppearance ||= this._needAppearances && data.fieldValue !== undefined && data.fieldValue !== null;
    const fieldType = getInheritableProperty({
      dict,
      key: "FT"
    });
    data.fieldType = fieldType instanceof Name ? fieldType.name : null;
    const localResources = getInheritableProperty({
      dict,
      key: "DR"
    });
    const acroFormResources = annotationGlobals.acroForm.get("DR");
    const appearanceResources = this.appearance?.dict.get("Resources");
    this._fieldResources = {
      localResources,
      acroFormResources,
      appearanceResources,
      mergedResources: Dict.merge({
        xref,
        dictArray: [localResources, appearanceResources, acroFormResources],
        mergeSubDicts: true
      })
    };
    data.fieldFlags = getInheritableProperty({
      dict,
      key: "Ff"
    });
    if (!Number.isInteger(data.fieldFlags) || data.fieldFlags < 0) {
      data.fieldFlags = 0;
    }
    data.password = this.hasFieldFlag(AnnotationFieldFlag.PASSWORD);
    data.readOnly = this.hasFieldFlag(AnnotationFieldFlag.READONLY);
    data.required = this.hasFieldFlag(AnnotationFieldFlag.REQUIRED);
    data.hidden = this._hasFlag(data.annotationFlags, AnnotationFlag.HIDDEN) || this._hasFlag(data.annotationFlags, AnnotationFlag.NOVIEW);
  }
  _decodeFormValue(formValue) {
    if (Array.isArray(formValue)) {
      return formValue.filter(item => typeof item === "string").map(item => stringToPDFString(item));
    } else if (formValue instanceof Name) {
      return stringToPDFString(formValue.name);
    } else if (typeof formValue === "string") {
      return stringToPDFString(formValue);
    }
    return null;
  }
  hasFieldFlag(flag) {
    return !!(this.data.fieldFlags & flag);
  }
  _isViewable(flags) {
    return true;
  }
  mustBeViewed(annotationStorage, renderForms) {
    if (renderForms) {
      return this.viewable;
    }
    return super.mustBeViewed(annotationStorage, renderForms) && !this._hasFlag(this.flags, AnnotationFlag.NOVIEW);
  }
  getRotationMatrix(annotationStorage) {
    let rotation = annotationStorage?.get(this.data.id)?.rotation;
    if (rotation === undefined) {
      rotation = this.rotation;
    }
    return rotation === 0 ? IDENTITY_MATRIX : getRotationMatrix(rotation, this.width, this.height);
  }
  getBorderAndBackgroundAppearances(annotationStorage) {
    let rotation = annotationStorage?.get(this.data.id)?.rotation;
    if (rotation === undefined) {
      rotation = this.rotation;
    }
    if (!this.backgroundColor && !this.borderColor) {
      return "";
    }
    const rect = rotation === 0 || rotation === 180 ? `0 0 ${this.width} ${this.height} re` : `0 0 ${this.height} ${this.width} re`;
    let str = "";
    if (this.backgroundColor) {
      str = `${getPdfColor(this.backgroundColor, true)} ${rect} f `;
    }
    if (this.borderColor) {
      const borderWidth = this.borderStyle.width || 1;
      str += `${borderWidth} w ${getPdfColor(this.borderColor, false)} ${rect} S `;
    }
    return str;
  }
  async getOperatorList(evaluator, task, intent, annotationStorage) {
    if (intent & RenderingIntentFlag.ANNOTATIONS_FORMS && !(this instanceof SignatureWidgetAnnotation) && !this.data.noHTML && !this.data.hasOwnCanvas) {
      return {
        opList: new OperatorList(),
        separateForm: true,
        separateCanvas: false
      };
    }
    if (!this._hasText) {
      return super.getOperatorList(evaluator, task, intent, annotationStorage);
    }
    const content = await this._getAppearance(evaluator, task, intent, annotationStorage);
    if (this.appearance && content === null) {
      return super.getOperatorList(evaluator, task, intent, annotationStorage);
    }
    const opList = new OperatorList();
    if (!this._defaultAppearance || content === null) {
      return {
        opList,
        separateForm: false,
        separateCanvas: false
      };
    }
    const isUsingOwnCanvas = !!(this.data.hasOwnCanvas && intent & RenderingIntentFlag.DISPLAY);
    const matrix = [1, 0, 0, 1, 0, 0];
    const bbox = [0, 0, this.width, this.height];
    const transform = getTransformMatrix(this.data.rect, bbox, matrix);
    let optionalContent;
    if (this.oc) {
      optionalContent = await evaluator.parseMarkedContentProps(this.oc, null);
    }
    if (optionalContent !== undefined) {
      opList.addOp(OPS.beginMarkedContentProps, ["OC", optionalContent]);
    }
    opList.addOp(OPS.beginAnnotation, [this.data.id, this.data.rect, transform, this.getRotationMatrix(annotationStorage), isUsingOwnCanvas]);
    const stream = new StringStream(content);
    await evaluator.getOperatorList({
      stream,
      task,
      resources: this._fieldResources.mergedResources,
      operatorList: opList
    });
    opList.addOp(OPS.endAnnotation, []);
    if (optionalContent !== undefined) {
      opList.addOp(OPS.endMarkedContent, []);
    }
    return {
      opList,
      separateForm: false,
      separateCanvas: isUsingOwnCanvas
    };
  }
  _getMKDict(rotation) {
    const mk = new Dict(null);
    if (rotation) {
      mk.set("R", rotation);
    }
    mk.setIfArray("BC", getPdfColorArray(this.borderColor));
    mk.setIfArray("BG", getPdfColorArray(this.backgroundColor));
    return mk.size > 0 ? mk : null;
  }
  amendSavedDict(annotationStorage, dict) {}
  setValue(dict, value, xref, changes) {
    const {
      dict: parentDict,
      ref: parentRef
    } = getParentToUpdate(dict, this.ref, xref);
    if (!parentDict) {
      dict.set("V", value);
    } else if (!changes.has(parentRef)) {
      const newParentDict = parentDict.clone();
      newParentDict.set("V", value);
      changes.put(parentRef, {
        data: newParentDict
      });
      return newParentDict;
    }
    return null;
  }
  async save(evaluator, task, annotationStorage, changes) {
    const storageEntry = annotationStorage?.get(this.data.id);
    const flags = this._buildFlags(storageEntry?.noView, storageEntry?.noPrint);
    let value = storageEntry?.value,
      rotation = storageEntry?.rotation;
    if (value === this.data.fieldValue || value === undefined) {
      if (!this._hasValueFromXFA && rotation === undefined && flags === undefined) {
        return;
      }
      value ||= this.data.fieldValue;
    }
    if (rotation === undefined && !this._hasValueFromXFA && Array.isArray(value) && Array.isArray(this.data.fieldValue) && isArrayEqual(value, this.data.fieldValue) && flags === undefined) {
      return;
    }
    if (rotation === undefined) {
      rotation = this.rotation;
    }
    let appearance = null;
    if (!this._needAppearances) {
      appearance = await this._getAppearance(evaluator, task, RenderingIntentFlag.SAVE, annotationStorage);
      if (appearance === null && flags === undefined) {
        return;
      }
    } else {}
    let needAppearances = false;
    if (appearance?.needAppearances) {
      needAppearances = true;
      appearance = null;
    }
    const {
      xref
    } = evaluator;
    const originalDict = xref.fetchIfRef(this.ref);
    if (!(originalDict instanceof Dict)) {
      return;
    }
    const dict = new Dict(xref);
    for (const key of originalDict.getKeys()) {
      if (key !== "AP") {
        dict.set(key, originalDict.getRaw(key));
      }
    }
    if (flags !== undefined) {
      dict.set("F", flags);
      if (appearance === null && !needAppearances) {
        const ap = originalDict.getRaw("AP");
        if (ap) {
          dict.set("AP", ap);
        }
      }
    }
    const xfa = {
      path: this.data.fieldName,
      value
    };
    const newParentDict = this.setValue(dict, Array.isArray(value) ? value.map(stringToAsciiOrUTF16BE) : stringToAsciiOrUTF16BE(value), xref, changes);
    this.amendSavedDict(annotationStorage, newParentDict || dict);
    const maybeMK = this._getMKDict(rotation);
    if (maybeMK) {
      dict.set("MK", maybeMK);
    }
    changes.put(this.ref, {
      data: dict,
      xfa,
      needAppearances
    });
    if (appearance !== null) {
      const newRef = xref.getNewTemporaryRef();
      const AP = new Dict(xref);
      dict.set("AP", AP);
      AP.set("N", newRef);
      const resources = this._getSaveFieldResources(xref);
      const appearanceStream = new StringStream(appearance);
      const appearanceDict = appearanceStream.dict = new Dict(xref);
      appearanceDict.setIfName("Subtype", "Form");
      appearanceDict.set("Resources", resources);
      const bbox = rotation % 180 === 0 ? [0, 0, this.width, this.height] : [0, 0, this.height, this.width];
      appearanceDict.set("BBox", bbox);
      const rotationMatrix = this.getRotationMatrix(annotationStorage);
      if (rotationMatrix !== IDENTITY_MATRIX) {
        appearanceDict.set("Matrix", rotationMatrix);
      }
      changes.put(newRef, {
        data: appearanceStream,
        xfa: null,
        needAppearances: false
      });
    }
    dict.set("M", `D:${getModificationDate()}`);
  }
  async _getAppearance(evaluator, task, intent, annotationStorage) {
    if (this.data.password) {
      return null;
    }
    const storageEntry = annotationStorage?.get(this.data.id);
    let value, rotation;
    if (storageEntry) {
      value = storageEntry.formattedValue || storageEntry.value;
      rotation = storageEntry.rotation;
    }
    if (rotation === undefined && value === undefined && !this._needAppearances) {
      if (!this._hasValueFromXFA || this.appearance) {
        return null;
      }
    }
    const colors = this.getBorderAndBackgroundAppearances(annotationStorage);
    if (value === undefined) {
      value = this.data.fieldValue;
      if (!value) {
        return `/Tx BMC q ${colors}Q EMC`;
      }
    }
    if (Array.isArray(value) && value.length === 1) {
      value = value[0];
    }
    assert(typeof value === "string", "Expected `value` to be a string.");
    value = value.trimEnd();
    if (this.data.combo) {
      const option = this.data.options.find(({
        exportValue
      }) => value === exportValue);
      value = option?.displayValue || value;
    }
    if (value === "") {
      return `/Tx BMC q ${colors}Q EMC`;
    }
    if (rotation === undefined) {
      rotation = this.rotation;
    }
    let lineCount = -1;
    let lines;
    if (this.data.multiLine) {
      lines = value.split(/\r\n?|\n/).map(line => line.normalize("NFC"));
      lineCount = lines.length;
    } else {
      lines = [value.replace(/\r\n?|\n/, "").normalize("NFC")];
    }
    const defaultPadding = 1;
    const defaultHPadding = 2;
    let {
      width: totalWidth,
      height: totalHeight
    } = this;
    if (rotation === 90 || rotation === 270) {
      [totalWidth, totalHeight] = [totalHeight, totalWidth];
    }
    if (!this._defaultAppearance) {
      this.data.defaultAppearanceData = parseDefaultAppearance(this._defaultAppearance = "/Helvetica 0 Tf 0 g");
    }
    let font = await WidgetAnnotation._getFontData(evaluator, task, this.data.defaultAppearanceData, this._fieldResources.mergedResources);
    let defaultAppearance, fontSize, lineHeight;
    const encodedLines = [];
    let encodingError = false;
    for (const line of lines) {
      const encodedString = font.encodeString(line);
      if (encodedString.length > 1) {
        encodingError = true;
      }
      encodedLines.push(encodedString.join(""));
    }
    if (encodingError && intent & RenderingIntentFlag.SAVE) {
      return {
        needAppearances: true
      };
    }
    if (encodingError && this._isOffscreenCanvasSupported) {
      const fontFamily = this.data.comb ? "monospace" : "sans-serif";
      const fakeUnicodeFont = new FakeUnicodeFont(evaluator.xref, fontFamily);
      const resources = fakeUnicodeFont.createFontResources(lines.join(""));
      const newFont = resources.getRaw("Font");
      if (this._fieldResources.mergedResources.has("Font")) {
        const oldFont = this._fieldResources.mergedResources.get("Font");
        for (const key of newFont.getKeys()) {
          oldFont.set(key, newFont.getRaw(key));
        }
      } else {
        this._fieldResources.mergedResources.set("Font", newFont);
      }
      const fontName = fakeUnicodeFont.fontName.name;
      font = await WidgetAnnotation._getFontData(evaluator, task, {
        fontName,
        fontSize: 0
      }, resources);
      for (let i = 0, ii = encodedLines.length; i < ii; i++) {
        encodedLines[i] = stringToUTF16String(lines[i]);
      }
      const savedDefaultAppearance = Object.assign(Object.create(null), this.data.defaultAppearanceData);
      this.data.defaultAppearanceData.fontSize = 0;
      this.data.defaultAppearanceData.fontName = fontName;
      [defaultAppearance, fontSize, lineHeight] = this._computeFontSize(totalHeight - 2 * defaultPadding, totalWidth - 2 * defaultHPadding, value, font, lineCount);
      this.data.defaultAppearanceData = savedDefaultAppearance;
    } else {
      if (!this._isOffscreenCanvasSupported) {
        warn("_getAppearance: OffscreenCanvas is not supported, annotation may not render correctly.");
      }
      [defaultAppearance, fontSize, lineHeight] = this._computeFontSize(totalHeight - 2 * defaultPadding, totalWidth - 2 * defaultHPadding, value, font, lineCount);
    }
    let descent = font.descent;
    if (isNaN(descent)) {
      descent = BASELINE_FACTOR * lineHeight;
    } else {
      descent = Math.max(BASELINE_FACTOR * lineHeight, Math.abs(descent) * fontSize);
    }
    const defaultVPadding = Math.min(Math.floor((totalHeight - fontSize) / 2), defaultPadding);
    const alignment = this.data.textAlignment;
    if (this.data.multiLine) {
      return this._getMultilineAppearance(defaultAppearance, encodedLines, font, fontSize, totalWidth, totalHeight, alignment, defaultHPadding, defaultVPadding, descent, lineHeight, annotationStorage);
    }
    if (this.data.comb) {
      return this._getCombAppearance(defaultAppearance, font, encodedLines[0], fontSize, totalWidth, totalHeight, defaultHPadding, defaultVPadding, descent, lineHeight, annotationStorage);
    }
    const bottomPadding = defaultVPadding + descent;
    if (alignment === 0 || alignment > 2) {
      return `/Tx BMC q ${colors}BT ` + defaultAppearance + ` 1 0 0 1 ${numberToString(defaultHPadding)} ${numberToString(bottomPadding)} Tm (${escapeString(encodedLines[0])}) Tj` + " ET Q EMC";
    }
    const prevInfo = {
      shift: 0
    };
    const renderedText = this._renderText(encodedLines[0], font, fontSize, totalWidth, alignment, prevInfo, defaultHPadding, bottomPadding);
    return `/Tx BMC q ${colors}BT ` + defaultAppearance + ` 1 0 0 1 0 0 Tm ${renderedText}` + " ET Q EMC";
  }
  static async _getFontData(evaluator, task, appearanceData, resources) {
    const operatorList = new OperatorList();
    const initialState = {
      font: null,
      clone() {
        return this;
      }
    };
    const {
      fontName,
      fontSize
    } = appearanceData;
    await evaluator.handleSetFont(resources, [fontName && Name.get(fontName), fontSize], null, operatorList, task, initialState, null);
    return initialState.font;
  }
  _getTextWidth(text, font) {
    return Math.sumPrecise(font.charsToGlyphs(text).map(g => g.width)) / 1000;
  }
  _computeFontSize(height, width, text, font, lineCount) {
    let {
      fontSize
    } = this.data.defaultAppearanceData;
    let lineHeight = (fontSize || 12) * LINE_FACTOR,
      numberOfLines = Math.round(height / lineHeight);
    if (!fontSize) {
      const roundWithTwoDigits = x => Math.floor(x * 100) / 100;
      if (lineCount === -1) {
        const textWidth = this._getTextWidth(text, font);
        fontSize = roundWithTwoDigits(Math.min(height / LINE_FACTOR, width / textWidth));
        numberOfLines = 1;
      } else {
        const lines = text.split(/\r\n?|\n/);
        const cachedLines = [];
        for (const line of lines) {
          const encoded = font.encodeString(line).join("");
          const glyphs = font.charsToGlyphs(encoded);
          const positions = font.getCharPositions(encoded);
          cachedLines.push({
            line: encoded,
            glyphs,
            positions
          });
        }
        const isTooBig = fsize => {
          let totalHeight = 0;
          for (const cache of cachedLines) {
            const chunks = this._splitLine(null, font, fsize, width, cache);
            totalHeight += chunks.length * fsize;
            if (totalHeight > height) {
              return true;
            }
          }
          return false;
        };
        numberOfLines = Math.max(numberOfLines, lineCount);
        while (true) {
          lineHeight = height / numberOfLines;
          fontSize = roundWithTwoDigits(lineHeight / LINE_FACTOR);
          if (isTooBig(fontSize)) {
            numberOfLines++;
            continue;
          }
          break;
        }
      }
      const {
        fontName,
        fontColor
      } = this.data.defaultAppearanceData;
      this._defaultAppearance = createDefaultAppearance({
        fontSize,
        fontName,
        fontColor
      });
    }
    return [this._defaultAppearance, fontSize, height / numberOfLines];
  }
  _renderText(text, font, fontSize, totalWidth, alignment, prevInfo, hPadding, vPadding) {
    let shift;
    if (alignment === 1) {
      const width = this._getTextWidth(text, font) * fontSize;
      shift = (totalWidth - width) / 2;
    } else if (alignment === 2) {
      const width = this._getTextWidth(text, font) * fontSize;
      shift = totalWidth - width - hPadding;
    } else {
      shift = hPadding;
    }
    const shiftStr = numberToString(shift - prevInfo.shift);
    prevInfo.shift = shift;
    vPadding = numberToString(vPadding);
    return `${shiftStr} ${vPadding} Td (${escapeString(text)}) Tj`;
  }
  _getSaveFieldResources(xref) {
    const {
      localResources,
      appearanceResources,
      acroFormResources
    } = this._fieldResources;
    const fontName = this.data.defaultAppearanceData?.fontName;
    if (!fontName) {
      return localResources || Dict.empty;
    }
    for (const resources of [localResources, appearanceResources]) {
      if (resources instanceof Dict) {
        const localFont = resources.get("Font");
        if (localFont instanceof Dict && localFont.has(fontName)) {
          return resources;
        }
      }
    }
    if (acroFormResources instanceof Dict) {
      const acroFormFont = acroFormResources.get("Font");
      if (acroFormFont instanceof Dict && acroFormFont.has(fontName)) {
        const subFontDict = new Dict(xref);
        subFontDict.set(fontName, acroFormFont.getRaw(fontName));
        const subResourcesDict = new Dict(xref);
        subResourcesDict.set("Font", subFontDict);
        return Dict.merge({
          xref,
          dictArray: [subResourcesDict, localResources],
          mergeSubDicts: true
        });
      }
    }
    return localResources || Dict.empty;
  }
  getFieldObject() {
    return null;
  }
}
class TextWidgetAnnotation extends WidgetAnnotation {
  constructor(params) {
    super(params);
    const {
      dict
    } = params;
    if (dict.has("PMD")) {
      this.flags |= AnnotationFlag.HIDDEN;
      this.data.hidden = true;
      warn("Barcodes are not supported");
    }
    this.data.hasOwnCanvas = this.data.readOnly && !this.data.noHTML;
    this._hasText = true;
    if (typeof this.data.fieldValue !== "string") {
      this.data.fieldValue = "";
    }
    let alignment = getInheritableProperty({
      dict,
      key: "Q"
    });
    if (!Number.isInteger(alignment) || alignment < 0 || alignment > 2) {
      alignment = null;
    }
    this.data.textAlignment = alignment;
    let maximumLength = getInheritableProperty({
      dict,
      key: "MaxLen"
    });
    if (!Number.isInteger(maximumLength) || maximumLength < 0) {
      maximumLength = 0;
    }
    this.data.maxLen = maximumLength;
    this.data.multiLine = this.hasFieldFlag(AnnotationFieldFlag.MULTILINE);
    this.data.comb = this.hasFieldFlag(AnnotationFieldFlag.COMB) && !this.data.multiLine && !this.data.password && !this.hasFieldFlag(AnnotationFieldFlag.FILESELECT) && this.data.maxLen !== 0;
    this.data.doNotScroll = this.hasFieldFlag(AnnotationFieldFlag.DONOTSCROLL);
    const {
      data: {
        actions
      }
    } = this;
    if (!actions) {
      return;
    }
    const AFDateTime = /^AF(Date|Time)_(?:Keystroke|Format)(?:Ex)?\(['"]?([^'"]+)['"]?\);$/;
    let canUseHTMLDateTime = false;
    if (actions.Format?.length === 1 && actions.Keystroke?.length === 1 && AFDateTime.test(actions.Format[0]) && AFDateTime.test(actions.Keystroke[0]) || actions.Format?.length === 0 && actions.Keystroke?.length === 1 && AFDateTime.test(actions.Keystroke[0]) || actions.Keystroke?.length === 0 && actions.Format?.length === 1 && AFDateTime.test(actions.Format[0])) {
      canUseHTMLDateTime = true;
    }
    const actionsToVisit = [];
    if (actions.Format) {
      actionsToVisit.push(...actions.Format);
    }
    if (actions.Keystroke) {
      actionsToVisit.push(...actions.Keystroke);
    }
    if (canUseHTMLDateTime) {
      delete actions.Keystroke;
      actions.Format = actionsToVisit;
    }
    for (const formatAction of actionsToVisit) {
      const m = formatAction.match(AFDateTime);
      if (!m) {
        continue;
      }
      const isDate = m[1] === "Date";
      let format = m[2];
      const num = parseInt(format, 10);
      if (!isNaN(num) && Math.floor(Math.log10(num)) + 1 === m[2].length) {
        format = (isDate ? DateFormats : TimeFormats)[num] ?? format;
      }
      this.data.datetimeFormat = format;
      if (!canUseHTMLDateTime) {
        break;
      }
      if (isDate) {
        if (/HH|MM|ss|h/.test(format)) {
          this.data.datetimeType = "datetime-local";
          this.data.timeStep = /ss/.test(format) ? 1 : 60;
        } else {
          this.data.datetimeType = "date";
        }
        break;
      }
      this.data.datetimeType = "time";
      this.data.timeStep = /ss/.test(format) ? 1 : 60;
      break;
    }
  }
  get hasTextContent() {
    return !!this.appearance && !this._needAppearances;
  }
  _getCombAppearance(defaultAppearance, font, text, fontSize, width, height, hPadding, vPadding, descent, lineHeight, annotationStorage) {
    const combWidth = width / this.data.maxLen;
    const colors = this.getBorderAndBackgroundAppearances(annotationStorage);
    const buf = [];
    const positions = font.getCharPositions(text);
    for (const [start, end] of positions) {
      buf.push(`(${escapeString(text.substring(start, end))}) Tj`);
    }
    const renderedComb = buf.join(` ${numberToString(combWidth)} 0 Td `);
    return `/Tx BMC q ${colors}BT ` + defaultAppearance + ` 1 0 0 1 ${numberToString(hPadding)} ${numberToString(vPadding + descent)} Tm ${renderedComb}` + " ET Q EMC";
  }
  _getMultilineAppearance(defaultAppearance, lines, font, fontSize, width, height, alignment, hPadding, vPadding, descent, lineHeight, annotationStorage) {
    const buf = [];
    const totalWidth = width - 2 * hPadding;
    const prevInfo = {
      shift: 0
    };
    for (let i = 0, ii = lines.length; i < ii; i++) {
      const line = lines[i];
      const chunks = this._splitLine(line, font, fontSize, totalWidth);
      for (let j = 0, jj = chunks.length; j < jj; j++) {
        const chunk = chunks[j];
        const vShift = i === 0 && j === 0 ? -vPadding - (lineHeight - descent) : -lineHeight;
        buf.push(this._renderText(chunk, font, fontSize, width, alignment, prevInfo, hPadding, vShift));
      }
    }
    const colors = this.getBorderAndBackgroundAppearances(annotationStorage);
    const renderedText = buf.join("\n");
    return `/Tx BMC q ${colors}BT ` + defaultAppearance + ` 1 0 0 1 0 ${numberToString(height)} Tm ${renderedText}` + " ET Q EMC";
  }
  _splitLine(line, font, fontSize, width, cache = {}) {
    line = cache.line || line;
    const glyphs = cache.glyphs || font.charsToGlyphs(line);
    if (glyphs.length <= 1) {
      return [line];
    }
    const positions = cache.positions || font.getCharPositions(line);
    const scale = fontSize / 1000;
    const chunks = [];
    let lastSpacePosInStringStart = -1,
      lastSpacePosInStringEnd = -1,
      lastSpacePos = -1,
      startChunk = 0,
      currentWidth = 0;
    for (let i = 0, ii = glyphs.length; i < ii; i++) {
      const [start, end] = positions[i];
      const glyph = glyphs[i];
      const glyphWidth = glyph.width * scale;
      if (glyph.unicode === " ") {
        if (currentWidth + glyphWidth > width) {
          chunks.push(line.substring(startChunk, start));
          startChunk = start;
          currentWidth = glyphWidth;
          lastSpacePosInStringStart = -1;
          lastSpacePos = -1;
        } else {
          currentWidth += glyphWidth;
          lastSpacePosInStringStart = start;
          lastSpacePosInStringEnd = end;
          lastSpacePos = i;
        }
      } else if (currentWidth + glyphWidth > width) {
        if (lastSpacePosInStringStart !== -1) {
          chunks.push(line.substring(startChunk, lastSpacePosInStringEnd));
          startChunk = lastSpacePosInStringEnd;
          i = lastSpacePos + 1;
          lastSpacePosInStringStart = -1;
          currentWidth = 0;
        } else {
          chunks.push(line.substring(startChunk, start));
          startChunk = start;
          currentWidth = glyphWidth;
        }
      } else {
        currentWidth += glyphWidth;
      }
    }
    if (startChunk < line.length) {
      chunks.push(line.substring(startChunk, line.length));
    }
    return chunks;
  }
  async extractTextContent(evaluator, task, viewBox) {
    await super.extractTextContent(evaluator, task, viewBox);
    const text = this.data.textContent;
    if (!text) {
      return;
    }
    const allText = text.join("\n");
    if (allText === this.data.fieldValue) {
      return;
    }
    const regex = allText.replaceAll(/([.*+?^${}()|[\]\\])|(\s+)/g, (_m, p1) => p1 ? `\\${p1}` : "\\s+");
    if (new RegExp(`^\\s*${regex}\\s*$`).test(this.data.fieldValue)) {
      this.data.textContent = this.data.fieldValue.split("\n");
    }
  }
  getFieldObject() {
    return {
      id: this.data.id,
      value: this.data.fieldValue,
      defaultValue: this.data.defaultFieldValue || "",
      multiline: this.data.multiLine,
      password: this.data.password,
      charLimit: this.data.maxLen,
      comb: this.data.comb,
      editable: !this.data.readOnly,
      hidden: this.data.hidden,
      name: this.data.fieldName,
      rect: this.data.rect,
      actions: this.data.actions,
      page: this.data.pageIndex,
      strokeColor: this.data.borderColor,
      fillColor: this.data.backgroundColor,
      rotation: this.rotation,
      datetimeFormat: this.data.datetimeFormat,
      hasDatetimeHTML: !!this.data.datetimeType,
      type: "text"
    };
  }
}
class ButtonWidgetAnnotation extends WidgetAnnotation {
  constructor(params) {
    super(params);
    this.checkedAppearance = null;
    this.uncheckedAppearance = null;
    const isRadio = this.hasFieldFlag(AnnotationFieldFlag.RADIO),
      isPushButton = this.hasFieldFlag(AnnotationFieldFlag.PUSHBUTTON);
    this.data.checkBox = !isRadio && !isPushButton;
    this.data.radioButton = isRadio && !isPushButton;
    this.data.pushButton = isPushButton;
    this.data.isTooltipOnly = false;
    if (this.data.checkBox) {
      this._processCheckBox(params);
    } else if (this.data.radioButton) {
      this._processRadioButton(params);
    } else if (this.data.pushButton) {
      this.data.hasOwnCanvas = true;
      this.data.noHTML = false;
      this._processPushButton(params);
    } else {
      warn("Invalid field flags for button widget annotation");
    }
  }
  async getOperatorList(evaluator, task, intent, annotationStorage) {
    if (this.data.pushButton) {
      return super.getOperatorList(evaluator, task, intent, false, annotationStorage);
    }
    let value = null;
    let rotation = null;
    if (annotationStorage) {
      const storageEntry = annotationStorage.get(this.data.id);
      value = storageEntry ? storageEntry.value : null;
      rotation = storageEntry ? storageEntry.rotation : null;
    }
    if (value === null && this.appearance) {
      return super.getOperatorList(evaluator, task, intent, annotationStorage);
    }
    if (value === null || value === undefined) {
      value = this.data.checkBox ? this.data.fieldValue === this.data.exportValue : this.data.fieldValue === this.data.buttonValue;
    }
    const appearance = value ? this.checkedAppearance : this.uncheckedAppearance;
    if (appearance) {
      const savedAppearance = this.appearance;
      const savedMatrix = lookupMatrix(appearance.dict.getArray("Matrix"), IDENTITY_MATRIX);
      if (rotation) {
        appearance.dict.set("Matrix", this.getRotationMatrix(annotationStorage));
      }
      this.appearance = appearance;
      const operatorList = super.getOperatorList(evaluator, task, intent, annotationStorage);
      this.appearance = savedAppearance;
      appearance.dict.set("Matrix", savedMatrix);
      return operatorList;
    }
    return {
      opList: new OperatorList(),
      separateForm: false,
      separateCanvas: false
    };
  }
  async save(evaluator, task, annotationStorage, changes) {
    if (this.data.checkBox) {
      this._saveCheckbox(evaluator, task, annotationStorage, changes);
      return;
    }
    if (this.data.radioButton) {
      this._saveRadioButton(evaluator, task, annotationStorage, changes);
    }
  }
  async _saveCheckbox(evaluator, task, annotationStorage, changes) {
    if (!annotationStorage) {
      return;
    }
    const storageEntry = annotationStorage.get(this.data.id);
    const flags = this._buildFlags(storageEntry?.noView, storageEntry?.noPrint);
    let rotation = storageEntry?.rotation,
      value = storageEntry?.value;
    if (rotation === undefined && flags === undefined) {
      if (value === undefined) {
        return;
      }
      const defaultValue = this.data.fieldValue === this.data.exportValue;
      if (defaultValue === value) {
        return;
      }
    }
    let dict = evaluator.xref.fetchIfRef(this.ref);
    if (!(dict instanceof Dict)) {
      return;
    }
    dict = dict.clone();
    if (rotation === undefined) {
      rotation = this.rotation;
    }
    if (value === undefined) {
      value = this.data.fieldValue === this.data.exportValue;
    }
    const xfa = {
      path: this.data.fieldName,
      value: value ? this.data.exportValue : ""
    };
    const name = Name.get(value ? this.data.exportValue : "Off");
    this.setValue(dict, name, evaluator.xref, changes);
    dict.set("AS", name);
    dict.set("M", `D:${getModificationDate()}`);
    if (flags !== undefined) {
      dict.set("F", flags);
    }
    const maybeMK = this._getMKDict(rotation);
    if (maybeMK) {
      dict.set("MK", maybeMK);
    }
    changes.put(this.ref, {
      data: dict,
      xfa,
      needAppearances: false
    });
  }
  async _saveRadioButton(evaluator, task, annotationStorage, changes) {
    if (!annotationStorage) {
      return;
    }
    const storageEntry = annotationStorage.get(this.data.id);
    const flags = this._buildFlags(storageEntry?.noView, storageEntry?.noPrint);
    let rotation = storageEntry?.rotation,
      value = storageEntry?.value;
    if (rotation === undefined && flags === undefined) {
      if (value === undefined) {
        return;
      }
      const defaultValue = this.data.fieldValue === this.data.buttonValue;
      if (defaultValue === value) {
        return;
      }
    }
    let dict = evaluator.xref.fetchIfRef(this.ref);
    if (!(dict instanceof Dict)) {
      return;
    }
    dict = dict.clone();
    if (value === undefined) {
      value = this.data.fieldValue === this.data.buttonValue;
    }
    if (rotation === undefined) {
      rotation = this.rotation;
    }
    const xfa = {
      path: this.data.fieldName,
      value: value ? this.data.buttonValue : ""
    };
    const name = Name.get(value ? this.data.buttonValue : "Off");
    if (value) {
      this.setValue(dict, name, evaluator.xref, changes);
    }
    dict.set("AS", name);
    dict.set("M", `D:${getModificationDate()}`);
    if (flags !== undefined) {
      dict.set("F", flags);
    }
    const maybeMK = this._getMKDict(rotation);
    if (maybeMK) {
      dict.set("MK", maybeMK);
    }
    changes.put(this.ref, {
      data: dict,
      xfa,
      needAppearances: false
    });
  }
  _getDefaultCheckedAppearance(params, type) {
    const {
      width,
      height
    } = this;
    const bbox = [0, 0, width, height];
    const FONT_RATIO = 0.8;
    const fontSize = Math.min(width, height) * FONT_RATIO;
    let metrics, char;
    if (type === "check") {
      metrics = {
        width: 0.755 * fontSize,
        height: 0.705 * fontSize
      };
      char = "\x33";
    } else if (type === "disc") {
      metrics = {
        width: 0.791 * fontSize,
        height: 0.705 * fontSize
      };
      char = "\x6C";
    } else {
      unreachable(`_getDefaultCheckedAppearance - unsupported type: ${type}`);
    }
    const xShift = numberToString((width - metrics.width) / 2);
    const yShift = numberToString((height - metrics.height) / 2);
    const appearance = `q BT /PdfJsZaDb ${fontSize} Tf 0 g ${xShift} ${yShift} Td (${char}) Tj ET Q`;
    const appearanceStreamDict = new Dict(params.xref);
    appearanceStreamDict.set("FormType", 1);
    appearanceStreamDict.setIfName("Subtype", "Form");
    appearanceStreamDict.setIfName("Type", "XObject");
    appearanceStreamDict.set("BBox", bbox);
    appearanceStreamDict.set("Matrix", [1, 0, 0, 1, 0, 0]);
    appearanceStreamDict.set("Length", appearance.length);
    const resources = new Dict(params.xref);
    const font = new Dict(params.xref);
    font.set("PdfJsZaDb", this.fallbackFontDict);
    resources.set("Font", font);
    appearanceStreamDict.set("Resources", resources);
    this.checkedAppearance = new StringStream(appearance);
    this.checkedAppearance.dict = appearanceStreamDict;
    this._streams.push(this.checkedAppearance);
  }
  _processCheckBox(params) {
    const customAppearance = params.dict.get("AP");
    if (!(customAppearance instanceof Dict)) {
      return;
    }
    const normalAppearance = customAppearance.get("N");
    if (!(normalAppearance instanceof Dict)) {
      return;
    }
    const asValue = this._decodeFormValue(params.dict.get("AS"));
    if (typeof asValue === "string") {
      this.data.fieldValue = asValue;
    }
    const yes = this.data.fieldValue !== null && this.data.fieldValue !== "Off" ? this.data.fieldValue : "Yes";
    const exportValues = this._decodeFormValue(normalAppearance.getKeys());
    if (exportValues.length === 0) {
      exportValues.push("Off", yes);
    } else if (exportValues.length === 1) {
      if (exportValues[0] === "Off") {
        exportValues.push(yes);
      } else {
        exportValues.unshift("Off");
      }
    } else if (exportValues.includes(yes)) {
      exportValues.length = 0;
      exportValues.push("Off", yes);
    } else {
      const otherYes = exportValues.find(v => v !== "Off");
      exportValues.length = 0;
      exportValues.push("Off", otherYes);
    }
    if (!exportValues.includes(this.data.fieldValue)) {
      this.data.fieldValue = "Off";
    }
    this.data.exportValue = exportValues[1];
    const checkedAppearance = normalAppearance.get(this.data.exportValue);
    this.checkedAppearance = checkedAppearance instanceof BaseStream ? checkedAppearance : null;
    const uncheckedAppearance = normalAppearance.get("Off");
    this.uncheckedAppearance = uncheckedAppearance instanceof BaseStream ? uncheckedAppearance : null;
    if (this.checkedAppearance) {
      this._streams.push(this.checkedAppearance);
    } else {
      this._getDefaultCheckedAppearance(params, "check");
    }
    if (this.uncheckedAppearance) {
      this._streams.push(this.uncheckedAppearance);
    }
    this._fallbackFontDict = this.fallbackFontDict;
    if (this.data.defaultFieldValue === null) {
      this.data.defaultFieldValue = "Off";
    }
  }
  _processRadioButton(params) {
    this.data.buttonValue = null;
    const fieldParent = params.dict.get("Parent");
    if (fieldParent instanceof Dict) {
      this.parent = params.dict.getRaw("Parent");
      const fieldParentValue = fieldParent.get("V");
      if (fieldParentValue instanceof Name) {
        this.data.fieldValue = this._decodeFormValue(fieldParentValue);
      }
    }
    const appearanceStates = params.dict.get("AP");
    if (!(appearanceStates instanceof Dict)) {
      return;
    }
    const normalAppearance = appearanceStates.get("N");
    if (!(normalAppearance instanceof Dict)) {
      return;
    }
    for (const key of normalAppearance.getKeys()) {
      if (key !== "Off") {
        this.data.buttonValue = this._decodeFormValue(key);
        break;
      }
    }
    const checkedAppearance = normalAppearance.get(this.data.buttonValue);
    this.checkedAppearance = checkedAppearance instanceof BaseStream ? checkedAppearance : null;
    const uncheckedAppearance = normalAppearance.get("Off");
    this.uncheckedAppearance = uncheckedAppearance instanceof BaseStream ? uncheckedAppearance : null;
    if (this.checkedAppearance) {
      this._streams.push(this.checkedAppearance);
    } else {
      this._getDefaultCheckedAppearance(params, "disc");
    }
    if (this.uncheckedAppearance) {
      this._streams.push(this.uncheckedAppearance);
    }
    this._fallbackFontDict = this.fallbackFontDict;
    if (this.data.defaultFieldValue === null) {
      this.data.defaultFieldValue = "Off";
    }
  }
  _processPushButton(params) {
    const {
      dict,
      annotationGlobals
    } = params;
    if (!dict.has("A") && !dict.has("AA") && !this.data.alternativeText) {
      warn("Push buttons without action dictionaries are not supported");
      return;
    }
    this.data.isTooltipOnly = !dict.has("A") && !dict.has("AA");
    Catalog.parseDestDictionary({
      destDict: dict,
      resultObj: this.data,
      docBaseUrl: annotationGlobals.baseUrl,
      docAttachments: annotationGlobals.attachments
    });
  }
  getFieldObject() {
    let type = "button";
    let exportValues;
    if (this.data.checkBox) {
      type = "checkbox";
      exportValues = this.data.exportValue;
    } else if (this.data.radioButton) {
      type = "radiobutton";
      exportValues = this.data.buttonValue;
    }
    return {
      id: this.data.id,
      value: this.data.fieldValue || "Off",
      defaultValue: this.data.defaultFieldValue,
      exportValues,
      editable: !this.data.readOnly,
      name: this.data.fieldName,
      rect: this.data.rect,
      hidden: this.data.hidden,
      actions: this.data.actions,
      page: this.data.pageIndex,
      strokeColor: this.data.borderColor,
      fillColor: this.data.backgroundColor,
      rotation: this.rotation,
      type
    };
  }
  get fallbackFontDict() {
    const dict = new Dict();
    dict.setIfName("BaseFont", "ZapfDingbats");
    dict.setIfName("Type", "FallbackType");
    dict.setIfName("Subtype", "FallbackType");
    dict.setIfName("Encoding", "ZapfDingbatsEncoding");
    return shadow(this, "fallbackFontDict", dict);
  }
}
class ChoiceWidgetAnnotation extends WidgetAnnotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref
    } = params;
    this.indices = dict.getArray("I");
    this.hasIndices = Array.isArray(this.indices) && this.indices.length > 0;
    this.data.options = [];
    const options = getInheritableProperty({
      dict,
      key: "Opt"
    });
    if (Array.isArray(options)) {
      for (let i = 0, ii = options.length; i < ii; i++) {
        const option = xref.fetchIfRef(options[i]);
        const isOptionArray = Array.isArray(option);
        this.data.options[i] = {
          exportValue: this._decodeFormValue(isOptionArray ? xref.fetchIfRef(option[0]) : option),
          displayValue: this._decodeFormValue(isOptionArray ? xref.fetchIfRef(option[1]) : option)
        };
      }
    }
    if (!this.hasIndices) {
      if (typeof this.data.fieldValue === "string") {
        this.data.fieldValue = [this.data.fieldValue];
      } else {
        this.data.fieldValue ||= [];
      }
    } else {
      this.data.fieldValue = [];
      const ii = this.data.options.length;
      for (const i of this.indices) {
        if (Number.isInteger(i) && i >= 0 && i < ii) {
          this.data.fieldValue.push(this.data.options[i].exportValue);
        }
      }
    }
    if (this.data.options.length === 0 && this.data.fieldValue.length > 0) {
      this.data.options = this.data.fieldValue.map(value => ({
        exportValue: value,
        displayValue: value
      }));
    }
    this.data.combo = this.hasFieldFlag(AnnotationFieldFlag.COMBO);
    this.data.multiSelect = this.hasFieldFlag(AnnotationFieldFlag.MULTISELECT);
    this._hasText = true;
  }
  getFieldObject() {
    const type = this.data.combo ? "combobox" : "listbox";
    const value = this.data.fieldValue.length > 0 ? this.data.fieldValue[0] : null;
    return {
      id: this.data.id,
      value,
      defaultValue: this.data.defaultFieldValue,
      editable: !this.data.readOnly,
      name: this.data.fieldName,
      rect: this.data.rect,
      numItems: this.data.fieldValue.length,
      multipleSelection: this.data.multiSelect,
      hidden: this.data.hidden,
      actions: this.data.actions,
      items: this.data.options,
      page: this.data.pageIndex,
      strokeColor: this.data.borderColor,
      fillColor: this.data.backgroundColor,
      rotation: this.rotation,
      type
    };
  }
  amendSavedDict(annotationStorage, dict) {
    if (!this.hasIndices) {
      return;
    }
    let values = annotationStorage?.get(this.data.id)?.value;
    if (!Array.isArray(values)) {
      values = [values];
    }
    const indices = [];
    const {
      options
    } = this.data;
    for (let i = 0, j = 0, ii = options.length; i < ii; i++) {
      if (options[i].exportValue === values[j]) {
        indices.push(i);
        j += 1;
      }
    }
    dict.set("I", indices);
  }
  async _getAppearance(evaluator, task, intent, annotationStorage) {
    if (this.data.combo) {
      return super._getAppearance(evaluator, task, intent, annotationStorage);
    }
    let exportedValue, rotation;
    const storageEntry = annotationStorage?.get(this.data.id);
    if (storageEntry) {
      rotation = storageEntry.rotation;
      exportedValue = storageEntry.value;
    }
    if (rotation === undefined && exportedValue === undefined && !this._needAppearances) {
      return null;
    }
    if (exportedValue === undefined) {
      exportedValue = this.data.fieldValue;
    } else if (!Array.isArray(exportedValue)) {
      exportedValue = [exportedValue];
    }
    const defaultPadding = 1;
    const defaultHPadding = 2;
    let {
      width: totalWidth,
      height: totalHeight
    } = this;
    if (rotation === 90 || rotation === 270) {
      [totalWidth, totalHeight] = [totalHeight, totalWidth];
    }
    const lineCount = this.data.options.length;
    const valueIndices = [];
    for (let i = 0; i < lineCount; i++) {
      const {
        exportValue
      } = this.data.options[i];
      if (exportedValue.includes(exportValue)) {
        valueIndices.push(i);
      }
    }
    if (!this._defaultAppearance) {
      this.data.defaultAppearanceData = parseDefaultAppearance(this._defaultAppearance = "/Helvetica 0 Tf 0 g");
    }
    const font = await WidgetAnnotation._getFontData(evaluator, task, this.data.defaultAppearanceData, this._fieldResources.mergedResources);
    let defaultAppearance;
    let {
      fontSize
    } = this.data.defaultAppearanceData;
    if (!fontSize) {
      const lineHeight = (totalHeight - defaultPadding) / lineCount;
      let lineWidth = -1;
      let value;
      for (const {
        displayValue
      } of this.data.options) {
        const width = this._getTextWidth(displayValue, font);
        if (width > lineWidth) {
          lineWidth = width;
          value = displayValue;
        }
      }
      [defaultAppearance, fontSize] = this._computeFontSize(lineHeight, totalWidth - 2 * defaultHPadding, value, font, -1);
    } else {
      defaultAppearance = this._defaultAppearance;
    }
    const lineHeight = fontSize * LINE_FACTOR;
    const vPadding = (lineHeight - fontSize) / 2;
    const numberOfVisibleLines = Math.floor(totalHeight / lineHeight);
    let firstIndex = 0;
    if (valueIndices.length > 0) {
      const minIndex = Math.min(...valueIndices);
      const maxIndex = Math.max(...valueIndices);
      firstIndex = Math.max(0, maxIndex - numberOfVisibleLines + 1);
      if (firstIndex > minIndex) {
        firstIndex = minIndex;
      }
    }
    const end = Math.min(firstIndex + numberOfVisibleLines + 1, lineCount);
    const buf = ["/Tx BMC q", `1 1 ${totalWidth} ${totalHeight} re W n`];
    if (valueIndices.length) {
      buf.push("0.600006 0.756866 0.854904 rg");
      for (const index of valueIndices) {
        if (firstIndex <= index && index < end) {
          buf.push(`1 ${totalHeight - (index - firstIndex + 1) * lineHeight} ${totalWidth} ${lineHeight} re f`);
        }
      }
    }
    buf.push("BT", defaultAppearance, `1 0 0 1 0 ${totalHeight} Tm`);
    const prevInfo = {
      shift: 0
    };
    for (let i = firstIndex; i < end; i++) {
      const {
        displayValue
      } = this.data.options[i];
      const vpadding = i === firstIndex ? vPadding : 0;
      buf.push(this._renderText(displayValue, font, fontSize, totalWidth, 0, prevInfo, defaultHPadding, -lineHeight + vpadding));
    }
    buf.push("ET Q EMC");
    return buf.join("\n");
  }
}
class SignatureWidgetAnnotation extends WidgetAnnotation {
  constructor(params) {
    super(params);
    this.data.fieldValue = null;
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.noHTML = !this.data.hasOwnCanvas;
  }
  getFieldObject() {
    return {
      id: this.data.id,
      value: null,
      page: this.data.pageIndex,
      type: "signature"
    };
  }
}
class TextAnnotation extends MarkupAnnotation {
  constructor(params) {
    const DEFAULT_ICON_SIZE = 22;
    super(params);
    this.data.noRotate = true;
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.noHTML = false;
    const {
      dict
    } = params;
    this.data.annotationType = AnnotationType.TEXT;
    if (this.data.hasAppearance) {
      this.data.name = "NoIcon";
    } else {
      this.data.rect[1] = this.data.rect[3] - DEFAULT_ICON_SIZE;
      this.data.rect[2] = this.data.rect[0] + DEFAULT_ICON_SIZE;
      this.data.name = dict.has("Name") ? dict.get("Name").name : "Note";
    }
    if (dict.has("State")) {
      this.data.state = dict.get("State") || null;
      this.data.stateModel = dict.get("StateModel") || null;
    } else {
      this.data.state = null;
      this.data.stateModel = null;
    }
  }
}
class LinkAnnotation extends Annotation {
  constructor(params) {
    super(params);
    const {
      dict,
      annotationGlobals
    } = params;
    this.data.annotationType = AnnotationType.LINK;
    this.data.noHTML = false;
    const quadPoints = getQuadPoints(dict, this.rectangle);
    if (quadPoints) {
      this.data.quadPoints = quadPoints;
    }
    this.data.borderColor ||= this.data.color;
    Catalog.parseDestDictionary({
      destDict: dict,
      resultObj: this.data,
      docBaseUrl: annotationGlobals.baseUrl,
      docAttachments: annotationGlobals.attachments
    });
  }
  get overlaysTextContent() {
    return true;
  }
}
class PopupAnnotation extends Annotation {
  constructor(params) {
    super(params);
    const {
      dict
    } = params;
    this.data.annotationType = AnnotationType.POPUP;
    this.data.noHTML = false;
    if (this.width === 0 || this.height === 0) {
      this.data.rect = null;
    }
    let parentItem = dict.get("Parent");
    if (!parentItem) {
      warn("Popup annotation has a missing or invalid parent annotation.");
      return;
    }
    this.data.parentRect = lookupNormalRect(parentItem.getArray("Rect"), null);
    this.data.creationDate = parentItem.get("CreationDate") || "";
    const rt = parentItem.get("RT");
    if (isName(rt, AnnotationReplyType.GROUP)) {
      parentItem = parentItem.get("IRT");
    }
    if (!parentItem.has("M")) {
      this.data.modificationDate = null;
    } else {
      this.setModificationDate(parentItem.get("M"));
      this.data.modificationDate = this.modificationDate;
    }
    if (!parentItem.has("C")) {
      this.data.color = null;
    } else {
      this.setColor(parentItem.getArray("C"));
      this.data.color = this.color;
    }
    if (!this.viewable) {
      const parentFlags = parentItem.get("F");
      if (this._isViewable(parentFlags)) {
        this.setFlags(parentFlags);
      }
    }
    this.setTitle(parentItem.get("T"));
    this.data.titleObj = this._title;
    this.setContents(parentItem.get("Contents"));
    this.data.contentsObj = this._contents;
    if (parentItem.has("RC")) {
      this.data.richText = XFAFactory.getRichTextAsHtml(parentItem.get("RC"));
    }
    this.data.open = !!dict.get("Open");
  }
  static createNewDict(annotation, xref, _params) {
    const {
      oldAnnotation,
      rect,
      parent
    } = annotation;
    const popup = oldAnnotation || new Dict(xref);
    popup.setIfNotExists("Type", Name.get("Annot"));
    popup.setIfNotExists("Subtype", Name.get("Popup"));
    popup.setIfNotExists("Open", false);
    popup.setIfArray("Rect", rect);
    popup.set("Parent", parent);
    return popup;
  }
  static async createNewAppearanceStream(annotation, xref, params) {
    return null;
  }
}
class FreeTextAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.isEditable = !this.data.noHTML;
    this.data.noHTML = false;
    const {
      annotationGlobals,
      evaluatorOptions,
      xref
    } = params;
    this.data.annotationType = AnnotationType.FREETEXT;
    this.setDefaultAppearance(params);
    this._hasAppearance = !!this.appearance;
    if (this._hasAppearance) {
      const {
        fontColor,
        fontSize
      } = parseAppearanceStream(this.appearance, evaluatorOptions, xref, annotationGlobals.globalColorSpaceCache);
      this.data.defaultAppearanceData.fontColor = fontColor;
      this.data.defaultAppearanceData.fontSize = fontSize || 10;
    } else {
      this.data.defaultAppearanceData.fontSize ||= 10;
      const {
        fontColor,
        fontSize
      } = this.data.defaultAppearanceData;
      if (this._contents.str) {
        this.data.textContent = this._contents.str.split(/\r\n?|\n/).map(line => line.trimEnd());
        const {
          coords,
          bbox,
          matrix
        } = FakeUnicodeFont.getFirstPositionInfo(this.rectangle, this.rotation, fontSize);
        this.data.textPosition = this._transformPoint(coords, bbox, matrix);
      }
      if (this._isOffscreenCanvasSupported) {
        const strokeAlpha = params.dict.get("CA");
        const fakeUnicodeFont = new FakeUnicodeFont(xref, "sans-serif");
        this.appearance = fakeUnicodeFont.createAppearance(this._contents.str, this.rectangle, this.rotation, fontSize, fontColor, strokeAlpha);
        this._streams.push(this.appearance);
      } else {
        warn("FreeTextAnnotation: OffscreenCanvas is not supported, annotation may not render correctly.");
      }
    }
  }
  get hasTextContent() {
    return this._hasAppearance;
  }
  static createNewDict(annotation, xref, {
    apRef,
    ap
  }) {
    const {
      color,
      date,
      fontSize,
      oldAnnotation,
      rect,
      rotation,
      user,
      value
    } = annotation;
    const freetext = oldAnnotation || new Dict(xref);
    freetext.setIfNotExists("Type", Name.get("Annot"));
    freetext.setIfNotExists("Subtype", Name.get("FreeText"));
    freetext.set(oldAnnotation ? "M" : "CreationDate", `D:${getModificationDate(date)}`);
    if (oldAnnotation) {
      freetext.delete("RC");
    }
    freetext.setIfArray("Rect", rect);
    const da = `/Helv ${fontSize} Tf ${getPdfColor(color, true)}`;
    freetext.set("DA", da);
    freetext.setIfDefined("Contents", stringToAsciiOrUTF16BE(value));
    freetext.setIfNotExists("F", 4);
    freetext.setIfNotExists("Border", [0, 0, 0]);
    freetext.setIfNumber("Rotate", rotation);
    freetext.setIfDefined("T", stringToAsciiOrUTF16BE(user));
    if (apRef || ap) {
      const n = new Dict(xref);
      freetext.set("AP", n);
      n.set("N", apRef || ap);
    }
    return freetext;
  }
  static async createNewAppearanceStream(annotation, xref, params) {
    const {
      baseFontRef,
      evaluator,
      task
    } = params;
    const {
      color,
      fontSize,
      rect,
      rotation,
      value
    } = annotation;
    if (!color) {
      return null;
    }
    const resources = new Dict(xref);
    const font = new Dict(xref);
    if (baseFontRef) {
      font.set("Helv", baseFontRef);
    } else {
      const baseFont = new Dict(xref);
      baseFont.setIfName("BaseFont", "Helvetica");
      baseFont.setIfName("Type", "Font");
      baseFont.setIfName("Subtype", "Type1");
      baseFont.setIfName("Encoding", "WinAnsiEncoding");
      font.set("Helv", baseFont);
    }
    resources.set("Font", font);
    const helv = await WidgetAnnotation._getFontData(evaluator, task, {
      fontName: "Helv",
      fontSize
    }, resources);
    const [x1, y1, x2, y2] = rect;
    let w = x2 - x1;
    let h = y2 - y1;
    if (rotation % 180 !== 0) {
      [w, h] = [h, w];
    }
    const lines = value.split("\n");
    const scale = fontSize / 1000;
    let totalWidth = -Infinity;
    const encodedLines = [];
    for (let line of lines) {
      const encoded = helv.encodeString(line);
      if (encoded.length > 1) {
        return null;
      }
      line = encoded.join("");
      encodedLines.push(line);
      let lineWidth = 0;
      const glyphs = helv.charsToGlyphs(line);
      for (const glyph of glyphs) {
        lineWidth += glyph.width * scale;
      }
      totalWidth = Math.max(totalWidth, lineWidth);
    }
    let hscale = 1;
    if (totalWidth > w) {
      hscale = w / totalWidth;
    }
    let vscale = 1;
    const lineHeight = LINE_FACTOR * fontSize;
    const lineAscent = (LINE_FACTOR - LINE_DESCENT_FACTOR) * fontSize;
    const totalHeight = lineHeight * lines.length;
    if (totalHeight > h) {
      vscale = h / totalHeight;
    }
    const fscale = Math.min(hscale, vscale);
    const newFontSize = fontSize * fscale;
    let firstPoint, clipBox, matrix;
    switch (rotation) {
      case 0:
        matrix = [1, 0, 0, 1];
        clipBox = [rect[0], rect[1], w, h];
        firstPoint = [rect[0], rect[3] - lineAscent];
        break;
      case 90:
        matrix = [0, 1, -1, 0];
        clipBox = [rect[1], -rect[2], w, h];
        firstPoint = [rect[1], -rect[0] - lineAscent];
        break;
      case 180:
        matrix = [-1, 0, 0, -1];
        clipBox = [-rect[2], -rect[3], w, h];
        firstPoint = [-rect[2], -rect[1] - lineAscent];
        break;
      case 270:
        matrix = [0, -1, 1, 0];
        clipBox = [-rect[3], rect[0], w, h];
        firstPoint = [-rect[3], rect[2] - lineAscent];
        break;
    }
    const buffer = ["q", `${matrix.join(" ")} 0 0 cm`, `${clipBox.join(" ")} re W n`, `BT`, `${getPdfColor(color, true)}`, `0 Tc /Helv ${numberToString(newFontSize)} Tf`];
    buffer.push(`${firstPoint.join(" ")} Td (${escapeString(encodedLines[0])}) Tj`);
    const vShift = numberToString(lineHeight);
    for (let i = 1, ii = encodedLines.length; i < ii; i++) {
      const line = encodedLines[i];
      buffer.push(`0 -${vShift} Td (${escapeString(line)}) Tj`);
    }
    buffer.push("ET", "Q");
    const appearance = buffer.join("\n");
    const appearanceStreamDict = new Dict(xref);
    appearanceStreamDict.set("FormType", 1);
    appearanceStreamDict.setIfName("Subtype", "Form");
    appearanceStreamDict.setIfName("Type", "XObject");
    appearanceStreamDict.set("BBox", rect);
    appearanceStreamDict.set("Resources", resources);
    appearanceStreamDict.set("Matrix", [1, 0, 0, 1, -rect[0], -rect[1]]);
    const ap = new StringStream(appearance);
    ap.dict = appearanceStreamDict;
    return ap;
  }
}
class LineAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref
    } = params;
    this.data.annotationType = AnnotationType.LINE;
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.noHTML = false;
    const lineCoordinates = lookupRect(dict.getArray("L"), [0, 0, 0, 0]);
    this.data.lineCoordinates = Util.normalizeRect(lineCoordinates);
    this.setLineEndings(dict.getArray("LE"));
    this.data.lineEndings = this.lineEndings;
    if (!this.appearance) {
      const strokeColor = getPdfColorArray(this.color, [0, 0, 0]);
      const strokeAlpha = dict.get("CA");
      const interiorColor = getRgbColor(dict.getArray("IC"), null);
      const fillColor = getPdfColorArray(interiorColor);
      const fillAlpha = fillColor ? strokeAlpha : null;
      const borderWidth = this.borderStyle.width || 1,
        borderAdjust = 2 * borderWidth;
      const bbox = [this.data.lineCoordinates[0] - borderAdjust, this.data.lineCoordinates[1] - borderAdjust, this.data.lineCoordinates[2] + borderAdjust, this.data.lineCoordinates[3] + borderAdjust];
      if (!Util.intersect(this.rectangle, bbox)) {
        this.rectangle = bbox;
      }
      this._setDefaultAppearance({
        xref,
        extra: `${borderWidth} w`,
        strokeColor,
        fillColor,
        strokeAlpha,
        fillAlpha,
        pointsCallback: (buffer, points) => {
          buffer.push(`${lineCoordinates[0]} ${lineCoordinates[1]} m`, `${lineCoordinates[2]} ${lineCoordinates[3]} l`, "S");
          return [points[0] - borderWidth, points[7] - borderWidth, points[2] + borderWidth, points[3] + borderWidth];
        }
      });
    }
  }
}
class SquareAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref
    } = params;
    this.data.annotationType = AnnotationType.SQUARE;
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.noHTML = false;
    if (!this.appearance) {
      const strokeColor = getPdfColorArray(this.color, [0, 0, 0]);
      const strokeAlpha = dict.get("CA");
      const interiorColor = getRgbColor(dict.getArray("IC"), null);
      const fillColor = getPdfColorArray(interiorColor);
      const fillAlpha = fillColor ? strokeAlpha : null;
      if (this.borderStyle.width === 0 && !fillColor) {
        return;
      }
      this._setDefaultAppearance({
        xref,
        extra: `${this.borderStyle.width} w`,
        strokeColor,
        fillColor,
        strokeAlpha,
        fillAlpha,
        pointsCallback: (buffer, points) => {
          const x = points[4] + this.borderStyle.width / 2;
          const y = points[5] + this.borderStyle.width / 2;
          const width = points[6] - points[4] - this.borderStyle.width;
          const height = points[3] - points[7] - this.borderStyle.width;
          buffer.push(`${x} ${y} ${width} ${height} re`);
          if (fillColor) {
            buffer.push("B");
          } else {
            buffer.push("S");
          }
          return [points[0], points[7], points[2], points[3]];
        }
      });
    }
  }
}
class CircleAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref
    } = params;
    this.data.annotationType = AnnotationType.CIRCLE;
    if (!this.appearance) {
      const strokeColor = getPdfColorArray(this.color, [0, 0, 0]);
      const strokeAlpha = dict.get("CA");
      const interiorColor = getRgbColor(dict.getArray("IC"), null);
      const fillColor = getPdfColorArray(interiorColor);
      const fillAlpha = fillColor ? strokeAlpha : null;
      if (this.borderStyle.width === 0 && !fillColor) {
        return;
      }
      const controlPointsDistance = 4 / 3 * Math.tan(Math.PI / (2 * 4));
      this._setDefaultAppearance({
        xref,
        extra: `${this.borderStyle.width} w`,
        strokeColor,
        fillColor,
        strokeAlpha,
        fillAlpha,
        pointsCallback: (buffer, points) => {
          const x0 = points[0] + this.borderStyle.width / 2;
          const y0 = points[1] - this.borderStyle.width / 2;
          const x1 = points[6] - this.borderStyle.width / 2;
          const y1 = points[7] + this.borderStyle.width / 2;
          const xMid = x0 + (x1 - x0) / 2;
          const yMid = y0 + (y1 - y0) / 2;
          const xOffset = (x1 - x0) / 2 * controlPointsDistance;
          const yOffset = (y1 - y0) / 2 * controlPointsDistance;
          buffer.push(`${xMid} ${y1} m`, `${xMid + xOffset} ${y1} ${x1} ${yMid + yOffset} ${x1} ${yMid} c`, `${x1} ${yMid - yOffset} ${xMid + xOffset} ${y0} ${xMid} ${y0} c`, `${xMid - xOffset} ${y0} ${x0} ${yMid - yOffset} ${x0} ${yMid} c`, `${x0} ${yMid + yOffset} ${xMid - xOffset} ${y1} ${xMid} ${y1} c`, "h");
          if (fillColor) {
            buffer.push("B");
          } else {
            buffer.push("S");
          }
          return [points[0], points[7], points[2], points[3]];
        }
      });
    }
  }
}
class PolylineAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref
    } = params;
    this.data.annotationType = AnnotationType.POLYLINE;
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.noHTML = false;
    this.data.vertices = null;
    if (!(this instanceof PolygonAnnotation)) {
      this.setLineEndings(dict.getArray("LE"));
      this.data.lineEndings = this.lineEndings;
    }
    const rawVertices = dict.getArray("Vertices");
    if (!isNumberArray(rawVertices, null)) {
      return;
    }
    const vertices = this.data.vertices = Float32Array.from(rawVertices);
    if (!this.appearance) {
      const strokeColor = getPdfColorArray(this.color, [0, 0, 0]);
      const strokeAlpha = dict.get("CA");
      let fillColor = getRgbColor(dict.getArray("IC"), null);
      if (fillColor) {
        fillColor = getPdfColorArray(fillColor);
      }
      let operator;
      if (fillColor) {
        if (this.color) {
          operator = fillColor.every((c, i) => c === strokeColor[i]) ? "f" : "B";
        } else {
          operator = "f";
        }
      } else {
        operator = "S";
      }
      const borderWidth = this.borderStyle.width || 1,
        borderAdjust = 2 * borderWidth;
      const bbox = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0, ii = vertices.length; i < ii; i += 2) {
        Util.rectBoundingBox(vertices[i] - borderAdjust, vertices[i + 1] - borderAdjust, vertices[i] + borderAdjust, vertices[i + 1] + borderAdjust, bbox);
      }
      if (!Util.intersect(this.rectangle, bbox)) {
        this.rectangle = bbox;
      }
      this._setDefaultAppearance({
        xref,
        extra: `${borderWidth} w`,
        strokeColor,
        strokeAlpha,
        fillColor,
        fillAlpha: fillColor ? strokeAlpha : null,
        pointsCallback: (buffer, points) => {
          for (let i = 0, ii = vertices.length; i < ii; i += 2) {
            buffer.push(`${vertices[i]} ${vertices[i + 1]} ${i === 0 ? "m" : "l"}`);
          }
          buffer.push(operator);
          return [points[0], points[7], points[2], points[3]];
        }
      });
    }
  }
}
class PolygonAnnotation extends PolylineAnnotation {
  constructor(params) {
    super(params);
    this.data.annotationType = AnnotationType.POLYGON;
  }
}
class CaretAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    this.data.annotationType = AnnotationType.CARET;
  }
}
class InkAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.noHTML = false;
    const {
      dict,
      xref
    } = params;
    this.data.annotationType = AnnotationType.INK;
    this.data.inkLists = [];
    this.data.isEditable = !this.data.noHTML;
    this.data.noHTML = false;
    this.data.opacity = dict.get("CA") || 1;
    const rawInkLists = dict.getArray("InkList");
    if (!Array.isArray(rawInkLists)) {
      return;
    }
    for (let i = 0, ii = rawInkLists.length; i < ii; ++i) {
      if (!Array.isArray(rawInkLists[i])) {
        continue;
      }
      const inkList = new Float32Array(rawInkLists[i].length);
      this.data.inkLists.push(inkList);
      for (let j = 0, jj = rawInkLists[i].length; j < jj; j += 2) {
        const x = xref.fetchIfRef(rawInkLists[i][j]),
          y = xref.fetchIfRef(rawInkLists[i][j + 1]);
        if (typeof x === "number" && typeof y === "number") {
          inkList[j] = x;
          inkList[j + 1] = y;
        }
      }
    }
    if (!this.appearance) {
      const strokeColor = getPdfColorArray(this.color, [0, 0, 0]);
      const strokeAlpha = dict.get("CA");
      const borderWidth = this.borderStyle.width || 1,
        borderAdjust = 2 * borderWidth;
      const bbox = [Infinity, Infinity, -Infinity, -Infinity];
      for (const inkList of this.data.inkLists) {
        for (let i = 0, ii = inkList.length; i < ii; i += 2) {
          Util.rectBoundingBox(inkList[i] - borderAdjust, inkList[i + 1] - borderAdjust, inkList[i] + borderAdjust, inkList[i + 1] + borderAdjust, bbox);
        }
      }
      if (!Util.intersect(this.rectangle, bbox)) {
        this.rectangle = bbox;
      }
      this._setDefaultAppearance({
        xref,
        extra: `${borderWidth} w`,
        strokeColor,
        strokeAlpha,
        pointsCallback: (buffer, points) => {
          for (const inkList of this.data.inkLists) {
            for (let i = 0, ii = inkList.length; i < ii; i += 2) {
              buffer.push(`${inkList[i]} ${inkList[i + 1]} ${i === 0 ? "m" : "l"}`);
            }
            buffer.push("S");
          }
          return [points[0], points[7], points[2], points[3]];
        }
      });
    }
  }
  static createNewDict(annotation, xref, {
    apRef,
    ap
  }) {
    const {
      oldAnnotation,
      color,
      date,
      opacity,
      paths,
      outlines,
      rect,
      rotation,
      thickness,
      user
    } = annotation;
    const ink = oldAnnotation || new Dict(xref);
    ink.setIfNotExists("Type", Name.get("Annot"));
    ink.setIfNotExists("Subtype", Name.get("Ink"));
    ink.set(oldAnnotation ? "M" : "CreationDate", `D:${getModificationDate(date)}`);
    ink.setIfArray("Rect", rect);
    ink.setIfArray("InkList", outlines?.points || paths?.points);
    ink.setIfNotExists("F", 4);
    ink.setIfNumber("Rotate", rotation);
    ink.setIfDefined("T", stringToAsciiOrUTF16BE(user));
    if (outlines) {
      ink.setIfName("IT", "InkHighlight");
    }
    if (thickness > 0) {
      const bs = new Dict(xref);
      ink.set("BS", bs);
      bs.set("W", thickness);
    }
    ink.setIfArray("C", getPdfColorArray(color));
    ink.setIfNumber("CA", opacity);
    if (ap || apRef) {
      const n = new Dict(xref);
      ink.set("AP", n);
      n.set("N", apRef || ap);
    }
    return ink;
  }
  static async createNewAppearanceStream(annotation, xref, params) {
    if (annotation.outlines) {
      return this.createNewAppearanceStreamForHighlight(annotation, xref, params);
    }
    const {
      color,
      rect,
      paths,
      thickness,
      opacity
    } = annotation;
    if (!color) {
      return null;
    }
    const appearanceBuffer = [`${thickness} w 1 J 1 j`, `${getPdfColor(color, false)}`];
    if (opacity !== 1) {
      appearanceBuffer.push("/R0 gs");
    }
    for (const outline of paths.lines) {
      appearanceBuffer.push(`${numberToString(outline[4])} ${numberToString(outline[5])} m`);
      for (let i = 6, ii = outline.length; i < ii; i += 6) {
        if (isNaN(outline[i])) {
          appearanceBuffer.push(`${numberToString(outline[i + 4])} ${numberToString(outline[i + 5])} l`);
        } else {
          const [c1x, c1y, c2x, c2y, x, y] = outline.slice(i, i + 6);
          appearanceBuffer.push([c1x, c1y, c2x, c2y, x, y].map(numberToString).join(" ") + " c");
        }
      }
      if (outline.length === 6) {
        appearanceBuffer.push(`${numberToString(outline[4])} ${numberToString(outline[5])} l`);
      }
    }
    appearanceBuffer.push("S");
    const appearance = appearanceBuffer.join("\n");
    const appearanceStreamDict = new Dict(xref);
    appearanceStreamDict.set("FormType", 1);
    appearanceStreamDict.setIfName("Subtype", "Form");
    appearanceStreamDict.setIfName("Type", "XObject");
    appearanceStreamDict.set("BBox", rect);
    appearanceStreamDict.set("Length", appearance.length);
    if (opacity !== 1) {
      const resources = new Dict(xref);
      const extGState = new Dict(xref);
      const r0 = new Dict(xref);
      r0.set("CA", opacity);
      r0.setIfName("Type", "ExtGState");
      extGState.set("R0", r0);
      resources.set("ExtGState", extGState);
      appearanceStreamDict.set("Resources", resources);
    }
    const ap = new StringStream(appearance);
    ap.dict = appearanceStreamDict;
    return ap;
  }
  static async createNewAppearanceStreamForHighlight(annotation, xref, params) {
    const {
      color,
      rect,
      outlines: {
        outline
      },
      opacity
    } = annotation;
    if (!color) {
      return null;
    }
    const appearanceBuffer = [`${getPdfColor(color, true)}`, "/R0 gs"];
    appearanceBuffer.push(`${numberToString(outline[4])} ${numberToString(outline[5])} m`);
    for (let i = 6, ii = outline.length; i < ii; i += 6) {
      if (isNaN(outline[i])) {
        appearanceBuffer.push(`${numberToString(outline[i + 4])} ${numberToString(outline[i + 5])} l`);
      } else {
        const [c1x, c1y, c2x, c2y, x, y] = outline.slice(i, i + 6);
        appearanceBuffer.push([c1x, c1y, c2x, c2y, x, y].map(numberToString).join(" ") + " c");
      }
    }
    appearanceBuffer.push("h f");
    const appearance = appearanceBuffer.join("\n");
    const appearanceStreamDict = new Dict(xref);
    appearanceStreamDict.set("FormType", 1);
    appearanceStreamDict.setIfName("Subtype", "Form");
    appearanceStreamDict.setIfName("Type", "XObject");
    appearanceStreamDict.set("BBox", rect);
    appearanceStreamDict.set("Length", appearance.length);
    const resources = new Dict(xref);
    const extGState = new Dict(xref);
    resources.set("ExtGState", extGState);
    appearanceStreamDict.set("Resources", resources);
    const r0 = new Dict(xref);
    extGState.set("R0", r0);
    r0.setIfName("BM", "Multiply");
    if (opacity !== 1) {
      r0.set("ca", opacity);
      r0.setIfName("Type", "ExtGState");
    }
    const ap = new StringStream(appearance);
    ap.dict = appearanceStreamDict;
    return ap;
  }
}
class HighlightAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref
    } = params;
    this.data.annotationType = AnnotationType.HIGHLIGHT;
    this.data.isEditable = !this.data.noHTML;
    this.data.noHTML = false;
    this.data.opacity = dict.get("CA") || 1;
    const quadPoints = this.data.quadPoints = getQuadPoints(dict, null);
    if (quadPoints) {
      const resources = this.appearance?.dict.get("Resources");
      if (!this.appearance || !resources?.has("ExtGState")) {
        if (this.appearance) {
          warn("HighlightAnnotation - ignoring built-in appearance stream.");
        }
        const fillColor = getPdfColorArray(this.color, [1, 1, 0]);
        const fillAlpha = dict.get("CA");
        this._setDefaultAppearance({
          xref,
          fillColor,
          blendMode: "Multiply",
          fillAlpha,
          pointsCallback: (buffer, points) => {
            buffer.push(`${points[0]} ${points[1]} m`, `${points[2]} ${points[3]} l`, `${points[6]} ${points[7]} l`, `${points[4]} ${points[5]} l`, "f");
            return [points[0], points[7], points[2], points[3]];
          }
        });
      }
    } else {
      this.data.popupRef = null;
    }
  }
  get overlaysTextContent() {
    return true;
  }
  static createNewDict(annotation, xref, {
    apRef,
    ap
  }) {
    const {
      color,
      date,
      oldAnnotation,
      opacity,
      rect,
      rotation,
      user,
      quadPoints
    } = annotation;
    const highlight = oldAnnotation || new Dict(xref);
    highlight.setIfNotExists("Type", Name.get("Annot"));
    highlight.setIfNotExists("Subtype", Name.get("Highlight"));
    highlight.set(oldAnnotation ? "M" : "CreationDate", `D:${getModificationDate(date)}`);
    highlight.setIfArray("Rect", rect);
    highlight.setIfNotExists("F", 4);
    highlight.setIfNotExists("Border", [0, 0, 0]);
    highlight.setIfNumber("Rotate", rotation);
    highlight.setIfArray("QuadPoints", quadPoints);
    highlight.setIfArray("C", getPdfColorArray(color));
    highlight.setIfNumber("CA", opacity);
    highlight.setIfDefined("T", stringToAsciiOrUTF16BE(user));
    if (apRef || ap) {
      const n = new Dict(xref);
      highlight.set("AP", n);
      n.set("N", apRef || ap);
    }
    return highlight;
  }
  static async createNewAppearanceStream(annotation, xref, params) {
    const {
      color,
      rect,
      outlines,
      opacity
    } = annotation;
    if (!color) {
      return null;
    }
    const appearanceBuffer = [`${getPdfColor(color, true)}`, "/R0 gs"];
    const buffer = [];
    for (const outline of outlines) {
      buffer.length = 0;
      buffer.push(`${numberToString(outline[0])} ${numberToString(outline[1])} m`);
      for (let i = 2, ii = outline.length; i < ii; i += 2) {
        buffer.push(`${numberToString(outline[i])} ${numberToString(outline[i + 1])} l`);
      }
      buffer.push("h");
      appearanceBuffer.push(buffer.join("\n"));
    }
    appearanceBuffer.push("f*");
    const appearance = appearanceBuffer.join("\n");
    const appearanceStreamDict = new Dict(xref);
    appearanceStreamDict.set("FormType", 1);
    appearanceStreamDict.setIfName("Subtype", "Form");
    appearanceStreamDict.setIfName("Type", "XObject");
    appearanceStreamDict.set("BBox", rect);
    appearanceStreamDict.set("Length", appearance.length);
    const resources = new Dict(xref);
    const extGState = new Dict(xref);
    resources.set("ExtGState", extGState);
    appearanceStreamDict.set("Resources", resources);
    const r0 = new Dict(xref);
    extGState.set("R0", r0);
    r0.setIfName("BM", "Multiply");
    if (opacity !== 1) {
      r0.set("ca", opacity);
      r0.setIfName("Type", "ExtGState");
    }
    const ap = new StringStream(appearance);
    ap.dict = appearanceStreamDict;
    return ap;
  }
}
class UnderlineAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref
    } = params;
    this.data.annotationType = AnnotationType.UNDERLINE;
    const quadPoints = this.data.quadPoints = getQuadPoints(dict, null);
    if (quadPoints) {
      if (!this.appearance) {
        const strokeColor = getPdfColorArray(this.color, [0, 0, 0]);
        const strokeAlpha = dict.get("CA");
        this._setDefaultAppearance({
          xref,
          extra: "[] 0 d 0.571 w",
          strokeColor,
          strokeAlpha,
          pointsCallback: (buffer, points) => {
            buffer.push(`${points[4]} ${points[5] + 1.3} m`, `${points[6]} ${points[7] + 1.3} l`, "S");
            return [points[0], points[7], points[2], points[3]];
          }
        });
      }
    } else {
      this.data.popupRef = null;
    }
  }
  get overlaysTextContent() {
    return true;
  }
}
class SquigglyAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref
    } = params;
    this.data.annotationType = AnnotationType.SQUIGGLY;
    const quadPoints = this.data.quadPoints = getQuadPoints(dict, null);
    if (quadPoints) {
      if (!this.appearance) {
        const strokeColor = getPdfColorArray(this.color, [0, 0, 0]);
        const strokeAlpha = dict.get("CA");
        this._setDefaultAppearance({
          xref,
          extra: "[] 0 d 1 w",
          strokeColor,
          strokeAlpha,
          pointsCallback: (buffer, points) => {
            const dy = (points[1] - points[5]) / 6;
            let shift = dy;
            let x = points[4];
            const y = points[5];
            const xEnd = points[6];
            buffer.push(`${x} ${y + shift} m`);
            do {
              x += 2;
              shift = shift === 0 ? dy : 0;
              buffer.push(`${x} ${y + shift} l`);
            } while (x < xEnd);
            buffer.push("S");
            return [points[4], y - 2 * dy, xEnd, y + 2 * dy];
          }
        });
      }
    } else {
      this.data.popupRef = null;
    }
  }
  get overlaysTextContent() {
    return true;
  }
}
class StrikeOutAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref
    } = params;
    this.data.annotationType = AnnotationType.STRIKEOUT;
    const quadPoints = this.data.quadPoints = getQuadPoints(dict, null);
    if (quadPoints) {
      if (!this.appearance) {
        const strokeColor = getPdfColorArray(this.color, [0, 0, 0]);
        const strokeAlpha = dict.get("CA");
        this._setDefaultAppearance({
          xref,
          extra: "[] 0 d 1 w",
          strokeColor,
          strokeAlpha,
          pointsCallback: (buffer, points) => {
            buffer.push(`${(points[0] + points[4]) / 2} ` + `${(points[1] + points[5]) / 2} m`, `${(points[2] + points[6]) / 2} ` + `${(points[3] + points[7]) / 2} l`, "S");
            return [points[0], points[7], points[2], points[3]];
          }
        });
      }
    } else {
      this.data.popupRef = null;
    }
  }
  get overlaysTextContent() {
    return true;
  }
}
class StampAnnotation extends MarkupAnnotation {
  #savedHasOwnCanvas = null;
  constructor(params) {
    super(params);
    this.data.annotationType = AnnotationType.STAMP;
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.isEditable = !this.data.noHTML;
    this.data.noHTML = false;
  }
  mustBeViewedWhenEditing(isEditing, modifiedIds = null) {
    if (isEditing) {
      if (!this.data.isEditable) {
        return true;
      }
      this.#savedHasOwnCanvas ??= this.data.hasOwnCanvas;
      this.data.hasOwnCanvas = true;
      return true;
    }
    if (this.#savedHasOwnCanvas !== null) {
      this.data.hasOwnCanvas = this.#savedHasOwnCanvas;
      this.#savedHasOwnCanvas = null;
    }
    return !modifiedIds?.has(this.data.id);
  }
  static async createImage(bitmap, xref) {
    const {
      width,
      height
    } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", {
      alpha: true
    });
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, width, height).data;
    const buf32 = new Uint32Array(data.buffer);
    const hasAlpha = buf32.some(FeatureTest.isLittleEndian ? x => x >>> 24 !== 0xff : x => (x & 0xff) !== 0xff);
    if (hasAlpha) {
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0);
    }
    const jpegBufferPromise = canvas.convertToBlob({
      type: "image/jpeg",
      quality: 1
    }).then(blob => blob.arrayBuffer());
    const xobjectName = Name.get("XObject");
    const imageName = Name.get("Image");
    const image = new Dict(xref);
    image.set("Type", xobjectName);
    image.set("Subtype", imageName);
    image.set("BitsPerComponent", 8);
    image.setIfName("ColorSpace", "DeviceRGB");
    image.setIfName("Filter", "DCTDecode");
    image.set("BBox", [0, 0, width, height]);
    image.set("Width", width);
    image.set("Height", height);
    let smaskStream = null;
    if (hasAlpha) {
      const alphaBuffer = new Uint8Array(buf32.length);
      if (FeatureTest.isLittleEndian) {
        for (let i = 0, ii = buf32.length; i < ii; i++) {
          alphaBuffer[i] = buf32[i] >>> 24;
        }
      } else {
        for (let i = 0, ii = buf32.length; i < ii; i++) {
          alphaBuffer[i] = buf32[i] & 0xff;
        }
      }
      const smask = new Dict(xref);
      smask.set("Type", xobjectName);
      smask.set("Subtype", imageName);
      smask.set("BitsPerComponent", 8);
      smask.setIfName("ColorSpace", "DeviceGray");
      smask.set("Width", width);
      smask.set("Height", height);
      smaskStream = new Stream(alphaBuffer, 0, 0, smask);
    }
    const imageStream = new Stream(await jpegBufferPromise, 0, 0, image);
    return {
      imageStream,
      smaskStream,
      width,
      height
    };
  }
  static createNewDict(annotation, xref, {
    apRef,
    ap
  }) {
    const {
      date,
      oldAnnotation,
      rect,
      rotation,
      user
    } = annotation;
    const stamp = oldAnnotation || new Dict(xref);
    stamp.setIfNotExists("Type", Name.get("Annot"));
    stamp.setIfNotExists("Subtype", Name.get("Stamp"));
    stamp.set(oldAnnotation ? "M" : "CreationDate", `D:${getModificationDate(date)}`);
    stamp.setIfArray("Rect", rect);
    stamp.setIfNotExists("F", 4);
    stamp.setIfNotExists("Border", [0, 0, 0]);
    stamp.setIfNumber("Rotate", rotation);
    stamp.setIfDefined("T", stringToAsciiOrUTF16BE(user));
    if (apRef || ap) {
      const n = new Dict(xref);
      stamp.set("AP", n);
      n.set("N", apRef || ap);
    }
    return stamp;
  }
  static async #createNewAppearanceStreamForDrawing(annotation, xref) {
    const {
      areContours,
      color,
      rect,
      lines,
      thickness
    } = annotation;
    if (!color) {
      return null;
    }
    const appearanceBuffer = [`${thickness} w 1 J 1 j`, `${getPdfColor(color, areContours)}`];
    for (const line of lines) {
      appearanceBuffer.push(`${numberToString(line[4])} ${numberToString(line[5])} m`);
      for (let i = 6, ii = line.length; i < ii; i += 6) {
        if (isNaN(line[i])) {
          appearanceBuffer.push(`${numberToString(line[i + 4])} ${numberToString(line[i + 5])} l`);
        } else {
          const [c1x, c1y, c2x, c2y, x, y] = line.slice(i, i + 6);
          appearanceBuffer.push([c1x, c1y, c2x, c2y, x, y].map(numberToString).join(" ") + " c");
        }
      }
      if (line.length === 6) {
        appearanceBuffer.push(`${numberToString(line[4])} ${numberToString(line[5])} l`);
      }
    }
    appearanceBuffer.push(areContours ? "F" : "S");
    const appearance = appearanceBuffer.join("\n");
    const appearanceStreamDict = new Dict(xref);
    appearanceStreamDict.set("FormType", 1);
    appearanceStreamDict.setIfName("Subtype", "Form");
    appearanceStreamDict.setIfName("Type", "XObject");
    appearanceStreamDict.set("BBox", rect);
    appearanceStreamDict.set("Length", appearance.length);
    const ap = new StringStream(appearance);
    ap.dict = appearanceStreamDict;
    return ap;
  }
  static async createNewAppearanceStream(annotation, xref, params) {
    if (annotation.oldAnnotation) {
      return null;
    }
    if (annotation.isSignature) {
      return this.#createNewAppearanceStreamForDrawing(annotation, xref);
    }
    const {
      rotation
    } = annotation;
    const {
      imageRef,
      width,
      height
    } = params.image;
    const resources = new Dict(xref);
    const xobject = new Dict(xref);
    resources.set("XObject", xobject);
    xobject.set("Im0", imageRef);
    const appearance = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
    const appearanceStreamDict = new Dict(xref);
    appearanceStreamDict.set("FormType", 1);
    appearanceStreamDict.setIfName("Subtype", "Form");
    appearanceStreamDict.setIfName("Type", "XObject");
    appearanceStreamDict.set("BBox", [0, 0, width, height]);
    appearanceStreamDict.set("Resources", resources);
    if (rotation) {
      const matrix = getRotationMatrix(rotation, width, height);
      appearanceStreamDict.set("Matrix", matrix);
    }
    const ap = new StringStream(appearance);
    ap.dict = appearanceStreamDict;
    return ap;
  }
}
class FileAttachmentAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref
    } = params;
    const file = new FileSpec(dict.get("FS"), xref);
    this.data.annotationType = AnnotationType.FILEATTACHMENT;
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.noHTML = false;
    this.data.file = file.serializable;
    const name = dict.get("Name");
    this.data.name = name instanceof Name ? stringToPDFString(name.name) : "PushPin";
    const fillAlpha = dict.get("ca");
    this.data.fillAlpha = typeof fillAlpha === "number" && fillAlpha >= 0 && fillAlpha <= 1 ? fillAlpha : null;
  }
}
export { Annotation, AnnotationBorderStyle, AnnotationFactory, getQuadPoints, MarkupAnnotation, PopupAnnotation, WidgetAnnotation };