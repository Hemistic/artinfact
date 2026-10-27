"use strict";
(self["webpackChunkpdf_reader"] = self["webpackChunkpdf_reader"] || []).push([["src_dom_common_lib_math-internal_ts"],{

/***/ "./src/dom/common/lib/math-internal.ts":
/*!*********************************************!*\
  !*** ./src/dom/common/lib/math-internal.ts ***!
  \*********************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   renderMathInternal: () => (/* binding */ renderMathInternal)
/* harmony export */ });
/* harmony import */ var mathjax_full_js_handlers_html__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! mathjax-full/js/handlers/html */ "./node_modules/mathjax-full/js/handlers/html.js");
/* harmony import */ var mathjax_full_js_mathjax__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! mathjax-full/js/mathjax */ "./node_modules/mathjax-full/js/mathjax.js");
/* harmony import */ var mathjax_full_js_input_tex__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! mathjax-full/js/input/tex */ "./node_modules/mathjax-full/js/input/tex.js");
/* harmony import */ var mathjax_full_js_input_tex__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(mathjax_full_js_input_tex__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var mathjax_full_js_input_tex_AllPackages__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! mathjax-full/js/input/tex/AllPackages */ "./node_modules/mathjax-full/js/input/tex/AllPackages.js");
/* harmony import */ var mathjax_full_js_output_chtml__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! mathjax-full/js/output/chtml */ "./node_modules/mathjax-full/js/output/chtml.js");
/* harmony import */ var mathjax_full_js_output_chtml__WEBPACK_IMPORTED_MODULE_4___default = /*#__PURE__*/__webpack_require__.n(mathjax_full_js_output_chtml__WEBPACK_IMPORTED_MODULE_4__);
/* harmony import */ var mathjax_full_js_adaptors_HTMLAdaptor__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! mathjax-full/js/adaptors/HTMLAdaptor */ "./node_modules/mathjax-full/js/adaptors/HTMLAdaptor.js");
/* harmony import */ var mathjax_full_js_adaptors_HTMLAdaptor__WEBPACK_IMPORTED_MODULE_5___default = /*#__PURE__*/__webpack_require__.n(mathjax_full_js_adaptors_HTMLAdaptor__WEBPACK_IMPORTED_MODULE_5__);






let registered = false;
function renderMathInternal(doc) {
  if (!registered) {
    // MathJax wants nodeValue not to be nullable, so we have to cast to any. It'll be fine.
    (0,mathjax_full_js_handlers_html__WEBPACK_IMPORTED_MODULE_0__.RegisterHTMLHandler)(new mathjax_full_js_adaptors_HTMLAdaptor__WEBPACK_IMPORTED_MODULE_5__.HTMLAdaptor(doc.defaultView ?? window));
    registered = true;
  }
  let mjDoc = mathjax_full_js_mathjax__WEBPACK_IMPORTED_MODULE_1__.mathjax.document(doc, {
    InputJax: new mathjax_full_js_input_tex__WEBPACK_IMPORTED_MODULE_2__.TeX({
      packages: mathjax_full_js_input_tex_AllPackages__WEBPACK_IMPORTED_MODULE_3__.AllPackages
    }),
    OutputJax: new mathjax_full_js_output_chtml__WEBPACK_IMPORTED_MODULE_4__.CHTML({
      fontURL: new URL('mathjax-fonts', document.location.href).toString()
    })
  });
  mjDoc.render();
  for (let item of mjDoc.math) {
    if (item.typesetRoot.nodeType === Node.ELEMENT_NODE) {
      item.typesetRoot.dataset.tex = item.math;
    }
  }
}

/***/ })

}]);
//# sourceMappingURL=src_dom_common_lib_math-internal_ts.js.map