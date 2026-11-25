// Starts the app once every ui file has registered its functions on FT.ui.
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', FT.ui.boot);
  else FT.ui.boot();
})(globalThis.FT);
