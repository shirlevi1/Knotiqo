import { getCsrfToken } from "./csrf";

export type CoupleNames = {
    creator_display_name: string;
    partner_display_name: string;
};

export type Wedding = Partial<CoupleNames> & {
    id: number;
    name: string;
    wedding_date: string | null;
    cover_image_url?: string | null;
};

type WeddingMembership = { display_name: string | null; first_name?: string | null };

type WeddingDetailsPayload = Wedding & { memberships: WeddingMembership[] };
export type WeddingDetails = WeddingDetailsPayload & CoupleNames;

export type CreateWeddingInput = Pick<Wedding, "name" | "wedding_date"> & CoupleNames;
export type WeddingFieldErrors = Partial<Record<keyof CreateWeddingInput, string>>;

export class WeddingApiError extends Error {
    readonly fields: WeddingFieldErrors;

    constructor(message: string, fields: WeddingFieldErrors = {}) {
        super(message);
        this.fields = fields;
    }
}

function isCoupleNames(value: unknown): value is CoupleNames {
    return typeof value === "object" && value !== null
        && "creator_display_name" in value && typeof value.creator_display_name === "string"
        && "partner_display_name" in value && typeof value.partner_display_name === "string";
}

export function isWedding(value: unknown): value is Wedding {
    return typeof value === "object" && value !== null
        && (!("creator_display_name" in value) || typeof value.creator_display_name === "string")
        && (!("partner_display_name" in value) || typeof value.partner_display_name === "string")
        && (!("cover_image_url" in value) || isCoverUrl(value.cover_image_url))
        && "id" in value && typeof value.id === "number"
        && "name" in value && typeof value.name === "string"
        && "wedding_date" in value && (value.wedding_date === null
            || (typeof value.wedding_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.wedding_date)));
}

function isCoverUrl(value: unknown): value is string | null {
    return value === null || (typeof value === "string" && /^\/api\/weddings\/\d+\/cover\/\?v=[a-f0-9]{16}$/.test(value));
}

const coupleNameError = "יש להזין שם באורך של עד 80 תווים.";
const coupleNameFields = ["creator_display_name", "partner_display_name"] as const;

export function readCoupleNames(form: FormData): CoupleNames {
    return {
        creator_display_name: String(form.get("creator_display_name") ?? "").trim(),
        partner_display_name: String(form.get("partner_display_name") ?? "").trim(),
    };
}

export function validateCoupleNames(names: CoupleNames): WeddingFieldErrors {
    const errors: WeddingFieldErrors = {};
    for (const field of coupleNameFields) {
        if (!names[field] || Array.from(names[field]).length > 80) errors[field] = coupleNameError;
    }
    return errors;
}

async function readResponse(response: Response): Promise<unknown> {
    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            throw new WeddingApiError("לא ניתן לאמת את הבקשה. רעננו את הדף והתחברו שוב במידת הצורך.");
        }
        if (response.status === 400) {
            const data: unknown = await response.json().catch(() => null);
            const fields: WeddingFieldErrors = {};
            if (typeof data === "object" && data !== null) {
                if ("name" in data) fields.name = "יש להזין שם חתונה באורך של עד 150 תווים.";
                if ("wedding_date" in data) fields.wedding_date = "יש להזין תאריך תקין או להשאיר את השדה ריק.";
                for (const field of coupleNameFields) {
                    if (field in data) fields[field] = coupleNameError;
                }
            }
            throw new WeddingApiError("בדקו את הפרטים שהזנתם ונסו שוב.", fields);
        }
        if (response.status === 404) throw new WeddingApiError("החתונה אינה זמינה לחשבון הזה.");
        throw new WeddingApiError("לא ניתן להשלים את הבקשה כרגע. נסו שוב מאוחר יותר.");
    }
    try {
        return await response.json();
    } catch {
        throw new WeddingApiError("התקבלה תשובה לא צפויה מהשרת. רעננו את הדף.");
    }
}

function isWeddingMembership(value: unknown): value is WeddingMembership {
    return typeof value === "object" && value !== null
        && "display_name" in value
        && (value.display_name === null || typeof value.display_name === "string")
        && (!("first_name" in value) || value.first_name === null || typeof value.first_name === "string");
}

function isWeddingDetails(value: unknown): value is WeddingDetailsPayload {
    return isWedding(value) && "memberships" in value
        && Array.isArray(value.memberships) && value.memberships.every(isWeddingMembership);
}

