// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { JsonPathUtil } from '../jsonpath.util';

describe('JsonPathUtil', () => {
  // -------------------------------------------------------------
  // extract() - basic scenarios
  // -------------------------------------------------------------
  describe('extract basic scenarios', () => {
    it('Should return undefined when data is null', () => {
      expect(JsonPathUtil.extract(null, '$.field')).toBeUndefined();
    });

    it('Should return undefined when data is undefined', () => {
      expect(JsonPathUtil.extract(undefined, '$.field')).toBeUndefined();
    });

    it('When jsonPath is an empty string, data should be returned as-is', () => {
      const data = { a: 1 };
      expect(JsonPathUtil.extract(data, '')).toBe(data);
    });

    it('When jsonPath is not a string, data should be returned as-is', () => {
      const data = { a: 1 };
      expect(JsonPathUtil.extract(data, null)).toBe(data);
    });

    it('When jsonPath is only $, data should be returned as-is', () => {
      const data = { a: 1 };
      expect(JsonPathUtil.extract(data, '$')).toBe(data);
    });

    it('When jsonPath is $., data should be returned as-is', () => {
      const data = { a: 1 };
      expect(JsonPathUtil.extract(data, '$.')).toBe(data);
    });
  });

  // -------------------------------------------------------------
  // extract() - root field
  // -------------------------------------------------------------
  describe('extract root field', () => {
    it('Should extract the top-level field $.field', () => {
      const data = { name: '温度传感器', value: 42 };
      expect(JsonPathUtil.extract(data, '$.name')).toBe('温度传感器');
      expect(JsonPathUtil.extract(data, '$.value')).toBe(42);
    });

    it('Should return undefined when the field does not exist', () => {
      const data = { name: '传感器' };
      expect(JsonPathUtil.extract(data, '$.missing')).toBeUndefined();
    });

    it('Should return null when the field value is null', () => {
      const data = { name: null };
      expect(JsonPathUtil.extract(data, '$.name')).toBeNull();
    });

    it('Should return 0 when the field value is 0', () => {
      const data = { value: 0 };
      expect(JsonPathUtil.extract(data, '$.value')).toBe(0);
    });

    it('Should return false when the field value is false', () => {
      const data = { active: false };
      expect(JsonPathUtil.extract(data, '$.active')).toBe(false);
    });
  });

  // -------------------------------------------------------------
  // extract() - nested field
  // -------------------------------------------------------------
  describe('extract nested fields', () => {
    it('Should extract the nested field $.a.b.c', () => {
      const data = { a: { b: { c: 'deep' } } };
      expect(JsonPathUtil.extract(data, '$.a.b.c')).toBe('deep');
    });

    it('Should return undefined when an intermediate field of the nested path does not exist', () => {
      const data = { a: { b: {} } };
      expect(JsonPathUtil.extract(data, '$.a.b.c.missing')).toBeUndefined();
    });

    it('Should return undefined when an intermediate field of the nested path is null', () => {
      const data = { a: { b: null } };
      expect(JsonPathUtil.extract(data, '$.a.b.c')).toBeUndefined();
    });

    it('Should return undefined when an intermediate field of the nested path is not an object', () => {
      const data = { a: { b: 'string' } };
      expect(JsonPathUtil.extract(data, '$.a.b.c')).toBeUndefined();
    });

    it('Should support multi-level nested numeric field values', () => {
      const data = {
        sensor: {
          reading: {
            value: 23.5,
            unit: '°C',
          },
        },
      };
      expect(JsonPathUtil.extract(data, '$.sensor.reading.value')).toBe(23.5);
      expect(JsonPathUtil.extract(data, '$.sensor.reading.unit')).toBe('°C');
    });
  });

  // -------------------------------------------------------------
  // extract() - array index
  // -------------------------------------------------------------
  describe('extract array indexes', () => {
    it('Should extract the array element $.array[0]', () => {
      const data = { array: [10, 20, 30] };
      expect(JsonPathUtil.extract(data, '$.array[0]')).toBe(10);
      expect(JsonPathUtil.extract(data, '$.array[1]')).toBe(20);
      expect(JsonPathUtil.extract(data, '$.array[2]')).toBe(30);
    });

    it('Should return undefined when the array index is out of bounds', () => {
      const data = { array: [1, 2, 3] };
      expect(JsonPathUtil.extract(data, '$.array[5]')).toBeUndefined();
    });

    it('Should return undefined when accessing by index on a non-array field', () => {
      const data = { array: 'not an array' };
      expect(JsonPathUtil.extract(data, '$.array[0]')).toBeUndefined();
    });

    it('Should support index access when data itself is an array', () => {
      const data = ['a', 'b', 'c'];
      expect(JsonPathUtil.extract(data, '$[0]')).toBe('a');
      expect(JsonPathUtil.extract(data, '$[2]')).toBe('c');
    });
  });

  // -------------------------------------------------------------
  // extract() - wildcard *
  // -------------------------------------------------------------
  describe('extract wildcards', () => {
    it('Wildcard should map all array elements $.array[*]', () => {
      const data = { array: [1, 2, 3] };
      expect(JsonPathUtil.extract(data, '$.array[*]')).toEqual([1, 2, 3]);
    });

    it('A wildcard followed by a field should map that field of every element', () => {
      const data = {
        sensors: [
          { name: 'a', value: 1 },
          { name: 'b', value: 2 },
          { name: 'c', value: 3 },
        ],
      };
      expect(JsonPathUtil.extract(data, '$.sensors[*].value')).toEqual([1, 2, 3]);
    });

    it('Should return undefined when the wildcard applies to a non-array', () => {
      const data = { array: 'not array' };
      expect(JsonPathUtil.extract(data, '$.array[*]')).toBeUndefined();
    });

    it('Wildcards with an empty array should return an empty array', () => {
      const data = { array: [] };
      expect(JsonPathUtil.extract(data, '$.array[*]')).toEqual([]);
    });

    it('Should map correctly when wildcard elements are objects', () => {
      const data = {
        items: [{ x: 1 }, { x: 2 }, { x: 3 }],
      };
      expect(JsonPathUtil.extract(data, '$.items[*].x')).toEqual([1, 2, 3]);
    });
  });

  // -------------------------------------------------------------
  // extract() - mixed path
  // -------------------------------------------------------------
  describe('extract mixed path', () => {
    it('Should support the mixed path $.a[0].b[1].c', () => {
      const data = {
        a: [
          {
            b: [{ c: 'first' }, { c: 'second' }],
          },
        ],
      };
      expect(JsonPathUtil.extract(data, '$.a[0].b[1].c')).toBe('second');
    });

    it('Should support wildcards mixed with indexes $.a[*].b[0]', () => {
      const data = {
        a: [{ b: [{ c: 1 }] }, { b: [{ c: 2 }] }],
      };
      expect(JsonPathUtil.extract(data, '$.a[*].b[0].c')).toEqual([1, 2]);
    });

    it('Should support consecutive indexes $.a[0][0]', () => {
      const data = {
        a: [
          [1, 2],
          [3, 4],
        ],
      };
      expect(JsonPathUtil.extract(data, '$.a[0][0]')).toBe(1);
      expect(JsonPathUtil.extract(data, '$.a[1][0]')).toBe(3);
      expect(JsonPathUtil.extract(data, '$.a[0][1]')).toBe(2);
    });
  });

  // -------------------------------------------------------------
  // extract() - syntax error
  // -------------------------------------------------------------
  describe('extract syntax error handling', () => {
    it('An unclosed [ should return empty (path resolves to empty)', () => {
      const data = { array: [1, 2] };
      // An unclosed [ causes parse to return an empty array, and extract returns data itself
      expect(JsonPathUtil.extract(data, '$.array[0')).toBe(data);
    });

    it('Non-numeric index should return data (parse failure)', () => {
      const data = { array: [1, 2] };
      // A non-numeric index causes parse to return an empty array
      expect(JsonPathUtil.extract(data, '$.array[abc]')).toBe(data);
    });

    it('Field names containing dots should be treated as separate fields', () => {
      const data = { a: { b: 1 } };
      expect(JsonPathUtil.extract(data, '$.a.b')).toBe(1);
    });
  });

  // -------------------------------------------------------------
  // extract() - scalar data
  // -------------------------------------------------------------
  describe('extract scalar data', () => {
    it('Should return undefined when accessing by field on string data', () => {
      expect(JsonPathUtil.extract('hello', '$.length')).toBeUndefined();
    });

    it('Should return undefined when accessing by field on numeric data', () => {
      expect(JsonPathUtil.extract(42, '$.field')).toBeUndefined();
    });

    it('Should return undefined when accessing by field on boolean data', () => {
      expect(JsonPathUtil.extract(true, '$.field')).toBeUndefined();
    });

    it('Should return data as-is when data is a string and the path is $', () => {
      expect(JsonPathUtil.extract('hello', '$')).toBe('hello');
    });
  });
});
