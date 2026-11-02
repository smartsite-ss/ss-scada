// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * InteractivePrompts - an interactive prompt utility built on Node.js built-in readline
 *
 * Does not depend on inquirer.js; implemented with readline + process.stdin.
 * Degrades gracefully in non-TTY environments (throws a clear error).
 */

import * as readline from 'readline';
import * as tty from 'tty';

/** Choice (single-select) */
export interface SelectChoice {
  name: string;
  value: string;
}

/** Choice (multi-select) */
export interface MultiSelectChoice {
  name: string;
  value: string;
  checked?: boolean;
}

/** Validator: returns null on success, or a string error message on failure */
export type Validator = (value: string) => string | null;

/**
 * Ensure the current environment supports interactive input
 * Throws a clear error in non-TTY environments
 */
function ensureTty(): void {
  if (!process.stdin.isTTY) {
    throw new Error(
      'Interactive mode requires a TTY environment. ' +
        'Please run this command in an interactive terminal.',
    );
  }
}

/** Create the readline interface */
function createInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Confirmation prompt
 * @param message prompt message
 * @param defaultValue default value (used when the user presses Enter directly)
 * @returns the user's choice, true/false
 */
export function confirm(message: string, defaultValue?: boolean): Promise<boolean> {
  ensureTty();
  const hint = defaultValue !== undefined ? (defaultValue ? 'Y/n' : 'y/N') : 'y/n';
  const prompt = `${message} (${hint}) `;

  return new Promise<boolean>((resolve) => {
    const rl = createInterface();
    rl.question(prompt, (answer: string) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === '') {
        resolve(defaultValue ?? false);
      } else {
        resolve(trimmed === 'y' || trimmed === 'yes');
      }
    });
  });
}

/**
 * Input prompt
 * @param message prompt message
 * @param defaultValue default value
 * @param validator validation function (optional)
 * @returns the string entered by the user
 */
export function input(
  message: string,
  defaultValue?: string,
  validator?: Validator,
): Promise<string> {
  ensureTty();
  const hint = defaultValue !== undefined ? ` (default: ${defaultValue})` : '';
  const prompt = `${message}${hint}: `;

  return new Promise<string>((resolve) => {
    const rl = createInterface();

    const ask = (): void => {
      rl.question(prompt, (answer: string) => {
        const trimmed = answer.trim();
        const value = trimmed === '' && defaultValue !== undefined ? defaultValue : trimmed;

        if (validator) {
          const error = validator(value);
          if (error) {
            console.log(`  Error: ${error}`);
            ask();
            return;
          }
        }

        rl.close();
        resolve(value);
      });
    };

    ask();
  });
}

/**
 * Single-select prompt
 * @param message prompt message
 * @param choices choice list
 * @param defaultValue the value selected by default
 * @returns the value chosen by the user
 */
export function select(
  message: string,
  choices: SelectChoice[],
  defaultValue?: string,
): Promise<string> {
  ensureTty();

  console.log(message);
  choices.forEach((choice: SelectChoice, index: number) => {
    const marker = defaultValue === choice.value ? '*' : ' ';
    console.log(`  ${marker} ${index + 1}. ${choice.name}`);
  });

  const hint = defaultValue !== undefined ? ` (default: ${defaultValue})` : '';

  return new Promise<string>((resolve) => {
    const rl = createInterface();

    const ask = (): void => {
      rl.question(`Select option (1-${choices.length})${hint}: `, (answer: string) => {
        const trimmed = answer.trim();

        if (trimmed === '' && defaultValue !== undefined) {
          rl.close();
          resolve(defaultValue);
          return;
        }

        const index = parseInt(trimmed, 10) - 1;
        if (Number.isNaN(index) || index < 0 || index >= choices.length) {
          console.log('  Invalid selection. Please try again.');
          ask();
          return;
        }

        rl.close();
        resolve(choices[index].value);
      });
    };

    ask();
  });
}

/**
 * Multi-select prompt
 * @param message prompt message
 * @param choices choice list (items with checked=true are selected by default)
 * @returns the array of values chosen by the user
 */
export function multiSelect(message: string, choices: MultiSelectChoice[]): Promise<string[]> {
  ensureTty();

  console.log(message);
  choices.forEach((choice: MultiSelectChoice, index: number) => {
    const marker = choice.checked ? '[x]' : '[ ]';
    console.log(`  ${marker} ${index + 1}. ${choice.name}`);
  });
  console.log('  Enter comma-separated numbers (e.g., 1,3,5). Empty for defaults.');

  return new Promise<string[]>((resolve) => {
    const rl = createInterface();

    const ask = (): void => {
      rl.question('Select options: ', (answer: string) => {
        const trimmed = answer.trim();

        if (trimmed === '') {
          const defaults = choices
            .filter((c: MultiSelectChoice) => c.checked)
            .map((c: MultiSelectChoice) => c.value);
          rl.close();
          resolve(defaults);
          return;
        }

        const indices = trimmed.split(',').map((s: string) => parseInt(s.trim(), 10) - 1);

        const invalid = indices.some(
          (i: number) => Number.isNaN(i) || i < 0 || i >= choices.length,
        );

        if (invalid) {
          console.log('  Invalid selection. Please try again.');
          ask();
          return;
        }

        rl.close();
        resolve(indices.map((i: number) => choices[i].value));
      });
    };

    ask();
  });
}

/**
 * Password input (characters are not echoed; replaced with *)
 * @param message prompt message
 * @returns the password entered by the user
 */
export function password(message: string): Promise<string> {
  ensureTty();

  process.stdout.write(`${message}: `);

  return new Promise<string>((resolve) => {
    const stdin = process.stdin as tty.ReadStream;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');

    let pw = '';

    const onData = (char: string): void => {
      // Enter / Return
      if (char === '\r' || char === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(pw);
        return;
      }

      // Ctrl+C
      if (char === '\u0003') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        process.exit(1);
      }

      // Backspace / Delete
      if (char === '\u007f' || char === '\b') {
        if (pw.length > 0) {
          pw = pw.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }

      // Normal character
      pw += char;
      process.stdout.write('*');
    };

    stdin.on('data', onData);
  });
}

/** Interactive prompt toolkit */
export const InteractivePrompts = {
  confirm,
  input,
  select,
  multiSelect,
  password,
};
