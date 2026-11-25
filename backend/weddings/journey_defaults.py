STAGES = (
    ("לפני סגירת אולם", (
        ("budget-initial", "קביעת תקציב ראשוני", "budget"),
        ("guest-estimate", "בניית רשימת מוזמנים משוערת", "guests"),
        ("area-dates", "בחירת אזור ותאריכים אפשריים", ""),
        ("venue-search", "חיפוש אולמות", "venues"),
        ("venue-tours", "קביעת סיורים באולמות", "meetings"),
        ("venue-compare", "השוואת הצעות מחיר", "venues/compare"),
        ("venue-contract", "בחירת אולם וסגירת חוזה", "venues"),
    )),
    ("אחרי סגירת האולם", (
        ("venue-booking", "שמירת פרטי סגירת האולם", "venues"),
        ("deposit", "תיעוד מקדמה ולוח תשלומים", "budget"),
        ("photographer", "סגירת צלם", "vendors"),
        ("dj", "סגירת DJ", "vendors"),
        ("lighting", "בדיקת הגברה ותאורה", "vendors"),
        ("decor", "בחינת עיצוב ואטרקציות", "vendors"),
        ("budget-detail", "עדכון התקציב המפורט", "budget"),
    )),
    ("3–6 חודשים לפני החתונה", (
        ("dress", "בחירת שמלת כלה", "vendors"),
        ("suit", "בחירת חליפת חתן", "vendors"),
        ("beauty", "קביעת איפור ושיער", "vendors"),
        ("rings", "בחירת טבעות", ""),
        ("rabbinical", "טיפול ברבנות ומקווה", ""),
        ("more-vendors", "סגירת אנשי מקצוע נוספים", "vendors"),
        ("follow-meetings", "מעקב אחרי פגישות ומשימות", "meetings"),
    )),
    ("חודש עד שבועיים לפני החתונה", (
        ("prepare-invitations", "הכנת הזמנות לחתונה", ""),
        ("send-invitations", "שליחת הזמנות", ""),
        ("rsvp", "איסוף אישורי הגעה", "guests"),
        ("follow-rsvp", "מעקב אחר מי שלא השיב", "guests"),
        ("guest-count", "בדיקת כמויות מוזמנים מעודכנות", "guests"),
        ("venue-followup", "תיאום המשך מול האולם", "venues"),
    )),
    ("השבוע האחרון והסידורים הסופיים", (
        ("seating", "סידורי הושבה", ""),
        ("tables", "חלוקת שולחנות ומשפחות", ""),
        ("final-guests", "אישור מספר מוזמנים סופי", "guests"),
        ("final-vendors", "תיאום אחרון עם ספקים", "vendors"),
        ("final-payments", "בדיקת תשלומים שנותרו", "budget"),
        ("pack", "הכנת תיק ליום החתונה", ""),
        ("timeline", "סגירת לוח הזמנים הסופי", ""),
    )),
    ("יום החתונה", (
        ("check-timeline", "בדיקת לוח הזמנים", ""),
        ("documents", "הכנת טבעות ומסמכים", ""),
        ("contacts", "אנשי קשר חשובים", "vendors"),
        ("vendor-arrivals", "אישור הגעת ספקים", ""),
        ("equipment", "בדיקת ציוד אישי", ""),
        ("enjoy", "ליהנות מהחתונה!", ""),
    )),
)

DEFAULTS = {
    key: {"stage": number, "title": title, "module": module, "position": position}
    for number, (_, tasks) in enumerate(STAGES, 1)
    for position, (key, title, module) in enumerate(tasks)
}
