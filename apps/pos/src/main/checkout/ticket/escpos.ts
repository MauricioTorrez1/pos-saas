/** Code page 858 is the one of Spanish on Epson printers: it has the accents and the inverted marks. */
const CODE_PAGE_858_NUMBER = 19;

/** The bytes of the characters of Spanish that ASCII does not have. */
const CODE_PAGE_858: Readonly<Record<string, number>> = {
  á: 0xa0,
  é: 0x82,
  í: 0xa1,
  ó: 0xa2,
  ú: 0xa3,
  ñ: 0xa4,
  Ñ: 0xa5,
  ü: 0x81,
  Ü: 0x9a,
  Á: 0xb5,
  É: 0x90,
  Í: 0xd6,
  Ó: 0xe0,
  Ú: 0xe9,
  '¿': 0xa8,
  '¡': 0xad,
};

const ESC = 0x1b;
const GS = 0x1d;
const LINE_FEED = 0x0a;
const SPACE = 0x20;
const QUESTION_MARK = 0x3f;
const FIRST_PRINTABLE = 0x20;
const LAST_ASCII = 0x7e;
const MAX_BYTE = 255;

/** Where the text sits on the paper. */
export type Alignment = 'left' | 'center' | 'right';

const ALIGNMENT_CODES: Readonly<Record<Alignment, number>> = { left: 0, center: 1, right: 2 };

/**
 * Builds the ESC/POS bytes of a job, which is what the ticket printer understands. Text never carries a command: a
 * control character in a product name becomes a space, so a name cannot open the drawer or cut the paper.
 */
export class EscPosBuilder {
  readonly #bytes: number[] = [];

  /**
   * Resets the printer and chooses the code page of Spanish. Every job starts with this, so the settings of a
   * previous job cannot leak into it.
   *
   * @returns this builder
   */
  initialize(): this {
    return this.#command(ESC, 0x40, ESC, 0x74, CODE_PAGE_858_NUMBER);
  }

  /**
   * Sets where the following text sits.
   *
   * @param alignment left, center, or right
   * @returns this builder
   */
  align(alignment: Alignment): this {
    return this.#command(ESC, 0x61, ALIGNMENT_CODES[alignment]);
  }

  /**
   * Turns bold on or off.
   *
   * @param isOn whether the following text is bold
   * @returns this builder
   */
  bold(isOn: boolean): this {
    return this.#command(ESC, 0x45, isOn ? 1 : 0);
  }

  /**
   * Doubles the width and the height of the following text, or puts them back.
   *
   * @param isOn whether the following text is double size
   * @returns this builder
   */
  doubleSize(isOn: boolean): this {
    return this.#command(GS, 0x21, isOn ? 0x11 : 0x00);
  }

  /**
   * Writes text and ends the line.
   *
   * @param text the text. Characters that the code page cannot draw print as a question mark.
   * @returns this builder
   */
  line(text: string): this {
    for (const character of text) {
      this.#bytes.push(encodeCharacter(character));
    }
    this.#bytes.push(LINE_FEED);
    return this;
  }

  /**
   * Feeds paper.
   *
   * @param lines how many lines, from 0 to 255
   * @returns this builder
   * @throws RangeError if the number does not fit in one byte
   */
  feed(lines: number): this {
    if (!Number.isInteger(lines) || lines < 0 || lines > MAX_BYTE) {
      throw new RangeError(`Expected between 0 and ${MAX_BYTE} lines to feed, got ${lines}`);
    }
    return this.#command(ESC, 0x64, lines);
  }

  /**
   * Feeds the paper to the cutter and cuts it.
   *
   * @returns this builder
   */
  cut(): this {
    return this.#command(GS, 0x56, 0x42, 0);
  }

  /**
   * Sends the pulse that opens the cash drawer. The drawer hangs from the printer, so the command goes in a print job:
   * pin 2, on for 50 ms and off for 500 ms (the units are 2 ms), which is what the usual drawers expect.
   *
   * @returns this builder
   */
  openDrawer(): this {
    return this.#command(ESC, 0x70, 0, 25, 250);
  }

  /**
   * Gives the bytes of the job.
   *
   * @returns a copy, so changing it does not change the builder
   */
  toBytes(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }

  #command(...bytes: number[]): this {
    this.#bytes.push(...bytes);
    return this;
  }
}

function encodeCharacter(character: string): number {
  const special = CODE_PAGE_858[character];
  if (special !== undefined) {
    return special;
  }
  const code = character.codePointAt(0) ?? QUESTION_MARK;
  if (code < FIRST_PRINTABLE) {
    return SPACE;
  }
  return code <= LAST_ASCII ? code : QUESTION_MARK;
}
