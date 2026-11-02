// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { TransformStep } from '../pipeline/steps/transform.step';
import { PipelineContext } from '../pipeline/pipeline-orchestrator';

function makeContext(overrides: Partial<PipelineContext>): PipelineContext {
  return {
    tagId: 'tag-001',
    deviceId: 'device-001',
    projectId: 'project-001',
    rawValue: null,
    transformedValue: null,
    quality: 'good',
    shouldPersist: true,
    shouldPublish: true,
    startTime: Date.now(),
    errors: [],
    ...overrides,
  };
}

describe('TransformStep — data type semantics preservation', () => {
  const step = new TransformStep();

  describe("Boolean type (compatible with point-table spec 'boolean')", () => {
    it("dataType='boolean' with boolean rawValue should keep boolean semantics", async () => {
      const ctx = makeContext({
        rawValue: true,
        tagConfig: { dataType: 'boolean' },
      });
      const result = await step.process(ctx);
      expect(result.transformedValue).toBe(true);
      expect(result.quality).toBe('good');
    });

    it("dataType='bool' (legacy notation) also keeps boolean semantics", async () => {
      const ctx = makeContext({
        rawValue: false,
        tagConfig: { dataType: 'bool' },
      });
      const result = await step.process(ctx);
      expect(result.transformedValue).toBe(false);
    });

    it("dataType='boolean' with rawValue 0/1 should convert to boolean", async () => {
      const ctx = makeContext({
        rawValue: 1,
        tagConfig: { dataType: 'boolean' },
      });
      const result = await step.process(ctx);
      expect(result.transformedValue).toBe(true);
    });

    it("dataType='boolean' with an invalid rawValue should be marked quality bad", async () => {
      const ctx = makeContext({
        rawValue: 42,
        tagConfig: { dataType: 'boolean' },
      });
      const result = await step.process(ctx);
      expect(result.transformedValue).toBeNull();
      expect(result.quality).toBe('bad');
    });
  });

  describe('Numeric type regression protection', () => {
    it("dataType='float32' with boolean rawValue should convert to 0/1 numbers", async () => {
      const ctx = makeContext({
        rawValue: true,
        tagConfig: { dataType: 'float32' },
      });
      const result = await step.process(ctx);
      expect(result.transformedValue).toBe(1);
    });

    it("dataType='string' should convert numbers to strings and keep them", async () => {
      const ctx = makeContext({
        rawValue: 'OK',
        tagConfig: { dataType: 'string' },
      });
      const result = await step.process(ctx);
      expect(result.transformedValue).toBe('OK');
    });
  });
});
