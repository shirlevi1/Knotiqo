import { getCsrfToken } from "./csrf";

export const venueStatuses = {
    interested: "מתעניינים",
    meeting_scheduled: "נקבעה פגישה",
    quote_received: "התקבלה הצעה",
    booked: "הוזמן",
    rejected: "לא מתאים",
};
export type VenueStatus = keyof typeof venueStatuses;
export type VenueInput = {
    name: string; location: string; contact_name: string; phone: string; website: string;
    capacity: number | null; notes: string; status: VenueStatus; is_favorite: boolean;
};
export type QuoteInput = {
    event_date: string | null; price_per_guest: string; minimum_guests: number;
    additional_costs: string; notes: string;
};
export type VenueImage = {
    id: number; image_url: string; source_url: string; alt_text: string;
    is_primary: boolean; sort_order: number; created_at: string;
};
export type ImageCandidate = Pick<VenueImage, "image_url" | "source_url" | "alt_text">;
export type VenuePreview = {
    preview_token: string;
    expires_in: number;
    metadata: {
        source_url: string; name: string; description: string; address: string;
        phone: string; images: ImageCandidate[];
    };
};
export type Venue = VenueInput & {
    id: number; description: string; images: VenueImage[]; created_at: string; updated_at: string;
};
export type VenueQuote = QuoteInput & { id: number; created_at: string; updated_at: string };
export type ComparedQuote = QuoteInput & {
    quote_id: number; venue_id: number; venue_name: string; billable_guests: number;
    meals_cost: string; total_cost: string; difference_from_cheapest: string;
};
export type VenueComparison = {
    expected_guests: number; comparisons: ComparedQuote[];
    cheapest_quote_id: number; cheapest_quote_label: "Lowest known calculated cost";
};

export class VenueApiError extends Error {
    readonly fields: string[];
    readonly code?: string;
    constructor(message: string, fields: string[] = [], code?: string) {
        super(message);
        this.fields = fields;
        this.code = code;
    }
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function resource(value: unknown): value is Record<string, unknown> {
    return record(value) && Number.isSafeInteger(value.id) && Number(value.id) > 0
        && typeof value.created_at === "string" && typeof value.updated_at === "string";
}
function isCandidate(value: unknown): value is ImageCandidate {
    return record(value) && typeof value.image_url === "string"
        && /^https?:\/\//i.test(value.image_url)
        && typeof value.source_url === "string" && typeof value.alt_text === "string";
}
function isImage(value: unknown): value is VenueImage {
    return record(value) && Number.isSafeInteger(value.id) && Number(value.id) > 0
        && Number.isSafeInteger(value.sort_order) && Number(value.sort_order) >= 0
        && typeof value.is_primary === "boolean" && typeof value.created_at === "string" && isCandidate(value);
}
function isPreview(value: unknown): value is VenuePreview {
    if (!record(value) || typeof value.preview_token !== "string" || !/^[\w-]{43}$/.test(value.preview_token)
        || !Number.isSafeInteger(value.expires_in) || Number(value.expires_in) <= 0 || !record(value.metadata)) return false;
    const metadata = value.metadata;
    return ["source_url", "name", "description", "address", "phone"].every((key) => typeof metadata[key] === "string")
        && Array.isArray(metadata.images) && metadata.images.every(isCandidate);
}
function isVenue(value: unknown): value is Venue {
    return resource(value)
        && ["name", "description", "location", "contact_name", "phone", "website", "notes"].every((key) => typeof value[key] === "string")
        && Array.isArray(value.images) && value.images.every(isImage)
        && (value.capacity === null || (Number.isInteger(value.capacity) && Number(value.capacity) > 0))
        && typeof value.status === "string" && Object.hasOwn(venueStatuses, value.status)
        && typeof value.is_favorite === "boolean";
}
function isQuote(value: unknown): value is VenueQuote {
    return resource(value)
        && (value.event_date === null || (typeof value.event_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.event_date)))
        && typeof value.price_per_guest === "string" && /^\d+\.\d{2}$/.test(value.price_per_guest)
        && typeof value.additional_costs === "string" && /^\d+\.\d{2}$/.test(value.additional_costs)
        && Number.isInteger(value.minimum_guests) && Number(value.minimum_guests) > 0
        && typeof value.notes === "string";
}

