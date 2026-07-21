export const TURKISH_WORKING_PHRASES = [
  "Yardırıyorum",
  "Kanırtıyorum",
  "Piston aşağı indi",
  "Motoru ısıtıyorum",
  "Vites yükseltiyorum",
  "İşlem gerçekleştiriyorum",
  "Kazan kaldırıyorum",
  "Harıl harıl çalışıyorum",
  "İnce ayar çekiyorum",
  "Söküp takıyorum",
  "Evirip çeviriyorum",
  "Yoğuruyorum",
  "Sistemsel bir hata tespit edildi",
  "Taşları yerine oturtuyorum",
  "Hallediyorum",
  "Hakkını veriyorum",
  "Bir işler çeviriyorum",
  "Altından girip üstünden çıkıyorum",
  "Kafa göz dalıyorum",
  "Kafa atıyorum",
  "Kalkışıyorum",
  "Yan gelip yatıyorum",
  "Sana hesap vermiyorum",
  "Bana mısın demiyorum",
  "İt gibi çalışıyorum",
  "Esssek gibi çalışıyorum",
  "Baltayı taşa vuruyorum",
  "İşi yokuşa sürüyorum",
  "Suyunu çıkarıyorum",
  "Şalteri indiriyorum",
  "Vuruyorum kırbacı",
  "Gözünün yaşına bakmıyorum",
  "İpe un seriyorum",
  "Çamura yatıyorum",
  "Tüy dikiyorum",
  "Nalları dikiyorum",
  "Damardan giriyorum",
  "Tozunu attırıyorum",
  "Racon kesiyorum",
  "Canımı dişime takıyorum",
  "Usta",
  "Yaparım",
  "Sıçtın mavisini izliyorum",
] as const;

export function pickWorkingPhrase(random: () => number = Math.random): string {
  const index = Math.floor(random() * TURKISH_WORKING_PHRASES.length);
  return TURKISH_WORKING_PHRASES[index] ?? TURKISH_WORKING_PHRASES[0];
}

export class WorkingPhraseState {
  private phrase: string | undefined;

  public get current(): string | undefined {
    return this.phrase;
  }

  public start(random: () => number = Math.random): string {
    this.phrase ??= pickWorkingPhrase(random);
    return this.phrase;
  }

  public reset(): void {
    this.phrase = undefined;
  }
}
