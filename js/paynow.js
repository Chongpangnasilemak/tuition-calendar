// -----------------------------------------------------------------------------
// PayNow QR — generate an EMVCo / SGQR-compliant PayNow payload entirely on the
// client. No API, no payment processor, no fees. The parent scans it with any
// Singapore banking app, PayLah, GrabPay, etc., and pays the tutor directly,
// bank-to-bank.
//
// IMPORTANT: PayNow has no payment callback — the money goes straight to the
// tutor's bank and the app never learns it happened. So the tutor still marks
// the lesson "Paid" manually (the dashboard already supports this).
//
// Format reference: EMV QR Code Specification for Payment Systems (Merchant-
// Presented Mode) + the Singapore PayNow proxy under merchant account info tag 26.
// -----------------------------------------------------------------------------

/** Build one EMVCo TLV field: 2-digit id + 2-digit length + value. */
function tlv(id, value) {
  const v = String(value);
  const len = String(v.length).padStart(2, "0");
  return `${id}${len}${v}`;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) over an ASCII string. */
function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Normalise a SG mobile number to PayNow proxy form: +65XXXXXXXX. */
export function normaliseMobile(raw) {
  let s = String(raw || "").replace(/[\s-]/g, "");
  if (!s) return "";
  if (s.startsWith("+65")) return s;
  if (s.startsWith("65") && s.length === 10) return "+" + s;
  if (/^[89]\d{7}$/.test(s)) return "+65" + s; // bare 8-digit SG mobile
  if (s.startsWith("+")) return s;
  return s; // leave as-is; caller validates
}

/** Is this a UEN (rough check) rather than a phone number? */
function looksLikeUEN(id) {
  return /[A-Za-z]/.test(id) || (!id.startsWith("+") && id.replace(/\D/g, "").length > 9);
}

/**
 * Build the PayNow QR payload string.
 * @param {{ proxy:string, amount?:number, editable?:boolean, reference?:string,
 *           merchantName?:string, expiryISO?:string }} opts
 *   proxy: a +65 mobile number OR a UEN.
 *   amount: SGD amount (omit/0 => parent enters the amount).
 *   editable: if true (or no amount), the amount is editable in the payer's app.
 *   reference: appears as the bill reference (e.g. "Aiden 12 Jun").
 * @returns {string} the QR text (encode this into a QR image).
 */
export function buildPayNowPayload({ proxy, amount, editable, reference, merchantName }) {
  const id = (proxy || "").trim();
  if (!id) throw new Error("PayNow ID (mobile or UEN) is required.");
  const isUEN = looksLikeUEN(id);
  const proxyValue = isUEN ? id : normaliseMobile(id);

  // Merchant Account Information — PayNow, under template id 26.
  //   00 = "SG.PAYNOW"
  //   01 = proxy type: 0 = mobile, 2 = UEN
  //   02 = proxy value
  //   03 = amount editable: "1" editable, "0" fixed
  //   04 = expiry (YYYYMMDD) — optional; omitted here
  const hasAmount = typeof amount === "number" && amount > 0;
  const amountEditable = editable === true || !hasAmount;
  const merchantAccount =
    tlv("00", "SG.PAYNOW") +
    tlv("01", isUEN ? "2" : "0") +
    tlv("02", proxyValue) +
    tlv("03", amountEditable ? "1" : "0");

  let payload =
    tlv("00", "01") +                 // payload format indicator
    tlv("01", "12") +                 // point of initiation: 12 = dynamic (with amount/ref)
    tlv("26", merchantAccount) +      // merchant account info: PayNow
    tlv("52", "0000") +               // merchant category code (unspecified)
    tlv("53", "702") +                // currency: SGD (ISO 4217 numeric)
    (hasAmount ? tlv("54", amount.toFixed(2)) : "") +
    tlv("58", "SG") +                 // country
    tlv("59", (merchantName || "NA").slice(0, 25)) + // merchant name
    tlv("60", "Singapore");           // merchant city

  // Additional data — bill reference (tag 62, sub-tag 01).
  if (reference) {
    const ref = String(reference).slice(0, 25);
    payload += tlv("62", tlv("01", ref));
  }

  // CRC: tag 63 + length 04, computed over everything INCLUDING "6304".
  payload += "6304";
  payload += crc16(payload);
  return payload;
}
