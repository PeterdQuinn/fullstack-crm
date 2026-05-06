export function formatPhoneNumber(phone: string | null | undefined): string {
  if (!phone) return "—";

  // Remove all non-digits
  const digits = phone.replace(/\D/g, "");

  // If not 10 digits, return as-is
  if (digits.length !== 10) return phone;

  // Format as (XXX) XXX-XXXX
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function formatPhoneLink(phone: string | null | undefined): string {
  if (!phone) return "";
  // Remove all non-digits for tel: link
  return `tel:${phone.replace(/\D/g, "")}`;
}
