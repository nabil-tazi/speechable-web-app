declare module "gtts" {
  export default class gTTS {
    constructor(text: string, lang?: string, slow?: boolean);
    save(filepath: string, callback: (err: Error | null) => void): void;
    stream(): NodeJS.ReadableStream;
  }
}
