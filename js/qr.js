// -----------------------------------------------------------------------------
// QR rendering — lazily loads a small QR library from a CDN (no build step) and
// renders a payload string into a <canvas>. Used for the PayNow QR.
// -----------------------------------------------------------------------------

let _qrlib = null;

async function loadQrLib() {
  if (_qrlib) return _qrlib;
  // node-qrcode, ES module build via esm.sh (browser-friendly, no deps).
  _qrlib = await import("https://esm.sh/qrcode@1.5.4");
  return _qrlib;
}

/**
 * Render a payload into a fresh canvas element.
 * @param {string} text @param {number} [size=240]
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderQrCanvas(text, size = 240) {
  const QR = await loadQrLib();
  const canvas = document.createElement("canvas");
  await (QR.toCanvas || QR.default.toCanvas)(canvas, text, {
    width: size,
    margin: 1,
    errorCorrectionLevel: "M",
  });
  return canvas;
}
