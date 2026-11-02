// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Declarative graphic property binding
 *
 * Configured in graphic customProps.bindings, automatically parsed and executed
 * by the BindingEngine. Supports bidirectional cross-graphic property sync
 * without hand-written linkage code.
 */
export interface IGraphicBinding {
  /** Source graphic ID ("self" means itself) */
  sourceId: string;

  /** Source property path, e.g. "customProps.value" */
  sourcePath: string;

  /** Target graphic ID */
  targetId: string;

  /** Target property path */
  targetPath: string;

  /** Optional: transform function name or custom function */
  transform?: string | ((value: any) => any);

  /** Optional: trigger condition */
  condition?: {
    field: string;
    operator: string;
    value: any;
  };
}
