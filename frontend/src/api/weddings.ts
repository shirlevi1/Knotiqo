import { getCsrfToken } from "./csrf";

export type Wedding = {
    id: number;
    name: string;
    wedding_date: string | null;
};

export type CreateWeddingInput = Pick<Wedding, "name" | "wedding_date">;
export type WeddingFieldErrors = Partial<Record<keyof CreateWeddingInput, string>>;

export class WeddingApiError extends Error {
    readonly fields: WeddingFieldErrors;

    constructor(message: string, fields: WeddingFieldErrors = {}) {
        super(message);
        this.fields = fields;
    }
}

function isWedding(value: unknown): value is Wedding {
    return typeof value === "object" && value !== null
        && "id" in value && typeof value.id === "number"
        && "name" in value && typeof value.name === "string"
        && "wedding_date" in value && (value.wedding_date === null
            || (typeof value.wedding_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.wedding_date)));
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
            }
            throw new WeddingApiError("בדקו את הפרטים שהזנתם ונסו שוב.", fields);
        }
        throw new WeddingApiError("לא ניתן להשלים את הבקשה כרגע. נסו שוב מאוחר יותר.");
    }
    try {
        return await response.json();
    } catch {
        throw new WeddingApiError("התקבלה תשובה לא צפויה מהשרת. רעננו את הדף.");
    }
}

export async function getWeddings(signal: AbortSignal): Promise<Wedding[]> {
    const response = await fetch("/api/weddings/", { credentials: "same-origin", signal });
    const data = await readResponse(response);
    if (!Array.isArray(data) || !data.every(isWedding)) {
        throw new WeddingApiError("התקבלה תשובה לא צפויה מהשרת. נסו לטעון שוב.");
    }
    return data;
}

export async function createWedding(input: CreateWeddingInput): Promise<Wedding> {
    const csrfResponse = await fetch("/api/auth/csrf/", { credentials: "same-origin" });
    if (!csrfResponse.ok) {
        throw new WeddingApiError("לא ניתן לאתחל את בדיקת האבטחה. נסו שוב.");
    }
    const token = getCsrfToken();
    if (!token) throw new WeddingApiError("לא נמצא אישור אבטחה. רעננו את הדף ונסו שוב.");

    const response = await fetch("/api/weddings/", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify(input),
    });
    const data = await readResponse(response);
    if (response.status !== 201 || !isWedding(data)) {
        throw new WeddingApiError("לא ניתן לאשר את תוצאת היצירה. רעננו את הדף לפני ניסיון נוסף.");
    }
    return data;
}
