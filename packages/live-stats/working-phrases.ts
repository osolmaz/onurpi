export const TURKISH_WORKING_PHRASES = [
  "Yardırıyorum",
  "Kanırtıyorum",
  "Piston aşağı indi",
  "Motoru ısıtıyorum",
  "Vites yükseltiyorum",
  "Çarkları döndürüyorum",
  "Kazanı kaynatıyorum",
  "Harıl harıl çalışıyorum",
  "İnce ayar çekiyorum",
  "Söküp takıyorum",
  "Evirip çeviriyorum",
  "Kodu yoğuruyorum",
  "Sistemi dürtüyorum",
  "Taşları yerine oturtuyorum",
  "Hallediyorum",
  "Bir şeyler çeviriyorum",
  "Altından girip üstünden çıkıyorum",
  "Şanzımana kuvvet",
  "Ustası hallediyor",
  "Kayış koptu kopacak",
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
