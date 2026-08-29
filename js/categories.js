// Order and names mirror questions/v1/manifest.json exactly.
export const GAME_CATEGORIES = [
  {id: "general", name: "معلومات عامة", icon: "fa-solid fa-globe", image: "assets/categories/general.png"},
  {id: "quran", name: "القرآن الكريم", icon: "fa-solid fa-quran", image: "assets/categories/quran.png"},
  {id: "science", name: "العلوم", icon: "fa-solid fa-flask", image: "assets/categories/science.png"},
  {id: "sports", name: "الرياضة", icon: "fa-solid fa-medal", image: "assets/categories/sports.png"},
  {id: "technology", name: "التكنولوجيا", icon: "fa-solid fa-microchip", image: "assets/categories/technology.png"},
  {id: "history", name: "التاريخ", icon: "fa-solid fa-landmark", image: "assets/categories/history.png"},
  {id: "geography", name: "الجغرافيا", icon: "fa-solid fa-earth-americas", image: "assets/categories/geography.png"},
  {id: "countries", name: "الدول", icon: "fa-solid fa-map", image: "assets/categories/countries.png"},
  {id: "babalhara", name: "باب الحارة", icon: "fa-solid fa-door", image: "assets/categories/babalhara.png"},
  {id: "arabic-literature", name: "اللغة العربية والأدب", icon: "fa-solid fa-book-open", image: "assets/categories/language.png"},
  {id: "origins", name: "أصل الأشياء", icon: "fa-solid fa-seedling", image: "assets/categories/origins.png"},
  {id: "movies-series", name: "الأفلام ومسلسلات", icon: "fa-solid fa-film", image: "assets/categories/movies.png"},
  {id: "logic", name: "الفلسفة والمنطق", icon: "fa-solid fa-puzzles", image: "assets/categories/logic.png"},
  {id: "arts", name: "الفنون", icon: "fa-solid fa-arts", image: "assets/categories/arts.png"},
  {id: "people", name: "شخصيات مشهورة", icon: "fa-solid fa-user", image: "assets/categories/people.png"},
  {id: "player-guess", name: "خمن اللاعب", icon: "fa-solid fa-user-secret", image: "assets/categories/player_guess.png"},
  {id: "animals", name: "عالم الحيوان", icon: "fa-solid fa-paw", image: "assets/categories/animals.png"},
  {id: "food", name: "الطعام", icon: "fa-solid fa-utensils", image: "assets/categories/food.png"},
  {id: "inventions", name: "الاختراعات", icon: "fa-solid fa-lightbulb", image: "assets/categories/inventions.png"},
  {id: "mathematics", name: "الأرقام والحسابات", icon: "fa-solid fa-math", image: "assets/categories/mathematics.png"},
  {id: "puzzles", name: "الألغاز", icon: "fa-solid fa-puzzles", image: "assets/categories/puzzles.png"},
];

export const CATEGORY_NAMES = Object.freeze(Object.fromEntries(GAME_CATEGORIES.map((category) => [category.id, category.name])));
const CATEGORY_IDS = new Set(GAME_CATEGORIES.map((category) => category.id));

export function categoryHasQuestions(categoryId) {
  return CATEGORY_IDS.has(String(categoryId || ""));
}
