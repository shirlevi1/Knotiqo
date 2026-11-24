import { budgetRequest, isCommitments } from "./budget";

export const vendorStatuses = {
    researching: "בבדיקה", contacted: "נוצר קשר", quote_received: "התקבלה הצעה", shortlisted: "ברשימה הקצרה",
    booked: "הוזמן", rejected: "נדחה", cancelled: "בוטל",
};
export const quoteStatuses = { pending: "ממתינה", selected: "נבחרה", rejected: "נדחתה" };
export const serviceCategories = ["אולם וקייטרינג", "צילום", "מגנטים", "מוזיקה ודיג׳יי", "הגברה ותאורה", "אטרקציות",
    "עיצוב ופרחים", "שמלות כלה", "חליפת חתן", "שיער", "איפור", "אלכוהול ובר", "מקום התארגנות", "רבנות ומקווה",
    "רב וטקס", "טבעות ותכשיטים", "רכב ותחבורה", "הגעה והושבה", "ציוד ואביזרים", "אביזרי רחבה", "טיפים", "אחר"];

export type QuoteInput = {
    title: string; amount: string; received_date: string | null; included_services: string;
    excluded_services: string; notes: string; status: keyof typeof quoteStatuses;
};
export type Quote = QuoteInput & { id: number };
export type VendorInput = {
    name: string; service_category: string; contact_person: string; phone: string; email: string;
    website: string; notes: string; status: keyof typeof vendorStatuses; budget_category_id: number | null;
};
export type Vendor = VendorInput & { id: number; quotes: Quote[] };

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function resource(value: unknown): value is Record<string, unknown> {
    return record(value) && Number.isSafeInteger(value.id) && Number(value.id) > 0;
}
function isQuote(value: unknown): value is Quote {
    return resource(value) && ["title", "included_services", "excluded_services", "notes"].every((key) => typeof value[key] === "string")
        && typeof value.amount === "string" && /^\d+\.\d{2}$/.test(value.amount)
        && (value.received_date === null || typeof value.received_date === "string")
        && typeof value.status === "string" && Object.hasOwn(quoteStatuses, value.status);
}
function isVendors(value: unknown): value is Vendor[] {
    return Array.isArray(value) && value.every((item: unknown) => resource(item)
        && ["name", "service_category", "contact_person", "phone", "email", "website", "notes"].every((key) => typeof item[key] === "string")
        && (!item.website || /^https?:\/\//i.test(String(item.website)))
        && typeof item.status === "string" && Object.hasOwn(vendorStatuses, item.status)
        && (item.budget_category_id === null || Number.isSafeInteger(item.budget_category_id))
        && Array.isArray(item.quotes) && item.quotes.every(isQuote));
}

export function vendorsForWedding(weddingId: number) {
    const base = `/api/weddings/${weddingId}/vendors/`;
    const vendor = (id: number) => `${base}${id}/`;
    const quotes = (id: number) => `${vendor(id)}quotes/`;
    const commitments = (id: number) => `${vendor(id)}commitments/`;
    return {
        list: (signal: AbortSignal) => budgetRequest(base, isVendors, signal),
        save: (input: VendorInput, signal: AbortSignal, id?: number) =>
            budgetRequest(id ? vendor(id) : base, isVendors, signal, id ? "PATCH" : "POST", input),
        remove: (id: number, signal: AbortSignal) => budgetRequest(vendor(id), isVendors, signal, "DELETE"),
        quote: (id: number, input: Partial<QuoteInput>, signal: AbortSignal, quoteId?: number) =>
            budgetRequest(quoteId ? `${quotes(id)}${quoteId}/` : quotes(id), isVendors, signal, quoteId ? "PATCH" : "POST", input),
        removeQuote: (id: number, quoteId: number, signal: AbortSignal) =>
            budgetRequest(`${quotes(id)}${quoteId}/`, isVendors, signal, "DELETE"),
        link: (id: number, input: { expense_id: number } | { quote_id: number; category_id: number; confirmed: true }, signal: AbortSignal) =>
            budgetRequest(commitments(id), isCommitments, signal, "POST", input),
        unlink: (id: number, expenseId: number, signal: AbortSignal) =>
            budgetRequest(`${commitments(id)}${expenseId}/`, isCommitments, signal, "DELETE"),
    };
}
