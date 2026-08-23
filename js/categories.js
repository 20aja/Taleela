export const GAME_CATEGORIES = [
  {id: "general", name: "معلومات عامة", icon: "fa-solid fa-globe", image: "assets/categories/general.webp"},
  {id: "history", name: "التاريخ", icon: "fa-solid fa-landmark", image: "assets/categories/history.webp"},
  {id: "geography", name: "الجغرافيا", icon: "fa-solid fa-earth-americas", image: "assets/categories/geography.webp"},
  {id: "science", name: "العلوم", icon: "fa-solid fa-flask", image: "assets/categories/science.webp"},
  {id: "technology", name: "التكنولوجيا", icon: "fa-solid fa-microchip", image: "assets/categories/technology.webp"},
  {id: "sports", name: "الرياضة", icon: "fa-solid fa-medal", image: "assets/categories/sports.webp"},
  {id: "football", name: "كرة القدم", icon: "fa-solid fa-futbol", image: "assets/categories/football.webp"},
  {id: "player_guess", name: "خمن اللاعب", icon: "fa-solid fa-user-secret", image: "assets/categories/player_guess.webp"},
  {id: "movies", name: "الأفلام", icon: "fa-solid fa-film", image: "assets/categories/movies.webp"},
  {id: "series", name: "المسلسلات", icon: "fa-solid fa-tv", image: "assets/categories/series.webp"},
  {id: "bab_al_hara", name: "باب الحارة", icon: "fa-solid fa-door-open", image: "assets/categories/bab_al_hara.webp"},
  {id: "music", name: "الموسيقى", icon: "fa-solid fa-music", image: "assets/categories/music.webp"},
  {id: "literature", name: "الأدب", icon: "fa-solid fa-book", image: "assets/categories/literature.webp"},
  {id: "language", name: "اللغة العربية", icon: "fa-solid fa-language", image: "assets/categories/language.webp"},
  {id: "islamic", name: "الثقافة الإسلامية", icon: "fa-solid fa-mosque", image: "assets/categories/islamic.webp"},
  {id: "countries", name: "الدول والعواصم", icon: "fa-solid fa-city", image: "assets/categories/countries.webp"},
  {id: "animals", name: "الحيوانات", icon: "fa-solid fa-paw", image: "assets/categories/animals.webp"},
  {id: "food", name: "الطعام", icon: "fa-solid fa-utensils", image: "assets/categories/food.webp"},
  {id: "inventions", name: "الاختراعات", icon: "fa-solid fa-lightbulb", image: "assets/categories/inventions.webp"},
  {id: "space", name: "الفضاء", icon: "fa-solid fa-rocket", image: "assets/categories/space.webp"},
  {id: "medicine", name: "الطب", icon: "fa-solid fa-stethoscope", image: "assets/categories/medicine.webp"},
  {id: "cars", name: "السيارات", icon: "fa-solid fa-car", image: "assets/categories/cars.webp"},
  {id: "programming", name: "البرمجة", icon: "fa-solid fa-code", image: "assets/categories/programming.webp"},
  {id: "internet", name: "الإنترنت", icon: "fa-solid fa-wifi", image: "assets/categories/internet.webp"},
  {id: "art", name: "الفن", icon: "fa-solid fa-palette", image: "assets/categories/art.webp"},
  {id: "fashion", name: "الموضة", icon: "fa-solid fa-shirt", image: "assets/categories/fashion.webp"},
  {id: "brands", name: "العلامات التجارية", icon: "fa-solid fa-tag", image: "assets/categories/brands.webp"},
  {id: "famous_people", name: "شخصيات مشهورة", icon: "fa-solid fa-user", image: "assets/categories/famous_people.webp"},
  {id: "riddles", name: "ألغاز", icon: "fa-solid fa-puzzle-piece", image: "assets/categories/riddles.webp"},
  {id: "logic", name: "المنطق", icon: "fa-solid fa-brain", image: "assets/categories/logic.webp"},
  {id: "numbers", name: "الأرقام والحساب", icon: "fa-solid fa-calculator", image: "assets/categories/numbers.webp"},
  {id: "culture", name: "الثقافة", icon: "fa-solid fa-masks-theater", image: "assets/categories/culture.webp"},
  {id: "iraq", name: "بلاد الرافدين", icon: "fa-solid fa-landmark-dome", image: "assets/categories/iraq.webp"},
];

export const CATEGORY_NAMES = Object.freeze(Object.fromEntries(GAME_CATEGORIES.map((category) => [category.id, category.name])));
const CATEGORY_IDS = new Set(GAME_CATEGORIES.map((category) => category.id));

export function categoryHasQuestions(categoryId) {
  return CATEGORY_IDS.has(String(categoryId || ""));
}
