import { useId } from "react";
import { type CoupleNames, type WeddingFieldErrors } from "../api/weddings";

export default function CoupleNameFields({ errors, names }: { errors: WeddingFieldErrors; names?: CoupleNames }) {
    const id = useId();
    const labels = {
        creator_display_name: names ? "שם יוצר/ת החתונה" : "השם שלך",
        partner_display_name: "שם בן/בת הזוג",
    };
    return (
        <div className="couple-name-fields">
            {(Object.keys(labels) as (keyof CoupleNames)[]).map((field) => {
                const inputId = `${id}-${field}`;
                return (
                    <div className="ui-field" key={field}>
                        <label htmlFor={inputId}>{labels[field]}</label>
                        <input className="ui-input" id={inputId} name={field} dir="auto"
                            required maxLength={80} defaultValue={names?.[field]}
                            aria-invalid={errors[field] ? true : undefined}
                            aria-describedby={errors[field] ? `${inputId}-error` : undefined} />
                        {errors[field] && <p id={`${inputId}-error`} className="ui-error" role="alert">{errors[field]}</p>}
                    </div>
                );
            })}
        </div>
    );
}
