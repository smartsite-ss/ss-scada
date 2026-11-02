// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Minimal JSONPath parser (no external dependency)
 *
 * Supported syntax:
 *  - `$.field`           root field
 *  - `$.a.b.c`           nested field
 *  - `$.array[0]`         array index
 *  - `$.array[*]`         array wildcard (returns an array of mapped results for all elements)
 *  - `$.a[0].b[1].c`     mixed path
 *
 * Not supported: filter expressions `?(@.price < 10)`, recursive descent `..`, slices `[1:3]`.
 */

/** JSONPath path segment (field name / array index / wildcard) */
type PathToken = string | number | '*';

export class JsonPathUtil {
  /**
   * Extract a value from JSON data by JSONPath.
   *
   * @param data    parsed JSON data (object/array/scalar)
   * @param jsonPath JSONPath expression, e.g. `$.sensors[0].value`
   * @returns the extracted value; returns `undefined` when the path does not exist
   */
  static extract(data: unknown, jsonPath: string): unknown {
    if (data === null || data === undefined) return undefined;
    if (!jsonPath || typeof jsonPath !== 'string') return data;

    const tokens = JsonPathUtil.parse(jsonPath);
    if (tokens.length === 0) return data;

    return JsonPathUtil.evaluate(data, tokens);
  }

  /**
   * Parse a JSONPath string into an array of path segments.
   *
   * `$.data[0].value` -> `['data', 0, 'value']`
   * `$.array[*]`      -> `['array', '*']`
   */
  private static parse(jsonPath: string): PathToken[] {
    let path = jsonPath.trim();

    // Strip the leading $ and an optional .
    if (path.startsWith('$')) {
      path = path.slice(1);
      if (path.startsWith('.')) {
        path = path.slice(1);
      }
    }

    if (!path) return [];

    const tokens: PathToken[] = [];
    let i = 0;

    while (i < path.length) {
      const ch = path[i];

      // Skip delimiters
      if (ch === '.') {
        i++;
        continue;
      }

      // Array access [index] or [*]
      if (ch === '[') {
        const closeIdx = path.indexOf(']', i);
        if (closeIdx === -1) return []; // syntax error: unclosed [
        const inner = path.slice(i + 1, closeIdx).trim();

        if (inner === '*') {
          tokens.push('*');
        } else {
          const idx = parseInt(inner, 10);
          if (Number.isNaN(idx)) return []; // syntax error: non-numeric index
          tokens.push(idx);
        }
        i = closeIdx + 1;
        continue;
      }

      // Field name: read until a . or [ is encountered
      let end = i;
      while (end < path.length && path[end] !== '.' && path[end] !== '[') {
        end++;
      }
      const field = path.slice(i, end).trim();
      if (field) tokens.push(field);
      i = end;
    }

    return tokens;
  }

  /**
   * Recursive evaluation: visit data step by step following the path segments.
   * On the wildcard `*` it applies the remaining segments to each array element and returns an array of results.
   */
  private static evaluate(data: unknown, tokens: ReadonlyArray<PathToken>): unknown {
    if (tokens.length === 0) return data;
    if (data === null || data === undefined) return undefined;

    const [token, ...rest] = tokens;

    // Wildcard: the current data must be an array
    if (token === '*') {
      if (!Array.isArray(data)) return undefined;
      return data.map((item) => JsonPathUtil.evaluate(item, rest));
    }

    // Array index
    if (typeof token === 'number') {
      if (!Array.isArray(data)) return undefined;
      return JsonPathUtil.evaluate(data[token], rest);
    }

    // Field name
    if (typeof data !== 'object') return undefined;
    return JsonPathUtil.evaluate((data as Record<string, unknown>)[token], rest);
  }
}
