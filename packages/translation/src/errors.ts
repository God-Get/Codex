export class TranslationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "TranslationError";
  }
}