export async function getWeddings(signal: AbortSignal): Promise<WeddingDetails[]> {
    const response = await fetch("/api/weddings/?include=memberships", { credentials: "same-origin", signal });
    const data = await readResponse(response);
    if (!Array.isArray(data) || !data.every(isWeddingDetails)) {
        throw new WeddingApiError("התקבלה תשובה לא צפויה מהשרת. נסו לטעון שוב.");
    }
    return data.map((wedding) => ({
        ...wedding,
        creator_display_name: wedding.creator_display_name ?? "",
        partner_display_name: wedding.partner_display_name ?? "",
    }));
}

async function csrfForWedding(options: RequestInit) {
    const csrfResponse = await fetch("/api/auth/csrf/", options);
    if (!csrfResponse.ok) {
        throw new WeddingApiError("לא ניתן לאתחל את בדיקת האבטחה. נסו שוב.");
    }
    const token = getCsrfToken();
    if (!token) throw new WeddingApiError("לא נמצא אישור אבטחה. רעננו את הדף ונסו שוב.");
    return token;
}

async function writeWedding(url: string, method: "POST" | "PUT" | "PATCH", input: CoupleNames | Pick<Wedding, "wedding_date">, signal?: AbortSignal) {
    const options = { credentials: "same-origin", signal } as const;
    const token = await csrfForWedding(options);
    const response = await fetch(url, {
        ...options,
        method,
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify(input),
    });
    return { status: response.status, data: await readResponse(response) };
}

export async function updateWeddingCover(weddingId: number, file: File | null, signal: AbortSignal) {
    const options = { credentials: "same-origin", signal, cache: "no-store" } as const;
    const token = await csrfForWedding(options);
    const body = file ? new FormData() : undefined;
    if (file) body?.append("cover", file);
    const path = `/api/weddings/${weddingId}/cover/`;
    const response = await fetch(path, {
        ...options, method: file ? "POST" : "DELETE", body,
        headers: { "X-CSRFToken": token },
    });
    if (response.status === 413) throw new WeddingApiError("אפשר להעלות תמונה בגודל של עד 5 MB.");
    if (response.status === 400 || response.status === 415) {
        const data = await response.json().catch(() => null);
        throw new WeddingApiError(data?.code === "unsafe_dimensions"
            ? "ממדי התמונה גדולים מדי. בחרו תמונה קטנה יותר."
            : "לא הצלחנו לקרוא את התמונה. בחרו קובץ JPEG, PNG או WebP תקין.");
    }
    const data = await readResponse(response);
    if (typeof data !== "object" || data === null || !("cover_image_url" in data)
        || !isCoverUrl(data.cover_image_url) || (file
            ? !data.cover_image_url?.startsWith(path + "?") : data.cover_image_url !== null)) {
        throw new WeddingApiError("לא הצלחנו לאשר את עדכון התמונה. רעננו את העמוד.");
    }
    return data.cover_image_url;
}

export async function createWedding(input: CreateWeddingInput): Promise<Wedding> {
    const { status, data } = await writeWedding("/api/weddings/", "POST", input);
    if (status !== 201 || !isWedding(data)) {
        throw new WeddingApiError("לא ניתן לאשר את תוצאת היצירה. רעננו את הדף לפני ניסיון נוסף.");
    }
    return data;
}

export async function updateCoupleNames(weddingId: number, input: CoupleNames, signal: AbortSignal): Promise<CoupleNames> {
    const { data } = await writeWedding(`/api/weddings/${weddingId}/couple-names/`, "PUT", input, signal);
    if (!isCoupleNames(data)) throw new WeddingApiError("לא ניתן לאשר ששמות הזוג נשמרו. רעננו את הדף.");
    return { creator_display_name: data.creator_display_name, partner_display_name: data.partner_display_name };
}

export async function updateWeddingDate(id: number, date: string | null, signal: AbortSignal) {
    const { data } = await writeWedding(`/api/weddings/${id}/`, "PATCH", { wedding_date: date }, signal);
    if (typeof data !== "object" || data === null || !("wedding_date" in data) || data.wedding_date !== date) {
        throw new WeddingApiError("לא ניתן לאשר שהתאריך נשמר. רעננו את הדף.");
    }
    return date;
}