function isComparedQuote(value: unknown): value is ComparedQuote {
    return record(value)
        && ["quote_id", "venue_id", "minimum_guests", "billable_guests"].every((key) =>
            Number.isSafeInteger(value[key]) && Number(value[key]) > 0)
        && (value.event_date === null || (typeof value.event_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.event_date)))
        && ["price_per_guest", "meals_cost", "additional_costs", "total_cost", "difference_from_cheapest"].every((key) =>
            typeof value[key] === "string" && /^\d+\.\d{2}$/.test(value[key]))
        && typeof value.venue_name === "string" && typeof value.notes === "string";
}

function isComparison(value: unknown): value is VenueComparison {
    return record(value) && Number.isSafeInteger(value.expected_guests) && Number(value.expected_guests) > 0
        && value.cheapest_quote_label === "Lowest known calculated cost"
        && Array.isArray(value.comparisons) && value.comparisons.length >= 2 && value.comparisons.length <= 4
        && value.comparisons.every(isComparedQuote) && value.cheapest_quote_id === value.comparisons[0].quote_id;
}

const mediaErrors: Record<string, string> = {
    invalid_preview: "תוקף התצוגה המקדימה פג או שהיא אינה זמינה. בקשו תצוגה חדשה ובחרו שוב תמונות.",
    preview_rate_limited: "בוצעו יותר מדי ניסיונות ייבוא. המתינו רגע ונסו שוב.",
    invalid_url: "הזינו כתובת אתר תקינה שמתחילה ב־https:// או ב־http://.",
    blocked_destination: "אפשר לייבא רק מאתר ציבורי זמין.",
    inaccessible_website: "לא הצלחנו להגיע לאתר האולם. בדקו את הכתובת ונסו שוב.",
    timeout: "אתר האולם לא הגיב בזמן. נסו שוב מאוחר יותר.",
    missing_metadata: "לא נמצאו באתר פרטי אולם או תמונות לייבוא.",
    unsupported_response: "לא ניתן לייבא פרטים מהעמוד הזה.",
    response_too_large: "עמוד האתר גדול מדי לייבוא. נסו כתובת של עמוד אחר באתר.",
    too_many_redirects: "האתר מפנה בין יותר מדי כתובות. נסו כתובת אחרת.",
    preview_unavailable: "שירות הייבוא אינו זמין כרגע. נסו שוב מאוחר יותר.",
    unverified_image: "לא ניתן לאמת את התמונות שנבחרו. בקשו תצוגה מקדימה חדשה.",
    image_conflict: "גלריית האולם השתנתה. נסו שוב.",
};

