import { useState, useEffect } from "react";

export type Language = "en" | "tr";

type TranslationKeys = {
  [key: string]: string;
};

const en: TranslationKeys = {
  "app.title": "Categoriends",
  "app.subtitle": "Midnight word battles",
  "home.solo": "Solo Mode",
  "home.createRoom": "Create Room",
  "home.joinRoom": "Join Room",
  "home.language": "Language",
  "setup.chooseCategory": "Choose a Category",
  "setup.customCategory": "Or type a custom category...",
  "setup.customCategoryPlaceholder": "e.g. 90s Action Movies",
  "setup.startSolo": "Start Solo Game",
  "setup.mode": "Game Mode",
  "setup.mode.duel": "1v1 Duel",
  "setup.mode.party": "Party (3+ Players)",
  "setup.create": "Create Room",
  "join.title": "Join Room",
  "join.codePlaceholder": "Room Code",
  "join.namePlaceholder": "Your Nickname",
  "join.button": "Join",
  "lobby.code": "Room Code:",
  "lobby.waiting": "Waiting for players...",
  "lobby.start": "Start Game",
  "lobby.players": "Players",
  "game.timeLeft": "Time Left",
  "game.answerPlaceholder": "Type your answer...",
  "game.submit": "Send",
  "game.yourTurn": "Your Turn!",
  "game.waiting": "Waiting for",
  "game.eliminated": "Eliminated",
  "result.title": "Game Over",
  "result.winner": "Winner:",
  "result.score": "Score:",
  "result.playAgain": "Play Again",
  "category.Games": "Games",
  "category.Sports": "Sports",
  "category.Film & TV": "Film & TV",
  "category.Music": "Music",
  "category.Food & Drink": "Food & Drink",
  "category.Science": "Science",
  "category.History": "History",
  "category.Geography": "Geography",
  "category.Animals": "Animals",
  "category.General Knowledge": "General Knowledge",
};

const tr: TranslationKeys = {
  "app.title": "Categoriends",
  "app.subtitle": "Gece yarısı kelime savaşları",
  "home.solo": "Tek Oyunculu",
  "home.createRoom": "Oda Kur",
  "home.joinRoom": "Odaya Katıl",
  "home.language": "Dil",
  "setup.chooseCategory": "Bir Kategori Seç",
  "setup.customCategory": "Veya kendi kategorini yaz...",
  "setup.customCategoryPlaceholder": "örn. 90'lar Aksiyon Filmleri",
  "setup.startSolo": "Başla",
  "setup.mode": "Oyun Modu",
  "setup.mode.duel": "1v1 Düello",
  "setup.mode.party": "Parti (3+ Oyuncu)",
  "setup.create": "Odayı Kur",
  "join.title": "Odaya Katıl",
  "join.codePlaceholder": "Oda Kodu",
  "join.namePlaceholder": "Kullanıcı Adın",
  "join.button": "Katıl",
  "lobby.code": "Oda Kodu:",
  "lobby.waiting": "Oyuncular bekleniyor...",
  "lobby.start": "Oyunu Başlat",
  "lobby.players": "Oyuncular",
  "game.timeLeft": "Kalan Süre",
  "game.answerPlaceholder": "Cevabını yaz...",
  "game.submit": "Gönder",
  "game.yourTurn": "Senin Sıran!",
  "game.waiting": "Bekleniyor:",
  "game.eliminated": "Elendi",
  "result.title": "Oyun Bitti",
  "result.winner": "Kazanan:",
  "result.score": "Puan:",
  "result.playAgain": "Tekrar Oyna",
  "category.Games": "Oyunlar",
  "category.Sports": "Spor",
  "category.Film & TV": "Film & Dizi",
  "category.Music": "Müzik",
  "category.Food & Drink": "Yiyecek & İçecek",
  "category.Science": "Bilim",
  "category.History": "Tarih",
  "category.Geography": "Coğrafya",
  "category.Animals": "Hayvanlar",
  "category.General Knowledge": "Genel Kültür",
};

const translations = { en, tr };

export function useTranslation() {
  const [lang, setLang] = useState<Language>(() => {
    return (localStorage.getItem("categoriends_lang") as Language) || "en";
  });

  useEffect(() => {
    localStorage.setItem("categoriends_lang", lang);
  }, [lang]);

  const t = (key: string): string => {
    return translations[lang][key] || key;
  };

  return { t, lang, setLang };
}
