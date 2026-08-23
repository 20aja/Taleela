export const GAME_CATEGORIES = [
  {id: "general", name: "معلومات عامة", icon: "fa-solid fa-globe"},
  {id: "history", name: "التاريخ", icon: "fa-solid fa-landmark"},
  {id: "geography", name: "الجغرافيا", icon: "fa-solid fa-earth-americas"},
  {id: "science", name: "العلوم", icon: "fa-solid fa-flask"},
  {id: "technology", name: "التكنولوجيا", icon: "fa-solid fa-microchip"},
  {id: "sports", name: "الرياضة", icon: "fa-solid fa-medal"},
  {id: "football", name: "كرة القدم", icon: "fa-solid fa-futbol"},
  {id: "player_guess", name: "خمن اللاعب", icon: "fa-solid fa-user-secret"},
  {id: "movies", name: "الأفلام", icon: "fa-solid fa-film"},
  {id: "series", name: "المسلسلات", icon: "fa-solid fa-tv"},
  {id: "bab_al_hara", name: "باب الحارة", icon: "fa-solid fa-door-open"},
  {id: "music", name: "الموسيقى", icon: "fa-solid fa-music"},
  {id: "literature", name: "الأدب", icon: "fa-solid fa-book"},
  {id: "language", name: "اللغة العربية", icon: "fa-solid fa-language"},
  {id: "islamic", name: "الثقافة الإسلامية", icon: "fa-solid fa-mosque"},
  {id: "countries", name: "الدول والعواصم", icon: "fa-solid fa-city"},
  {id: "animals", name: "الحيوانات", icon: "fa-solid fa-paw"},
  {id: "food", name: "الطعام", icon: "fa-solid fa-utensils"},
  {id: "inventions", name: "الاختراعات", icon: "fa-solid fa-lightbulb"},
  {id: "space", name: "الفضاء", icon: "fa-solid fa-rocket"},
  {id: "medicine", name: "الطب", icon: "fa-solid fa-stethoscope"},
  {id: "cars", name: "السيارات", icon: "fa-solid fa-car"},
  {id: "programming", name: "البرمجة", icon: "fa-solid fa-code"},
  {id: "internet", name: "الإنترنت", icon: "fa-solid fa-wifi"},
  {id: "art", name: "الفن", icon: "fa-solid fa-palette"},
  {id: "fashion", name: "الموضة", icon: "fa-solid fa-shirt"},
  {id: "brands", name: "العلامات التجارية", icon: "fa-solid fa-tag"},
  {id: "famous_people", name: "شخصيات مشهورة", icon: "fa-solid fa-user"},
  {id: "riddles", name: "ألغاز", icon: "fa-solid fa-puzzle-piece"},
  {id: "logic", name: "المنطق", icon: "fa-solid fa-brain"},
  {id: "numbers", name: "الأرقام والحساب", icon: "fa-solid fa-calculator"},
  {id: "culture", name: "الثقافة", icon: "fa-solid fa-masks-theater"},
  {id: "iraq", name: "بلاد الرافدين", icon: "fa-solid fa-landmark-dome"},
];

export const CATEGORY_NAMES = Object.freeze(Object.fromEntries(GAME_CATEGORIES.map((category) => [category.id, category.name])));
const CATEGORY_IDS = new Set(GAME_CATEGORIES.map((category) => category.id));

export function categoryHasQuestions(categoryId) {
  return CATEGORY_IDS.has(String(categoryId || ""));
}
