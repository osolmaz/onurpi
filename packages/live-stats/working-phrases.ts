export const TURKISH_WORKING_PHRASES = [
  "Yardırıyorum",
  "Kanırtıyorum",
  "Piston aşağı indi",
  "Motoru ısıtıyorum",
  "Vites yükseltiyorum",
  "Çarkları döndürüyorum",
  "Kazan kaldırıyorum",
  "Harıl harıl çalışıyorum",
  "İnce ayar çekiyorum",
  "Söküp takıyorum",
  "Evirip çeviriyorum",
  "Yoğuruyorum",
  "Sistemsel bir hata tespit edildi",
  "Taşları yerine oturtuyorum",
  "Hallediyorum",
  "Bir işler çeviriyorum",
  "Altından girip üstünden çıkıyorum",
  "Kafa göz dalıyorum",
  "Kalkışıyorum",
  "İt gibi çalışıyorum",
  "Eşek gibi çalışıyorum",
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