async function request(url: string, signal: AbortSignal, method = "GET", body?: unknown, media = false): Promise<unknown> {
    const options = { credentials: "same-origin", signal, cache: "no-store" } as const;
    const headers: Record<string, string> = {};
    if (method !== "GET") {
        const csrf = await fetch("/api/auth/csrf/", options);
        const token = getCsrfToken();
        if (!csrf.ok || !token) throw new VenueApiError("לא ניתן לאמת את הבקשה. רעננו את העמוד והתחברו שוב במידת הצורך.");
        headers["X-CSRFToken"] = token;
        headers["Content-Type"] = "application/json";
    }
    const response = await fetch(url, {
        ...options, method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return null;
    const data: unknown = await response.json().catch(() => null);
    if (media && !response.ok) {
        const code = record(data) && record(data.error) && typeof data.error.code === "string" ? data.error.code : "";
        if (Object.hasOwn(mediaErrors, code)) throw new VenueApiError(mediaErrors[code], [], code);
        if (response.status === 429) throw new VenueApiError(mediaErrors.preview_rate_limited);
        if (response.status === 404) throw new VenueApiError("האולם או התמונה אינם זמינים בחתונה הזו.");
    }
    if (response.status === 400) {
        throw new VenueApiError("בדקו את השדות המסומנים ונסו שוב.", record(data) ? Object.keys(data) : []);
    }
    if (response.status === 401 || response.status === 403) {
        throw new VenueApiError("לא ניתן לאמת את הבקשה. רעננו את העמוד והתחברו שוב במידת הצורך.");
    }
    if (response.status === 404) throw new VenueApiError("האולם או ההצעה אינם זמינים בחתונה הזו. רעננו את הרשימה.");
    if (!response.ok) throw new VenueApiError("לא הצלחנו להשלים את הבקשה. נסו שוב בעוד רגע.");
    return data;
}

function checked<T>(value: unknown, guard: (value: unknown) => value is T): T {
    if (!guard(value)) throw new VenueApiError("התקבלה תשובה לא תקינה מהשרת. רעננו את הרשימה.");
    return value;
}
function list<T>(value: unknown, guard: (value: unknown) => value is T): T[] {
    if (!Array.isArray(value)) throw new VenueApiError("התקבלה תשובה לא תקינה מהשרת.");
    return value.map((item) => checked(item, guard));
}

export function venuesApi(weddingId: number) {
    const base = `/api/weddings/${weddingId}/venues/`;
    const quoteBase = (venueId: number) => `${base}${venueId}/quotes/`;
    return {
        async list(signal: AbortSignal) { return list(await request(base, signal), isVenue); },
        async compare(expected_guests: number, quote_ids: number[], signal: AbortSignal) {
            const result = checked(await request(`${base}compare/`, signal, "POST", { expected_guests, quote_ids }), isComparison);
            const returned = new Set(result.comparisons.map(({ quote_id }) => quote_id));
            if (result.expected_guests !== expected_guests || returned.size !== quote_ids.length
                || result.comparisons.length !== quote_ids.length || quote_ids.some((id) => !returned.has(id))) {
                throw new VenueApiError("תוצאות ההשוואה אינן תואמות לבחירה. נסו שוב.");
            }
            return result;
        },
        async detail(venueId: number, signal: AbortSignal) {
            return checked(await request(`${base}${venueId}/`, signal), isVenue);
        },
        async preview(venueId: number, website: string | undefined, signal: AbortSignal) {
            return checked(await request(`${base}${venueId}/metadata-preview/`,
                signal, "POST", website ? { website } : {}, true), isPreview);
        },
        async saveImages(venueId: number, token: string, urls: string[], signal: AbortSignal) {
            const payload = { preview_token: token, images: urls.map((image_url) => ({ image_url })) };
            const result = await request(`${base}${venueId}/images/`, signal, "POST", payload, true);
            return list(record(result) ? result.images : null, isImage);
        },
        async removeImage(venueId: number, id: number, signal: AbortSignal) {
            await request(`${base}${venueId}/images/${id}/`, signal, "DELETE", undefined, true);
        },
        async save(input: VenueInput | Partial<VenueInput>, signal: AbortSignal, id?: number) {
            return checked(await request(id ? `${base}${id}/` : base, signal, id ? "PATCH" : "POST", input), isVenue);
        },
        async remove(id: number, signal: AbortSignal) { await request(`${base}${id}/`, signal, "DELETE"); },
        async quotes(venueId: number, signal: AbortSignal) {
            return list(await request(quoteBase(venueId), signal), isQuote);
        },
        async saveQuote(venueId: number, input: QuoteInput, signal: AbortSignal, id?: number) {
            return checked(await request(id ? `${quoteBase(venueId)}${id}/` : quoteBase(venueId),
                signal, id ? "PATCH" : "POST", input), isQuote);
        },
        async removeQuote(venueId: number, id: number, signal: AbortSignal) {
            await request(`${quoteBase(venueId)}${id}/`, signal, "DELETE");
        },
    };
}

const ils = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS" });
export function formatVenueMoney(amount: string): string {
    const [whole, cents] = amount.split(".");
    return ils.formatToParts(BigInt(whole)).map((part) => part.type === "fraction" ? cents : part.value).join("");
}
