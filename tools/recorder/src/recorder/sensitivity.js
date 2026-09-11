// Classifies a form field as sensitive. PURE: no DOM, no Node APIs, no imports.
// createSensitivity is stringified into the injected page script (instrument.js) and
// also used by the recorder as defence in depth — everything it needs lives inside it.
// Lists come from Firefox HeuristicsRegExp, Chromium autofill, Bitwarden and KeePassXC,
// plus Brazilian documents (CPF/CNPJ/RG).
export function createSensitivity() {
  const splitCamel = (s) => String(s ?? '').replace(/([a-z])([A-Z])/g, '$1 $2');
  const norm = (s) => String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // keep the \u escapes: this source is inlined into the page script
    .replace(/[_\-.\s]+/g, ' ')
    .trim();
  const words = (list) => new RegExp('(^| )(' + list.join('|') + ')( |$)');

  const PASSWORD = words(['senha', 'password', 'passwd', 'pwd', 'pass', 'contrasena', 'kennwort', 'mot de passe']);
  const OTP = words(['otp', 'otpcode', 'totp', 'mfa', '2fa', 'twofa', 'twofactor', 'two factor', 'onetime', 'one time',
    'verification code', 'codigo de verificacao', 'codigo verificacao', 'codigo de seguranca', 'codigo seguranca',
    'token', 'pin']);
  const OTP_EXCLUDE = /promo|cupom|coupon|(^| )cep( |$)|postal|zip|bank|barcode/;
  const OTP_TYPES = ['text', 'number', 'tel', 'password'];
  const CARD = words(['cvv', 'cvc', 'csc', 'cvn', 'ccv', 'cid', 'card number', 'cardnumber', 'numero do cartao',
    'numero cartao', 'tarjeta', 'carte']);
  const DOCUMENT = words(['cpf', 'cnpj', 'cpf cnpj', 'cpfcnpj', 'documento', 'rg', 'passaporte', 'passport',
    'nif', 'dni', 'ssn', 'tax id']);
  const PHONE = words(['telefone', 'celular', 'fone', 'phone', 'mobile', 'telemovel', 'telefono', 'whatsapp']);

  const luhn = (d) => {
    let sum = 0, dbl = false;
    for (let i = d.length - 1; i >= 0; i--) {
      let n = d.charCodeAt(i) - 48;
      if (dbl) { n *= 2; if (n > 9) n -= 9; }
      sum += n; dbl = !dbl;
    }
    return sum % 10 === 0;
  };
  const allSame = (d) => /^(\d)\1+$/.test(d);
  const cpfValid = (d) => {
    if (d.length !== 11 || allSame(d)) return false;
    const dv = (len) => {
      let s = 0;
      for (let i = 0; i < len; i++) s += (d.charCodeAt(i) - 48) * (len + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return dv(9) === d.charCodeAt(9) - 48 && dv(10) === d.charCodeAt(10) - 48;
  };
  const cnpjValid = (d) => {
    if (d.length !== 14 || allSame(d)) return false;
    const dv = (len) => {
      const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      let s = 0;
      for (let i = 0; i < len; i++) s += (d.charCodeAt(i) - 48) * w[i];
      const r = s % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return dv(12) === d.charCodeAt(12) - 48 && dv(13) === d.charCodeAt(13) - 48;
  };

  return function sensitivityOf(field) {
    const f = field || {};
    const type = String(f.type || 'text').toLowerCase();
    const ac = norm(f.autocomplete);
    const names = norm([f.name, f.id, f.placeholder, f.ariaLabel, f.labelText].map(splitCamel).join(' '));
    const value = String(f.value ?? '');
    const digits = value.replace(/\D/g, '');
    const numericLike = /^[\d\s.\-\/]+$/.test(value.trim()) && digits.length > 0;

    // 1. standard autocomplete tokens and type=password
    if (type === 'password' || ac === 'current password' || ac === 'new password') return 'password';
    if (ac === 'one time code') return 'otp';
    if (ac === 'cc' || ac.indexOf('cc ') === 0) return 'card';
    if (ac === 'tel' || ac === 'tel national' || ac === 'tel local') return 'phone';

    // 2. field name / id / placeholder / aria-label / label text
    if (PASSWORD.test(names)) return 'password';
    if (OTP.test(names) && !OTP_EXCLUDE.test(names) && OTP_TYPES.indexOf(type) >= 0) return 'otp';
    if (CARD.test(names) || (/(^| )validade( |$)/.test(names) && /cartao/.test(names))) return 'card';
    if (DOCUMENT.test(names)) return 'document';
    if (PHONE.test(names) || type === 'tel') return 'phone';

    // 3. value alone — only strong validators (a phone-looking number could be a ticket id)
    if (numericLike && digits.length >= 13 && digits.length <= 19 && luhn(digits)) return 'card';
    if (numericLike && (cpfValid(digits) || cnpjValid(digits))) return 'document';
    return null;
  };
}

export const sensitivityOf = createSensitivity();
