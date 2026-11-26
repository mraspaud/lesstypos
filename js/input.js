// Keyboard capture through a hidden textarea. beforeinput gives the produced
// text (including multi-character outputs and composed characters), keydown /
// keyup give key timing for rollover. Times are event.timeStamp (ms,
// high resolution, same clock for all events).
(function (FT) {
  'use strict';
  function attach(el, h) {
    function onKeyDown(e) {
      if (!e.repeat) h.onKey && h.onKey({ k: 'd', c: e.code || e.key, t: e.timeStamp });
      // Backspace is handled here: browsers do not reliably fire beforeinput
      // for deletions in an empty field.
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (e.ctrlKey || e.altKey || e.metaKey) h.onBackWord(e.timeStamp); else h.onBack(e.timeStamp);
      } else if (e.key === 'Escape') { e.preventDefault(); h.onEscape && h.onEscape(); }
      else if (e.key === 'Tab') { e.preventDefault(); h.onTab && h.onTab(); }
      else if (e.key === 'Enter') { e.preventDefault(); h.onEnter && h.onEnter(); }
      else if (e.key === 'Delete') { e.preventDefault(); h.onDelete && h.onDelete(); }
    }
    function onKeyUp(e) { h.onKey && h.onKey({ k: 'u', c: e.code || e.key, t: e.timeStamp }); }
    function onBeforeInput(e) {
      var t = e.timeStamp;
      switch (e.inputType) {
        case 'insertText':
          e.preventDefault(); if (e.data) h.onText(e.data, t); break;
        case 'deleteContentBackward':
          e.preventDefault(); h.onBack(t); break;
        case 'deleteWordBackward': case 'deleteSoftLineBackward': case 'deleteHardLineBackward':
          e.preventDefault(); h.onBackWord(t); break;
        case 'insertCompositionText':
          break; // composition: handled on compositionend
        default:
          e.preventDefault();
      }
    }
    function onCompositionEnd(e) {
      if (e.data) h.onText(e.data, e.timeStamp);
      el.value = '';
    }
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('keyup', onKeyUp);
    el.addEventListener('beforeinput', onBeforeInput);
    el.addEventListener('compositionend', onCompositionEnd);
    el.addEventListener('input', function () { if (!el.isComposing) el.value = ''; });
    return function detach() {
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('keyup', onKeyUp);
      el.removeEventListener('beforeinput', onBeforeInput);
      el.removeEventListener('compositionend', onCompositionEnd);
    };
  }
  FT.input = { attach: attach };
})(globalThis.FT);
